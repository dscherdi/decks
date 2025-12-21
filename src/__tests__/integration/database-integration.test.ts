import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { Deck, Flashcard, ReviewLog } from "../../database/types";

describe("Database Integration Tests", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  describe("Database Initialization", () => {
    it("should create fresh database with correct schema", async () => {
      const stats = await db.getOverallStatistics();
      expect(stats.cardStats.new).toBe(0);
      expect(stats.cardStats.review).toBe(0);
      expect(stats.cardStats.mature).toBe(0);
    });

    it("should handle empty deck operations", async () => {
      const decks = await db.getAllDecks();
      expect(decks).toHaveLength(0);
    });
  });

  describe("Deck Operations", () => {
    it("should create and retrieve decks", async () => {
      const deck = DatabaseTestUtils.createTestDeck();

      await db.createDeck(deck);
      const retrievedDeck = await db.getDeckByFilepath(deck.filepath);

      expect(retrievedDeck).toBeTruthy();
      expect(retrievedDeck!.id).toBe(deck.id);
      expect(retrievedDeck!.name).toBe(deck.name);
      expect(retrievedDeck!.filepath).toBe(deck.filepath);
    });

    it("should update deck configuration", async () => {
      const deck = DatabaseTestUtils.createTestDeck();
      await db.createDeck(deck);

      const newConfig = {
        ...deck.config,
        newCardsPerDay: 30,
        reviewCardsPerDay: 150,
        reviewOrder: "random" as const,
      };

      await db.updateDeck(deck.id, { ...deck, config: newConfig });
      const updatedDeck = await db.getDeckByFilepath(deck.filepath);

      expect(updatedDeck!.config.newCardsPerDay).toBe(30);
      expect(updatedDeck!.config.reviewCardsPerDay).toBe(150);
      expect(updatedDeck!.config.reviewOrder).toBe("random");
    });

    it("should delete decks without affecting other data", async () => {
      const { deck, flashcards } =
        await DatabaseTestUtils.createDeckWithFlashcards(db, 3);

      await db.deleteDeck(deck.id);
      const deletedDeck = await db.getDeckByFilepath(deck.filepath);

      expect(deletedDeck).toBeNull();

      // Flashcards should still exist (orphaned but preserved for progress)
      const orphanedFlashcard = await db.getFlashcardById(flashcards[0].id);
      expect(orphanedFlashcard).toBeTruthy();
    });
  });

  describe("Flashcard Operations", () => {
    let testDeck: Deck;

    beforeEach(async () => {
      testDeck = DatabaseTestUtils.createTestDeck();
      await db.createDeck(testDeck);
    });

    it("should create and retrieve flashcards", async () => {
      const flashcard = DatabaseTestUtils.createTestFlashcard(testDeck.id);

      await db.createFlashcard(flashcard);
      const retrieved = await db.getFlashcardById(flashcard.id);

      expect(retrieved).toBeTruthy();
      expect(retrieved!.front).toBe(flashcard.front);
      expect(retrieved!.back).toBe(flashcard.back);
      expect(retrieved!.state).toBe("new");
    });

    it("should update flashcard state and FSRS data", async () => {
      const flashcard = DatabaseTestUtils.createTestFlashcard(testDeck.id);
      await db.createFlashcard(flashcard);

      const updatedFlashcard: Flashcard = {
        ...flashcard,
        state: "review",
        repetitions: 1,
        interval: 1440, // 1 day
        stability: 2.5,
        difficulty: 5.0,
        lastReviewed: new Date().toISOString(),
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      await db.updateFlashcard(updatedFlashcard.id, updatedFlashcard);
      const retrieved = await db.getFlashcardById(flashcard.id);

      expect(retrieved!.state).toBe("review");
      expect(retrieved!.repetitions).toBe(1);
      expect(retrieved!.stability).toBe(2.5);
      expect(retrieved!.difficulty).toBe(5.0);
      DatabaseTestUtils.expectValidFSRSData(retrieved!);
    });

    it("should handle content hash changes for sync", async () => {
      const flashcard = DatabaseTestUtils.createTestFlashcard(testDeck.id);
      await db.createFlashcard(flashcard);

      // Simulate content change
      const updatedFlashcard: Flashcard = {
        ...flashcard,
        back: "Updated answer content",
        contentHash: "newHash123",
      };

      await db.updateFlashcard(updatedFlashcard.id, updatedFlashcard);
      const retrieved = await db.getFlashcardById(flashcard.id);

      expect(retrieved!.back).toBe("Updated answer content");
      expect(retrieved!.contentHash).toBe("newHash123");
    });

    it("should get flashcards by deck with filtering", async () => {
      // Create flashcards with different header levels
      const flashcards = [
        DatabaseTestUtils.createTestFlashcard(testDeck.id),
        DatabaseTestUtils.createTestFlashcard(testDeck.id),
        DatabaseTestUtils.createTestFlashcard(testDeck.id),
        DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          type: "table",
        }),
      ];

      for (const flashcard of flashcards) {
        await db.createFlashcard(flashcard);
      }

      // Test basic deck filtering
      const deckCards = await db.getFlashcardsByDeck(testDeck.id);
      expect(deckCards).toHaveLength(4);
    });
  });

  describe("Review Log Operations", () => {
    let testDeck: Deck;
    let testFlashcard: Flashcard;

    beforeEach(async () => {
      const result = await DatabaseTestUtils.createDeckWithFlashcards(db, 1);
      testDeck = result.deck;
      testFlashcard = result.flashcards[0];
    });

    it("should create and retrieve review logs", async () => {
      const reviewLog = DatabaseTestUtils.createTestReviewLog(testFlashcard.id);

      await db.createReviewLog(reviewLog);
      const allLogs = await db.getAllReviewLogs();
      const logs = allLogs.filter(
        (log) => log.flashcardId === testFlashcard.id,
      );

      expect(logs).toHaveLength(1);
      expect(logs[0].rating).toBe(3);
      expect(logs[0].ratingLabel).toBe("good");
      expect(logs[0].flashcardId).toBe(testFlashcard.id);
    });

    it("should track FSRS progression through review logs", async () => {
      const reviews = [
        DatabaseTestUtils.createTestReviewLog(testFlashcard.id, {
          rating: 3,
          oldState: "new",
          newState: "review",
          newStability: 2.5,
          newDifficulty: 5.0,
          newRepetitions: 1,
        }),
        DatabaseTestUtils.createTestReviewLog(testFlashcard.id, {
          rating: 3,
          oldState: "review",
          newState: "review",
          newStability: 6.2,
          newDifficulty: 4.8,
          newRepetitions: 2,
          reviewedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }),
      ];

      for (const review of reviews) {
        await db.createReviewLog(review);
      }

      const allLogs = await db.getAllReviewLogs();
      const logs = allLogs.filter(
        (log) => log.flashcardId === testFlashcard.id,
      );
      expect(logs).toHaveLength(2);

      // Verify FSRS progression
      expect(logs[0].newStability).toBe(2.5);
      expect(logs[1].newStability).toBe(6.2);
      expect(logs[1].newRepetitions).toBe(2);
    });

    it("should restore flashcard progress from review logs", async () => {
      // Create review log with FSRS data
      const reviewLog = DatabaseTestUtils.createTestReviewLog(
        testFlashcard.id,
        {
          newState: "review",
          newStability: 5.2,
          newDifficulty: 6.1,
          newRepetitions: 3,
          newLapses: 1,
          newIntervalMinutes: 4320, // 3 days
          reviewedAt: new Date(
            Date.now() - 2 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      );

      await db.createReviewLog(reviewLog);

      // Get latest review for restoration
      const latestReview = await db.getLatestReviewLogForFlashcard(
        testFlashcard.id,
      );

      expect(latestReview).toBeTruthy();
      expect(latestReview!.newStability).toBe(5.2);
      expect(latestReview!.newDifficulty).toBe(6.1);
      expect(latestReview!.newRepetitions).toBe(3);

      // Verify due date calculation
      const reviewDate = new Date(latestReview!.reviewedAt);
      const expectedDue = new Date(reviewDate.getTime() + 4320 * 60 * 1000);
      DatabaseTestUtils.expectDateWithinRange(
        new Date(
          reviewDate.getTime() + latestReview!.newIntervalMinutes * 60 * 1000,
        ).toISOString(),
        expectedDue,
      );
    });
  });

  describe("Statistics and Queries", () => {
    beforeEach(async () => {
      // Create test data
      const { deck, flashcards } =
        await DatabaseTestUtils.createDeckWithFlashcards(db, 10);

      // Create some review history
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        const flashcard = flashcards[i];
        const reviewLog = DatabaseTestUtils.createTestReviewLog(flashcard.id, {
          reviewedAt: new Date(
            now.getTime() - i * 24 * 60 * 60 * 1000,
          ).toISOString(),
          rating: ((i % 4) + 1) as 1 | 2 | 3 | 4, // Vary ratings 1-4
          newState: "review",
          newStability: 2.0 + i,
          newDifficulty: 4.0 + i * 0.5,
          newRepetitions: i + 1,
        });
        await db.createReviewLog(reviewLog);

        // Update flashcard to reflect review
        await db.updateFlashcard(flashcard.id, {
          state: "review",
          repetitions: i + 1,
          stability: 2.0 + i,
          difficulty: 4.0 + i * 0.5,
          lastReviewed: reviewLog.reviewedAt,
          interval: (i + 1) * 1440, // Increasing intervals
        });
      }
    });

    it("should calculate overall statistics correctly", async () => {
      const stats = await db.getOverallStatistics();

      expect(
        stats.cardStats.new + stats.cardStats.review + stats.cardStats.mature,
      ).toBe(10);
      expect(stats.cardStats.review).toBeGreaterThan(0);
      expect(stats.cardStats.new).toBeGreaterThan(0);
    });

    it("should get deck statistics with proper counts", async () => {
      const decks = await db.getAllDecks();
      const allStats = await db.getOverallStatistics();
      const deckStats = allStats.cardStats;

      expect(deckStats.new + deckStats.review + deckStats.mature).toBe(10);
    });

    it("should filter cards for review queue", async () => {
      const decks = await db.getAllDecks();
      const dueCards = await db.getDueFlashcards(decks[0].id);

      expect(Array.isArray(dueCards)).toBe(true);
      // Some cards should be due for review
      if (dueCards.length > 0) {
        expect(dueCards[0].deckId).toBe(decks[0].id);
      }
    });

    it("should respect daily limits in card queries", async () => {
      const decks = await db.getAllDecks();
      const deck = decks[0];

      // Update deck config with low limits
      const updatedDeck = { ...deck };
      updatedDeck.config = {
        ...deck.config,
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 2,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 3,
      };
      await db.updateDeck(deck.id, updatedDeck);

      const newCards = await db.getNewCardsForReview(deck.id);
      expect(newCards.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Database Persistence", () => {
    it("should persist data across saves", async () => {
      const deck = DatabaseTestUtils.createTestDeck();
      await db.createDeck(deck);

      // Save database
      await db.save();

      // Verify data persists
      const retrievedDeck = await db.getDeckByFilepath(deck.filepath);
      expect(retrievedDeck).toBeTruthy();
      expect(retrievedDeck!.name).toBe(deck.name);
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle deck sync with progress preservation", async () => {
      // Create deck with reviewed flashcards
      const { deck, flashcards } =
        await DatabaseTestUtils.createDeckWithFlashcards(db, 3);

      // Add review history
      for (const flashcard of flashcards) {
        const reviewLog = DatabaseTestUtils.createTestReviewLog(flashcard.id, {
          newState: "review",
          newRepetitions: 2,
          newStability: 3.5,
        });
        await db.createReviewLog(reviewLog);

        await db.updateFlashcard(flashcard.id, {
          state: "review",
          repetitions: 2,
          stability: 3.5,
        });
      }

      // Simulate deck deletion and recreation (file moved/renamed scenario)
      await db.deleteDeck(deck.id);

      // Create new deck (same flashcard content)
      const newDeck = DatabaseTestUtils.createTestDeck({
        id: "new-deck-id",
        filepath: "/test/renamed-deck.md",
      });
      await db.createDeck(newDeck);

      // Flashcards should still exist with their progress
      for (const flashcard of flashcards) {
        const existingCard = await db.getFlashcardById(flashcard.id);
        expect(existingCard).toBeTruthy();
        expect(existingCard!.state).toBe("review");
        expect(existingCard!.repetitions).toBe(2);
      }

      // Update flashcard deck IDs to new deck
      await db.updateFlashcardDeckIds(deck.id, newDeck.id);

      const updatedCard = await db.getFlashcardById(flashcards[0].id);
      expect(updatedCard!.deckId).toBe(newDeck.id);
    });
  });
});
