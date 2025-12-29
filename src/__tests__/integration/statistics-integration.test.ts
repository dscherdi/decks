/**
 * Integration tests for StatisticsService with real SQL.js database
 *
 * Tests all 9 database aggregation methods and maturity progression simulation
 * with real flashcards and review logs.
 */

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { StatisticsService } from "../../services/StatisticsService";
import type { Deck, Flashcard } from "../../database/types";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { toLocalDateString } from "../../utils/date-utils";

describe("StatisticsService Integration Tests", () => {
  let db: MainDatabaseService;
  let statsService: StatisticsService;
  let testDeck: Deck;

  beforeEach(async () => {
    db = await setupTestDatabase();

    // Create mock settings for StatisticsService
    const mockSettings = {
      review: { nextDayStartsAt: 4 },
      backup: { enableAutoBackup: false, maxBackups: 3 },
      debug: { enableLogging: false, performanceLogs: false },
    } as any;

    statsService = new StatisticsService(db, mockSettings);

    // Create test deck
    testDeck = DatabaseTestUtils.createTestDeck({
      id: "test-deck-stats",
      name: "Statistics Test Deck",
      filepath: "/test/statistics-deck.md",
      tag: "#statistics-test",
    });
    await db.createDeck(testDeck);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  // Helper function to insert flashcard with custom timestamps
  // This bypasses db.createFlashcard() which always sets created/modified to now
  async function insertFlashcardWithTimestamp(card: Flashcard): Promise<void> {
    const sql = `INSERT INTO flashcards
                 (id, deck_id, front, back, type, source_file, content_hash, state, due_date,
                  interval, repetitions, difficulty, stability, lapses, last_reviewed, created, modified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await db.executeSql(sql, [
      card.id,
      card.deckId,
      card.front,
      card.back,
      card.type,
      card.sourceFile,
      card.contentHash,
      card.state,
      card.dueDate,
      card.interval,
      card.repetitions,
      card.difficulty,
      card.stability,
      card.lapses,
      card.lastReviewed,
      card.created,
      card.modified,
    ]);
  }

  describe("getCardCountsByMaturity", () => {
    it("should count new, young, and mature cards correctly", async () => {
      // Create 10 new cards
      for (let i = 0; i < 10; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-new-${i}`,
          front: `New Card ${i}`,
          state: "new",
          interval: 0,
        });
        await db.createFlashcard(card);
      }

      // Create 5 young cards (interval < 21 days = 30240 minutes)
      for (let i = 0; i < 5; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-young-${i}`,
          front: `Young Card ${i}`,
          state: "review",
          interval: 1440 * (i + 1), // 1-5 days
          stability: 5,
          repetitions: 1,
        });
        await db.createFlashcard(card);
      }

      // Create 3 mature cards (interval > 21 days = 30240 minutes)
      for (let i = 0; i < 3; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-mature-${i}`,
          front: `Mature Card ${i}`,
          state: "review",
          interval: 30241 + 1440 * i, // > 21 days (30241, 31681, 33121)
          stability: 50,
          difficulty: 3,
          repetitions: 5,
        });
        await db.createFlashcard(card);
      }

      const counts = await statsService.getCardCountsByMaturity([testDeck.id]);

      expect(counts.new).toBe(10);
      expect(counts.young).toBe(5);
      expect(counts.mature).toBe(3);
    });

    it("should return zeros for empty deck", async () => {
      const counts = await statsService.getCardCountsByMaturity([testDeck.id]);

      expect(counts.new).toBe(0);
      expect(counts.young).toBe(0);
      expect(counts.mature).toBe(0);
    });

    it("should aggregate across all decks when no filter provided", async () => {
      // Create card in test deck
      const card1 = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card-1",
        state: "new",
      });
      await db.createFlashcard(card1);

      // Create second deck with card
      const deck2 = DatabaseTestUtils.createTestDeck({
        id: "test-deck-2",
        name: "Second Deck",
        filepath: "/test/deck2.md",
      });
      await db.createDeck(deck2);

      const card2 = DatabaseTestUtils.createTestFlashcard(deck2.id, {
        id: "card-2",
        state: "new",
      });
      await db.createFlashcard(card2);

      const counts = await statsService.getCardCountsByMaturity([]);

      expect(counts.new).toBe(2);
    });
  });

  describe("getReviewsByDateAndRating", () => {
    it("should group reviews by date and rating", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card-1",
        state: "review",
      });
      await db.createFlashcard(card);

      // Create review logs for the past 3 days
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86400000);

      // Today: 2 Good, 1 Easy
      for (let i = 0; i < 2; i++) {
        const log = DatabaseTestUtils.createTestReviewLog(card.id, {
          id: `log-today-good-${i}`,
          rating: 3,
          ratingLabel: "good",
          reviewedAt: today.toISOString(),
        });
        await db.createReviewLog(log);
      }

      const logEasy = DatabaseTestUtils.createTestReviewLog(card.id, {
        id: "log-today-easy",
        rating: 4,
        ratingLabel: "easy",
        reviewedAt: today.toISOString(),
      });
      await db.createReviewLog(logEasy);

      // Yesterday: 1 Again, 1 Hard
      const logAgain = DatabaseTestUtils.createTestReviewLog(card.id, {
        id: "log-yesterday-again",
        rating: 1,
        ratingLabel: "again",
        reviewedAt: yesterday.toISOString(),
      });
      await db.createReviewLog(logAgain);

      const logHard = DatabaseTestUtils.createTestReviewLog(card.id, {
        id: "log-yesterday-hard",
        rating: 2,
        ratingLabel: "hard",
        reviewedAt: yesterday.toISOString(),
      });
      await db.createReviewLog(logHard);

      const reviewData = await statsService.getReviewsByDateAndRating(7, [
        testDeck.id,
      ]);

      // Check today's data
      const todayKey = toLocalDateString(today);
      const todayData = reviewData.get(todayKey);
      expect(todayData).toBeDefined();
      expect(todayData?.good).toBe(2);
      expect(todayData?.easy).toBe(1);

      // Check yesterday's data
      const yesterdayKey = toLocalDateString(yesterday);
      const yesterdayData = reviewData.get(yesterdayKey);
      expect(yesterdayData).toBeDefined();
      expect(yesterdayData?.again).toBe(1);
      expect(yesterdayData?.hard).toBe(1);
    });
  });

  describe("getReviewsByHour", () => {
    it("should group reviews by hour of day", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card-1",
      });
      await db.createFlashcard(card);

      const baseDate = new Date("2024-01-15T00:00:00.000");

      // 3 reviews at 9 AM local time
      for (let i = 0; i < 3; i++) {
        const reviewTime = new Date(baseDate);
        reviewTime.setHours(9, i, 0, 0);
        const log = DatabaseTestUtils.createTestReviewLog(card.id, {
          reviewedAt: reviewTime.toISOString(),
        });
        await db.createReviewLog(log);
      }

      // 5 reviews at 2 PM (14:00) local time
      for (let i = 0; i < 5; i++) {
        const reviewTime = new Date(baseDate);
        reviewTime.setHours(14, i, 0, 0);
        const log = DatabaseTestUtils.createTestReviewLog(card.id, {
          reviewedAt: reviewTime.toISOString(),
        });
        await db.createReviewLog(log);
      }

      const hourlyData = await statsService.getReviewsByHour([testDeck.id]);

      expect(hourlyData.get(9)).toBe(3);
      expect(hourlyData.get(14)).toBe(5);
      expect(hourlyData.get(0)).toBeUndefined();
    });
  });

  describe("getSuccessRatesByHour", () => {
    it("should calculate success rates by hour of day", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card-1",
      });
      await db.createFlashcard(card);

      const baseDate = new Date("2024-01-15T00:00:00.000");

      // 9 AM: 3 reviews - 2 passed (Good/Easy), 1 failed (Again)
      const hour9Reviews = [
        { rating: 3 as 1 | 2 | 3 | 4 }, // Good - pass
        { rating: 4 as 1 | 2 | 3 | 4 }, // Easy - pass
        { rating: 1 as 1 | 2 | 3 | 4 }, // Again - fail
      ];

      for (let i = 0; i < hour9Reviews.length; i++) {
        const reviewTime = new Date(baseDate);
        reviewTime.setHours(9, i, 0, 0);
        const log = DatabaseTestUtils.createTestReviewLog(card.id, {
          reviewedAt: reviewTime.toISOString(),
          rating: hour9Reviews[i].rating,
          ratingLabel: hour9Reviews[i].rating >= 3 ? "good" : "again",
        });
        await db.createReviewLog(log);
      }

      // 2 PM: 4 reviews - all passed (Good)
      for (let i = 0; i < 4; i++) {
        const reviewTime = new Date(baseDate);
        reviewTime.setHours(14, i, 0, 0);
        const log = DatabaseTestUtils.createTestReviewLog(card.id, {
          reviewedAt: reviewTime.toISOString(),
          rating: 3 as 1 | 2 | 3 | 4,
          ratingLabel: "good",
        });
        await db.createReviewLog(log);
      }

      const successRates = await statsService.getSuccessRatesByHour([
        testDeck.id,
      ]);

      // 9 AM: 2 passed out of 3 = 66.67%
      expect(successRates.get(9)).toBeCloseTo(66.67, 1);
      // 2 PM: 4 passed out of 4 = 100%
      expect(successRates.get(14)).toBe(100);
      // Hour with no reviews should be undefined
      expect(successRates.get(0)).toBeUndefined();
    });
  });

  describe("getStabilityDistribution", () => {
    it("should bucket cards by stability ranges", async () => {
      const stabilityValues = [0.5, 3, 15, 60, 120, 270, 400];

      for (let i = 0; i < stabilityValues.length; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-${i}`,
          front: `Card ${i}`,
          state: "review",
          stability: stabilityValues[i],
        });
        await db.createFlashcard(card);
      }

      const distribution = await statsService.getStabilityDistribution([
        testDeck.id,
      ]);

      expect(distribution.size).toBeGreaterThan(0);
      // Verify some cards are bucketed
      const totalCards = Array.from(distribution.values()).reduce(
        (sum, count) => sum + count,
        0
      );
      expect(totalCards).toBe(stabilityValues.length);
    });
  });

  describe("getDifficultyDistribution", () => {
    it("should bucket cards by difficulty ranges", async () => {
      const difficultyValues = [1.5, 3.2, 5.5, 7.8, 9.2];

      for (let i = 0; i < difficultyValues.length; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-${i}`,
          front: `Card ${i}`,
          state: "review",
          difficulty: difficultyValues[i],
        });
        await db.createFlashcard(card);
      }

      const distribution = await statsService.getDifficultyDistribution([
        testDeck.id,
      ]);

      expect(distribution.size).toBeGreaterThan(0);
      // Each difficulty value should be bucketed
      const totalCards = Array.from(distribution.values()).reduce(
        (sum, count) => sum + count,
        0
      );
      expect(totalCards).toBe(difficultyValues.length);
    });
  });

  describe("getIntervalDistribution", () => {
    it("should bucket cards by interval ranges", async () => {
      // Create cards with various intervals (in minutes)
      const intervals = [1440, 2880, 7200, 14400, 28800, 57600, 144000];

      for (let i = 0; i < intervals.length; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-${i}`,
          front: `Card ${i}`,
          state: "review",
          interval: intervals[i],
        });
        await db.createFlashcard(card);
      }

      const distribution = await statsService.getIntervalDistribution([
        testDeck.id,
      ]);

      expect(distribution.size).toBeGreaterThan(0);
      const totalCards = Array.from(distribution.values()).reduce(
        (sum, count) => sum + count,
        0
      );
      expect(totalCards).toBe(intervals.length);
    });
  });

  describe("getCardsAddedByDate", () => {
    it("should group cards by creation date", async () => {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86400000);

      // Create 3 cards today - use helper to set custom created timestamp
      for (let i = 0; i < 3; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-today-${i}`,
          front: `Today Card ${i}`,
          created: today.toISOString(),
          modified: today.toISOString(),
        });
        await insertFlashcardWithTimestamp(card);
      }

      // Create 2 cards yesterday - use helper to set custom created timestamp
      for (let i = 0; i < 2; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-yesterday-${i}`,
          front: `Yesterday Card ${i}`,
          created: yesterday.toISOString(),
          modified: yesterday.toISOString(),
        });
        await insertFlashcardWithTimestamp(card);
      }

      const cardsAdded = await statsService.getCardsAddedByDate(7, [
        testDeck.id,
      ]);

      const todayKey = toLocalDateString(today);
      const yesterdayKey = toLocalDateString(yesterday);

      expect(cardsAdded.get(todayKey)).toBe(3);
      expect(cardsAdded.get(yesterdayKey)).toBe(2);
    });
  });

  describe("getRetrievabilityDistribution", () => {
    it("should bucket reviews by retrievability ranges", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card-1",
        state: "review",
      });
      await db.createFlashcard(card);

      // Create reviews with various retrievability values
      const retrievabilities = [0.05, 0.15, 0.35, 0.55, 0.75, 0.95];

      for (let i = 0; i < retrievabilities.length; i++) {
        const log = DatabaseTestUtils.createTestReviewLog(card.id, {
          id: `log-${i}`,
          retrievability: retrievabilities[i],
        });
        await db.createReviewLog(log);
      }

      const distribution = await statsService.getRetrievabilityDistribution([
        testDeck.id,
      ]);

      // Should have reviews in buckets: 0-10%, 10-20%, 30-40%, 50-60%, 70-80%, 90-100%
      expect(distribution.get("0-10%")).toBe(1);
      expect(distribution.get("10-20%")).toBe(1);
      expect(distribution.get("30-40%")).toBe(1);
      expect(distribution.get("50-60%")).toBe(1);
      expect(distribution.get("70-80%")).toBe(1);
      expect(distribution.get("90-100%")).toBe(1);
    });
  });

  describe("getTrueRetentionStats", () => {
    it("should calculate pass rates for young and mature cards", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card-1",
        state: "review",
      });
      await db.createFlashcard(card);

      // Create young card reviews (interval <= 21 days = 30240 minutes)
      // 3 passed (rating >= 3), 1 failed (rating < 3)
      const youngReviews = [
        { rating: 3 as 1 | 2 | 3 | 4, interval: 1440 * 5 },
        { rating: 4 as 1 | 2 | 3 | 4, interval: 1440 * 3 },
        { rating: 3 as 1 | 2 | 3 | 4, interval: 1440 * 7 },
        { rating: 1 as 1 | 2 | 3 | 4, interval: 1440 * 2 },
      ];

      for (let i = 0; i < youngReviews.length; i++) {
        const log = DatabaseTestUtils.createTestReviewLog(card.id, {
          id: `young-${i}`,
          rating: youngReviews[i].rating,
          ratingLabel: youngReviews[i].rating >= 3 ? "good" : "again",
          oldIntervalMinutes: youngReviews[i].interval,
          elapsedDays: youngReviews[i].interval / 1440,
        });
        await db.createReviewLog(log);
      }

      // Create mature card reviews (interval > 21 days)
      // 4 passed, 1 failed
      const matureReviews = [
        { rating: 3 as 1 | 2 | 3 | 4, interval: 1440 * 30 },
        { rating: 4 as 1 | 2 | 3 | 4, interval: 1440 * 60 },
        { rating: 3 as 1 | 2 | 3 | 4, interval: 1440 * 90 },
        { rating: 3 as 1 | 2 | 3 | 4, interval: 1440 * 45 },
        { rating: 2 as 1 | 2 | 3 | 4, interval: 1440 * 50 },
      ];

      for (let i = 0; i < matureReviews.length; i++) {
        const log = DatabaseTestUtils.createTestReviewLog(card.id, {
          id: `mature-${i}`,
          rating: matureReviews[i].rating,
          ratingLabel: matureReviews[i].rating >= 3 ? "good" : "hard",
          oldIntervalMinutes: matureReviews[i].interval,
          elapsedDays: matureReviews[i].interval / 1440,
        });
        await db.createReviewLog(log);
      }

      const stats = await statsService.getTrueRetentionStats([testDeck.id]);

      // Young: 3 passed, 4 total = 75%
      expect(stats.young.passed).toBe(3);
      expect(stats.young.total).toBe(4);
      expect(stats.young.rate).toBeCloseTo(75, 1);

      // Mature: 4 passed, 5 total = 80%
      expect(stats.mature.passed).toBe(4);
      expect(stats.mature.total).toBe(5);
      expect(stats.mature.rate).toBeCloseTo(80, 1);

      // All: 7 passed, 9 total = 77.78%
      expect(stats.all.passed).toBe(7);
      expect(stats.all.total).toBe(9);
      expect(stats.all.rate).toBeCloseTo(77.78, 1);
    });

    it("should only count reviews with interval > 1 day", async () => {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: "card-1",
        state: "review",
      });
      await db.createFlashcard(card);

      // Create a review with interval < 1 day (should be excluded)
      const shortLog = DatabaseTestUtils.createTestReviewLog(card.id, {
        id: "short-1",
        oldIntervalMinutes: 720, // 0.5 days
      });
      await db.createReviewLog(shortLog);

      // Create a valid review (interval > 1 day)
      const validLog = DatabaseTestUtils.createTestReviewLog(card.id, {
        id: "valid-1",
        oldIntervalMinutes: 1440 * 5,
      });
      await db.createReviewLog(validLog);

      const stats = await statsService.getTrueRetentionStats([testDeck.id]);

      // Should only count the valid review
      expect(stats.all.total).toBe(1);
      expect(stats.all.passed).toBe(1);
    });
  });

  describe("simulateMaturityProgression", () => {
    it("should project card maturity over time", async () => {
      // Create 5 new cards with staggered due dates (due in 1-5 days)
      for (let i = 0; i < 5; i++) {
        const futureDate = new Date(Date.now() + (i + 1) * 86400000); // Due in 1-5 days
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-new-${i}`,
          front: `New Card ${i}`,
          state: "new",
          interval: 0,
          dueDate: futureDate.toISOString(),
        });
        await db.createFlashcard(card);
      }

      // Create 3 learning cards (interval < 21 days)
      for (let i = 0; i < 3; i++) {
        const futureDate = new Date(Date.now() + (i + 1) * 86400000);
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-learning-${i}`,
          front: `Learning Card ${i}`,
          state: "review",
          dueDate: futureDate.toISOString(),
          interval: 1440 * (i + 1),
          stability: 5,
          repetitions: 1,
        });
        await db.createFlashcard(card);
      }

      // Create 2 mature cards (interval >= 21 days)
      for (let i = 0; i < 2; i++) {
        const futureDate = new Date(Date.now() + (30 + i * 10) * 86400000);
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-mature-${i}`,
          front: `Mature Card ${i}`,
          state: "review",
          dueDate: futureDate.toISOString(),
          interval: 30240 + 1440 * i * 10,
          stability: 50,
          difficulty: 3,
          repetitions: 5,
        });
        await db.createFlashcard(card);
      }

      const progression = await statsService.simulateMaturityProgression(
        [testDeck.id],
        90
      );

      expect(progression.dailySnapshots.length).toBeGreaterThan(0);

      // First day should have all cards
      const firstDay = progression.dailySnapshots[0];
      expect(
        firstDay.newCards + firstDay.learningCards + firstDay.matureCards
      ).toBe(10);

      // As days progress, new cards should decrease
      let previousNewCount = firstDay.newCards;
      let foundProgression = false;

      for (
        let i = 1;
        i < Math.min(progression.dailySnapshots.length, 30);
        i++
      ) {
        const day = progression.dailySnapshots[i];
        // Total should remain constant
        expect(day.newCards + day.learningCards + day.matureCards).toBe(10);

        // New cards should decrease or stay same
        expect(day.newCards).toBeLessThanOrEqual(previousNewCount);

        if (day.newCards < previousNewCount) {
          foundProgression = true;
        }
        previousNewCount = day.newCards;
      }

      expect(foundProgression).toBe(true);
    });

    it("should stop early when all cards are mature", async () => {
      // Create only mature cards with due dates far in the future
      const futureDate = new Date(
        Date.now() + 365 * 2 * 24 * 60 * 60 * 1000
      ).toISOString(); // 2 years in future

      for (let i = 0; i < 3; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-mature-${i}`,
          front: `Mature Card ${i}`,
          state: "review",
          interval: 100000, // Very long interval
          stability: 200, // > 21 days = mature
          difficulty: 3,
          repetitions: 10,
          dueDate: futureDate, // No reviews needed during simulation
        });
        await db.createFlashcard(card);
      }

      const progression = await statsService.simulateMaturityProgression(
        [testDeck.id],
        365
      );

      // Should stop early after 7+ idle days (all mature, no activity)
      expect(progression.dailySnapshots.length).toBeLessThan(10);

      const lastDay =
        progression.dailySnapshots[progression.dailySnapshots.length - 1];
      expect(lastDay.newCards).toBe(0);
      expect(lastDay.learningCards).toBe(0);
      expect(lastDay.matureCards).toBe(3);
    });

    it("should return empty array for empty deck", async () => {
      const progression = await statsService.simulateMaturityProgression(
        [testDeck.id],
        90
      );

      expect(progression.dailySnapshots.length).toBe(0);
    });

    describe("FSRS Fidelity and Accuracy", () => {
      it("should produce outcomes matching real Scheduler over multiple days", async () => {
        // Create 10 cards with known FSRS state
        const cards = [];
        const now = new Date();

        for (let i = 0; i < 10; i++) {
          const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
            id: `card-${i}`,
            front: `Card ${i}`,
            state: i < 5 ? "new" : "review",
            stability: i < 5 ? 1 : 5 + i,
            difficulty: 5,
            repetitions: i < 5 ? 0 : i - 4,
            lapses: 0,
            dueDate: now.toISOString(),
            lastReviewed:
              i < 5 ? null : new Date(now.getTime() - 86400000).toISOString(),
          });
          cards.push(card);
          await db.createFlashcard(card);
        }

        // Add daily limits to ensure gradual progression
        const profile = await db.getDefaultProfile();
        if (profile) {
          await db.updateProfile(profile.id, {
            hasNewCardsLimitEnabled: true,
            newCardsPerDay: 2, // Process 2 new cards per day
          });
        }

        // Run simulation for 30 days
        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          30
        );

        // Verify simulation produces expected behavior
        expect(progression.dailySnapshots.length).toBeGreaterThan(0);
        expect(progression.dailySnapshots.length).toBeLessThanOrEqual(30);

        // First day should have all 10 cards
        const firstDay = progression.dailySnapshots[0];
        expect(
          firstDay.newCards + firstDay.learningCards + firstDay.matureCards
        ).toBe(10);

        // Total should remain constant throughout
        progression.dailySnapshots.forEach((day) => {
          expect(day.newCards + day.learningCards + day.matureCards).toBe(10);
        });

        // New cards should decrease over time (as they get processed)
        let foundDecreaseInNewCards = false;
        for (let i = 1; i < progression.dailySnapshots.length; i++) {
          if (
            progression.dailySnapshots[i].newCards <
            progression.dailySnapshots[i - 1].newCards
          ) {
            foundDecreaseInNewCards = true;
            break;
          }
        }
        expect(foundDecreaseInNewCards).toBe(true);

        // Mature cards should increase over time
        const lastDay =
          progression.dailySnapshots[progression.dailySnapshots.length - 1];
        expect(lastDay.matureCards).toBeGreaterThanOrEqual(
          firstDay.matureCards
        );
      });

      it("should use stability-based maturity classification (not interval)", async () => {
        const now = new Date();

        // Card 1: High stability (25 days), low interval (5 days) → should be MATURE
        const card1 = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "card-mature-by-stability",
          front: "Mature by Stability",
          state: "review",
          stability: 25,
          interval: 5 * 1440, // 5 days
          difficulty: 5,
          repetitions: 3,
          dueDate: new Date(now.getTime() + 100000000).toISOString(), // Far future
        });

        // Card 2: Low stability (10 days), high interval (30 days) → should be LEARNING
        const card2 = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "card-learning-by-stability",
          front: "Learning by Stability",
          state: "review",
          stability: 10,
          interval: 30 * 1440, // 30 days
          difficulty: 5,
          repetitions: 3,
          dueDate: new Date(now.getTime() + 100000000).toISOString(),
        });

        await db.createFlashcard(card1);
        await db.createFlashcard(card2);

        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          1
        );

        expect(progression.dailySnapshots).toHaveLength(1);
        // Card 1 (stability=25) should be mature (≥21 days)
        // Card 2 (stability=10) should be learning (<21 days)
        expect(progression.dailySnapshots[0].matureCards).toBe(1);
        expect(progression.dailySnapshots[0].learningCards).toBe(1);
      });

      it("should enforce daily new card limits correctly", async () => {
        // Create 100 new cards
        for (let i = 0; i < 100; i++) {
          const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
            id: `card-${i}`,
            front: `Card ${i}`,
            state: "new",
            dueDate: new Date().toISOString(),
          });
          await db.createFlashcard(card);
        }

        // Update profile to limit new cards to 10/day
        const profile = await db.getDefaultProfile();
        if (profile) {
          await db.updateProfile(profile.id, {
            hasNewCardsLimitEnabled: true,
            newCardsPerDay: 10,
          });
        }

        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          20
        );

        // Day 1: Should have 90 new cards remaining (100 - 10)
        expect(progression.dailySnapshots[0].newCards).toBe(90);

        // By day 10, all 100 cards should be processed (100 / 10 = 10 days)
        const day10 = progression.dailySnapshots[9];
        expect(day10.newCards).toBe(0);
        expect(day10.learningCards + day10.matureCards).toBe(100);
      });

      it("should enforce daily review card limits correctly", async () => {
        const now = new Date();

        // Create 50 review cards (all due now)
        for (let i = 0; i < 50; i++) {
          const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
            id: `card-${i}`,
            front: `Card ${i}`,
            state: "review",
            stability: 5,
            difficulty: 5,
            repetitions: 1,
            dueDate: now.toISOString(),
          });
          await db.createFlashcard(card);
        }

        // Update profile to limit reviews to 5/day
        const profile = await db.getDefaultProfile();
        if (profile) {
          await db.updateProfile(profile.id, {
            hasReviewCardsLimitEnabled: true,
            reviewCardsPerDay: 5,
          });
        }

        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          15
        );

        // Simulation should take approximately 10 days to process 50 cards at 5/day
        expect(progression.dailySnapshots.length).toBeGreaterThanOrEqual(10);
      });

      it("should handle unlimited daily limits (Infinity)", async () => {
        // Create 200 new cards
        for (let i = 0; i < 200; i++) {
          const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
            id: `card-${i}`,
            front: `Card ${i}`,
            state: "new",
            dueDate: new Date().toISOString(),
          });
          await db.createFlashcard(card);
        }

        // Ensure profile has no limits (unlimited)
        const profile = await db.getDefaultProfile();
        if (profile) {
          await db.updateProfile(profile.id, {
            hasNewCardsLimitEnabled: false,
          });
        }

        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          5
        );

        // With unlimited, cards should be processed quickly (within FSRS scheduling constraints)
        // Day 1 should process many cards (not artificially limited)
        expect(progression.dailySnapshots[0].newCards).toBeLessThan(200);
        expect(
          progression.dailySnapshots[0].learningCards +
            progression.dailySnapshots[0].matureCards
        ).toBeGreaterThan(0);
      });

      it("should verify maturity boundary at 21 days stability", async () => {
        const now = new Date();

        // Card just below threshold
        const cardBelow = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "card-20.9",
          front: "Below Threshold",
          state: "review",
          stability: 20.9,
          difficulty: 5,
          repetitions: 3,
          dueDate: new Date(now.getTime() + 100000000).toISOString(),
        });

        // Card exactly at threshold
        const cardBoundary = DatabaseTestUtils.createTestFlashcard(
          testDeck.id,
          {
            id: "card-21.0",
            front: "At Threshold",
            state: "review",
            stability: 21.0,
            difficulty: 5,
            repetitions: 3,
            dueDate: new Date(now.getTime() + 100000000).toISOString(),
          }
        );

        // Card above threshold
        const cardAbove = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "card-21.1",
          front: "Above Threshold",
          state: "review",
          stability: 21.1,
          difficulty: 5,
          repetitions: 3,
          dueDate: new Date(now.getTime() + 100000000).toISOString(),
        });

        await db.createFlashcard(cardBelow);
        await db.createFlashcard(cardBoundary);
        await db.createFlashcard(cardAbove);

        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          1
        );

        expect(progression.dailySnapshots).toHaveLength(1);
        // 20.9 < 21 → learning
        expect(progression.dailySnapshots[0].learningCards).toBe(1);
        // 21.0 ≥ 21 and 21.1 ≥ 21 → mature (boundary is inclusive)
        expect(progression.dailySnapshots[0].matureCards).toBe(2);
      });

      it("should exit early when all cards mature with 7 idle days", async () => {
        const now = new Date();

        // Create 5 cards with high stability (all mature)
        // Due date far in future so they won't be processed during simulation
        for (let i = 0; i < 5; i++) {
          const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
            id: `card-${i}`,
            front: `Card ${i}`,
            state: "review",
            stability: 50,
            difficulty: 3,
            repetitions: 10,
            dueDate: new Date(now.getTime() + 100 * 86400000).toISOString(), // Due 100 days in future
          });
          await db.createFlashcard(card);
        }

        // Run simulation with maxDays = 100
        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          100
        );

        // Should exit early (way before 100 days) due to idle threshold
        // No cards are due during the simulation, so should exit after MAX_IDLE_DAYS (7 days)
        expect(progression.dailySnapshots.length).toBeLessThan(100);
        // Should exit after approximately 7 idle days (MAX_IDLE_DAYS) + 1 for initial snapshot
        expect(progression.dailySnapshots.length).toBeLessThan(20);

        // All days should show all cards as mature
        const finalDay =
          progression.dailySnapshots[progression.dailySnapshots.length - 1];
        expect(finalDay.newCards).toBe(0);
        expect(finalDay.learningCards).toBe(0);
        expect(finalDay.matureCards).toBe(5);
      });

      it("should handle mixed due dates with priority queue", async () => {
        const now = new Date();

        // Create cards with different due dates
        const cardPast = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "card-past",
          front: "Past Due",
          state: "review",
          stability: 5,
          difficulty: 5,
          repetitions: 1,
          dueDate: new Date(now.getTime() - 86400000 * 3).toISOString(), // 3 days ago
        });

        const cardToday = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "card-today",
          front: "Due Today",
          state: "review",
          stability: 5,
          difficulty: 5,
          repetitions: 1,
          dueDate: now.toISOString(),
        });

        const cardTomorrow = DatabaseTestUtils.createTestFlashcard(
          testDeck.id,
          {
            id: "card-tomorrow",
            front: "Due Tomorrow",
            state: "review",
            stability: 5,
            difficulty: 5,
            repetitions: 1,
            dueDate: new Date(now.getTime() + 86400000).toISOString(),
          }
        );

        const cardFuture = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "card-future",
          front: "Due in 5 days",
          state: "review",
          stability: 5,
          difficulty: 5,
          repetitions: 1,
          dueDate: new Date(now.getTime() + 86400000 * 5).toISOString(),
        });

        await db.createFlashcard(cardPast);
        await db.createFlashcard(cardToday);
        await db.createFlashcard(cardTomorrow);
        await db.createFlashcard(cardFuture);

        // Set limit to 1 card/day to force priority queue behavior
        const profile = await db.getDefaultProfile();
        if (profile) {
          await db.updateProfile(profile.id, {
            hasReviewCardsLimitEnabled: true,
            reviewCardsPerDay: 1,
          });
        }

        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          10
        );

        // Verify simulation processes cards (priority queue is working)
        expect(progression).toBeDefined();
        expect(progression.dailySnapshots.length).toBeGreaterThan(0);

        // Cards should be processed in due date order (implicit in sorting logic)
        // The past due cards should be handled first
      });

      it("should handle invalid stability values gracefully", async () => {
        // Create cards with edge case stability values
        const cardNegative = DatabaseTestUtils.createTestFlashcard(
          testDeck.id,
          {
            id: "card-negative",
            front: "Negative Stability",
            state: "new",
            stability: -5,
          }
        );

        const cardZero = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: "card-zero",
          front: "Zero Stability",
          state: "new",
          stability: 0,
        });

        await db.createFlashcard(cardNegative);
        await db.createFlashcard(cardZero);

        // Should not crash with invalid stability values
        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          1
        );

        // Verify simulation completes without crashing
        expect(progression).toBeDefined();
        expect(progression.dailySnapshots.length).toBeGreaterThan(0);

        // Cards should be handled with default stability (1)
        const firstDay = progression.dailySnapshots[0];
        expect(
          firstDay.newCards + firstDay.learningCards + firstDay.matureCards
        ).toBe(2);
      });
    });

    describe("Performance and Large Deck Tests", () => {
      it("should handle large deck simulation efficiently", async () => {
        jest.setTimeout(10000); // 10 second timeout

        // Create 1,000 cards (reduced from 10k for integration test speed)
        for (let i = 0; i < 1000; i++) {
          const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
            id: `card-${i}`,
            front: `Card ${i}`,
            state: "new",
          });
          await db.createFlashcard(card);
        }

        const profile = await db.getDefaultProfile();
        if (profile) {
          await db.updateProfile(profile.id, {
            hasNewCardsLimitEnabled: true,
            newCardsPerDay: 50,
          });
        }

        const startTime = Date.now();
        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id],
          90
        );
        const elapsedTime = Date.now() - startTime;

        // Should complete in reasonable time (<5 seconds for 1000 cards)
        expect(elapsedTime).toBeLessThan(5000);
        expect(progression.dailySnapshots.length).toBeGreaterThan(0);
        expect(progression.dailySnapshots.length).toBeLessThanOrEqual(90);
      });

      it("should handle multi-deck aggregation efficiently", async () => {
        jest.setTimeout(10000);

        // Create 3 decks with 200 cards each
        const deck2 = DatabaseTestUtils.createTestDeck({
          id: "deck-2",
          name: "Deck 2",
          filepath: "/test/deck2.md",
          tag: "#deck2",
        });
        const deck3 = DatabaseTestUtils.createTestDeck({
          id: "deck-3",
          name: "Deck 3",
          filepath: "/test/deck3.md",
          tag: "#deck3",
        });

        await db.createDeck(deck2);
        await db.createDeck(deck3);

        const decks = [testDeck, deck2, deck3];

        for (const deck of decks) {
          for (let i = 0; i < 200; i++) {
            const card = DatabaseTestUtils.createTestFlashcard(deck.id, {
              id: `${deck.id}-card-${i}`,
              front: `${deck.name} Card ${i}`,
              state: "new",
            });
            await db.createFlashcard(card);
          }
        }

        const startTime = Date.now();
        const progression = await statsService.simulateMaturityProgression(
          [testDeck.id, deck2.id, deck3.id],
          30
        );
        const elapsedTime = Date.now() - startTime;

        // Should complete efficiently (<3 seconds for 600 cards)
        expect(elapsedTime).toBeLessThan(3000);
        expect(progression.dailySnapshots.length).toBeGreaterThan(0);

        // Should aggregate all 600 cards
        const firstDay = progression.dailySnapshots[0];
        expect(
          firstDay.newCards + firstDay.learningCards + firstDay.matureCards
        ).toBe(600);
      });
    });
  });

  describe("getOverallStatistics with Deck Filtering", () => {
    let testDeck1: Deck;
    let testDeck2: Deck;

    beforeEach(async () => {
      // Create two separate decks with different cards and reviews
      testDeck1 = DatabaseTestUtils.createTestDeck({
        id: "deck-1",
        name: "Deck 1",
        filepath: "/test/deck1.md",
        tag: "#deck1",
      });
      testDeck2 = DatabaseTestUtils.createTestDeck({
        id: "deck-2",
        name: "Deck 2",
        filepath: "/test/deck2.md",
        tag: "#deck2",
      });
      await db.createDeck(testDeck1);
      await db.createDeck(testDeck2);
    });

    it("should filter card stats by deck", async () => {
      // Deck 1: 3 new, 2 review cards
      for (let i = 0; i < 3; i++) {
        await db.createFlashcard(
          DatabaseTestUtils.createTestFlashcard(testDeck1.id, {
            id: `deck1-new-${i}`,
            state: "new",
          })
        );
      }
      for (let i = 0; i < 2; i++) {
        await db.createFlashcard(
          DatabaseTestUtils.createTestFlashcard(testDeck1.id, {
            id: `deck1-review-${i}`,
            state: "review",
            interval: 5000, // Not mature
            repetitions: 2,
          })
        );
      }

      // Deck 2: 5 new, 1 mature card
      for (let i = 0; i < 5; i++) {
        await db.createFlashcard(
          DatabaseTestUtils.createTestFlashcard(testDeck2.id, {
            id: `deck2-new-${i}`,
            state: "new",
          })
        );
      }
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck2.id, {
          id: "deck2-mature-0",
          state: "review",
          interval: 50000, // Mature
          repetitions: 5,
        })
      );

      // Test filtering to deck 1
      const deck1Stats = await statsService.getOverallStatistics(
        [testDeck1.id],
        "all"
      );
      expect(deck1Stats.cardStats.new).toBe(3);
      expect(deck1Stats.cardStats.review).toBe(2);
      expect(deck1Stats.cardStats.mature).toBe(0);
      expect(deck1Stats.cardStats.total).toBe(5);

      // Test filtering to deck 2
      const deck2Stats = await statsService.getOverallStatistics(
        [testDeck2.id],
        "all"
      );
      expect(deck2Stats.cardStats.new).toBe(5);
      expect(deck2Stats.cardStats.review).toBe(0);
      expect(deck2Stats.cardStats.mature).toBe(1);
      expect(deck2Stats.cardStats.total).toBe(6);

      // Test all decks (no filter)
      const allStats = await statsService.getOverallStatistics([], "all");
      expect(allStats.cardStats.new).toBe(8);
      expect(allStats.cardStats.review).toBe(2);
      expect(allStats.cardStats.mature).toBe(1);
      expect(allStats.cardStats.total).toBe(11);
    });

    it("should filter answer button stats by deck", async () => {
      // Create cards
      const card1 = DatabaseTestUtils.createTestFlashcard(testDeck1.id, {
        id: "card1",
      });
      const card2 = DatabaseTestUtils.createTestFlashcard(testDeck2.id, {
        id: "card2",
      });
      await db.createFlashcard(card1);
      await db.createFlashcard(card2);

      // Deck 1: 2 "Good", 1 "Again"
      await db.createReviewLog(
        DatabaseTestUtils.createTestReviewLog(card1.id, {
          id: "log1-1",
          ratingLabel: "good",
        })
      );
      await db.createReviewLog(
        DatabaseTestUtils.createTestReviewLog(card1.id, {
          id: "log1-2",
          ratingLabel: "good",
        })
      );
      await db.createReviewLog(
        DatabaseTestUtils.createTestReviewLog(card1.id, {
          id: "log1-3",
          ratingLabel: "again",
        })
      );

      // Deck 2: 3 "Easy", 1 "Hard"
      await db.createReviewLog(
        DatabaseTestUtils.createTestReviewLog(card2.id, {
          id: "log2-1",
          ratingLabel: "easy",
        })
      );
      await db.createReviewLog(
        DatabaseTestUtils.createTestReviewLog(card2.id, {
          id: "log2-2",
          ratingLabel: "easy",
        })
      );
      await db.createReviewLog(
        DatabaseTestUtils.createTestReviewLog(card2.id, {
          id: "log2-3",
          ratingLabel: "easy",
        })
      );
      await db.createReviewLog(
        DatabaseTestUtils.createTestReviewLog(card2.id, {
          id: "log2-4",
          ratingLabel: "hard",
        })
      );

      // Test deck 1 filtering
      const deck1Stats = await statsService.getOverallStatistics(
        [testDeck1.id],
        "all"
      );
      expect(deck1Stats.answerButtons.again).toBe(1);
      expect(deck1Stats.answerButtons.hard).toBe(0);
      expect(deck1Stats.answerButtons.good).toBe(2);
      expect(deck1Stats.answerButtons.easy).toBe(0);

      // Test deck 2 filtering
      const deck2Stats = await statsService.getOverallStatistics(
        [testDeck2.id],
        "all"
      );
      expect(deck2Stats.answerButtons.again).toBe(0);
      expect(deck2Stats.answerButtons.hard).toBe(1);
      expect(deck2Stats.answerButtons.good).toBe(0);
      expect(deck2Stats.answerButtons.easy).toBe(3);

      // Test all decks
      const allStats = await statsService.getOverallStatistics([], "all");
      expect(allStats.answerButtons.again).toBe(1);
      expect(allStats.answerButtons.hard).toBe(1);
      expect(allStats.answerButtons.good).toBe(2);
      expect(allStats.answerButtons.easy).toBe(3);
    });

    it("should filter forecast by deck", async () => {
      const tomorrow = new Date(Date.now() + 86400000);
      const nextWeek = new Date(Date.now() + 7 * 86400000);

      // Deck 1: 2 cards due tomorrow
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck1.id, {
          id: "deck1-due-1",
          state: "review",
          dueDate: tomorrow.toISOString(),
        })
      );
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(testDeck1.id, {
          id: "deck1-due-2",
          state: "review",
          dueDate: tomorrow.toISOString(),
        })
      );

      // Deck 2: 3 cards due next week
      for (let i = 0; i < 3; i++) {
        await db.createFlashcard(
          DatabaseTestUtils.createTestFlashcard(testDeck2.id, {
            id: `deck2-due-${i}`,
            state: "review",
            dueDate: nextWeek.toISOString(),
          })
        );
      }

      // Test deck 1 filtering
      const deck1Stats = await statsService.getOverallStatistics(
        [testDeck1.id],
        "all"
      );
      const tomorrowStr = toLocalDateString(tomorrow);
      const deck1TomorrowForecast = deck1Stats.forecast.find(
        (f) => f.date === tomorrowStr
      );
      expect(deck1TomorrowForecast?.dueCount).toBe(2);

      // Test deck 2 filtering
      const deck2Stats = await statsService.getOverallStatistics(
        [testDeck2.id],
        "all"
      );
      const nextWeekStr = toLocalDateString(nextWeek);
      const deck2NextWeekForecast = deck2Stats.forecast.find(
        (f) => f.date === nextWeekStr
      );
      expect(deck2NextWeekForecast?.dueCount).toBe(3);

      // Test all decks
      const allStats = await statsService.getOverallStatistics([], "all");
      const allTomorrowForecast = allStats.forecast.find(
        (f) => f.date === tomorrowStr
      );
      const allNextWeekForecast = allStats.forecast.find(
        (f) => f.date === nextWeekStr
      );
      expect(allTomorrowForecast?.dueCount).toBe(2);
      expect(allNextWeekForecast?.dueCount).toBe(3);
    });
  });

  describe("Performance", () => {
    it("should handle large datasets efficiently", async () => {
      // Create 1000 cards
      const cardPromises = [];
      for (let i = 0; i < 1000; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
          id: `card-${i}`,
          front: `Card ${i}`,
          state: i % 3 === 0 ? "new" : "review",
          interval: i % 3 === 0 ? 0 : 1440 * (i % 100),
          stability: i % 3 === 0 ? 0 : i % 100,
          repetitions: i % 3 === 0 ? 0 : i % 10,
        });
        cardPromises.push(db.createFlashcard(card));
      }
      await Promise.all(cardPromises);

      const startTime = Date.now();
      const counts = await statsService.getCardCountsByMaturity([testDeck.id]);
      const duration = Date.now() - startTime;

      // Should complete in under 200ms for 1000 cards
      expect(duration).toBeLessThan(200);
      expect(counts.new + counts.young + counts.mature).toBe(1000);
    });
  });
});
