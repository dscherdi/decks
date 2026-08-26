jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase, DatabaseTestUtils } from "./database-test-utils";
import { generateFlashcardId } from "@decks/core";
import type { Deck, DeckProfile } from "../../database/types";

// Smart Rename Detection pairs a delete (old front) with a create (new front) so
// an edited card keeps its scheduling state. Matching is by identical back,
// resolved through a Map. The front-similarity pass that used to catch the rest
// is gone: it was a guess, and a capped one, disabled on exactly the large decks
// where renames are most likely. An anchor carries those cases exactly instead.
describe("rename detection: state survives edits, degraded paths stay safe", () => {
  let db: MainDatabaseService;
  let profile: DeckProfile;
  let deck: Deck;

  const table = (rows: Array<[string, string]>): string =>
    "## T\n\n| Front | Back |\n| --- | --- |\n" +
    rows.map(([f, b]) => `| ${f} | ${b} |`).join("\n") +
    "\n";

  async function sync(content: string): Promise<void> {
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });
  }

  beforeEach(async () => {
    db = await setupTestDatabase();
    profile = await db.getDefaultProfile();
    deck = DatabaseTestUtils.createTestDeck();
    await db.createDeck(deck);
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("strong match (identical back): front rename keeps scheduling state", async () => {
    await sync(table([["la maison", "the house"]]));
    const oldId = generateFlashcardId("la maison");
    await db.updateFlashcard(oldId, { state: "review", stability: 7.7 });

    await sync(table([["la maison!!", "the house"]])); // front edited, back identical

    const [card] = await db.getFlashcardsByDeck(deck.id);
    expect(card.id).toBe(generateFlashcardId("la maison!!"));
    expect(card.state).toBe("review");
    expect(card.stability).toBe(7.7); // migrated, not recreated
  });

  it("both sides edited, unanchored: state is not inherited", async () => {
    await sync(table([["le chien noir", "the black dog"]]));
    await db.updateFlashcard(generateFlashcardId("le chien noir"), {
      state: "review",
      stability: 3.3,
    });

    // Front and back both edited: nothing identical to match on, and no anchor
    // to match by. This is the case the front-similarity guess used to cover.
    await sync(table([["le chien noir!", "the black dog (new wording)"]]));

    const [card] = await db.getFlashcardsByDeck(deck.id);
    expect(card.id).toBe(generateFlashcardId("le chien noir!"));
    expect(card.stability).not.toBe(3.3);
  });

  it("both sides edited, anchored: state migrates exactly", async () => {
    const row = (front: string, back: string): string =>
      `## T\n\n| Front | Back |\n| --- | --- |\n| ${front} | ${back} %%dk:t:tok1%% |\n`;

    await sync(row("le chien noir", "the black dog"));
    const oldId = generateFlashcardId("le chien noir");
    await db.updateFlashcard(oldId, {
      state: "review",
      stability: 3.3,
      repetitions: 3,
      lastReviewed: new Date().toISOString(),
    });

    // Adopt-only: a binding is written when the token meets a card that already
    // carries review history — hence the repetitions above, not just stability.
    await sync(row("le chien noir", "the black dog"));

    await sync(row("le chien noir!", "the black dog (new wording)"));

    const [card] = await db.getFlashcardsByDeck(deck.id);
    expect(card.id).toBe(oldId);
    expect(card.stability).toBe(3.3);
  });

  it("length-ratio filter: an unrelated replacement does NOT inherit state", async () => {
    await sync(table([["cat", "a feline"]]));
    await db.updateFlashcard(generateFlashcardId("cat"), { state: "review", stability: 9.9 });

    // Both sides completely different → neither strong nor fuzzy should pair.
    await sync(table([["a much longer unrelated front", "totally new content"]]));

    const [card] = await db.getFlashcardsByDeck(deck.id);
    expect(card.id).toBe(generateFlashcardId("a much longer unrelated front"));
    expect(card.state).toBe("new"); // fresh card, no inherited scheduling
  });

  it("pair budget exceeded: strong matches still migrate, sync completes", async () => {
    // 460 cards; on re-sync every front AND back changes except one strong-match
    // card → 459×459 ≈ 210k fuzzy pairs > 200k budget → fuzzy pass skipped.
    const n = 460;
    const first: Array<[string, string]> = [];
    const second: Array<[string, string]> = [];
    for (let i = 0; i < n; i++) {
      first.push([`front-alpha-${i}`, `back-alpha-${i}`]);
      second.push([`front-beta-${i}`, `back-beta-${i}`]);
    }
    // One card keeps its back (strong match candidate) with a renamed front.
    first[0] = ["keeper-front", "shared back"];
    second[0] = ["keeper-front-renamed", "shared back"];

    await sync(table(first));
    await db.updateFlashcard(generateFlashcardId("keeper-front"), {
      state: "review",
      stability: 5.5,
    });

    await sync(table(second));

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(n); // all landed despite skipped fuzzy pass
    const keeper = cards.find((c) => c.id === generateFlashcardId("keeper-front-renamed"));
    expect(keeper?.stability).toBe(5.5); // strong match still migrated
  });
});
