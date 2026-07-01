import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler } from "@decks/core";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";

// Global daily cap across all decks: the scheduler stops serving BOTH new and
// review cards once the combined daily total reaches the cap;
// countCardsStudiedTodayAllDecks drives the count (new + review).
describe("Global daily card cap", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  // Mutable so tests can flip the cap between calls (scheduler reads it live).
  const settings = {
    review: {
      nextDayStartsAt: 4,
      showProgress: true,
      enableKeyboardShortcuts: true,
      sessionDuration: 25,
      hasGlobalReviewCap: true,
      globalReviewCapAmount: 1,
    },
    backup: { enableAutoBackup: false, maxBackups: 3 },
    debug: { enableLogging: false, performanceLogs: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  beforeEach(async () => {
    db = await setupTestDatabase();
    settings.review.hasGlobalReviewCap = true;
    settings.review.globalReviewCapAmount = 1;
    scheduler = new Scheduler(db, settings, { createBackup: jest.fn() } as never);

    await db.createDeck(
      DatabaseTestUtils.createTestDeck({
        id: "deck_b",
        name: "Deck B",
        filepath: "b.md",
        tag: "#b",
      })
    );
    // A due review card in deck B that would normally be served.
    await db.createFlashcard(
      DatabaseTestUtils.createTestFlashcard("deck_b", {
        id: "b_due",
        state: "review",
        dueDate: new Date(Date.now() - 1000).toISOString(),
        interval: 1440,
        stability: 2.5,
        difficulty: 5.0,
        repetitions: 1,
      })
    );
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function studyOne(cardId: string, oldState: "new" | "review"): Promise<void> {
    await db.createReviewLog(
      DatabaseTestUtils.createTestReviewLog(cardId, {
        oldState,
        reviewedAt: new Date().toISOString(),
      })
    );
  }

  it("counts both new and review cards studied today across all decks", async () => {
    expect(await db.countCardsStudiedTodayAllDecks(4)).toBe(0);
    await studyOne("reviewed_card", "review");
    await studyOne("new_card", "new");
    expect(await db.countCardsStudiedTodayAllDecks(4)).toBe(2);
  });

  it("stops serving due cards once the daily cap is reached", async () => {
    await studyOne("some_card", "review"); // cap is 1 → budget exhausted
    expect(await scheduler.getNext(new Date(), "deck_b")).toBeNull();
  });

  it("also stops serving NEW cards once the daily cap is reached", async () => {
    await db.createFlashcard(
      DatabaseTestUtils.createTestFlashcard("deck_b", {
        id: "b_new",
        state: "new",
        interval: 0,
        repetitions: 0,
      })
    );
    await db.deleteFlashcard("b_due"); // only the new card could be served
    await studyOne("some_card", "new"); // budget exhausted by a new-card study

    const card = await scheduler.getNext(new Date(), "deck_b", { allowNew: true });
    expect(card).toBeNull();
  });

  it("serves cards when the daily budget remains", async () => {
    settings.review.globalReviewCapAmount = 5;
    await studyOne("some_card", "review"); // 1 of 5 used
    const card = await scheduler.getNext(new Date(), "deck_b");
    expect(card?.id).toBe("b_due");
  });

  it("does not cap anything when the setting is disabled", async () => {
    settings.review.hasGlobalReviewCap = false;
    await studyOne("some_card", "review");
    const card = await scheduler.getNext(new Date(), "deck_b");
    expect(card?.id).toBe("b_due");
  });
});
