jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase, DatabaseTestUtils } from "./database-test-utils";
import { generateDeckId, generateFlashcardId } from "@decks/core";
import type { Deck } from "../../database/types";

// The Anki import reserves fronts already taken by live decks OUTSIDE its target
// folder: a colliding imported card gets a " (2)" suffix (rendered upstream) so
// it lands as its own card instead of being dropped by the live-deck UPSERT
// guard. This covers the helper's semantics and the end-to-end landing.
describe("reserved fronts: import lands complete next to existing decks", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function seedCard(filepath: string, front: string): Promise<Deck> {
    const deck = DatabaseTestUtils.createTestDeck({
      id: generateDeckId(filepath),
      filepath,
    });
    await db.createDeck(deck);
    const card = DatabaseTestUtils.createTestFlashcard(deck.id, { front, back: "b" });
    card.id = generateFlashcardId(front);
    await db.createFlashcard(card);
    return deck;
  }

  it("getFrontsOutsidePath excludes the import's own target folder", async () => {
    await seedCard("exam/deck.md", "tie");
    await seedCard("Anki Import/Old/deck.md", "être");

    const fronts = await db.getFrontsOutsidePath("Anki Import/");

    expect(fronts).toContain("tie"); // other live deck → reserved
    expect(fronts).not.toContain("être"); // re-import target → not reserved
  });

  it("getFrontsOutsidePath excludes ORPHANED cards (they stay adoptable)", async () => {
    const orphanDeck = await seedCard("gone/deck.md", "avoir");
    await db["executeSql"]("PRAGMA foreign_keys = OFF", []);
    await db["executeSql"]("DELETE FROM decks WHERE id = ?", [orphanDeck.id]);

    const fronts = await db.getFrontsOutsidePath("Anki Import/");

    // The orphan's front is NOT reserved — the sync upsert adopts the orphan
    // (preserving its history) instead of creating a suffixed duplicate.
    expect(fronts).not.toContain("avoir");
  });

  it("a suffixed import lands as its own card; the other deck keeps its card", async () => {
    const examDeck = await seedCard("exam/deck.md", "tie");

    // Simulate the import result: the renderer suffixed the colliding front, so
    // the new deck's file content carries "tie (2)".
    const filepath = "Anki Import/EN/deck.md";
    const newDeck = DatabaseTestUtils.createTestDeck({ id: generateDeckId(filepath), filepath });
    await db.createDeck(newDeck);
    const profile = await db.getDefaultProfile();
    await db.syncFlashcardsForDeck({
      deckId: newDeck.id,
      deckName: newDeck.name,
      deckFilepath: filepath,
      deckConfig: profile,
      fileContent: "## T\n\n| Front | Back |\n| --- | --- |\n| tie (2) | necktie |\n",
    });

    expect(await db.countAllCards()).toBe(2); // both cards exist
    const inExam = await db.getFlashcardsByDeck(examDeck.id);
    expect(inExam.map((c) => c.front)).toEqual(["tie"]); // untouched
    const inNew = await db.getFlashcardsByDeck(newDeck.id);
    expect(inNew.map((c) => c.front)).toEqual(["tie (2)"]); // landed, not merged
  });
});
