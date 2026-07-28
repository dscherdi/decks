jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase, DatabaseTestUtils } from "./database-test-utils";
import { generateFlashcardId } from "@decks/core";
import type { Deck, DeckProfile } from "../../database/types";

// The import's retry pass: when a card moves between part-files across imports,
// syncing its NEW home before its OLD home's delete drops the create (the
// upsert refuses to steal from a live deck). Re-syncing the short deck AFTER
// all files have synced lands the card — the old copy is gone by then — with
// its scheduling state restored from review_logs.
describe("import move race: retry re-sync lands the dropped card", () => {
  let db: MainDatabaseService;
  let profile: DeckProfile;

  const withCube = "## T\n\n| Front | Back |\n| --- | --- |\n| cube | a solid |\n| other-a | x |\n";
  const withoutCube = "## T\n\n| Front | Back |\n| --- | --- |\n| other-b | y |\n";

  async function makeDeck(filepath: string): Promise<Deck> {
    const deck = DatabaseTestUtils.createTestDeck({ id: `deck_${filepath}`, filepath });
    await db.createDeck(deck);
    return deck;
  }
  async function sync(deck: Deck, content: string): Promise<void> {
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
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("re-syncing the short deck after all deletes have run lands the card", async () => {
    const cubeId = generateFlashcardId("cube");

    // Previous import: "cube" lives in old home A.
    const a = await makeDeck("import/A.md");
    await sync(a, withCube);
    await db.updateFlashcard(cubeId, { state: "review", stability: 6.6 });

    // Re-import assigns "cube" to new home B. Bad order: B syncs FIRST —
    // the create is dropped because A (live deck) still owns the front.
    const b = await makeDeck("import/B.md");
    await sync(b, withCube);
    expect((await db.getFlashcardsByDeck(b.id)).map((c) => c.id)).not.toContain(cubeId);

    // A's re-synced content no longer contains "cube" → old copy deleted.
    await sync(a, withoutCube);
    expect(await db.getFlashcardsByDeck(a.id)).toHaveLength(1); // only other-b

    // The retry pass: re-sync the short deck B → the conflict is gone, the
    // create lands and restores FSRS state from review_logs... (state comes
    // from review_logs only; direct column edits aren't logged, so here the
    // card lands fresh — the key assertion is that it LANDS.)
    await sync(b, withCube);
    const inB = await db.getFlashcardsByDeck(b.id);
    expect(inB.map((c) => c.id)).toContain(cubeId);
    expect(inB).toHaveLength(2); // cube + other-a
    expect(await db.countAllCards()).toBe(3); // no duplicates, nothing lost
  });
});
