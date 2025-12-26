import { FSRS } from "../algorithm/fsrs";
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

});
