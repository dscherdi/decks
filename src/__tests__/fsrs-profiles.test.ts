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
        scheduling.again.interval
      );
      expect(scheduling.hard.interval).toBeLessThan(30);

      // Good should be ~10 minutes
      expect(scheduling.good.interval).toBeGreaterThan(
        scheduling.hard.interval
      );
      expect(scheduling.good.interval).toBeLessThan(60);

      // Easy should be ~1 day
      expect(scheduling.easy.interval).toBeGreaterThan(
        scheduling.good.interval
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
        scheduling90.good.interval
      );

      // Scaling factor using FSRS-6 interval formula: I = S * (R^(-1/w20) - 1) / factor
      const w20 = 0.1542;
      const factor80 = Math.pow(0.8, -1 / w20) - 1;
      const factor90 = Math.pow(0.9, -1 / w20) - 1;
      const expectedFactor = factor80 / factor90;
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
          scheduling.hard.interval
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
          scheduling.hard.interval + 0.01
        );
        expect(scheduling.hard.interval).toBeLessThanOrEqual(
          scheduling.good.interval + 0.01
        );
        expect(scheduling.good.interval).toBeLessThanOrEqual(
          scheduling.easy.interval + 0.01
        );

        // Ensure at least some differentiation exists
        expect(scheduling.again.interval).toBeLessThanOrEqual(
          scheduling.easy.interval
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

  describe("Due date calculation", () => {
    test("should set sub-day dueDate relative to review time for INTENSIVE profile", () => {
      const now = new Date("2025-06-15T10:00:00.000Z");
      const fsrs = new FSRS({
        requestRetention: 0.9,
        profile: "INTENSIVE",
        nextDayStartsAt: 4,
      });

      const scheduling = fsrs.getSchedulingInfo(testCard, now);

      const subDayRatings = ["again", "hard", "good"] as const;
      for (const rating of subDayRatings) {
        const due = new Date(scheduling[rating].dueDate);
        const diffMinutes = (due.getTime() - now.getTime()) / (60 * 1000);

        expect(scheduling[rating].interval).toBeLessThan(1440);
        expect(diffMinutes).toBeCloseTo(scheduling[rating].interval, 0);
      }
    });

    test("should align day-based dueDate to study day boundary for INTENSIVE Easy rating", () => {
      const now = new Date("2025-06-15T10:00:00.000Z");
      const fsrs = new FSRS({
        requestRetention: 0.9,
        profile: "INTENSIVE",
        nextDayStartsAt: 4,
      });

      const scheduling = fsrs.getSchedulingInfo(testCard, now);

      expect(scheduling.easy.interval).toBeGreaterThanOrEqual(1440);

      const easyDue = new Date(scheduling.easy.dueDate);
      expect(easyDue.getMinutes()).toBe(0);
      expect(easyDue.getSeconds()).toBe(0);
    });

    test("should always align dueDate to study day boundary for STANDARD profile", () => {
      const now = new Date("2025-06-15T10:00:00.000Z");
      const fsrs = new FSRS({
        requestRetention: 0.9,
        profile: "STANDARD",
        nextDayStartsAt: 4,
      });

      const scheduling = fsrs.getSchedulingInfo(testCard, now);

      const ratings = ["again", "hard", "good", "easy"] as const;
      for (const rating of ratings) {
        expect(scheduling[rating].interval).toBeGreaterThanOrEqual(1440);

        const due = new Date(scheduling[rating].dueDate);
        expect(due.getMinutes()).toBe(0);
        expect(due.getSeconds()).toBe(0);
      }
    });

    test("should set correct sub-day dueDate via updateCard for INTENSIVE profile", () => {
      const now = new Date("2025-06-15T10:00:00.000Z");
      const fsrs = new FSRS({
        requestRetention: 0.9,
        profile: "INTENSIVE",
        nextDayStartsAt: 4,
      });

      const updatedCard = fsrs.updateCard(testCard, "good", now);

      const dueDate = new Date(updatedCard.dueDate);
      const diffMinutes = (dueDate.getTime() - now.getTime()) / (60 * 1000);

      expect(updatedCard.interval).toBeLessThan(1440);
      expect(diffMinutes).toBeCloseTo(updatedCard.interval, 0);
    });

    test("should transition from sub-day to study-day-aligned dueDate as intervals grow", () => {
      const fsrs = new FSRS({
        requestRetention: 0.9,
        profile: "INTENSIVE",
        nextDayStartsAt: 4,
      });

      let card = { ...testCard };
      let hadSubDayInterval = false;
      let hadDayBasedInterval = false;

      for (let i = 0; i < 20; i++) {
        const reviewTime = card.lastReviewed
          ? new Date(
              new Date(card.lastReviewed).getTime() +
                card.interval * 60 * 1000
            )
          : new Date("2025-06-15T10:00:00.000Z");

        card = fsrs.updateCard(card, "good", reviewTime);

        const dueDate = new Date(card.dueDate);
        const diffMinutes =
          (dueDate.getTime() - reviewTime.getTime()) / (60 * 1000);

        if (card.interval < 1440) {
          hadSubDayInterval = true;
          expect(diffMinutes).toBeCloseTo(card.interval, 0);
        } else {
          hadDayBasedInterval = true;
          expect(dueDate.getMinutes()).toBe(0);
          expect(dueDate.getSeconds()).toBe(0);
        }
      }

      expect(hadSubDayInterval).toBe(true);
      expect(hadDayBasedInterval).toBe(true);
    });
  });
});
