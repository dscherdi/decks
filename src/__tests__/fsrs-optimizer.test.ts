import type { Flashcard, ReviewLog } from "../database/types";
import { FSRS, type RatingLabel } from "@decks/core";
import {
  optimizeWeights,
  DEFAULT_TRAINING_OPTIONS,
} from "@decks/core";
import { FSRS_WEIGHTS_STANDARD } from "@decks/core";
import { LOWER_BOUNDS, UPPER_BOUNDS } from "@decks/core";

function lcgRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeNewFlashcard(id: string): Flashcard {
  return {
    id,
    deckId: "",
    front: "",
    back: "",
    type: "header-paragraph",
    sourceFile: "",
    contentHash: "",
    breadcrumb: "",
    notes: "",
    tags: [],
    clozeText: null,
    clozeOrder: null,
    state: "new",
    dueDate: "",
    interval: 0,
    repetitions: 0,
    difficulty: 0,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
    created: "",
    modified: "",
  };
}

function makeLog(partial: Partial<ReviewLog> & {
  flashcardId: string;
  reviewedAt: string;
  rating: 1 | 2 | 3 | 4;
  ratingLabel: RatingLabel;
  elapsedDays: number;
}): ReviewLog {
  return {
    id: `${partial.flashcardId}-${partial.reviewedAt}`,
    lastReviewedAt: partial.reviewedAt,
    oldState: "review",
    oldRepetitions: 0,
    oldLapses: 0,
    oldStability: 1,
    oldDifficulty: 5,
    newState: "review",
    newRepetitions: 1,
    newLapses: 0,
    newStability: 1,
    newDifficulty: 5,
    oldIntervalMinutes: 0,
    newIntervalMinutes: 1440,
    oldDueAt: partial.reviewedAt,
    newDueAt: partial.reviewedAt,
    retrievability: 0.9,
    requestRetention: 0.9,
    profile: "STANDARD",
    maximumIntervalDays: 36500,
    minMinutes: 1440,
    fsrsWeightsVersion: "test",
    schedulerVersion: "test",
    ...partial,
  };
}

/**
 * Generate synthetic review logs by replaying through FSRS with `target` weights
 * and sampling outcomes from the model's predicted retrievability. This means
 * the data is "drawn from" `target`, so an optimizer starting from different
 * weights should be able to reduce LogLoss by moving toward `target`.
 */
function generateSyntheticLogs(
  target: number[],
  numCards: number,
  reviewsPerCard: number,
  seed: number
): ReviewLog[] {
  const fsrs = new FSRS({
    profile: "STANDARD",
    requestRetention: 0.9,
    weights: target,
  });
  const rand = lcgRng(seed);
  const logs: ReviewLog[] = [];
  const epochMs = Date.UTC(2025, 0, 1, 12, 0, 0);

  for (let c = 0; c < numCards; c++) {
    let card = makeNewFlashcard(`syn-${c}`);
    let lastDayOffset = 0;

    for (let r = 0; r < reviewsPerCard; r++) {
      const gapDays = r === 0 ? 0 : 1 + Math.floor(rand() * 21);
      lastDayOffset += gapDays;
      const now = new Date(epochMs + lastDayOffset * 86400000);

      let rating: 1 | 2 | 3 | 4;
      if (r === 0) {
        rating = 3;
      } else {
        const p = fsrs.forgettingCurve(gapDays, card.stability);
        rating = rand() < p ? 3 : 1;
      }
      const ratingLabel: RatingLabel =
        rating === 1 ? "again" : rating === 2 ? "hard" : rating === 3 ? "good" : "easy";

      logs.push(
        makeLog({
          flashcardId: card.id,
          reviewedAt: now.toISOString(),
          rating,
          ratingLabel,
          elapsedDays: r === 0 ? 0 : gapDays,
        })
      );
      card = fsrs.updateCard(card, ratingLabel, now);
    }
  }
  return logs;
}

describe("FSRS optimizer", () => {
  // yieldEveryNSteps: 0 disables the await in tests for speed.
  const noYield = { yieldEveryNSteps: 0 };

  test("returns ok:false when below minReviews threshold", async () => {
    const logs = generateSyntheticLogs(FSRS_WEIGHTS_STANDARD, 5, 10, 1);
    expect(logs.length).toBeLessThan(DEFAULT_TRAINING_OPTIONS.minReviews);

    const result = await optimizeWeights(logs, noYield);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/at least/i);
    expect(result.weights).toEqual(FSRS_WEIGHTS_STANDARD);
  });

  test("trained weights stay within FSRS-6 bounds", async () => {
    const logs = generateSyntheticLogs(FSRS_WEIGHTS_STANDARD, 30, 8, 2);
    const result = await optimizeWeights(logs, {
      steps: 10,
      batchCards: 16,
      ...noYield,
    });
    expect(result.ok).toBe(true);
    expect(result.weights.length).toBe(21);
    for (let i = 0; i < 21; i++) {
      expect(result.weights[i]).toBeGreaterThanOrEqual(LOWER_BOUNDS[i]);
      expect(result.weights[i]).toBeLessThanOrEqual(UPPER_BOUNDS[i]);
    }
  });

  test("training reduces LogLoss on synthetic data drawn from perturbed weights", async () => {
    const target = FSRS_WEIGHTS_STANDARD.map((w, i) => {
      const range = UPPER_BOUNDS[i] - LOWER_BOUNDS[i];
      return Math.min(w + 0.3 * range * 0.5, UPPER_BOUNDS[i]);
    });
    const logs = generateSyntheticLogs(target, 80, 8, 3);
    const result = await optimizeWeights(logs, {
      steps: 30,
      batchCards: 32,
      seed: 42,
      ...noYield,
    });
    expect(result.ok).toBe(true);
    expect(Number.isFinite(result.beforeLogLoss)).toBe(true);
    expect(Number.isFinite(result.afterLogLoss)).toBe(true);
    expect(result.afterLogLoss).toBeLessThan(result.beforeLogLoss * 0.99);
  }, 20000);

  test("is deterministic given the same seed", async () => {
    const logs = generateSyntheticLogs(FSRS_WEIGHTS_STANDARD, 25, 8, 4);
    const a = await optimizeWeights(logs, {
      steps: 8,
      batchCards: 16,
      seed: 7,
      ...noYield,
    });
    const b = await optimizeWeights(logs, {
      steps: 8,
      batchCards: 16,
      seed: 7,
      ...noYield,
    });
    expect(a.weights).toEqual(b.weights);
    expect(a.afterLogLoss).toBe(b.afterLogLoss);
  });

  test("invokes onProgress for each step", async () => {
    const logs = generateSyntheticLogs(FSRS_WEIGHTS_STANDARD, 25, 8, 5);
    const observed: number[] = [];
    await optimizeWeights(logs, {
      steps: 5,
      batchCards: 16,
      seed: 1,
      ...noYield,
      onProgress: (p) => observed.push(p.step),
    });
    expect(observed).toEqual([1, 2, 3, 4, 5]);
  });
});
