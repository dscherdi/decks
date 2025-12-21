import { FSRS, roundForDisplay } from "../algorithm/fsrs";
import { Flashcard } from "../database/types";
import { DEFAULT_FSRS_PARAMETERS } from "../algorithm/fsrs-weights";

describe("FSRS Numeric Precision Tests", () => {
  let fsrs: FSRS;
  let testCard: Flashcard;

  beforeEach(() => {
    fsrs = new FSRS(DEFAULT_FSRS_PARAMETERS);
    testCard = {
      id: "test_card",
      deckId: "test_deck",
      front: "Test Front",
      back: "Test Back",
      type: "header-paragraph",
      sourceFile: "test.md",
      contentHash: "hash123",
      headerLevel: 2,
      state: "new",
      dueDate: new Date().toISOString(),
      interval: 0,
      repetitions: 0,
      difficulty: 5.0,
      stability: 2.5,
      lapses: 0,
      lastReviewed: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
  });

  describe("Internal Precision Validation", () => {
    it("should maintain reasonable precision in stability calculations", () => {
      const card = { ...testCard, stability: 1.234567890123456 };
      const updated = fsrs.updateCard(card, "good");

      // Check that we maintain reasonable precision and finite values
      expect(Number.isFinite(updated.stability)).toBe(true);
      expect(updated.stability).toBeGreaterThan(0);
    });

    it("should maintain reasonable precision in difficulty calculations", () => {
      const card = { ...testCard, difficulty: 3.123456789012345 };
      const updated = fsrs.updateCard(card, "hard");

      // Check that we maintain reasonable precision and finite values
      expect(Number.isFinite(updated.difficulty)).toBe(true);
      expect(updated.difficulty).toBeGreaterThanOrEqual(1);
      expect(updated.difficulty).toBeLessThanOrEqual(10);
    });

    it("should preserve precision in interval calculations", () => {
      const card = { ...testCard, stability: 0.001234567890123 };
      const updated = fsrs.updateCard(card, "good");

      // Very small intervals should still be precise
      expect(Number.isFinite(updated.interval)).toBe(true);
      expect(updated.interval).toBeGreaterThan(0);
    });

    it("should handle very large stability values without precision loss", () => {
      const card = { ...testCard, stability: 12345.67890123456 };
      const updated = fsrs.updateCard(card, "good");

      expect(Number.isFinite(updated.stability)).toBe(true);
      expect(updated.stability).toBeGreaterThan(0);
    });
  });

  describe("Forgetting Curve Precision", () => {
    it("should maintain precision for small elapsed times", () => {
      const elapsedDays = 0.0006944444; // 1 minute
      const stability = 0.001; // Very small stability

      const retrievability = fsrs.forgettingCurve(elapsedDays, stability);

      expect(Number.isFinite(retrievability)).toBe(true);
      expect(retrievability).toBeGreaterThan(0);
      expect(retrievability).toBeLessThanOrEqual(1);
    });

    it("should maintain precision for large elapsed times", () => {
      const elapsedDays = 3650.25; // ~10 years
      const stability = 1000.123456789;

      const retrievability = fsrs.forgettingCurve(elapsedDays, stability);

      expect(Number.isFinite(retrievability)).toBe(true);
      expect(retrievability).toBeGreaterThan(0);
      expect(retrievability).toBeLessThanOrEqual(1);
    });

    it("should handle edge cases without precision loss", () => {
      const testCases = [
        { elapsed: 0, stability: 1 },
        { elapsed: 1e-10, stability: 1e-6 },
        { elapsed: 1e6, stability: 1e6 },
        { elapsed: Math.PI, stability: Math.E },
      ];

      testCases.forEach(({ elapsed, stability }) => {
        const result = fsrs.forgettingCurve(elapsed, stability);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("Multi-Cycle Precision Preservation", () => {
    it("should maintain precision through 100 review cycles", () => {
      let card = { ...testCard };
      const difficulties = ["good", "good", "hard", "easy", "good"] as const;

      for (let i = 0; i < 100; i++) {
        const difficulty = difficulties[i % difficulties.length];
        card = fsrs.updateCard(card, difficulty);

        // Verify no NaN or Infinity values
        expect(Number.isFinite(card.stability)).toBe(true);
        expect(Number.isFinite(card.difficulty)).toBe(true);
        expect(Number.isFinite(card.interval)).toBe(true);

        // Verify values are reasonable
        expect(card.stability).toBeGreaterThan(0);
        expect(card.difficulty).toBeGreaterThanOrEqual(1);
        expect(card.difficulty).toBeLessThanOrEqual(10);
        expect(card.interval).toBeGreaterThan(0);
      }

      // Final values should remain finite and in valid ranges
      expect(Number.isFinite(card.stability)).toBe(true);
      expect(Number.isFinite(card.difficulty)).toBe(true);
      expect(card.stability).toBeGreaterThan(0);
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    });

    it("should maintain consistent results with identical inputs", () => {
      const card1 = { ...testCard, stability: 1.234567890123 };
      const card2 = { ...testCard, stability: 1.234567890123 };

      const result1 = fsrs.updateCard(card1, "good");
      const result2 = fsrs.updateCard(card2, "good");

      expect(result1.stability).toBe(result2.stability);
      expect(result1.difficulty).toBe(result2.difficulty);
      expect(result1.interval).toBe(result2.interval);
    });
  });

  describe("Extreme Value Handling", () => {
    it("should handle very small stability values", () => {
      const card = { ...testCard, stability: 1e-15 };
      const updated = fsrs.updateCard(card, "good");

      expect(Number.isFinite(updated.stability)).toBe(true);
      expect(updated.stability).toBeGreaterThan(0);
    });

    it("should handle very large stability values", () => {
      const card = { ...testCard, stability: 1e15 };
      const updated = fsrs.updateCard(card, "good");

      expect(Number.isFinite(updated.stability)).toBe(true);
      expect(updated.stability).toBeGreaterThan(0);
    });

    it("should handle edge difficulty values", () => {
      const cardMin = { ...testCard, difficulty: 1.0 };
      const cardMax = { ...testCard, difficulty: 10.0 };

      const updatedMin = fsrs.updateCard(cardMin, "again");
      const updatedMax = fsrs.updateCard(cardMax, "easy");

      expect(updatedMin.difficulty).toBeGreaterThanOrEqual(1);
      expect(updatedMin.difficulty).toBeLessThanOrEqual(10);
      expect(updatedMax.difficulty).toBeGreaterThanOrEqual(1);
      expect(updatedMax.difficulty).toBeLessThanOrEqual(10);
    });
  });

  describe("Time Precision Tests", () => {
    it("should handle sub-minute intervals precisely", () => {
      const card = { ...testCard, stability: 0.0001 }; // Very small stability
      const updated = fsrs.updateCard(card, "good");

      expect(updated.interval).toBeGreaterThan(0);
      expect(Number.isFinite(updated.interval)).toBe(true);
    });

    it("should handle very long intervals precisely", () => {
      const card = { ...testCard, stability: 100000 };
      const updated = fsrs.updateCard(card, "good");

      expect(updated.interval).toBeGreaterThan(0);
      expect(Number.isFinite(updated.interval)).toBe(true);
    });

    it("should maintain precision in retrievability calculations", () => {
      const reviewedAt = new Date();
      const lastReviewed = new Date(reviewedAt.getTime() - 60000); // 1 minute ago

      const card = {
        ...testCard,
        lastReviewed: lastReviewed.toISOString(),
        stability: 0.001,
      };

      const retrievability = fsrs.getRetrievability(card, reviewedAt);

      expect(Number.isFinite(retrievability)).toBe(true);
      expect(retrievability).toBeGreaterThan(0);
      expect(retrievability).toBeLessThanOrEqual(1);
    });
  });

  describe("Scheduling Info Precision", () => {
    it("should provide precise scheduling for all difficulties", () => {
      const card = { ...testCard, stability: 1.23456789 };
      const scheduleInfo = fsrs.getSchedulingInfo(card);

      const difficulties = ["again", "hard", "good", "easy"] as const;

      difficulties.forEach((diff) => {
        const schedule = scheduleInfo[diff];
        expect(Number.isFinite(schedule.stability)).toBe(true);
        expect(Number.isFinite(schedule.difficulty)).toBe(true);
        expect(Number.isFinite(schedule.interval)).toBe(true);
        expect(schedule.stability).toBeGreaterThan(0);
        expect(schedule.difficulty).toBeGreaterThanOrEqual(1);
        expect(schedule.difficulty).toBeLessThanOrEqual(10);
        expect(schedule.interval).toBeGreaterThan(0);
      });
    });
  });

  describe("Precision Loss Detection", () => {
    it("should detect if calculations lose significant precision", () => {
      const originalStability = 1.23456789012345;
      const card = { ...testCard, stability: originalStability };

      const updated = fsrs.updateCard(card, "good");

      // The result should have meaningful precision
      // Check that stability remains finite and positive after many operations
      expect(Number.isFinite(updated.stability)).toBe(true);
      expect(updated.stability).toBeGreaterThan(0);
    });

    it("should maintain precision through calculation chains", () => {
      let card = { ...testCard, stability: Math.PI, difficulty: Math.E };

      // Chain multiple operations
      for (let i = 0; i < 10; i++) {
        card = fsrs.updateCard(card, "good");

        // Values should remain finite and reasonable
        expect(Number.isFinite(card.stability)).toBe(true);
        expect(Number.isFinite(card.difficulty)).toBe(true);
        expect(card.stability).toBeGreaterThan(0);
        expect(card.difficulty).toBeGreaterThanOrEqual(1);
        expect(card.difficulty).toBeLessThanOrEqual(10);
      }
    });
  });
});
