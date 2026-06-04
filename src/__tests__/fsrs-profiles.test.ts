import { FSRS, RatingLabel } from "@decks/core";
import { Flashcard, FlashcardState } from "../database/types";

describe("FSRS Profiles", () => {
  let standardFSRS: FSRS;
  let trainedFSRS: FSRS;
  let testCard: Flashcard;

  beforeEach(() => {
    standardFSRS = new FSRS({
      requestRetention: 0.9,
      profile: "STANDARD",
    });

    // No trained weights are injected here, so TRAINED falls back to the shipped
    // standard weights — it should schedule identically to STANDARD.
    trainedFSRS = new FSRS({
      requestRetention: 0.9,
      profile: "TRAINED",
    });

    testCard = {
      id: "test-card",
      deckId: "test-deck",
      front: "Test Question",
      back: "Test Answer",
      type: "header-paragraph",
      sourceFile: "test.md",
      contentHash: "test-hash",
      breadcrumb: "",
      notes: "",
      clozeText: null,
      clozeOrder: null,
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

  describe("Unified profile behavior", () => {
    test("floors Again at 1 minute (sub-day is allowed for every profile)", () => {
      // Before the merge, STANDARD floored Again at one day. The single profile now
      // honors the 1-minute floor, so sub-day scheduling is permitted everywhere.
      const scheduling = standardFSRS.getSchedulingInfo(testCard);
      expect(scheduling.again.interval).toBe(1);
    });

    test("lets FSRS decide day-scale intervals for Hard/Good/Easy on new cards", () => {
      const scheduling = standardFSRS.getSchedulingInfo(testCard);

      // No hardcoded sub-day overrides remain; these follow pure FSRS and are day-scale.
      expect(scheduling.hard.interval).toBeGreaterThanOrEqual(1440);
      expect(scheduling.hard.interval).toBeGreaterThan(scheduling.again.interval);
      expect(scheduling.good.interval).toBeGreaterThan(scheduling.hard.interval);
      expect(scheduling.easy.interval).toBeGreaterThan(scheduling.good.interval);
    });

    test("TRAINED falls back to standard scheduling when no trained weights are injected", () => {
      const s = standardFSRS.getSchedulingInfo(testCard);
      const t = trainedFSRS.getSchedulingInfo(testCard);

      expect(t.again.interval).toBe(s.again.interval);
      expect(t.hard.interval).toBeCloseTo(s.hard.interval, 5);
      expect(t.good.interval).toBeCloseTo(s.good.interval, 5);
      expect(t.easy.interval).toBeCloseTo(s.easy.interval, 5);
    });

    test("honors sub-day intervals for low-stability review cards", () => {
      // A heavily-lapsed, low-stability card can legitimately come due within minutes.
      const lowStabilityCard: Flashcard = {
        ...testCard,
        state: "review",
        stability: 0.002, // ~3 minutes
        difficulty: 9,
        repetitions: 5,
        lapses: 4,
        lastReviewed: new Date().toISOString(),
      };

      const scheduling = standardFSRS.getSchedulingInfo(lowStabilityCard);

      expect(scheduling.again.interval).toBe(1);
      expect(scheduling.hard.interval).toBeGreaterThanOrEqual(1);
      expect(scheduling.hard.interval).toBeLessThan(1440);
    });
  });

  describe("Request Retention Scaling", () => {
    test("should scale intervals with request retention", () => {
      const fsrs90 = new FSRS({ requestRetention: 0.9, profile: "STANDARD" });
      const fsrs80 = new FSRS({ requestRetention: 0.8, profile: "STANDARD" });

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
    test("should not mutate stored card state when recomputing scheduling", () => {
      let card = standardFSRS.updateCard(testCard, "good");
      const originalStability = card.stability;
      const originalDifficulty = card.difficulty;

      // Recompute under a different profile instance (simulating a profile switch)
      const newScheduling = trainedFSRS.getSchedulingInfo(card);

      // Card state should remain unchanged
      expect(card.stability).toBe(originalStability);
      expect(card.difficulty).toBe(originalDifficulty);

      // Scheduling is still produced and respects the 1-minute floor
      expect(newScheduling.again.interval).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Monotonicity", () => {
    test("should maintain rating order: Again < Hard < Good < Easy", () => {
      [standardFSRS, trainedFSRS].forEach((fsrs) => {
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
    test("sets a sub-day dueDate to the exact minute offset from review time", () => {
      const now = new Date("2025-06-15T10:00:00.000Z");
      const fsrs = new FSRS({
        requestRetention: 0.9,
        profile: "STANDARD",
        nextDayStartsAt: 4,
      });

      const scheduling = fsrs.getSchedulingInfo(testCard, now);

      // Again is the deterministic sub-day case on a new card.
      const due = new Date(scheduling.again.dueDate);
      const diffMinutes = (due.getTime() - now.getTime()) / (60 * 1000);

      expect(scheduling.again.interval).toBeLessThan(1440);
      expect(diffMinutes).toBeCloseTo(scheduling.again.interval, 0);
    });

    test("aligns day-scale dueDates to the study-day boundary", () => {
      const now = new Date("2025-06-15T10:00:00.000Z");
      const fsrs = new FSRS({
        requestRetention: 0.9,
        profile: "STANDARD",
        nextDayStartsAt: 4,
      });

      const scheduling = fsrs.getSchedulingInfo(testCard, now);

      for (const rating of ["hard", "good", "easy"] as const) {
        expect(scheduling[rating].interval).toBeGreaterThanOrEqual(1440);

        const due = new Date(scheduling[rating].dueDate);
        expect(due.getMinutes()).toBe(0);
        expect(due.getSeconds()).toBe(0);
      }
    });

    test("updateCard sets a sub-day dueDate for the Again rating", () => {
      const now = new Date("2025-06-15T10:00:00.000Z");
      const fsrs = new FSRS({
        requestRetention: 0.9,
        profile: "STANDARD",
        nextDayStartsAt: 4,
      });

      const updatedCard = fsrs.updateCard(testCard, "again", now);

      const dueDate = new Date(updatedCard.dueDate);
      const diffMinutes = (dueDate.getTime() - now.getTime()) / (60 * 1000);

      expect(updatedCard.interval).toBeLessThan(1440);
      expect(diffMinutes).toBeCloseTo(updatedCard.interval, 0);
    });

    test("uses exact offset for sub-day and study-day alignment for day-scale", () => {
      const now = new Date("2025-06-15T10:00:00.000Z");
      const fsrs = new FSRS({
        requestRetention: 0.9,
        profile: "STANDARD",
        nextDayStartsAt: 4,
      });

      // Again -> sub-day, exact minute offset.
      const again = fsrs.updateCard(testCard, "again", now);
      expect(again.interval).toBeLessThan(1440);
      const againDiff =
        (new Date(again.dueDate).getTime() - now.getTime()) / (60 * 1000);
      expect(againDiff).toBeCloseTo(again.interval, 0);

      // Good on a new card -> day-scale, aligned to the study-day boundary.
      const good = fsrs.updateCard(testCard, "good", now);
      expect(good.interval).toBeGreaterThanOrEqual(1440);
      const goodDue = new Date(good.dueDate);
      expect(goodDue.getMinutes()).toBe(0);
      expect(goodDue.getSeconds()).toBe(0);
    });
  });
});
