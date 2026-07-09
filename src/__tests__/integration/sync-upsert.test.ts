jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { generateDeckId, generateFlashcardId } from "@decks/core";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import type { Deck, DeckProfile } from "../../database/types";

// The sync create op is a move-or-create upsert: a card that already exists in a
// different deck OR is orphaned (deck row gone) is ADOPTED into the new deck with its
// content refreshed but its scheduling/suspend/bury state preserved. This is what makes
// re-import into a dirty vault lossless and non-destructive.
describe("Sync upsert: move-or-create preserves card state", () => {
  let db: MainDatabaseService;
  let profile: DeckProfile;

  beforeEach(async () => {
    db = await setupTestDatabase();
    profile = await db.getDefaultProfile();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  const CONTENT = "## Topic\n\n| Front | Back |\n| --- | --- |\n| Capital of France | Paris |\n";
  const cardId = generateFlashcardId("Capital of France");

  async function makeDeck(name: string): Promise<Deck> {
    const filepath = `/test/${name}.md`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name,
      filepath,
      tag: "decks/test",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
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

  // Orphan a card the way FK-off migrations did: drop its deck row without cascading.
  async function orphanCardsOf(deck: Deck): Promise<void> {
    await db["executeSql"]("PRAGMA foreign_keys = OFF", []);
    await db["executeSql"]("DELETE FROM decks WHERE id = ?", [deck.id]);
    await db["executeSql"]("PRAGMA foreign_keys = ON", []);
  }

  it("adopts a card from a wrong deck into the new deck, preserving FSRS + suspended", async () => {
    const a = await makeDeck("deck-a");
    const b = await makeDeck("deck-b");
    await sync(a, CONTENT);
    const suspendedAt = new Date().toISOString();
    await db.updateFlashcard(cardId, { state: "review", stability: 9.9, suspendedAt });

    // deck B's file has the same front while the card still lives in A → upsert adopts.
    await sync(b, CONTENT);

    expect(await db.getFlashcardsByDeck(a.id)).toHaveLength(0); // moved, not duplicated
    const inB = await db.getFlashcardsByDeck(b.id);
    expect(inB.map((c) => c.id)).toEqual([cardId]);
    expect(inB[0].deckId).toBe(b.id);
    expect(inB[0].state).toBe("review"); // FSRS preserved (not reset)
    expect(inB[0].stability).toBe(9.9);
    expect(inB[0].suspendedAt).toBe(suspendedAt); // suspend preserved (not nulled)
    expect(await db.countAllCards()).toBe(1); // no loss, no duplication
  });

  it("adopts an ORPHANED card (deck row gone) preserving all state", async () => {
    const tmp = await makeDeck("deck-tmp");
    await sync(tmp, CONTENT);
    const buriedUntil = new Date(Date.now() + 86_400_000).toISOString();
    await db.updateFlashcard(cardId, { state: "review", stability: 12.3, buriedUntil });
    await orphanCardsOf(tmp); // card now has deck_id → no deck row

    const b = await makeDeck("deck-b");
    await sync(b, CONTENT);

    const inB = await db.getFlashcardsByDeck(b.id);
    expect(inB.map((c) => c.id)).toEqual([cardId]);
    expect(inB[0].state).toBe("review");
    expect(inB[0].stability).toBe(12.3);
    expect(inB[0].buriedUntil).toBe(buriedUntil);
    expect(await db.countAllCards()).toBe(1);
    expect(await db.pruneOrphanedFlashcards()).toBe(0); // nothing left dangling
  });

  it("still creates a genuinely-new card, restoring FSRS from review_logs", async () => {
    await db["executeSql"](
      `INSERT INTO review_logs (id, flashcard_id, last_reviewed_at, reviewed_at,
        rating, rating_label, time_elapsed_ms,
        old_state, old_repetitions, old_lapses, old_stability, old_difficulty,
        new_state, new_repetitions, new_lapses, new_stability, new_difficulty,
        old_interval_minutes, new_interval_minutes, old_due_at, new_due_at,
        elapsed_days, retrievability, request_retention, profile,
        maximum_interval_days, min_minutes, fsrs_weights_version, scheduler_version)
       VALUES ('log_x', ?, ?, ?, 3, 'good', 5000, 'new', 0, 0, 0, 5.0,
        'review', 1, 0, 4.4, 5.1, 0, 1440, ?, ?, 1.0, 0.9, 0.9, 'STANDARD', 36500, 1, '4.5', '1.0')`,
      [
        cardId, new Date().toISOString(), new Date().toISOString(),
        new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString(),
      ]
    );
    const b = await makeDeck("deck-b");
    await sync(b, CONTENT);

    const [card] = await db.getFlashcardsByDeck(b.id);
    expect(card.id).toBe(cardId);
    expect(card.state).toBe("review"); // restored from review_logs
    expect(card.stability).toBe(4.4);
    expect(card.suspendedAt).toBeNull(); // genuinely new → not suspended
  });

  it("pruneOrphanedFlashcards removes only dangling orphans, keeping live cards + logs", async () => {
    const b = await makeDeck("deck-b");
    await sync(b, CONTENT); // one live card in B

    // A dangling orphan (its front matches no file) plus a surviving review_log.
    const orphan = await makeDeck("deck-orphan");
    await sync(orphan, "## T\n\n| Front | Back |\n| --- | --- |\n| Zzz | zzz |\n");
    const orphanCardId = generateFlashcardId("Zzz");
    await orphanCardsOf(orphan);
    expect(await db.countAllCards()).toBe(2);

    const pruned = await db.pruneOrphanedFlashcards();
    expect(pruned).toBe(1);
    expect(await db.countAllCards()).toBe(1);
    expect((await db.getFlashcardsByDeck(b.id)).map((c) => c.id)).toEqual([cardId]);
    // review_logs have no FK to flashcards, so history survives the prune.
    const logs = await db["querySql"](
      "SELECT COUNT(*) as c FROM review_logs WHERE flashcard_id = ?",
      [orphanCardId],
      { asObject: true }
    );
    // (orphan card was never reviewed here, so 0 — the point is prune doesn't touch logs)
    expect((logs[0] as { c: number }).c).toBe(0);
  });
});
