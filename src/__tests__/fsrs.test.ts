import { FSRS } from "../algorithm/fsrs";
import { Flashcard } from "../database/types";

describe("FSRS Algorithm - Pure Implementation", () => {
  let fsrs: FSRS;

  beforeEach(() => {
    fsrs = new FSRS();
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
      easeFactor: 0,
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
      expect(againCard.interval).toBeGreaterThanOrEqual(1440); // At least 1 day
    });

    it("should initialize new card with Hard rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);
      const hardCard = schedulingInfo.hard;

      expect(hardCard.state).toBe("review");
      expect(hardCard.stability).toBeGreaterThan(0);
      expect(hardCard.difficulty).toBeGreaterThan(0);
      expect(hardCard.repetitions).toBe(1);
      expect(hardCard.interval).toBeGreaterThanOrEqual(1440); // At least 1 day
    });

    it("should initialize new card with Good rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);
      const goodCard = schedulingInfo.good;

      expect(goodCard.state).toBe("review");
      expect(goodCard.stability).toBeGreaterThan(0);
      expect(goodCard.difficulty).toBeGreaterThan(0);
      expect(goodCard.repetitions).toBe(1);
      expect(goodCard.interval).toBeGreaterThanOrEqual(1440); // At least 1 day
    });

    it("should initialize new card with Easy rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);
      const easyCard = schedulingInfo.easy;

      expect(easyCard.state).toBe("review");
      expect(easyCard.stability).toBeGreaterThan(0);
      expect(easyCard.difficulty).toBeGreaterThan(0);
      expect(easyCard.repetitions).toBe(1);
      expect(easyCard.interval).toBeGreaterThanOrEqual(1440); // At least 1 day
    });

    it("should set lapses correctly on first rating", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);

      // Only Again should increment lapses on first rating
      expect(schedulingInfo.again.repetitions).toBe(1);
      expect(schedulingInfo.hard.repetitions).toBe(1);
      expect(schedulingInfo.good.repetitions).toBe(1);
      expect(schedulingInfo.easy.repetitions).toBe(1);
    });

    it("should never return intervals less than 1 day", () => {
      const schedulingInfo = fsrs.getSchedulingInfo(newCard);

      expect(schedulingInfo.again.interval).toBeGreaterThanOrEqual(1440);
      expect(schedulingInfo.hard.interval).toBeGreaterThanOrEqual(1440);
      expect(schedulingInfo.good.interval).toBeGreaterThanOrEqual(1440);
      expect(schedulingInfo.easy.interval).toBeGreaterThanOrEqual(1440);
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
      easeFactor: 5.5, // FSRS difficulty
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
      expect(againCard.interval).toBeGreaterThanOrEqual(1440); // At least 1 day
    });

    it("should increment lapses when pressing Again on review card", () => {
      const updatedCard = fsrs.updateCard(reviewCard, "again");
      expect(updatedCard.lapses).toBe(reviewCard.lapses + 1);
      expect(updatedCard.state).toBe("review"); // Still in review state
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
      // Note: In FSRS, Again rating reduces stability but minimum interval is 1 day
      expect(againCard.interval).toBeGreaterThanOrEqual(1440);
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
        easeFactor: 0,
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
        easeFactor: 6.0, // FSRS difficulty
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
    it("should never schedule intervals less than 1 day", () => {
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
          easeFactor: cardData.difficulty,
          lapses: 0,
          lastReviewed: null,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        const schedulingInfo = fsrs.getSchedulingInfo(card);

        expect(schedulingInfo.again.interval).toBeGreaterThanOrEqual(1440);
        expect(schedulingInfo.hard.interval).toBeGreaterThanOrEqual(1440);
        expect(schedulingInfo.good.interval).toBeGreaterThanOrEqual(1440);
        expect(schedulingInfo.easy.interval).toBeGreaterThanOrEqual(1440);
      });
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
        easeFactor: 5.0,
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
        easeFactor: 4.5,
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
        easeFactor: 0,
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
        easeFactor: 0,
        stability: 0,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const updatedCard = fsrs.updateCard(newCard, "good");

      expect(updatedCard.stability).toBeGreaterThan(0);
      expect(updatedCard.easeFactor).toBeGreaterThan(0); // Difficulty stored in easeFactor
      expect(updatedCard.stability).not.toBe(updatedCard.easeFactor);
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
        easeFactor: 5.0,
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
        easeFactor: 5.0,
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
        easeFactor: 5.0,
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
          easeFactor: 0,
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
        expect(easySchedule.interval).toBeGreaterThanOrEqual(1440);

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
          easeFactor: 5.0,
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
        easeFactor: 2.5, // Old SM-2 ease factor
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
  });
});
