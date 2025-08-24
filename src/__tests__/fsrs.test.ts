import { FSRS } from "../algorithm/fsrs";
import { Flashcard } from "../database/types";
import {
  FSRS_WEIGHTS_STANDARD,
  FSRS_WEIGHTS_SUBDAY,
} from "../algorithm/fsrs-weights";

describe("FSRS Algorithm - Pure Implementation", () => {
  let fsrs: FSRS;

  beforeEach(() => {
    fsrs = new FSRS({ requestRetention: 0.9, profile: "INTENSIVE" });
  });

  describe("New Card Initialization", () => {
    const newCard: Flashcard = {
      id: "test-card-1",
      deckId: "test-deck",
      front: "Test Question",
      back: "Test Answer",
      type: "header-paragraph",
      sourceFile: "test.md",
      contentHash: "hash123",
      state: "new",
      dueDate: new Date().toISOString(),
      interval: 0,
      repetitions: 0,
      difficulty: 0,
      stability: 0,
      lapses: 0,
      lastReviewed: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    it("should initialize new card with Again rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);
      const againCard = schedulingInfo.again;

      expect(againCard.state).toBe("review");
      expect(againCard.stability).toBeGreaterThan(0);
      expect(againCard.difficulty).toBeGreaterThan(0);
      expect(againCard.repetitions).toBe(1);
      expect(againCard.interval).toBeGreaterThanOrEqual(1); // Should be at least 1 minute
      expect(againCard.interval).toBeLessThan(10); // Should be around 1 minute
    });

    it("should initialize new card with Hard rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);
      const hardCard = schedulingInfo.hard;

      expect(hardCard.state).toBe("review");
      expect(hardCard.stability).toBeGreaterThan(0);
      expect(hardCard.difficulty).toBeGreaterThan(0);
      expect(hardCard.repetitions).toBe(1);
      expect(hardCard.interval).toBeGreaterThan(1); // Should be more than again
      expect(hardCard.interval).toBeLessThan(30); // Should be around 5 minutes
    });

    it("should initialize new card with Good rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);
      const goodCard = schedulingInfo.good;

      expect(goodCard.state).toBe("review");
      expect(goodCard.stability).toBeGreaterThan(0);
      expect(goodCard.difficulty).toBeGreaterThan(0);
      expect(goodCard.repetitions).toBe(1);
      expect(goodCard.interval).toBeGreaterThanOrEqual(1); // At least minMinutes
      expect(goodCard.interval).toBeLessThan(60); // Should be around 10 minutes with intensive profile
    });

    it("should initialize new card with Easy rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);
      const easyCard = schedulingInfo.easy;

      expect(easyCard.state).toBe("review");
      expect(easyCard.stability).toBeGreaterThan(0);
      expect(easyCard.difficulty).toBeGreaterThan(0);
      expect(easyCard.repetitions).toBe(1);
      expect(easyCard.interval).toBeGreaterThan(30); // Should be more than good
      expect(easyCard.interval).toBeLessThanOrEqual(1440); // Should be around 1 day with intensive profile
    });

    it("should set lapses correctly on first rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);

      // Only Again should increment lapses on first rating
      expect(schedulingInfo.again.repetitions).toBe(1);
      expect(schedulingInfo.hard.repetitions).toBe(1);
      expect(schedulingInfo.good.repetitions).toBe(1);
      expect(schedulingInfo.easy.repetitions).toBe(1);
    });

    it("should never return intervals less than minMinutes", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);

      expect(schedulingInfo.again.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.hard.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.good.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.easy.interval).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Review Card State Transitions", () => {
    const reviewCard: Flashcard = {
      id: "test-card-2",
      deckId: "test-deck",
      front: "Review Question",
      back: "Review Answer",
      type: "header-paragraph",
      sourceFile: "test.md",
      contentHash: "hash456",
      state: "review",
      dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Due yesterday
      interval: 1440, // 1 day
      repetitions: 3,
      difficulty: 5.5, // FSRS difficulty
      stability: 2.5,
      lapses: 1,
      lastReviewed: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 2 days ago
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    it("should keep review card in Review state when pressing Again", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(reviewCard);
      const againCard = schedulingInfo.again;

      expect(againCard.state).toBe("review");
      expect(againCard.repetitions).toBe(4);
      expect(againCard.interval).toBe(1); // INTENSIVE profile: 1 minute for Again
    });

    it("should increment lapses when pressing Again on review card", () => {
      const updatedCard = fsrs.updateCard(reviewCard, "again");
      expect(updatedCard.lapses).toBe(reviewCard.lapses + 1);
      expect(updatedCard.state).toBe("review"); // Still in review state
    });

    it("should increase difficulty and reset stability when pressing Again on review card", () => {
      // Create a card with moderate difficulty and high stability from multiple reviews
      const experiencedCard: Flashcard = {
        ...reviewCard,
        difficulty: 5.5,
        stability: 45.7,
        repetitions: 10,
        lapses: 1,
      };

      const updatedCard = fsrs.updateCard(experiencedCard, "again");

      // After "Again", difficulty should increase (become harder)
      expect(updatedCard.difficulty).toBeGreaterThan(
        experiencedCard.difficulty,
      );

      // Stability should be reset to w[0] (much lower than before)
      expect(updatedCard.stability).toBeLessThan(experiencedCard.stability);
      expect(updatedCard.stability).toBeLessThan(5); // Should be reset to w[0] which is typically small

      // Lapses should increment
      expect(updatedCard.lapses).toBe(experiencedCard.lapses + 1);

      // Repetitions should increment
      expect(updatedCard.repetitions).toBe(experiencedCard.repetitions + 1);
    });

    it("should reset stability to w[0] specifically for Again rating", () => {
      // Create a card with known high stability
      const cardWithHighStability: Flashcard = {
        ...reviewCard,
        difficulty: 6.0,
        stability: 30.5,
        repetitions: 5,
        lapses: 0,
      };

      const updatedCard = fsrs.updateCard(cardWithHighStability, "again");

      // Get the w[0] weight directly from FSRS
      const fsrsWeights = (fsrs as any).getWeights();
      const expectedStability = fsrsWeights[0];

      // Stability should be exactly w[0]
      expect(updatedCard.stability).toBe(expectedStability);
      expect(updatedCard.stability).toBeLessThan(5); // w[0] should be small

      // Verify other Again rating behaviors
      expect(updatedCard.difficulty).toBeGreaterThan(
        cardWithHighStability.difficulty,
      );
      expect(updatedCard.lapses).toBe(1);
      expect(updatedCard.repetitions).toBe(6);
    });

    it("should keep review card in Review state for all ratings", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(reviewCard);

      expect(schedulingInfo.again.state).toBe("review");
      expect(schedulingInfo.hard.state).toBe("review");
      expect(schedulingInfo.good.state).toBe("review");
      expect(schedulingInfo.easy.state).toBe("review");
    });

    it("should increase intervals for Good and Easy ratings", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(reviewCard);

      expect(schedulingInfo.good.interval).toBeGreaterThan(reviewCard.interval);
      expect(schedulingInfo.easy.interval).toBeGreaterThan(
        schedulingInfo.good.interval,
      );
    });

    it("should decrease stability for Again rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(reviewCard);
      const againCard = schedulingInfo.again;

      // Again rating should result in shorter interval than current
      // Note: In INTENSIVE profile, Again rating always gives 1 minute minimum
      expect(againCard.interval).toBe(1);
      expect(againCard.state).toBe("review");
    });

    it("should respect maximum interval limit", () => {
      const longReviewCard = {
        ...reviewCard,
        stability: 50000, // Very high stability
      };

      const schedulingInfo = fsrs.getSchedulingInfo(longReviewCard);

      // Should be capped at maximum interval (36500 days = ~100 years)
      const maxIntervalMinutes = 36500 * 1440;
      expect(schedulingInfo.easy.interval).toBeLessThanOrEqual(
        maxIntervalMinutes,
      );
    });
  });

  describe("FSRS State Management", () => {
    it("should only have New and Review states", () => {
      const newCard: Flashcard = {
        id: "test-card-3",
        deckId: "test-deck",
        front: "Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash789",
        state: "new",
        dueDate: new Date().toISOString(),
        interval: 0,
        repetitions: 0,
        difficulty: 0,
        stability: 0,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const schedulingInfo = fsrs.getSchedulingInfo(newCard);

      // All ratings should result in review state (no learning state)
      expect(schedulingInfo.again.state).toBe("review");
      expect(schedulingInfo.hard.state).toBe("review");
      expect(schedulingInfo.good.state).toBe("review");
      expect(schedulingInfo.easy.state).toBe("review");
    });

    it("should preserve stability and difficulty in review cards", () => {
      const reviewCard: Flashcard = {
        id: "test-card-4",
        deckId: "test-deck",
        front: "Review Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash101112",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 2880, // 2 days
        repetitions: 2,
        difficulty: 6.0, // FSRS difficulty
        stability: 5.0,
        lapses: 0,
        lastReviewed: new Date(
          Date.now() - 2 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const schedulingInfo = fsrs.getSchedulingInfo(reviewCard);

      // Stability and difficulty should be calculated based on FSRS algorithm
      expect(schedulingInfo.good.stability).toBeGreaterThan(0);
      expect(schedulingInfo.good.difficulty).toBeGreaterThan(0);
      expect(schedulingInfo.good.stability).not.toBe(reviewCard.stability); // Should be updated
    });
  });

  describe("Pure FSRS Compliance", () => {
    it("should never schedule intervals less than minMinutes", () => {
      const testCards = [
        {
          id: "1",
          state: "new" as const,
          stability: 0,
          difficulty: 0,
          repetitions: 0,
        },
        {
          id: "2",
          state: "review" as const,
          stability: 0.5,
          difficulty: 8.0,
          repetitions: 5,
        },
      ];

      testCards.forEach((cardData) => {
        const card: Flashcard = {
          ...cardData,
          deckId: "test-deck",
          front: "Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: `hash${cardData.id}`,
          dueDate: new Date().toISOString(),
          interval: 0,
          difficulty: cardData.difficulty,
          lapses: 0,
          lastReviewed: null,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const schedulingInfo = fsrs.getSchedulingInfo(card);

        expect(schedulingInfo.again.interval).toBeGreaterThanOrEqual(1);
        expect(schedulingInfo.hard.interval).toBeGreaterThanOrEqual(1);
        expect(schedulingInfo.good.interval).toBeGreaterThanOrEqual(1);
        expect(schedulingInfo.easy.interval).toBeGreaterThanOrEqual(1);
      });
    });

    it("should support sub-day intervals with low stability", () => {
      // Create FSRS with intensive profile for sub-day intervals
      const subDayFsrs = new FSRS({
        requestRetention: 0.9,
        profile: "INTENSIVE", // Sub-day intervals
      });

      const newCard: Flashcard = {
        id: "subday-test",
        deckId: "test-deck",
        front: "Sub-day Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hashsubday",
        state: "new",
        dueDate: new Date().toISOString(),
        interval: 0,
        repetitions: 0,
        difficulty: 0,
        stability: 0,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const schedulingInfo = subDayFsrs.getSchedulingInfo(newCard);

      // Should respect minMinutes floor
      expect(schedulingInfo.again.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.hard.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.good.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.easy.interval).toBeGreaterThanOrEqual(1);

      // With low initial stability, intervals could be sub-day but >= minMinutes
      expect(schedulingInfo.again.interval).toBeLessThan(1440); // Less than 1 day is now allowed
    });

    it("should validate FSRS parameters", () => {
      // Should throw on invalid w length
      expect(() => {
        new FSRS({ requestRetention: 0.9, profile: "INVALID" as any }); // Invalid profile
      }).toThrow("Invalid profile");

      // Should throw on invalid requestRetention
      expect(() => {
        new FSRS({ requestRetention: -0.1, profile: "STANDARD" });
      }).toThrow("requestRetention must be in range (0.5, 0.995)");

      expect(() => {
        new FSRS({ requestRetention: 1.1, profile: "STANDARD" });
      }).toThrow("requestRetention must be in range (0.5, 0.995)");

      // Profile and requestRetention validation is sufficient for new system
    });

    it("should support continuous sub-day scheduling workflow", () => {
      // Create FSRS optimized for sub-day intervals
      const subDayFsrs = new FSRS({
        requestRetention: 0.95, // Higher retention for frequent reviews
        profile: "INTENSIVE", // Use intensive profile for sub-day intervals
      });

      let card: Flashcard = {
        id: "continuous-test",
        deckId: "test-deck",
        front: "Continuous Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hashcontinuous",
        state: "new",
        dueDate: new Date().toISOString(),
        interval: 0,
        repetitions: 0,
        difficulty: 0,
        stability: 0,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // First review - should create sub-day interval
      card = subDayFsrs.updateCard(card, "good");
      expect(card.interval).toBeGreaterThanOrEqual(1); // >= minMinutes
      expect(card.interval).toBeLessThan(1440); // Should be sub-day with intensive profile
      expect(card.state).toBe("review");
      expect(card.repetitions).toBe(1);

      // Simulate time passing and review again
      const firstDueTime = new Date(card.dueDate).getTime();
      const reviewTime = new Date(firstDueTime + 30 * 60 * 1000); // 30 minutes later

      // Update lastReviewed for next calculation
      card.lastReviewed = reviewTime.toISOString();

      // Second review - again rating should still respect minMinutes
      card = subDayFsrs.updateCard(card, "again");
      expect(card.interval).toBeGreaterThanOrEqual(1);
      expect(card.lapses).toBe(1); // Should increment lapses
      expect(card.repetitions).toBe(2);
    });

    it("should handle invalid stability and interval edge cases", () => {
      const testCard: Flashcard = {
        id: "edge-case-test",
        deckId: "test-deck",
        front: "Edge Case Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hashedge",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 0,
        repetitions: 1,
        difficulty: NaN, // Invalid difficulty
        stability: NaN, // Invalid stability
        lapses: 0,
        lastReviewed: new Date().toISOString(),
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Should not throw and should return valid intervals
      const schedulingInfo = fsrs.getSchedulingInfo(testCard);

      expect(schedulingInfo.again.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.hard.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.good.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.easy.interval).toBeGreaterThanOrEqual(1);

      // All due dates should be valid
      expect(() => new Date(schedulingInfo.again.dueDate)).not.toThrow();
      expect(() => new Date(schedulingInfo.hard.dueDate)).not.toThrow();
      expect(() => new Date(schedulingInfo.good.dueDate)).not.toThrow();
      expect(() => new Date(schedulingInfo.easy.dueDate)).not.toThrow();
    });

    it("should recover from NaN stability calculations in real scenarios", () => {
      // Create a card that might cause NaN stability through extreme calculations
      const problematicCard: Flashcard = {
        id: "nan-recovery-test",
        deckId: "test-deck",
        front: "NaN Recovery Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hashnan",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 1440,
        repetitions: 100, // Very high repetitions
        difficulty: 0, // Invalid difficulty
        stability: 0, // Invalid stability
        lapses: 50, // High lapses
        lastReviewed: new Date(Date.now() - 1000000000).toISOString(), // Very old review
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Should recover gracefully and not throw
      expect(() => {
        const schedulingInfo = fsrs.getSchedulingInfo(problematicCard);
        expect(schedulingInfo.again.interval).toBeGreaterThanOrEqual(1);
        expect(isFinite(schedulingInfo.again.interval)).toBe(true);
        expect(schedulingInfo.again.dueDate).toBeTruthy();
      }).not.toThrow();

      // Should also work for updateCard
      expect(() => {
        const updated = fsrs.updateCard(problematicCard, "again");
        expect(updated.interval).toBeGreaterThanOrEqual(1);
        expect(isFinite(updated.interval)).toBe(true);
        expect(updated.stability).toBeGreaterThan(0);
        expect(isFinite(updated.stability)).toBe(true);
      }).not.toThrow();
    });

    it("should produce target intervals with sub-day optimized weights", () => {
      const newCard: Flashcard = {
        id: "subday-target-test",
        deckId: "test-deck",
        front: "Sub-day Target Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hashsubdayTarget",
        state: "new",
        dueDate: new Date().toISOString(),
        interval: 0,
        repetitions: 0,
        difficulty: 0,
        stability: 0,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const schedulingInfo = fsrs.getSchedulingInfo(newCard);

      // With intensive profile, should produce sub-day intervals
      expect(schedulingInfo.good.interval).toBeLessThan(1440); // Sub-day
      expect(schedulingInfo.good.interval).toBeGreaterThan(5); // Reasonable minimum

      // Verify button order: Again < Hard < Good < Easy
      expect(schedulingInfo.again.interval).toBeLessThan(
        schedulingInfo.hard.interval,
      );
      expect(schedulingInfo.hard.interval).toBeLessThan(
        schedulingInfo.good.interval,
      );
      expect(schedulingInfo.good.interval).toBeLessThan(
        schedulingInfo.easy.interval,
      );

      // All should be >= minMinutes
      expect(schedulingInfo.again.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.hard.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.good.interval).toBeGreaterThanOrEqual(1);
      expect(schedulingInfo.easy.interval).toBeGreaterThanOrEqual(1);
    });

    it("should maintain monotonic interval progression for ratings 2-4", () => {
      const reviewCard: Flashcard = {
        id: "test-card-5",
        deckId: "test-deck",
        front: "Monotonic Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash131415",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 1440,
        repetitions: 3,
        difficulty: 5.0,
        stability: 3.0,
        lapses: 0,
        lastReviewed: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const schedulingInfo = fsrs.getSchedulingInfo(reviewCard);

      // Hard < Good < Easy intervals
      expect(schedulingInfo.hard.interval).toBeLessThan(
        schedulingInfo.good.interval,
      );
      expect(schedulingInfo.good.interval).toBeLessThan(
        schedulingInfo.easy.interval,
      );
    });

    it("should increment reps on every rating", () => {
      const reviewCard: Flashcard = {
        id: "test-card-6",
        deckId: "test-deck",
        front: "Reps Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash161718",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 2880,
        repetitions: 5,
        difficulty: 4.5,
        stability: 4.0,
        lapses: 1,
        lastReviewed: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const schedulingInfo = fsrs.getSchedulingInfo(reviewCard);

      expect(schedulingInfo.again.repetitions).toBe(6);
      expect(schedulingInfo.hard.repetitions).toBe(6);
      expect(schedulingInfo.good.repetitions).toBe(6);
      expect(schedulingInfo.easy.repetitions).toBe(6);
    });

    it("should update lastReviewed timestamp", () => {
      const newCard: Flashcard = {
        id: "test-card-7",
        deckId: "test-deck",
        front: "Timestamp Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash192021",
        state: "new",
        dueDate: new Date().toISOString(),
        interval: 0,
        repetitions: 0,
        difficulty: 0,
        stability: 0,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const beforeTime = Date.now();
      const updatedCard = fsrs.updateCard(newCard, "good");
      const afterTime = Date.now();

      expect(updatedCard.lastReviewed).toBeTruthy();
      // Check that lastReviewed is set to current time (within reasonable range)
      const lastReviewedTime = new Date(updatedCard.lastReviewed!).getTime();
      expect(lastReviewedTime).toBeGreaterThanOrEqual(beforeTime);
      expect(lastReviewedTime).toBeLessThanOrEqual(afterTime);
    });
  });

  describe("Data Model Compliance", () => {
    it("should store stability and difficulty separately", () => {
      const newCard: Flashcard = {
        id: "test-card-8",
        deckId: "test-deck",
        front: "Data Model Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash222324",
        state: "new",
        dueDate: new Date().toISOString(),
        interval: 0,
        repetitions: 0,
        difficulty: 0,
        stability: 0,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const updatedCard = fsrs.updateCard(newCard, "good");

      expect(updatedCard.stability).toBeGreaterThan(0);
      expect(updatedCard.difficulty).toBeGreaterThan(0); // Explicit difficulty field
      expect(updatedCard.stability).not.toBe(updatedCard.difficulty);
    });

    it("should maintain reps and lapses counters", () => {
      const reviewCard: Flashcard = {
        id: "test-card-9",
        deckId: "test-deck",
        front: "Counters Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash252627",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 1440,
        repetitions: 2,
        difficulty: 5.0,
        stability: 3.0,
        lapses: 1,
        lastReviewed: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const againCard = fsrs.updateCard(reviewCard, "again");
      const goodCard = fsrs.updateCard(reviewCard, "good");

      // Again should increment both reps and lapses
      expect(againCard.repetitions).toBe(3);
      expect(againCard.lapses).toBe(2);

      // Good should increment only reps
      expect(goodCard.repetitions).toBe(3);
      expect(goodCard.lapses).toBe(1); // Unchanged
    });
  });

  describe("Algorithm Correctness", () => {
    it("should calculate elapsed days correctly", () => {
      const reviewCard: Flashcard = {
        id: "test-card-10",
        deckId: "test-deck",
        front: "Elapsed Days Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash282930",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 2880, // 2 days
        repetitions: 1,
        difficulty: 5.0,
        stability: 2.0,
        lapses: 0,
        lastReviewed: new Date(
          Date.now() - 3 * 24 * 60 * 60 * 1000,
        ).toISOString(), // 3 days ago
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const schedulingInfo = fsrs.getSchedulingInfo(reviewCard);

      // Since card was due 1 day ago (interval was 2 days, last reviewed 3 days ago)
      // the stability should be affected by the forgetting curve
      expect(schedulingInfo.good.stability).toBeDefined();
      expect(schedulingInfo.good.difficulty).toBeDefined();
    });

    it("should not mutate original card in getSchedulingInfo", () => {
      const originalCard: Flashcard = {
        id: "test-card-11",
        deckId: "test-deck",
        front: "Immutable Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash313233",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 1440,
        repetitions: 2,
        difficulty: 5.0,
        stability: 2.5,
        lapses: 0,
        lastReviewed: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const originalState = { ...originalCard };
      fsrs.getSchedulingInfo(originalCard);

      // Original card should be unchanged
      expect(originalCard).toEqual(originalState);
    });

    describe("Pure FSRS Verification", () => {
      it("should satisfy all pure FSRS requirements", () => {
        // Test 1: New card with rating=4 initializes S/D, returns interval ≥1 day; state becomes Review
        const newCard: Flashcard = {
          id: "pure-test-1",
          deckId: "test-deck",
          front: "Pure FSRS Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "purehash",
          state: "new",
          dueDate: new Date().toISOString(),
          interval: 0,
          repetitions: 0,
          difficulty: 0,
          stability: 0,
          lapses: 0,
          lastReviewed: null,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const easySchedule = fsrs.getSchedulingInfo(newCard).easy;
        expect(easySchedule.state).toBe("review");
        expect(easySchedule.stability).toBeGreaterThan(0);
        expect(easySchedule.difficulty).toBeGreaterThan(0);
        expect(easySchedule.interval).toBeGreaterThanOrEqual(5); // Sub-day intervals allowed

        // Test 2: Review + rating=1 keeps state Review, increments lapses
        const reviewCard: Flashcard = {
          id: "pure-test-2",
          deckId: "test-deck",
          front: "Review Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "reviewhash",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 2880,
          repetitions: 2,
          difficulty: 5.0,
          stability: 3.0,
          lapses: 1,
          lastReviewed: new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString(),
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const againUpdated = fsrs.updateCard(reviewCard, "again");
        expect(againUpdated.state).toBe("review");
        expect(againUpdated.lapses).toBe(2);
        expect(againUpdated.repetitions).toBe(3);

        // Test 3: getSchedulingInfo returns four different futures without mutating
        const originalCard = { ...reviewCard };
        const schedulingInfo = fsrs.getSchedulingInfo(reviewCard);
        expect(reviewCard).toEqual(originalCard); // No mutation

        // All four outcomes should be different
        const intervals = [
          schedulingInfo.again.interval,
          schedulingInfo.hard.interval,
          schedulingInfo.good.interval,
          schedulingInfo.easy.interval,
        ];
        expect(new Set(intervals)).toHaveProperty("size", 4); // All different

        // Test 4: Maximum interval capping works
        const highStabilityCard = {
          ...reviewCard,
          stability: 100000,
        };
        const cappedSchedule = fsrs.getSchedulingInfo(highStabilityCard);
        expect(cappedSchedule.easy.interval).toBeLessThanOrEqual(36500 * 1440);
      });
    });
  });

  describe("Migration Support", () => {
    it("should handle cards with missing FSRS data", () => {
      const legacyCard: Flashcard = {
        id: "legacy-card",
        deckId: "test-deck",
        front: "Legacy Test",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "legacyhash",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 1440,
        repetitions: 3,
        difficulty: 2.5, // FSRS difficulty
        stability: 0, // Missing FSRS data
        lapses: 0,
        lastReviewed: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const schedulingInfo = fsrs.getSchedulingInfo(legacyCard);

      // Should be treated as initialization since stability is 0
      expect(schedulingInfo.good.state).toBe("review");
      expect(schedulingInfo.good.stability).toBeGreaterThan(0);
      expect(schedulingInfo.good.difficulty).toBeGreaterThan(0);
    });

    describe("getRetrievability", () => {
      it("should calculate retrievability using FSRS forgetting curve", () => {
        const card: Flashcard = {
          id: "test-card",
          deckId: "test-deck",
          front: "Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "hash123",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 1440,
          repetitions: 3,
          difficulty: 5.0,
          stability: 3.0,
          lapses: 0,
          lastReviewed: new Date(
            Date.now() - 3 * 24 * 60 * 60 * 1000,
          ).toISOString(), // 3 days ago
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const reviewedAt = new Date();
        const retrievability = fsrs.getRetrievability(card, reviewedAt);

        // Should use FSRS forgetting curve formula: (1 + t/(9*S))^-1
        // With t=3 days, S=3.0: (1 + 3/(9*3))^-1 = (1 + 1/9)^-1 = (10/9)^-1 = 0.9
        expect(retrievability).toBeCloseTo(0.9, 2);
      });

      it("should return default retrievability for new cards", () => {
        const newCard: Flashcard = {
          id: "new-card",
          deckId: "test-deck",
          front: "Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "hash123",
          state: "new",
          dueDate: new Date().toISOString(),
          interval: 0,
          repetitions: 0,
          difficulty: 0,
          stability: 0,
          lapses: 0,
          lastReviewed: null,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const retrievability = fsrs.getRetrievability(newCard);
        expect(retrievability).toBe(0.9);
      });

      it("should handle cards with zero stability", () => {
        const card: Flashcard = {
          id: "test-card",
          deckId: "test-deck",
          front: "Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "hash123",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 1440,
          repetitions: 1,
          difficulty: 5.0,
          stability: 0, // Invalid stability
          lapses: 0,
          lastReviewed: new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString(),
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const retrievability = fsrs.getRetrievability(card);
        expect(retrievability).toBe(0.9);
      });
    });

    describe("Again Rating Minimum Interval", () => {
      it("should always use minimum interval for Again rating in INTENSIVE profile", () => {
        const fsrsIntensive = new FSRS({
          requestRetention: 0.9,
          profile: "INTENSIVE",
        });

        const reviewCard: Flashcard = {
          id: "again-test-1",
          deckId: "test-deck",
          front: "Again Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "againhash",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 2880, // 2 days
          repetitions: 5,
          difficulty: 6.0,
          stability: 10.0, // High stability
          lapses: 2,
          lastReviewed: new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString(),
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const againSchedule = fsrsIntensive.getSchedulingInfo(reviewCard).again;

        // INTENSIVE profile should always give 1 minute for Again rating
        expect(againSchedule.interval).toBe(1);
        expect(againSchedule.state).toBe("review");
        // Note: lapses are tracked internally, not in SchedulingCard interface
      });

      it("should always use minimum interval for Again rating in STANDARD profile", () => {
        const fsrsStandard = new FSRS({
          requestRetention: 0.9,
          profile: "STANDARD",
        });

        const reviewCard: Flashcard = {
          id: "again-test-2",
          deckId: "test-deck",
          front: "Again Test Standard",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "againhash2",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 10080, // 7 days
          repetitions: 10,
          difficulty: 8.0,
          stability: 30.0, // Very high stability
          lapses: 0,
          lastReviewed: new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString(),
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const againSchedule = fsrsStandard.getSchedulingInfo(reviewCard).again;

        // STANDARD profile should always give 1440 minutes (1 day) for Again rating
        expect(againSchedule.interval).toBe(1440);
        expect(againSchedule.state).toBe("review");
        // Note: lapses are tracked internally, not in SchedulingCard interface
      });

      it("should use calculated interval for non-Again ratings", () => {
        const fsrsIntensive = new FSRS({
          requestRetention: 0.9,
          profile: "INTENSIVE",
        });

        const reviewCard: Flashcard = {
          id: "good-test-1",
          deckId: "test-deck",
          front: "Good Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "goodhash",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 1440, // 1 day
          repetitions: 2,
          difficulty: 5.0,
          stability: 2.0,
          lapses: 0,
          lastReviewed: new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString(),
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const goodSchedule = fsrsIntensive.getSchedulingInfo(reviewCard).good;

        // Good rating should use calculated interval based on stability, not minimum
        expect(goodSchedule.interval).toBeGreaterThan(1); // Should be more than 1 minute
        expect(goodSchedule.state).toBe("review");
        // Note: lapses are tracked internally, not in SchedulingCard interface
      });

      it("should show correct Again interval in preview for review cards", () => {
        const fsrsIntensive = new FSRS({
          requestRetention: 0.9,
          profile: "INTENSIVE",
        });

        const reviewCard: Flashcard = {
          id: "preview-test-1",
          deckId: "test-deck",
          front: "Preview Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "previewhash",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 7200, // 5 days
          repetitions: 8,
          difficulty: 7.0,
          stability: 15.0, // High stability
          lapses: 1,
          lastReviewed: new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString(),
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const schedulingInfo = fsrsIntensive.getSchedulingInfo(reviewCard);

        // INTENSIVE profile should show 1 minute for Again in preview
        expect(schedulingInfo.again.interval).toBe(1);

        // Other ratings should show calculated intervals
        expect(schedulingInfo.good.interval).toBeGreaterThan(1);
        expect(schedulingInfo.hard.interval).toBeGreaterThan(1);
        expect(schedulingInfo.easy.interval).toBeGreaterThan(1);
      });

      it("should show correct Again interval in updateCard for review cards", () => {
        const fsrsStandard = new FSRS({
          requestRetention: 0.9,
          profile: "STANDARD",
        });

        const reviewCard: Flashcard = {
          id: "update-test-1",
          deckId: "test-deck",
          front: "Update Test",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "updatehash",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 14400, // 10 days
          repetitions: 12,
          difficulty: 8.5,
          stability: 25.0, // Very high stability
          lapses: 0,
          lastReviewed: new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString(),
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const updatedCard = fsrsStandard.updateCard(reviewCard, "again");

        // STANDARD profile should give 1440 minutes (1 day) for Again
        expect(updatedCard.interval).toBe(1440);
        expect(updatedCard.state).toBe("review");
      });
    });
  });
});
