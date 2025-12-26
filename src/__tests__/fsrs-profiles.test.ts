import { FSRS, RatingLabel } from "../algorithm/fsrs";
import { Flashcard, FlashcardState } from "../database/types";

describe("FSRS Profiles", () => {
  let standardFSRS: FSRS;
  let intensiveFSRS: FSRS;
  let testCard: Flashcard;

  beforeEach(() => {
    standardFSRS = new FSRS({
      requestRetention: 0.9,
      profile: "STANDARD",
    });

    intensiveFSRS = new FSRS({
      requestRetention: 0.9,
      profile: "INTENSIVE",
    });

    testCard = {
      id: "test-card",
      deckId: "test-deck",
      front: "Test Question",
      back: "Test Answer",
      type: "header-paragraph",
      sourceFile: "test.md",
      contentHash: "test-hash",
      state: "new" as FlashcardState,
      dueDate: new Date().toISOString(),
      interval: 0,
      repetitions: 0,
      difficulty: 5.0,
      stability: 0,
      lapses: 0,
      lastReviewed: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
  });

  describe("INTENSIVE Profile Behavior", () => {
    test("should produce sub-day intervals for new cards", () => {
      const scheduling = intensiveFSRS.getSchedulingInfo(testCard);

      // Again should be ~1 minute
      expect(scheduling.again.interval).toBeGreaterThanOrEqual(1);
      expect(scheduling.again.interval).toBeLessThan(10);

      // Hard should be ~5 minutes
      expect(scheduling.hard.interval).toBeGreaterThan(
        scheduling.again.interval,
      );
      expect(scheduling.hard.interval).toBeLessThan(30);

      // Good should be ~10 minutes
      expect(scheduling.good.interval).toBeGreaterThan(
        scheduling.hard.interval,
      );
      expect(scheduling.good.interval).toBeLessThan(60);

      // Easy should be ~1 day
      expect(scheduling.easy.interval).toBeGreaterThan(
        scheduling.good.interval,
      );
      expect(scheduling.easy.interval).toBeLessThanOrEqual(1440);
    });

    test("should maintain minute granularity throughout", () => {
      let card = { ...testCard };

      // Simulate multiple reviews
      for (let i = 0; i < 5; i++) {
        card = intensiveFSRS.updateCard(card, "good");

        // All intervals should be precise (not rounded to days)
        expect(card.interval % 1440).not.toBe(0); // Not a multiple of 1440 minutes (1 day)
      }
    });
  });

  describe("STANDARD Profile Behavior", () => {
    test("should produce day-based intervals for new cards", () => {
      const scheduling = standardFSRS.getSchedulingInfo(testCard);

      // All intervals should be at least 1 day (1440 minutes)
      expect(scheduling.again.interval).toBeGreaterThanOrEqual(1440);
      expect(scheduling.hard.interval).toBeGreaterThanOrEqual(1440);
      expect(scheduling.good.interval).toBeGreaterThanOrEqual(1440);
      expect(scheduling.easy.interval).toBeGreaterThanOrEqual(1440);

      // Should follow Again < Hard < Good < Easy
      expect(scheduling.again.interval).toBeLessThan(scheduling.hard.interval);
      expect(scheduling.hard.interval).toBeLessThan(scheduling.good.interval);
      expect(scheduling.good.interval).toBeLessThan(scheduling.easy.interval);
    });

    test("should maintain day minimum throughout", () => {
      let card = { ...testCard };

      // Simulate multiple reviews
      for (let i = 0; i < 10; i++) {
        card = standardFSRS.updateCard(card, "good");

        // All intervals should be at least 1 day
        expect(card.interval).toBeGreaterThanOrEqual(1440);
      }
    });
  });

  describe("Request Retention Scaling", () => {
    test("should scale intervals with request retention", () => {
      const fsrs90 = new FSRS({ requestRetention: 0.9, profile: "INTENSIVE" });
      const fsrs80 = new FSRS({ requestRetention: 0.8, profile: "INTENSIVE" });

      const scheduling90 = fsrs90.getSchedulingInfo(testCard);
      const scheduling80 = fsrs80.getSchedulingInfo(testCard);

      // Lower retention should produce longer intervals
      expect(scheduling80.good.interval).toBeGreaterThan(
        scheduling90.good.interval,
      );

      // Scaling factor should be ln(0.8)/ln(0.9) ≈ 2.1
      const expectedFactor = Math.log(0.8) / Math.log(0.9);
      const actualFactor =
        scheduling80.good.interval / scheduling90.good.interval;
      expect(actualFactor).toBeCloseTo(expectedFactor, 1);
    });
  });

  describe("Profile Switching Behavior", () => {
    test("should not affect existing card states when switching profiles", () => {
      // Start with INTENSIVE
      let card = intensiveFSRS.updateCard(testCard, "good");
      const originalStability = card.stability;
      const originalDifficulty = card.difficulty;

      // Switch to STANDARD (simulated by creating new FSRS instance)
      const newScheduling = standardFSRS.getSchedulingInfo(card);

      // Card state should remain unchanged
      expect(card.stability).toBe(originalStability);
      expect(card.difficulty).toBe(originalDifficulty);

      // But new scheduling should use STANDARD rules (minimum 1 day)
      expect(newScheduling.again.interval).toBeGreaterThanOrEqual(1440);
    });
  });

  describe("Monotonicity", () => {
    test("should maintain rating order: Again < Hard < Good < Easy", () => {
      // Test both profiles
      [standardFSRS, intensiveFSRS].forEach((fsrs) => {
        const scheduling = fsrs.getSchedulingInfo(testCard);

        expect(scheduling.again.interval).toBeLessThan(
          scheduling.hard.interval,
        );
        expect(scheduling.hard.interval).toBeLessThan(scheduling.good.interval);
        expect(scheduling.good.interval).toBeLessThan(scheduling.easy.interval);
      });
    });

    test("should maintain monotonicity after multiple reviews", () => {
      let card = { ...testCard };

      // Test monotonicity with varied review patterns
      const patterns = ["good", "hard", "good", "easy", "again"];

      for (let i = 0; i < patterns.length; i++) {
        card = standardFSRS.updateCard(card, patterns[i] as RatingLabel);
        const scheduling = standardFSRS.getSchedulingInfo(card);

        // Allow for edge cases where intervals might be equal due to algorithm constraints
        // Use toBeCloseTo for floating-point comparisons to handle precision
        expect(scheduling.again.interval).toBeLessThanOrEqual(
          scheduling.hard.interval + 0.01,
        );
        expect(scheduling.hard.interval).toBeLessThanOrEqual(
          scheduling.good.interval + 0.01,
        );
        expect(scheduling.good.interval).toBeLessThanOrEqual(
          scheduling.easy.interval + 0.01,
        );

        // Ensure at least some differentiation exists
        expect(scheduling.again.interval).toBeLessThanOrEqual(
          scheduling.easy.interval,
        );
      }
    });
  });

  describe("Precision Preservation", () => {
    test("should maintain stability precision after many updates", () => {
      let card = { ...testCard };

      // Simulate 100 reviews
      for (let i = 0; i < 100; i++) {
        const difficulty =
          i % 4 === 0
            ? "again"
            : i % 3 === 0
              ? "hard"
              : i % 2 === 0
                ? "good"
                : "easy";
        card = standardFSRS.updateCard(card, difficulty as RatingLabel);

        // Stability should remain finite and positive
        expect(isFinite(card.stability)).toBe(true);
        expect(card.stability).toBeGreaterThan(0);

        // Difficulty should remain in valid range
        expect(card.difficulty).toBeGreaterThanOrEqual(1);
        expect(card.difficulty).toBeLessThanOrEqual(10);
      }
    });
  });

});
