jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase, DatabaseTestUtils } from "./database-test-utils";

// Production runs sql.js with `PRAGMA foreign_keys` OFF (it is a per-connection
// setting that defaults off and is not stored in the DB file; the plugin only
// turns it on when creating a fresh DB or migrating). So the `flashcards.deck_id
// → decks ON DELETE CASCADE` never fires in a normal session, and deleting a
// deck's file leaves its cards behind as orphans (still shown in filter decks,
// still reviewable, colliding on re-import). Deck deletion must remove the cards
// itself, independent of FK enforcement. Each test flips FK off to mirror prod.
describe("deleting a deck removes its cards (FK enforcement off, as in production)", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function seedDeck(): Promise<{ filepath: string; deckId: string; cardIds: string[] }> {
    const deck = DatabaseTestUtils.createTestDeck();
    await db.createDeck(deck);
    const cardIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const fc = DatabaseTestUtils.createTestFlashcard(deck.id, { front: `Q${i}`, back: `A${i}` });
      await db.createFlashcard(fc);
      cardIds.push(fc.id);
    }
    return { filepath: deck.filepath, deckId: deck.id, cardIds };
  }

  it("deleteDeckByFilepath removes the deck's cards with FK OFF", async () => {
    const { filepath } = await seedDeck();
    await db["executeSql"]("PRAGMA foreign_keys = OFF", []);
    expect(await db.countAllCards()).toBe(3);

    await db.deleteDeckByFilepath(filepath);

    expect(await db.countAllCards()).toBe(0);
  });

  it("deleteDeck(id) removes the deck's cards with FK OFF", async () => {
    const { deckId } = await seedDeck();
    await db["executeSql"]("PRAGMA foreign_keys = OFF", []);

    await db.deleteDeck(deckId);

    expect(await db.countAllCards()).toBe(0);
  });

  it("also clears custom-deck memberships for the deleted cards", async () => {
    const { filepath, cardIds } = await seedDeck();
    const cdId = await db.createCustomDeck("Study");
    await db.addCardsToCustomDeck(cdId, cardIds);
    expect(await db.countTotalCardsCustomDeck(cdId)).toBe(3);
    await db["executeSql"]("PRAGMA foreign_keys = OFF", []);

    await db.deleteDeckByFilepath(filepath);

    expect(await db.countAllCards()).toBe(0);
    expect(await db.countTotalCardsCustomDeck(cdId)).toBe(0);
  });

  it("one-time prune removes already-orphaned cards + memberships, keeps live cards", async () => {
    await seedDeck(); // 3 live cards under a live deck

    // An already-orphaned card: create a deck + card, then delete ONLY the deck
    // row with FK off (exactly the pre-fix leftover state).
    const orphanDeck = DatabaseTestUtils.createTestDeck({ filepath: "/orphan/deck.md" });
    await db.createDeck(orphanDeck);
    const orphanCard = DatabaseTestUtils.createTestFlashcard(orphanDeck.id, { front: "Orphan" });
    await db.createFlashcard(orphanCard);
    const cdId = await db.createCustomDeck("Mix");
    await db.addCardsToCustomDeck(cdId, [orphanCard.id]);

    await db["executeSql"]("PRAGMA foreign_keys = OFF", []);
    await db["executeSql"]("DELETE FROM decks WHERE id = ?", [orphanDeck.id]);
    expect(await db.countAllCards()).toBe(4); // 3 live + 1 orphan

    const pruned = await db.pruneOrphanedFlashcards();

    expect(pruned).toBe(1);
    expect(await db.countAllCards()).toBe(3); // live cards untouched
    expect(await db.countTotalCardsCustomDeck(cdId)).toBe(0); // orphan membership gone
  });
});
