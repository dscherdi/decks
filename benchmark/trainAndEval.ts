/**
 * Per-user train-then-evaluate flow for the benchmark `--train` mode.
 *
 * For each user:
 *   1. Sort reviews chronologically by dayOffset.
 *   2. Split 80/20: train_set = first 80%, test_set = last 20%.
 *   3. Run optimizer on train_set with default hyperparams (reduced steps for
 *      total runtime sanity).
 *   4. Replay test_set through FSRS configured with the trained weights.
 *   5. Push test predictions into the global metrics stream.
 *
 * This is the apples-to-apples comparison against the published per-user-trained
 * FSRS-6 baseline. Uses the same dataset slice as the default-weight benchmark.
 */
import { FSRS, type RatingLabel } from "../src/algorithm/fsrs";
import {
  optimizeWeights,
  type OptimizerReviewInput,
  type TrainingResult,
} from "../src/algorithm/fsrs-optimizer";
import { FSRS_WEIGHTS_STANDARD } from "../src/algorithm/fsrs-weights";
import type { Flashcard } from "../src/database/types";
import type { ReviewRecord, UserData } from "./loadDataset";
import { replayUser } from "./replayEngine";
import type { PredictionRecord } from "./replayEngine";
import { timeSeriesSplit } from "./timeSeriesSplit";

const RATING_LABELS: readonly RatingLabel[] = [
  "again",
  "hard",
  "good",
  "easy",
] as const;

const EPOCH_MS = Date.UTC(2020, 0, 1, 12, 0, 0);

function recordToOptimizerInput(
  r: ReviewRecord,
  userId: number
): OptimizerReviewInput {
  return {
    flashcardId: `${userId}-${r.cardId}`,
    reviewedAt: new Date(EPOCH_MS + r.dayOffset * 86400000).toISOString(),
    rating: r.rating,
    ratingLabel: RATING_LABELS[r.rating - 1],
    elapsedDays: r.elapsedDays,
  };
}

export interface TrainEvalOptions {
  trainFraction: number; // 0.8 default (single-split mode)
  kfold: number; // 1 = single 80/20 split; >=2 = TimeSeriesSplit (matches srs-benchmark)
  trainBatchCards: number;
  includeSameDay: boolean;
  minTrainReviews: number;
}

export const DEFAULT_TRAIN_EVAL_OPTIONS: TrainEvalOptions = {
  trainFraction: 0.8,
  kfold: 1,
  trainBatchCards: 64,
  includeSameDay: false,
  minTrainReviews: 100,
};

/**
 * Per-user step count matching fsrs-optimizer: `n_epoch * ceil(N / batch_size)`
 * with `n_epoch = 5` and `batch_size = 512`. Floors at 20 steps for tiny
 * users so the optimizer still has room to move from defaults.
 *
 * Reference: open-spaced-repetition/fsrs-optimizer hyperparameters.
 */
function adaptiveSteps(nReviews: number): number {
  const N_EPOCH = 5;
  const BATCH = 512;
  const FLOOR = 20;
  return Math.max(FLOOR, N_EPOCH * Math.ceil(nReviews / BATCH));
}

export interface UserTrainEvalResult {
  testPredictions: PredictionRecord[];
  training: TrainingResult;
  // Populated when kfold >= 2: one entry per executed fold.
  perFoldTrainings?: TrainingResult[];
  foldsExecuted?: number;
  foldsSkipped?: number;
}

