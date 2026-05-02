import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler } from "../../services/Scheduler";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { Deck } from "../../database/types";

describe("Scheduler.undoLastReview Integration", () => {
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
      id: "undo_test_deck",
      name: "Undo Test Deck",
      filepath: "undo-test.md",
      tag: "#undo-test",
    });
    await db.createDeck(testDeck);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("returns null when no session is active", async () => {
    const result = await scheduler.undoLastReview();
    expect(result).toBeNull();
  });

  it("returns null when session has no reviews", async () => {
    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);

    const result = await scheduler.undoLastReview();
    expect(result).toBeNull();
  });

  it("hasUndoableReview reflects session review state", async () => {
    expect(await scheduler.hasUndoableReview()).toBe(false);

    const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_undoable",
      state: "new",
    });
    await db.createFlashcard(card);

    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);
    expect(await scheduler.hasUndoableReview()).toBe(false);

    await scheduler.rate(card.id, "good");
    expect(await scheduler.hasUndoableReview()).toBe(true);

    await scheduler.undoLastReview();
    expect(await scheduler.hasUndoableReview()).toBe(false);
  });

  it("restores card FSRS state to pre-review values", async () => {
    const originalDueDate = new Date(Date.now() - 60 * 1000).toISOString();
    const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_restore_state",
      state: "review",
      dueDate: originalDueDate,
      interval: 1440,
      stability: 2.5,
      difficulty: 5.0,
      repetitions: 3,
      lapses: 0,
      lastReviewed: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    await db.createFlashcard(card);

    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);

    await scheduler.rate(card.id, "again");

    const afterRate = await db.getFlashcardById(card.id);
    expect(afterRate!.lapses).toBe(1);
    expect(afterRate!.state).toBe("review");

    const restored = await scheduler.undoLastReview();
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(card.id);
    expect(restored!.state).toBe("review");
    expect(restored!.dueDate).toBe(originalDueDate);
    expect(restored!.interval).toBe(1440);
    expect(restored!.stability).toBe(2.5);
    expect(restored!.difficulty).toBe(5.0);
    expect(restored!.repetitions).toBe(3);
    expect(restored!.lapses).toBe(0);
  });

  it("restores a new card back to 'new' state", async () => {
    const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_new_undo",
      state: "new",
      interval: 0,
      repetitions: 0,
      stability: 0,
    });
    await db.createFlashcard(card);

    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);

    await scheduler.rate(card.id, "good");

    const afterRate = await db.getFlashcardById(card.id);
    expect(afterRate!.state).toBe("review");
    expect(afterRate!.repetitions).toBe(1);

    const restored = await scheduler.undoLastReview();
    expect(restored!.state).toBe("new");
    expect(restored!.repetitions).toBe(0);
    expect(restored!.stability).toBe(0);
  });

  it("deletes the review log entry on undo", async () => {
    const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_log_delete",
      state: "new",
    });
    await db.createFlashcard(card);

    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);

    await scheduler.rate(card.id, "good");
    expect(await db.getAllReviewLogs()).toHaveLength(1);

    await scheduler.undoLastReview();
    expect(await db.getAllReviewLogs()).toHaveLength(0);
  });

  it("decrements session.doneUnique when undoing card's only review", async () => {
    const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_session_decrement",
      state: "new",
    });
    await db.createFlashcard(card);

    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);

    await scheduler.rate(card.id, "good");
    let dbSession = await db.getReviewSessionById(session.sessionId);
    expect(dbSession!.doneUnique).toBe(1);

    await scheduler.undoLastReview();
    dbSession = await db.getReviewSessionById(session.sessionId);
    expect(dbSession!.doneUnique).toBe(0);
  });

  it("does NOT decrement session.doneUnique when card has prior reviews in same session", async () => {
    const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_multi_review",
      state: "new",
    });
    await db.createFlashcard(card);

    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);

    await scheduler.rate(card.id, "again");
    await scheduler.rate(card.id, "good");

    let dbSession = await db.getReviewSessionById(session.sessionId);
    expect(dbSession!.doneUnique).toBe(1);

    await scheduler.undoLastReview();

    dbSession = await db.getReviewSessionById(session.sessionId);
    expect(dbSession!.doneUnique).toBe(1);
    expect(await db.getAllReviewLogs()).toHaveLength(1);
  });

  it("undoes the most recent review across multiple cards", async () => {
    const cardA = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_a",
      state: "new",
    });
    const cardB = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_b",
      state: "new",
    });
    await db.createFlashcard(cardA);
    await db.createFlashcard(cardB);

    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);

    await scheduler.rate(cardA.id, "good");
    await scheduler.rate(cardB.id, "good");

    const restored = await scheduler.undoLastReview();
    expect(restored!.id).toBe(cardB.id);
    expect(restored!.state).toBe("new");

    const cardAState = await db.getFlashcardById(cardA.id);
    expect(cardAState!.state).toBe("review");

    const dbSession = await db.getReviewSessionById(session.sessionId);
    expect(dbSession!.doneUnique).toBe(1);
  });

  it("ignores review logs from other sessions", async () => {
    const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_other_session",
      state: "new",
    });
    await db.createFlashcard(card);

    const oldSession = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(oldSession.sessionId);
    await scheduler.rate(card.id, "good");
    await scheduler.endReviewSession(oldSession.sessionId);

    const newSession = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(newSession.sessionId);

    expect(await scheduler.hasUndoableReview()).toBe(false);
    const result = await scheduler.undoLastReview();
    expect(result).toBeNull();

    const cardState = await db.getFlashcardById(card.id);
    expect(cardState!.state).toBe("review");
    expect(await db.getAllReviewLogs()).toHaveLength(1);
  });

  it("walks back the full stack of reviews in a session", async () => {
    const cards = ["a", "b", "c"].map((suffix) =>
      DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: `card_stack_${suffix}`,
        state: "new",
      })
    );
    for (const c of cards) await db.createFlashcard(c);

    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);

    await scheduler.rate(cards[0].id, "good");
    await scheduler.rate(cards[1].id, "again");
    await scheduler.rate(cards[2].id, "easy");

    let dbSession = await db.getReviewSessionById(session.sessionId);
    expect(dbSession!.doneUnique).toBe(3);
    expect(await db.getAllReviewLogs()).toHaveLength(3);

    const restored3 = await scheduler.undoLastReview();
    expect(restored3!.id).toBe(cards[2].id);

    const restored2 = await scheduler.undoLastReview();
    expect(restored2!.id).toBe(cards[1].id);

    const restored1 = await scheduler.undoLastReview();
    expect(restored1!.id).toBe(cards[0].id);

    for (const c of cards) {
      const state = await db.getFlashcardById(c.id);
      expect(state!.state).toBe("new");
      expect(state!.repetitions).toBe(0);
    }

    expect(await db.getAllReviewLogs()).toHaveLength(0);
    dbSession = await db.getReviewSessionById(session.sessionId);
    expect(dbSession!.doneUnique).toBe(0);

    expect(await scheduler.hasUndoableReview()).toBe(false);
    expect(await scheduler.undoLastReview()).toBeNull();
  });

  it("supports undo → re-rate flow with consistent state", async () => {
    const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
      id: "card_undo_redo",
      state: "new",
    });
    await db.createFlashcard(card);

    const session = await scheduler.startReviewSession(testDeck.id);
    scheduler.setCurrentSession(session.sessionId);

    await scheduler.rate(card.id, "easy");
    const afterEasy = await db.getFlashcardById(card.id);
    const easyInterval = afterEasy!.interval;

    await scheduler.undoLastReview();
    await scheduler.rate(card.id, "again");

    const afterAgain = await db.getFlashcardById(card.id);
    expect(afterAgain!.interval).toBeLessThan(easyInterval);

    expect(await db.getAllReviewLogs()).toHaveLength(1);
    const dbSession = await db.getReviewSessionById(session.sessionId);
    expect(dbSession!.doneUnique).toBe(1);
  });
});
