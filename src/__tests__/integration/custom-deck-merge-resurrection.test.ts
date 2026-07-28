jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter, DatabaseTestUtils } from "./database-test-utils";

// InMemoryAdapter reports a fixed mtime of 0, so the merge-before-save never
// fires. This subclass lets a test bump the disk mtime to force a merge from the
// stale on-disk snapshot — the situation iCloud/Dropbox create routinely.
class MtimeAdapter extends InMemoryAdapter {
  public mtimeValue = 0;
  async stat(_path: string): Promise<{ type: string; size: number; mtime: number; ctime: number }> {
    return { type: "file", size: 0, mtime: this.mtimeValue, ctime: 0 };
  }
}

describe("custom_deck_cards merge does not resurrect removed memberships", () => {
  let adapter: MtimeAdapter;
  let db: MainDatabaseService;

  beforeEach(async () => {
    adapter = new MtimeAdapter();
    db = new MainDatabaseService("test.db", adapter, () => {});
    await db.initialize();
  });
  afterEach(async () => {
    await db.close();
  });

  it("keeps a removed card removed after a newer-mtime disk merge", async () => {
    const deck = DatabaseTestUtils.createTestDeck();
    await db.createDeck(deck);
    const cardIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const fc = DatabaseTestUtils.createTestFlashcard(deck.id, { front: `Q${i}`, back: `A${i}` });
      await db.createFlashcard(fc);
      cardIds.push(fc.id);
    }
    const cdId = await db.createCustomDeck("Study");
    await db.addCardsToCustomDeck(cdId, cardIds);
    expect(await db.countTotalCardsCustomDeck(cdId)).toBe(3);

    // Snapshot to disk — the stale snapshot still has all 3 memberships.
    await db.save();

    // Remove one card (DELETE + tombstone), WITHOUT saving.
    await db.removeCardsFromCustomDeck(cdId, [cardIds[0]]);
    expect(await db.countTotalCardsCustomDeck(cdId)).toBe(2);

    // A newer disk mtime forces a merge from the stale 3-card snapshot.
    adapter.mtimeValue = 1;
    await db.syncWithDisk();

    // The removed membership must NOT come back — and repeated merges keep it gone.
    expect(await db.countTotalCardsCustomDeck(cdId)).toBe(2);
    adapter.mtimeValue = 2;
    await db.syncWithDisk();
    expect(await db.countTotalCardsCustomDeck(cdId)).toBe(2);

    const ids = await db.getFlashcardIdsForCustomDeck(cdId);
    expect(ids).not.toContain(cardIds[0]);
    expect([...ids].sort()).toEqual([cardIds[1], cardIds[2]].sort());
  });

  it("still honours a genuine re-add after removal (tombstone cleared)", async () => {
    const deck = DatabaseTestUtils.createTestDeck();
    await db.createDeck(deck);
    const fc = DatabaseTestUtils.createTestFlashcard(deck.id, { front: "Q", back: "A" });
    await db.createFlashcard(fc);
    const cdId = await db.createCustomDeck("Study");
    await db.addCardsToCustomDeck(cdId, [fc.id]);
    await db.save();

    await db.removeCardsFromCustomDeck(cdId, [fc.id]);
    expect(await db.countTotalCardsCustomDeck(cdId)).toBe(0);

    // Re-add clears the tombstone; a subsequent merge must not drop the re-add.
    await db.addCardsToCustomDeck(cdId, [fc.id]);
    adapter.mtimeValue = 1;
    await db.syncWithDisk();
    expect(await db.countTotalCardsCustomDeck(cdId)).toBe(1);
  });
});
