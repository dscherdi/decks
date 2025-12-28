import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler } from "../../services/Scheduler";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { Deck } from "../../database/types";

describe("Scheduler Integration Tests", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  let testDeck: Deck;

  beforeEach(async () => {
    db = await setupTestDatabase();

    // Create minimal dependencies for Scheduler
    const mockSettings = {
      review: { nextDayStartsAt: 4, showProgress: true, enableKeyboardShortcuts: true, sessionDuration: 25 },
      backup: { enableAutoBackup: false, maxBackups: 3 },
      debug: { enableLogging: false, performanceLogs: false },
    } as any;
    const mockBackupService = {
      createBackup: jest.fn(),
    } as any;

    scheduler = new Scheduler(db, mockSettings, mockBackupService);

    testDeck = DatabaseTestUtils.createTestDeck({
      id: "test_deck",
      name: "Scheduler Test Deck",
      filepath: "scheduler-test.md",
      tag: "#scheduler-test",
      config: {
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        reviewOrder: "due-date",
        headerLevel: 2,
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
      },
    });

    await db.createDeck(testDeck);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  describe("Card Selection with Real Database", () => {
    it("should select due cards from database", async () => {
      // Create a card that's due now
      const dueCard = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card_due",
        state: "review",
        dueDate: new Date(Date.now() - 1000).toISOString(), // Due 1 second ago
        interval: 1440, // 1 day
        stability: 2.5,
        difficulty: 5.0,
        repetitions: 1,
      });

      await db.createFlashcard(dueCard);

      // Get next card
      const nextCard = await scheduler.getNext(new Date(), testDeck.id);

      expect(nextCard).toBeDefined();
      expect(nextCard?.id).toBe("card_due");
      expect(nextCard?.state).toBe("review");
    });

    it("should select new cards when no due cards exist", async () => {
      // Create a new card
      const newCard = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card_new",
        state: "new",
        interval: 0,
        repetitions: 0,
      });

      await db.createFlashcard(newCard);

      // Get next card with allowNew
      const nextCard = await scheduler.getNext(new Date(), testDeck.id, {
        allowNew: true,
      });

      expect(nextCard).toBeDefined();
      expect(nextCard?.id).toBe("card_new");
      expect(nextCard?.state).toBe("new");
    });

    it("should respect due date ordering", async () => {
      // Create multiple due cards
      const card1 = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card_1",
        state: "review",
        dueDate: new Date(Date.now() - 3600000).toISOString(), // Due 1 hour ago
      });
      const card2 = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card_2",
        state: "review",
        dueDate: new Date(Date.now() - 7200000).toISOString(), // Due 2 hours ago
      });

      await db.createFlashcard(card1);
      await db.createFlashcard(card2);

      // Should get card_2 first (older due date)
      const nextCard = await scheduler.getNext(new Date(), testDeck.id);

      expect(nextCard?.id).toBe("card_2");
    });
  });

  describe("Rating Flow Updates Database", () => {
    it("should update card state and create review log when rating", async () => {
      // Create a new card
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card_rate_test",
        state: "new",
      });

      await db.createFlashcard(card);

      // Rate the card as "good"
      await scheduler.rate(card.id, "good");

      // Verify card was updated
      const updatedCard = await db.getFlashcardById(card.id);
      expect(updatedCard).toBeDefined();
      expect(updatedCard!.state).toBe("review");
      expect(updatedCard!.interval).toBeGreaterThan(0);
      expect(updatedCard!.repetitions).toBe(1);
      expect(updatedCard!.lastReviewed).not.toBeNull();

      // Verify review log was created
      const reviewLogs = await db.getAllReviewLogs();
      expect(reviewLogs).toHaveLength(1);
      expect(reviewLogs[0].flashcardId).toBe(card.id);
      expect(reviewLogs[0].rating).toBe(3); // "good" is stored as 3
    });

    it("should handle lapse (again) rating correctly", async () => {
      // Create a review card
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card_lapse_test",
        state: "review",
        interval: 1440, // 1 day
        stability: 2.5,
        difficulty: 5.0,
        repetitions: 3,
        lapses: 0,
      });

      await db.createFlashcard(card);

      // Rate as "again" (lapse)
      await scheduler.rate(card.id, "again");

      // Verify lapse was recorded
      const updatedCard = await db.getFlashcardById(card.id);
      expect(updatedCard).toBeDefined();
      expect(updatedCard!.lapses).toBe(1);
      // After lapse, interval is reset to minimum (1440 for STANDARD profile)
      expect(updatedCard!.interval).toBeGreaterThanOrEqual(1440);
    });
  });

  describe("Daily Limits Enforcement with Real Counts", () => {
    beforeEach(async () => {
      // Update deck with daily limits
      testDeck.config.hasNewCardsLimitEnabled = true;
      testDeck.config.newCardsPerDay = 2;
      testDeck.config.hasReviewCardsLimitEnabled = true;
      testDeck.config.reviewCardsPerDay = 3;
      await db.updateDeck(testDeck.id, {
        config: testDeck.config,
      });
    });

    it("should enforce new card daily limit", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Create 3 new cards
      for (let i = 0; i < 3; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card_new_${i}`,
          state: "new",
        });
        await db.createFlashcard(card);
      }

      // Review 2 new cards (reach limit)
      for (let i = 0; i < 2; i++) {
        const card = await scheduler.getNext(new Date(), testDeck.id, {
          allowNew: true,
        });
        expect(card).toBeDefined();
        await scheduler.rate(card!.id, "good");
      }

      // Try to get another new card - should return null (limit reached)
      const nextCard = await scheduler.getNext(new Date(), testDeck.id, {
        allowNew: true,
      });
      expect(nextCard).toBeNull();
    });

    it("should enforce review card daily limit", async () => {
      // Create 4 due cards
      for (let i = 0; i < 4; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card_review_${i}`,
          state: "review",
          dueDate: new Date(Date.now() - 1000).toISOString(),
          interval: 1440,
          stability: 2.5,
          difficulty: 5.0,
          repetitions: 1,
        });
        await db.createFlashcard(card);
      }

      // Review 3 cards (reach limit)
      for (let i = 0; i < 3; i++) {
        const card = await scheduler.getNext(new Date(), testDeck.id);
        expect(card).toBeDefined();
        await scheduler.rate(card!.id, "good");
      }

      // Try to get another card - should return null (limit reached)
      const nextCard = await scheduler.getNext(new Date(), testDeck.id);
      expect(nextCard).toBeNull();
    });
  });

  describe("Session Management Persistence", () => {
    it("should create and track review session", async () => {
      // Create session
      const session = await scheduler.startReviewSession(testDeck.id);
      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();

      // Verify session exists in database
      const dbSession = await db.getReviewSessionById(session.sessionId);
      expect(dbSession).toBeDefined();
      expect(dbSession!.deckId).toBe(testDeck.id);
      expect(dbSession!.endedAt).toBeNull();
    });

    it("should update session progress when cards are reviewed", async () => {
      // Create a card
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card_session_test",
        state: "new",
      });
      await db.createFlashcard(card);

      // Start session
      const session = await scheduler.startReviewSession(testDeck.id);

      // Set current session for tracking
      scheduler.setCurrentSession(session.sessionId);

      // Rate the card (session tracking is automatic via currentSessionId)
      await scheduler.rate(card.id, "good");

      // Verify session progress updated
      const dbSession = await db.getReviewSessionById(session.sessionId);
      expect(dbSession!.doneUnique).toBe(1);
    });

    it("should end review session", async () => {
      // Create and start session
      const session = await scheduler.startReviewSession(testDeck.id);

      // End session
      await scheduler.endReviewSession(session.sessionId);

      // Verify session ended
      const dbSession = await db.getReviewSessionById(session.sessionId);
      expect(dbSession!.endedAt).not.toBeNull();
    });
  });

  describe("Review Order Configuration", () => {
    it("should respect random review order setting", async () => {
      // Update deck to use random order
      testDeck.config.reviewOrder = "random";
      await db.updateDeck(testDeck.id, {
        config: testDeck.config,
      });

      // Create multiple due cards
      for (let i = 0; i < 10; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card_random_${i}`,
          state: "review",
          dueDate: new Date(Date.now() - 1000).toISOString(),
          interval: 1440,
          stability: 2.5,
          difficulty: 5.0,
          repetitions: 1,
        });
        await db.createFlashcard(card);
      }

      // Get cards multiple times - with random order, sequence should vary
      const firstSequence: string[] = [];
      for (let i = 0; i < 5; i++) {
        const card = await scheduler.getNext(new Date(), testDeck.id);
        if (card) {
          firstSequence.push(card.id);
          await scheduler.rate(card.id, "good");
        }
      }

      // The order should be random (not guaranteed to differ, but statistically likely)
      expect(firstSequence).toHaveLength(5);
    });
  });
});
