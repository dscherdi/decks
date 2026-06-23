import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import { createRealDatabase } from "./setup-real-sql";
import {
  AnkiCollectionParser,
  AnkiDeckRenderer,
  AnkiHistoryImporter,
  generateDeckId,
} from "@decks/core";
import type { AnkiDeckItem, AnkiRenderedDeck, DeckProfile, RawDatabase } from "@decks/core";

// The 18MB sample lives at the repo root (not committed as a fixture). Skip
// gracefully when it is absent so CI without the file still passes.
const APKG_PATH = resolve(__dirname, "../../../../../test-anki-deck.apkg");
const HAS_APKG = existsSync(APKG_PATH);
const describeIf = HAS_APKG ? describe : describe.skip;

function loadCollection(): RawDatabase {
  const entries = unzipSync(new Uint8Array(readFileSync(APKG_PATH)));
  const bytes = entries["collection.anki21"] ?? entries["collection.anki2"];
  return createRealDatabase(bytes) as unknown as RawDatabase;
}

describeIf("Anki import pipeline (integration)", () => {
  let db: MainDatabaseService;
  let profile: DeckProfile;

  beforeEach(async () => {
    db = await setupTestDatabase();
    profile = await db.getDefaultProfile();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("parses notes/cards and resolves field roles", () => {
    const parsed = AnkiCollectionParser.parse(loadCollection());
    expect(parsed.cardCount).toBeGreaterThan(400);
    expect(parsed.noteCount).toBeGreaterThan(200);
    expect(parsed.deckNames.some((name) => /German/i.test(name))).toBe(true);
    expect(parsed.mediaFiles.some((name) => name.endsWith(".mp3"))).toBe(true);

    const forward = parsed.cards.find((c) => c.front === "Das Wetter ist heute schön.");
    expect(forward).toBeDefined();
    expect(forward?.back).toContain("The weather is nice today.");

    // The reverse template yields an independent card with swapped roles.
    const reverse = parsed.cards.find((c) => c.front === "The weather is nice today.");
    expect(reverse).toBeDefined();
    expect(reverse?.back).toContain("Das Wetter ist heute schön.");
  });

  it("renders header-paragraph markdown that the real parser can sync", async () => {
    const parsed = AnkiCollectionParser.parse(loadCollection());
    const decks = AnkiDeckRenderer.render(parsed.cards, "decks/anki", profile.headerLevel);
    expect(decks.length).toBeGreaterThan(1);

    // Sync the largest deck and confirm cards land in the database.
    const largest = decks.reduce((a, b) => (b.cards.length > a.cards.length ? b : a));
    const filepath = `Anki Import/${largest.relativePath}.md`;
    const deckId = await syncDeck(filepath, largest);

    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.front.trim().length > 0)).toBe(true);
  });

  it("runs history import without injecting state for an all-new deck", async () => {
    const parsed = AnkiCollectionParser.parse(loadCollection());
    const decks = AnkiDeckRenderer.render(parsed.cards, "decks/anki", profile.headerLevel);

    const items: AnkiDeckItem[] = [];
    for (const deck of decks) {
      const filepath = `Anki Import/${deck.relativePath}.md`;
      await syncDeck(filepath, deck);
      items.push({
        deckId: generateDeckId(filepath),
        profileFsrs: { requestRetention: profile.fsrs.requestRetention, profile: profile.fsrs.profile },
        cards: deck.cards,
      });
    }

    const collection = loadCollection();
    const result = await AnkiHistoryImporter.importHistory(db, items, {
      collectionCreatedMs: AnkiCollectionParser.readCollectionCreatedMs(collection),
      revlogByCard: AnkiCollectionParser.readRevlog(collection),
    });
    // The sample deck is entirely new (empty revlog), so nothing is injected.
    expect(result.injected).toBe(0);
    expect(result.reviews).toBe(0);
  });

  async function syncDeck(filepath: string, deck: AnkiRenderedDeck): Promise<string> {
    const deckId = generateDeckId(filepath);
    await db.createDeck({
      id: deckId,
      name: filepath,
      filepath,
      tag: "#decks",
      lastReviewed: null,
      profileId: profile.id,
    });
    await db.syncFlashcardsForDeck({
      deckId,
      deckName: filepath,
      deckFilepath: filepath,
      deckConfig: profile,
      fileContent: deck.content,
      reverseCards: false,
      clozeEnabled: profile.clozeEnabled,
    });
    return deckId;
  }
});