function makeNewFlashcard(): Flashcard {
  return {
    id: "",
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

const EPOCH_REPLAY_MS = Date.UTC(2020, 0, 1, 12, 0, 0);
function dayOffsetToDate(dayOffset: number): Date {
  return new Date(EPOCH_REPLAY_MS + dayOffset * 86400000);
}

/**
 * Split a user's reviews chronologically, group by card, ensure each card's
 * sequence is preserved across the split (test set inherits card state from
 * train set's final state).
 */
function chronologicalSplit(
  user: UserData,
  fraction: number
): { train: ReviewRecord[]; test: ReviewRecord[] } {
  const sorted = user.reviews.slice().sort((a, b) => a.dayOffset - b.dayOffset);
  const cutoff = Math.floor(sorted.length * fraction);
  return {
    train: sorted.slice(0, cutoff),
    test: sorted.slice(cutoff),
  };
}

export async function trainAndEvalUser(
  user: UserData,
  options: TrainEvalOptions
): Promise<UserTrainEvalResult> {
  const { train, test } = chronologicalSplit(user, options.trainFraction);

  if (train.length < options.minTrainReviews) {
    return {
      testPredictions: [],
      training: {
        ok: false,
        reason: `Train slice has ${train.length} reviews, need ${options.minTrainReviews}`,
        weights: [...FSRS_WEIGHTS_STANDARD],
        beforeLogLoss: Number.NaN,
        afterLogLoss: Number.NaN,
        reviewsTrained: train.length,
        cardsTrained: 0,
        steps: 0,
        durationMs: 0,
      },
    };
  }

  const trainInputs = train.map((r) => recordToOptimizerInput(r, user.userId));
  const training = await optimizeWeights(trainInputs, {
    steps: adaptiveSteps(trainInputs.length),
    batchCards: options.trainBatchCards,
    minReviews: options.minTrainReviews,
    yieldEveryNSteps: 0,
  });

  if (!training.ok) {
    return { testPredictions: [], training };
  }

  const trainedFsrs = new FSRS({
    profile: "STANDARD",
    requestRetention: 0.9,
    weights: training.weights,
  });
  const testUser: UserData = { userId: user.userId, reviews: test };
  const testPredictions = replayUser(testUser, trainedFsrs, {
    includeSameDay: options.includeSameDay,
  });

  return { testPredictions, training };
}

/**
 * K-fold TimeSeriesSplit version. Matches the open-spaced-repetition
 * srs-benchmark methodology:
 * - Sort all reviews chronologically (across cards) for the user.
 * - For each of K folds, train on the prefix, evaluate on the next chunk.
 * - Replay the prefix-plus-test-chunk through the trained FSRS for state
 *   continuity; only the test-chunk reviews emit (p, y) predictions.
 * - Concatenate test predictions across folds — that's the user's prediction
 *   set for per-user metric aggregation.
 */
export async function trainAndEvalUserKFold(
  user: UserData,
  options: TrainEvalOptions
): Promise<UserTrainEvalResult> {
  if (options.kfold < 2) {
    return trainAndEvalUser(user, options);
  }

  const sorted = user.reviews.slice().sort((a, b) => a.dayOffset - b.dayOffset);
  const folds = timeSeriesSplit(sorted.length, options.kfold);
  const allPredictions: PredictionRecord[] = [];
  const perFoldTrainings: TrainingResult[] = [];
  let foldsExecuted = 0;
  let foldsSkipped = 0;
  let lastTraining: TrainingResult | null = null;

  for (const fold of folds) {
    const trainItems = sorted.slice(0, fold.trainEnd);
    if (trainItems.length < options.minTrainReviews) {
      foldsSkipped += 1;
      continue;
    }

    const trainInputs = trainItems.map((r) =>
      recordToOptimizerInput(r, user.userId)
    );
    const training = await optimizeWeights(trainInputs, {
      steps: adaptiveSteps(trainInputs.length),
      batchCards: options.trainBatchCards,
      minReviews: options.minTrainReviews,
      yieldEveryNSteps: 0,
    });
    if (!training.ok) {
      foldsSkipped += 1;
      continue;
    }
    perFoldTrainings.push(training);
    lastTraining = training;
    foldsExecuted += 1;

    const fsrs = new FSRS({
      profile: "STANDARD",
      requestRetention: 0.9,
      weights: training.weights,
    });

    // Walk items[0..testEnd) chronologically, group by card, but only emit
    // predictions for items in [trainEnd..testEnd). State is built from
    // train + earlier-fold test items so each card sees its full history.
    const trainEndIdx = fold.trainEnd;
    const testEndIdx = fold.testEnd;
    const byCard = new Map<string, { item: ReviewRecord; globalIdx: number }[]>();
    for (let i = 0; i < testEndIdx; i++) {
      const item = sorted[i];
      let arr = byCard.get(item.cardId);
      if (!arr) {
        arr = [];
        byCard.set(item.cardId, arr);
      }
      arr.push({ item, globalIdx: i });
    }

    for (const cardReviews of byCard.values()) {
      let card = makeNewFlashcard();
      for (let i = 0; i < cardReviews.length; i++) {
        const { item, globalIdx } = cardReviews[i];
        const now = dayOffsetToDate(item.dayOffset);
        const inTestWindow = globalIdx >= trainEndIdx && globalIdx < testEndIdx;
        if (i > 0 && inTestWindow) {
          const elapsed = Math.max(0, item.elapsedDays);
          const sameDay = elapsed === 0;
          if (!sameDay || options.includeSameDay) {
            const p = fsrs.forgettingCurve(elapsed, card.stability);
            const y: 0 | 1 = item.rating === 1 ? 0 : 1;
            allPredictions.push({
              p,
              y,
              elapsedDays: elapsed,
              reviewCount: i + 1,
              lapses: card.lapses,
            });
          }
        }
        card = fsrs.updateCard(card, RATING_LABELS[item.rating - 1], now);
      }
    }
  }

  const headlineTraining: TrainingResult = lastTraining ?? {
    ok: false,
    reason: "All k-folds skipped (insufficient data per fold)",
    weights: [...FSRS_WEIGHTS_STANDARD],
    beforeLogLoss: Number.NaN,
    afterLogLoss: Number.NaN,
    reviewsTrained: sorted.length,
    cardsTrained: 0,
    steps: 0,
    durationMs: 0,
  };

  return {
    testPredictions: allPredictions,
    training: headlineTraining,
    perFoldTrainings,
    foldsExecuted,
    foldsSkipped,
  };
}
