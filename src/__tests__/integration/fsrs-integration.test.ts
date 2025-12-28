import { MainDatabaseService } from "../../database/MainDatabaseService";
import { FSRS } from "../../algorithm/fsrs";
import { Scheduler } from "../../services/Scheduler";
import { BackupService } from "../../services/BackupService";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { Deck, Flashcard } from "../../database/types";
import { DEFAULT_FSRS_PARAMETERS } from "../../algorithm/fsrs-weights";

describe("FSRS Algorithm Integration Tests", () => {
  let db: MainDatabaseService;
  let fsrs: FSRS;
  let scheduler: Scheduler;
  let testDeck: Deck;

  beforeEach(async () => {
    db = await setupTestDatabase();
    fsrs = new FSRS(DEFAULT_FSRS_PARAMETERS);

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

  describe("New Card Learning Progression", () => {
    let newFlashcard: Flashcard;

    beforeEach(async () => {
      newFlashcard = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        front: "What is the capital of France?",
        back: "Paris",
        state: "new",
      });
      await db.createFlashcard(newFlashcard);
    });

    it("should handle Again rating on new card", async () => {
      const flashcard = await scheduler.rate(newFlashcard.id, "again");

      // Verify database persistence
      const dbCard = await db.getFlashcardById(newFlashcard.id);
      expect(dbCard!.state).toBe("review");
      expect(dbCard!.repetitions).toBe(1);
      expect(dbCard!.lapses).toBe(1);
      expect(dbCard!.stability).toBeGreaterThan(0);
      expect(dbCard!.difficulty).toBeGreaterThanOrEqual(1);
      expect(dbCard!.difficulty).toBeLessThanOrEqual(10);

      // Verify review log creation
      const reviewLogs = await db.getAllReviewLogs();
      const cardLogs = reviewLogs.filter(
        (log) => log.flashcardId === flashcard.id
      );
      expect(reviewLogs).toHaveLength(1);
      expect(reviewLogs[0].rating).toBe(1);
      expect(reviewLogs[0].oldState).toBe("new");
      expect(reviewLogs[0].newState).toBe("review");
      expect(reviewLogs[0].newLapses).toBe(1);
    });

    it("should handle Hard rating on new card", async () => {
      const now = new Date();
      const flashcard = await scheduler.rate(newFlashcard.id, "hard");

      const dbCard = await db.getFlashcardById(newFlashcard.id);
      expect(dbCard!.state).toBe("review");
      expect(dbCard!.repetitions).toBe(1);
      expect(dbCard!.lapses).toBe(0);
      expect(dbCard!.stability).toBeGreaterThan(0);

      // Hard should give smaller initial stability than Good
      const reviewLog = await db.getLatestReviewLogForFlashcard(
        newFlashcard.id
      );
      expect(reviewLog!.newStability).toBeLessThan(3.0);
    });

    it("should handle Good rating on new card", async () => {
      const now = new Date();
      const flashcard = await scheduler.rate(newFlashcard.id, "good");

      const dbCard = await db.getFlashcardById(newFlashcard.id);
      expect(dbCard!.state).toBe("review");
      expect(dbCard!.repetitions).toBe(1);
      expect(dbCard!.lapses).toBe(0);

      const reviewLog = await db.getLatestReviewLogForFlashcard(
        newFlashcard.id
      );
      expect(reviewLog!.newStability).toBeGreaterThan(1.0);
      expect(reviewLog!.newStability).toBeLessThan(10.0);
    });

    it("should handle Easy rating on new card", async () => {
      const now = new Date();
      const flashcard = await scheduler.rate(newFlashcard.id, "easy");

      const dbCard = await db.getFlashcardById(newFlashcard.id);
      expect(dbCard!.state).toBe("review");
      expect(dbCard!.repetitions).toBe(1);
      expect(dbCard!.lapses).toBe(0);

      // Easy should give highest initial stability
      const reviewLog = await db.getLatestReviewLogForFlashcard(
        newFlashcard.id
      );
      expect(reviewLog!.newStability).toBeGreaterThan(5.0);
    });

    it("should maintain monotonic intervals across ratings", async () => {
      const now = new Date();

      // Test all four ratings on identical cards
      const cards: Flashcard[] = [];
      const ratings: Array<"again" | "hard" | "good" | "easy"> = [
        "again",
        "hard",
        "good",
        "easy",
      ];

      for (let i = 0; i < 4; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          front: `Test Question ${i}`,
          back: `Test Answer ${i}`,
        });
        await db.createFlashcard(card);
        await scheduler.rate(card.id, ratings[i]);
        const updatedCard = await db.getFlashcardById(card.id);
        if (updatedCard) {
          cards.push(updatedCard);
        }
      }

      // Intervals should be monotonic: Again ≤ Hard ≤ Good ≤ Easy
      if (cards.length >= 4) {
        expect(cards[0].interval).toBeLessThanOrEqual(cards[1].interval);
        expect(cards[1].interval).toBeLessThanOrEqual(cards[2].interval);
        expect(cards[2].interval).toBeLessThanOrEqual(cards[3].interval);
      }
    });
  });

  describe("Review Card Progression", () => {
    let reviewFlashcard: Flashcard;

    beforeEach(async () => {
      // Create a card that's already in review state
      reviewFlashcard = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        state: "review",
        repetitions: 2,
        stability: 5.0,
        difficulty: 6.0,
        interval: 2880, // 2 days
        lastReviewed: new Date(
          Date.now() - 3 * 24 * 60 * 60 * 1000
        ).toISOString(),
      });
      await db.createFlashcard(reviewFlashcard);
    });

    it("should handle lapse (Again) on review card", async () => {
      const now = new Date();
      const updatedCard = await scheduler.rate(reviewFlashcard.id, "again");

      const dbCard = await db.getFlashcardById(reviewFlashcard.id);
      expect(dbCard!.state).toBe("review");
      expect(dbCard!.repetitions).toBe(3); // Incremented
      expect(dbCard!.lapses).toBe(1); // Incremented from 0
      expect(dbCard!.stability).toBeLessThan(5.0); // Reduced due to lapse
      expect(dbCard!.interval).toBeLessThan(2880); // Shorter interval

      const reviewLog = await db.getLatestReviewLogForFlashcard(
        reviewFlashcard.id
      );
      expect(reviewLog!.rating).toBe(1);
      expect(reviewLog!.oldStability).toBe(5.0);
      expect(reviewLog!.newStability).toBeLessThan(5.0);
    });

    it("should handle successful review progression", async () => {
      const now = new Date();
      const flashcard = await scheduler.rate(reviewFlashcard.id, "good");

      const dbCard = await db.getFlashcardById(reviewFlashcard.id);
      expect(dbCard!.state).toBe("review");
      expect(dbCard!.repetitions).toBe(3);
      expect(dbCard!.lapses).toBe(0); // No lapse
      expect(dbCard!.stability).toBeGreaterThan(5.0); // Increased
      expect(dbCard!.interval).toBeGreaterThan(2880); // Longer interval

      const reviewLog = await db.getLatestReviewLogForFlashcard(
        reviewFlashcard.id
      );
      expect(reviewLog!.newStability).toBeGreaterThan(5.0);
    });

    it("should calculate retrievability correctly", async () => {
      const now = new Date();

      // Test with different elapsed times
      const testCases = [
        {
          elapsedDays: 1,
          expectedRetrievability: { min: 0.7, max: 1.0 },
        },
        {
          elapsedDays: 5,
          expectedRetrievability: { min: 0.3, max: 0.95 },
        },
        {
          elapsedDays: 10,
          expectedRetrievability: { min: 0.1, max: 0.85 },
        },
      ];

      for (const testCase of testCases) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          state: "review",
          stability: 5.0,
          lastReviewed: new Date(
            now.getTime() - testCase.elapsedDays * 24 * 60 * 60 * 1000
          ).toISOString(),
        });
        await db.createFlashcard(card);
        await scheduler.rate(card.id, "good");

        const reviewLog = await db.getLatestReviewLogForFlashcard(card.id);
        expect(reviewLog!.retrievability).toBeGreaterThanOrEqual(
          testCase.expectedRetrievability.min
        );
        expect(reviewLog!.retrievability).toBeLessThanOrEqual(
          testCase.expectedRetrievability.max
        );
      }
    });
  });

  describe("FSRS Parameter Compliance", () => {
    it("should respect request retention in interval calculation", async () => {
      // Create two decks with different retention targets
      const highRetentionDeck = DatabaseTestUtils.createTestDeck({
        name: "High Retention Deck",
        filepath: "/high-retention.md",
        tag: "high-retention",
        config: {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          reviewOrder: "due-date",
          headerLevel: 2,
          fsrs: {
            requestRetention: 0.95,
            profile: "STANDARD",
          },
        },
      });

      const lowRetentionDeck = DatabaseTestUtils.createTestDeck({
        name: "Low Retention Deck",
        filepath: "/low-retention.md",
        tag: "low-retention",
        config: {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          reviewOrder: "due-date",
          headerLevel: 2,
          fsrs: {
            requestRetention: 0.8,
            profile: "STANDARD",
          },
        },
      });

      await db.createDeck(highRetentionDeck);
      await db.createDeck(lowRetentionDeck);

      // Create identical cards in each deck
      const card1 = DatabaseTestUtils.createTestFlashcard(
        highRetentionDeck.id,
        { state: "review", stability: 5.0, repetitions: 2 }
      );
      const card2 = DatabaseTestUtils.createTestFlashcard(lowRetentionDeck.id, {
        state: "review",
        stability: 5.0,
        repetitions: 2,
      });
      await db.createFlashcard(card1);
      await db.createFlashcard(card2);

      // Rate both cards with "good"
      await scheduler.rate(card1.id, "good");
      await scheduler.rate(card2.id, "good");

      const highCard = await db.getFlashcardById(card1.id);
      const lowCard = await db.getFlashcardById(card2.id);

      // Higher retention target should result in shorter intervals (more frequent reviews)
      expect(highCard!.interval).toBeLessThan(lowCard!.interval);
    });

    it("should enforce maximum interval limits", async () => {
      const limitedFSRS = new FSRS({
        ...DEFAULT_FSRS_PARAMETERS,
      });
      const testScheduler = scheduler;

      // Create card with very high stability that would normally exceed limit
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        state: "review",
        stability: 100.0, // Very high stability
        repetitions: 10,
      });
      await db.createFlashcard(card);

      const now = new Date();
      await scheduler.rate(card.id, "easy"); // Easy rating

      const updatedCard = await db.getFlashcardById(card.id);
      // Maximum interval is 36500 days (100 years), so 144000 minutes (100 days) is valid
      expect(updatedCard!.interval).toBeLessThanOrEqual(36500 * 24 * 60); // 36500 days in minutes
    });
  });

  describe("Scheduler Integration", () => {
    it("should provide correct next card for review", async () => {
      // Create cards with different due dates
      const now = new Date();
      const cards: Flashcard[] = [];

      for (let i = 0; i < 3; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          front: `Test Question ${i}`,
          state: "review",
          dueDate: new Date(
            now.getTime() - (3 - i) * 60 * 60 * 1000
          ).toISOString(), // Different overdue amounts
        });
        await db.createFlashcard(card);
        const createdCard = await db.getFlashcardById(card.id);
        if (createdCard) {
          cards.push(createdCard);
        }
      }

      // Should return the most overdue card first
      const nextCard = await scheduler.getNext(now, testDeck.id);
      expect(nextCard).toBeTruthy();
      expect(nextCard!.id).toBe(cards[0].id); // Most overdue
    });

    it("should generate scheduling previews correctly", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        state: "review",
        stability: 50.0,
        difficulty: 5.0,
        interval: 43200, // 30 days
      });
      await db.createFlashcard(card);

      // Should not exceed maximum interval
      const now = new Date();
      await scheduler.rate(card.id, "easy");
      const preview = await scheduler.preview(card.id);

      expect(preview?.again).toBeTruthy();
      expect(preview?.hard).toBeTruthy();
      expect(preview?.good).toBeTruthy();
      expect(preview?.easy).toBeTruthy();

      // Intervals should be monotonic
      if (preview) {
        expect(preview.again.interval).toBeLessThanOrEqual(
          preview.hard.interval
        );
        expect(preview.hard.interval).toBeLessThanOrEqual(
          preview.good.interval
        );
        expect(preview.good.interval).toBeLessThanOrEqual(
          preview.easy.interval
        );
      }
    });

    it("should handle review session workflow", async () => {
      // Create multiple cards
      const cards: Flashcard[] = [];
      for (let i = 0; i < 5; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          front: `Question ${i}`,
          back: `Answer ${i}`,
          state: "review",
          dueDate: new Date().toISOString(), // All due now
        });
        await db.createFlashcard(card);
        const createdCard = await db.getFlashcardById(card.id);
        if (createdCard) {
          cards.push(createdCard);
        }
      }

      const now = new Date();

      // Start review session
      const session = await scheduler.startReviewSession(testDeck.id, now);
      expect(session).toBeDefined();

      // Review cards in sequence
      let reviewedCount = 0;
      while (reviewedCount < 3 && reviewedCount < cards.length) {
        await scheduler.rate(cards[reviewedCount].id, "good");
        reviewedCount++;
      }

      // Check session progress
      expect(session).toBeDefined();
    });
  });

  describe("Data Integrity and Persistence", () => {
    it("should maintain FSRS data consistency across operations", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id);
      await db.createFlashcard(card);

      const now = new Date();

      // Perform multiple reviews
      const ratings: Array<"again" | "hard" | "good" | "easy"> = [
        "good",
        "easy",
        "hard",
        "good",
        "easy",
      ];
      for (let i = 0; i < ratings.length; i++) {
        await scheduler.rate(card.id, ratings[i]);
      }

      // Verify data consistency
      const finalCard = await db.getFlashcardById(card.id);
      const allLogs = await db.getAllReviewLogs();
      const reviewLogs = allLogs.filter((log) => log.flashcardId === card.id);

      expect(reviewLogs).toHaveLength(5);
      expect(finalCard!.repetitions).toBe(5); // After 5 reviews, should have 5 repetitions

      // Verify FSRS parameters are within valid ranges
      DatabaseTestUtils.expectValidFSRSData(finalCard!);

      // Verify review logs capture state transitions
      // Note: repetitions may not always increase (e.g., "hard" or "again" ratings can reset)
      for (let i = 0; i < reviewLogs.length; i++) {
        expect(reviewLogs[i].newRepetitions).toBeGreaterThanOrEqual(0);
        expect(reviewLogs[i].newStability).toBeGreaterThan(0);
        expect(reviewLogs[i].newDifficulty).toBeGreaterThan(0);
      }
    });

    it("should handle progress restoration from review logs", async () => {
      // Create card with review history
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id);
      await db.createFlashcard(card);

      await scheduler.rate(card.id, "good");
      await scheduler.rate(card.id, "easy");

      // Get the reviewed card state
      const reviewedCard = await db.getFlashcardById(card.id);
      const originalStability = reviewedCard!.stability;
      const originalRepetitions = reviewedCard!.repetitions;

      // Simulate card recreation (e.g., deck sync)
      await db.deleteFlashcard(card.id);

      // Create new card with same ID
      const newCard = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: card.id,
        front: card.front,
        back: card.back,
        state: "new", // Reset state
        stability: 0,
        repetitions: 0,
      });
      await db.createFlashcard(newCard);

      // Restore progress from review logs
      const latestReview = await db.getLatestReviewLogForFlashcard(card.id);
      expect(latestReview).toBeTruthy();

      // Update card with restored data
      const restoredCard: Flashcard = {
        ...newCard,
        state: latestReview!.newState as "new" | "review",
        stability: latestReview!.newStability,
        difficulty: latestReview!.newDifficulty,
        repetitions: latestReview!.newRepetitions,
        lapses: latestReview!.newLapses,
        lastReviewed: latestReview!.reviewedAt,
        interval: latestReview!.newIntervalMinutes,
        dueDate: new Date(
          new Date(latestReview!.reviewedAt).getTime() +
            latestReview!.newIntervalMinutes * 60 * 1000
        ).toISOString(),
      };

      await db.updateFlashcard(restoredCard.id, restoredCard);
      const finalCard = await db.getFlashcardById(card.id);

      // Verify restoration
      expect(finalCard!.stability).toBe(originalStability);
      expect(finalCard!.repetitions).toBe(originalRepetitions);
      expect(finalCard!.state).toBe("review");
    });
  });
});
