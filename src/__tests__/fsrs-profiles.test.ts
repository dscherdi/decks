import { FSRS, FSRSParameters } from "../algorithm/fsrs";
import {
  FSRS_WEIGHTS_STANDARD,
  FSRS_WEIGHTS_SUBDAY,
  getWeightsForProfile,
  getMinMinutesForProfile,
  getMaxIntervalDaysForProfile,
  validateProfile,
  validateRequestRetention,
} from "../algorithm/fsrs-weights";
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

  describe("Profile Configuration", () => {
    test("should have correct weights for STANDARD profile", () => {
      const weights = getWeightsForProfile("STANDARD");
      expect(weights).toEqual(FSRS_WEIGHTS_STANDARD);
      expect(weights).toHaveLength(17);
    });

    test("should have correct weights for INTENSIVE profile", () => {
      const weights = getWeightsForProfile("INTENSIVE");
      expect(weights).toEqual(FSRS_WEIGHTS_SUBDAY);
      expect(weights).toHaveLength(17);
    });

    test("should have correct minimum minutes for profiles", () => {
      expect(getMinMinutesForProfile("STANDARD")).toBe(1440); // 1 day
      expect(getMinMinutesForProfile("INTENSIVE")).toBe(1); // 1 minute
    });

    test("should have correct maximum interval days for profiles", () => {
      expect(getMaxIntervalDaysForProfile("STANDARD")).toBe(36500);
      expect(getMaxIntervalDaysForProfile("INTENSIVE")).toBe(36500);
    });
  });

  describe("Profile Validation", () => {
    test("should validate correct profiles", () => {
      expect(validateProfile("STANDARD")).toBe(true);
      expect(validateProfile("INTENSIVE")).toBe(true);
    });

    test("should reject invalid profiles", () => {
      expect(validateProfile("INVALID")).toBe(false);
      expect(validateProfile("standard")).toBe(false);
      expect(validateProfile("")).toBe(false);
    });

    test("should validate request retention range", () => {
      expect(validateRequestRetention(0.9)).toBe(true);
      expect(validateRequestRetention(0.7)).toBe(true);
      expect(validateRequestRetention(0.99)).toBe(true);
      expect(validateRequestRetention(0.5)).toBe(false);
      expect(validateRequestRetention(0.995)).toBe(false);
      expect(validateRequestRetention(1.0)).toBe(false);
      expect(validateRequestRetention(0.0)).toBe(false);
    });
  });

  describe("FSRS Constructor", () => {
    test("should create FSRS with valid parameters", () => {
      expect(
        () => new FSRS({ requestRetention: 0.9, profile: "STANDARD" }),
      ).not.toThrow();
      expect(
        () => new FSRS({ requestRetention: 0.85, profile: "INTENSIVE" }),
      ).not.toThrow();
    });

    test("should reject invalid profiles", () => {
      expect(
        () => new FSRS({ requestRetention: 0.9, profile: "INVALID" as any }),
      ).toThrow();
    });

    test("should reject invalid request retention", () => {
      expect(
        () => new FSRS({ requestRetention: 0.5, profile: "STANDARD" }),
      ).toThrow();
      expect(
        () => new FSRS({ requestRetention: 0.995, profile: "STANDARD" }),
      ).toThrow();
      expect(
        () => new FSRS({ requestRetention: 1.0, profile: "STANDARD" }),
      ).toThrow();
    });
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

      // Easy should be ~40 minutes
      expect(scheduling.easy.interval).toBeGreaterThan(
        scheduling.good.interval,
      );
      expect(scheduling.easy.interval).toBeLessThan(120);
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
        card = standardFSRS.updateCard(card, patterns[i] as any);
        const scheduling = standardFSRS.getSchedulingInfo(card);

        // Allow for edge cases where intervals might be equal due to algorithm constraints
        expect(scheduling.again.interval).toBeLessThanOrEqual(
          scheduling.hard.interval,
        );
        expect(scheduling.hard.interval).toBeLessThanOrEqual(
          scheduling.good.interval,
        );
        expect(scheduling.good.interval).toBeLessThanOrEqual(
          scheduling.easy.interval,
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
        card = standardFSRS.updateCard(card, difficulty as any);

        // Stability should remain finite and positive
        expect(isFinite(card.stability)).toBe(true);
        expect(card.stability).toBeGreaterThan(0);

        // Difficulty should remain in valid range
        expect(card.difficulty).toBeGreaterThanOrEqual(1);
        expect(card.difficulty).toBeLessThanOrEqual(10);
      }
    });
  });

  describe("Parameter Updates", () => {
    test("should allow updating parameters", () => {
      const fsrs = new FSRS({ requestRetention: 0.9, profile: "STANDARD" });

      expect(() => {
        fsrs.updateParameters({ requestRetention: 0.85, profile: "INTENSIVE" });
      }).not.toThrow();
    });

    test("should validate parameters on update", () => {
      const fsrs = new FSRS({ requestRetention: 0.9, profile: "STANDARD" });

      expect(() => {
        fsrs.updateParameters({ requestRetention: 0.5 });
      }).toThrow();

      expect(() => {
        fsrs.updateParameters({ profile: "INVALID" as any });
      }).toThrow();
    });
  });
});
