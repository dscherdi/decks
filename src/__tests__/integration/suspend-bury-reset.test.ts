import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler } from "@decks/core";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { Deck } from "../../database/types";

// End-to-end behavior for the new card-state overlays (suspend, bury, reset)
// against a real SQL.js database. Mirrors the scheduler-integration.test.ts
// style: real db, real Scheduler, no mocks on the SQL layer.

describe("Suspend / Bury / Reset Integration", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  let testDeck: Deck;

  beforeEach(async () => {
    db = await setupTestDatabase();

    const mockSettings = {
      review: {
        nextDayStartsAt: 4,
        showProgress: true,
        enableKeyboardShortcuts: true,
        sessionDuration: 25,
      },
      backup: { enableAutoBackup: false, maxBackups: 3 },
      debug: { enableLogging: false, performanceLogs: false },
    } as any;
    const mockBackupService = { createBackup: jest.fn() } as any;

    scheduler = new Scheduler(db, mockSettings, mockBackupService);

    testDeck = DatabaseTestUtils.createTestDeck({
      id: "deck_suspend_test",
      name: "Suspend/Bury/Reset Test",
      filepath: "suspend-test.md",
      tag: "#suspend-test",
    });

    await db.createDeck(testDeck);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  describe("suspend", () => {
    it("suspended card is excluded from getNext", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card_due",
        state: "review",
        dueDate: new Date(Date.now() - 1000).toISOString(),
        interval: 1440,
        stability: 2.5,
        difficulty: 5.0,
        repetitions: 1,
      });
      await db.createFlashcard(card);

      // Before suspend → returned.
      expect((await scheduler.getNext(new Date(), testDeck.id))?.id).toBe(
        "card_due"
      );

      await db.suspendCard("card_due");

      // After suspend → not returned.
      expect(await scheduler.getNext(new Date(), testDeck.id)).toBeNull();
    });

    it("countNewCards / countDueCards exclude suspended cards", async () => {
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "c_new",
          state: "new",
          dueDate: new Date().toISOString(),
        })
      );
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "c_due",
          state: "review",
          dueDate: new Date(Date.now() - 1000).toISOString(),
          interval: 1440,
        })
      );

      expect(await db.countNewCards(testDeck.id)).toBe(1);
      expect(await db.countDueCards(testDeck.id)).toBe(1);

      await db.suspendCard("c_new");
      await db.suspendCard("c_due");

      expect(await db.countNewCards(testDeck.id)).toBe(0);
      expect(await db.countDueCards(testDeck.id)).toBe(0);
    });

    it("countTotalCards INCLUDES suspended cards (parity with Anki)", async () => {
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "c_total",
          state: "review",
          dueDate: new Date().toISOString(),
        })
      );

      await db.suspendCard("c_total");

      // Total includes suspended; due/new exclude. Matches plan.
      expect(await db.countTotalCards(testDeck.id)).toBe(1);
      expect(await db.countDueCards(testDeck.id)).toBe(0);
    });

    it("suspend then unsuspend restores card to queue with FSRS state intact", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "c_restore",
        state: "review",
        dueDate: new Date(Date.now() - 1000).toISOString(),
        interval: 4320, // 3 days
        stability: 7.5,
        difficulty: 6.2,
        lapses: 1,
        repetitions: 3,
      });
      await db.createFlashcard(card);

      await db.suspendCard("c_restore");
      expect(await scheduler.getNext(new Date(), testDeck.id)).toBeNull();

      await db.unsuspendCard("c_restore");
      const restored = await scheduler.getNext(new Date(), testDeck.id);
      expect(restored?.id).toBe("c_restore");
      // FSRS state must survive.
      expect(restored?.interval).toBe(4320);
      expect(restored?.stability).toBeCloseTo(7.5);
      expect(restored?.difficulty).toBeCloseTo(6.2);
      expect(restored?.lapses).toBe(1);
      expect(restored?.repetitions).toBe(3);
    });

    it("batchSuspendCards hides every selected card from getNext", async () => {
      const ids = ["c_a", "c_b", "c_c"];
      for (const id of ids) {
        await db.createFlashcard(
          DatabaseTestUtils.createTestFlashcard(testDeck.id, {
            id,
            state: "review",
            dueDate: new Date(Date.now() - 1000).toISOString(),
            interval: 1440,
          })
        );
      }
      expect(await db.countDueCards(testDeck.id)).toBe(3);

      await db.batchSuspendCards(ids);
      expect(await db.countDueCards(testDeck.id)).toBe(0);
      expect(await scheduler.getNext(new Date(), testDeck.id)).toBeNull();
    });
  });

  describe("bury", () => {
    it("buried card is hidden while buried_until > now, then reappears", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "c_bury",
        state: "review",
        dueDate: new Date(Date.now() - 1000).toISOString(),
        interval: 1440,
      });
      await db.createFlashcard(card);

      // Bury into the future.
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.buryCard("c_bury", future);

      expect(await scheduler.getNext(new Date(), testDeck.id)).toBeNull();

      // Simulate expiry: write a past timestamp.
      const past = new Date(Date.now() - 60 * 1000).toISOString();
      await db.buryCard("c_bury", past);
      expect((await scheduler.getNext(new Date(), testDeck.id))?.id).toBe(
        "c_bury"
      );
    });

    it("unburyCard clears the buried_until field", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "c_unbury",
        state: "review",
        dueDate: new Date(Date.now() - 1000).toISOString(),
        interval: 1440,
      });
      await db.createFlashcard(card);

      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.buryCard("c_unbury", future);
      expect(await scheduler.getNext(new Date(), testDeck.id)).toBeNull();

      await db.unburyCard("c_unbury");
      const fetched = await db.getFlashcardById("c_unbury");
      expect(fetched?.buriedUntil).toBeNull();
      expect((await scheduler.getNext(new Date(), testDeck.id))?.id).toBe(
        "c_unbury"
      );
    });

    it("getBuryUntilForNextDay yields a study-day rollover after now", () => {
      const now = new Date();
      const untilIso = scheduler.getBuryUntilForNextDay(now);
      expect(new Date(untilIso).getTime()).toBeGreaterThan(now.getTime());
    });
  });

  describe("reset", () => {
    it("resetCard wipes FSRS state and deletes review_logs", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "c_reset",
        state: "review",
        dueDate: new Date(Date.now() - 1000).toISOString(),
        interval: 4320,
        stability: 8.0,
        difficulty: 7.0,
        repetitions: 5,
        lapses: 2,
        lastReviewed: new Date(Date.now() - 86400000).toISOString(),
      });
      await db.createFlashcard(card);

      // Seed a review log so we can confirm it's deleted.
      await db.insertReviewLog(
        DatabaseTestUtils.createTestReviewLog("c_reset", {
          oldState: "new",
          newState: "review",
          oldIntervalMinutes: 0,
          newIntervalMinutes: 1440,
          oldStability: 0,
          newStability: 2.5,
        })
      );
      expect((await db.getAllReviewLogs()).length).toBeGreaterThan(0);

      await db.resetCard("c_reset");

      const reset = await db.getFlashcardById("c_reset");
      expect(reset?.state).toBe("new");
      expect(reset?.interval).toBe(0);
      expect(reset?.stability).toBe(0);
      expect(reset?.difficulty).toBeCloseTo(5.0);
      expect(reset?.repetitions).toBe(0);
      expect(reset?.lapses).toBe(0);
      expect(reset?.lastReviewed).toBeNull();
      expect(reset?.suspendedAt).toBeNull();
      expect(reset?.buriedUntil).toBeNull();

      // review_logs for this card should be gone (scoped, not bulk).
      const logs = await db.getAllReviewLogs();
      expect(logs.find((l) => l.flashcardId === "c_reset")).toBeUndefined();
    });

    it("resetCard scoped: other cards' review_logs survive", async () => {
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "c_target",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 1440,
        })
      );
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "c_other",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 1440,
        })
      );

      await db.insertReviewLog(
        DatabaseTestUtils.createTestReviewLog("c_target")
      );
      await db.insertReviewLog(
        DatabaseTestUtils.createTestReviewLog("c_other")
      );

      await db.resetCard("c_target");

      const logs = await db.getAllReviewLogs();
      expect(logs.find((l) => l.flashcardId === "c_target")).toBeUndefined();
      expect(logs.find((l) => l.flashcardId === "c_other")).toBeDefined();
    });

    it("batchResetCards wipes selected cards only", async () => {
      const idsToReset = ["c_r1", "c_r2"];
      const ids = [...idsToReset, "c_keep"];
      for (const id of ids) {
        await db.createFlashcard(
          DatabaseTestUtils.createTestFlashcard(testDeck.id, {
            id,
            state: "review",
            dueDate: new Date().toISOString(),
            interval: 1440,
            stability: 5,
          })
        );
      }

      await db.batchResetCards(idsToReset);

      for (const id of idsToReset) {
        const c = await db.getFlashcardById(id);
        expect(c?.state).toBe("new");
        expect(c?.interval).toBe(0);
      }
      const kept = await db.getFlashcardById("c_keep");
      expect(kept?.state).toBe("review");
      expect(kept?.interval).toBe(1440);
    });
  });

  describe("durable overlay rows", () => {
    async function overlay(cardId: string) {
      const rows = await db.querySql<{
        suspended_at: string | null;
        buried_until: string | null;
      }>(
        "SELECT suspended_at, buried_until FROM card_state_overlays WHERE flashcard_id = ?",
        [cardId],
        { asObject: true }
      );
      return rows[0];
    }

    it("suspend/bury/reset writers keep card_state_overlays in lockstep", async () => {
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "c_overlay",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 1440,
        })
      );

      await db.suspendCard("c_overlay");
      expect((await overlay("c_overlay"))?.suspended_at).not.toBeNull();

      const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.buryCard("c_overlay", until);
      expect((await overlay("c_overlay"))?.buried_until).toBe(until);

      await db.unsuspendCard("c_overlay");
      const afterUnsuspend = await overlay("c_overlay");
      expect(afterUnsuspend?.suspended_at).toBeNull();
      expect(afterUnsuspend?.buried_until).toBe(until);

      await db.resetCard("c_overlay");
      const afterReset = await overlay("c_overlay");
      expect(afterReset?.suspended_at).toBeNull();
      expect(afterReset?.buried_until).toBeNull();
    });

    it("deck reset clears bury in the overlay but keeps suspend", async () => {
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "c_deck_reset",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 1440,
        })
      );
      await db.suspendCard("c_deck_reset");
      const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.buryCard("c_deck_reset", until);

      await db.resetDeckProgress(testDeck.id);

      const row = await overlay("c_deck_reset");
      expect(row?.suspended_at).not.toBeNull();
      expect(row?.buried_until).toBeNull();
    });
  });

  describe("deck reset interaction", () => {
    it("resetDeckProgress clears buried_until but preserves suspended_at", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "c_persist",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 1440,
      });
      await db.createFlashcard(card);

      await db.suspendCard("c_persist");
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.buryCard("c_persist", future);

      await db.resetDeckProgress(testDeck.id);

      const after = await db.getFlashcardById("c_persist");
      // Suspend is a deliberate user assertion — preserved.
      expect(after?.suspendedAt).not.toBeNull();
      // Bury is daily-scoped — cleared by progress wipe.
      expect(after?.buriedUntil).toBeNull();
      // FSRS state reset.
      expect(after?.state).toBe("new");
      expect(after?.interval).toBe(0);
    });
  });
});
