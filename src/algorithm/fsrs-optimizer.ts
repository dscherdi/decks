/**
 * FSRS-6 weight optimizer — Adam over BCE loss with parameter clipping.
 *
 * Inputs: a user's review history for a profile (OptimizerReviewInput[]).
 * Output: a 21-element trained weight vector + before/after LogLoss.
 *
 * Approach: replay each card's review sequence through the existing FSRS class
 * (with the candidate weight vector), accumulate (predicted_R, actual_y) pairs,
 * compute BCE loss. Numerical (central-difference) gradients — 42 forward
 * passes per Adam step is fine for typical deck sizes. Mini-batch by card to
 * keep per-step cost bounded for very large decks.
 */
import type { Flashcard } from "../database/types";
import { FSRS, type RatingLabel } from "./fsrs";
import { FSRS_WEIGHTS_STANDARD, type FSRSProfile } from "./fsrs-weights";
import { LOWER_BOUNDS, UPPER_BOUNDS, clampWeights } from "./fsrs-bounds";

const EPS_LOG = 1e-15;

/**
 * Minimal review-log shape the optimizer needs. Real ReviewLog from the
 * database satisfies this; benchmark code can construct minimal adapters.
 */
export interface OptimizerReviewInput {
  flashcardId: string;
  reviewedAt: string;
  rating: 1 | 2 | 3 | 4;
  ratingLabel: RatingLabel;
  elapsedDays: number;
}

export interface TrainingProgress {
  step: number;
  totalSteps: number;
}

export interface TrainingOptions {
  steps: number; // gradient steps
  batchCards: number; // cards per minibatch (sampled with replacement)
  lr: number; // initial learning rate
  beta1: number;
  beta2: number;
  epsilon: number; // Adam epsilon
  fdEps: number; // central-difference perturbation (relative to bound range)
  initial: number[]; // starting weights
  profile: FSRSProfile; // for FSRS instance config (not weights — overridden)
  requestRetention: number; // for FSRS instance config (does not affect loss)
  minReviews: number; // bail out below this threshold
  seed: number; // PRNG seed for reproducible minibatch sampling
  onProgress?: (p: TrainingProgress) => void; // optional progress callback
  yieldEveryNSteps?: number; // 0 = no yielding (tests); >0 = await yieldFn() every N steps
  yieldFn?: () => Promise<void>; // injected by caller (plugin uses yieldToUI)
}

export interface TrainingResult {
  ok: boolean;
  reason?: string;
  weights: number[];
  beforeLogLoss: number;
  afterLogLoss: number;
  reviewsTrained: number;
  cardsTrained: number;
  steps: number;
  durationMs: number;
}

export const DEFAULT_TRAINING_OPTIONS: TrainingOptions = {
  steps: 100,
  batchCards: 256,
  lr: 0.04,
  beta1: 0.9,
  beta2: 0.999,
  epsilon: 1e-8,
  fdEps: 1e-3,
  initial: [...FSRS_WEIGHTS_STANDARD],
  profile: "STANDARD",
  requestRetention: 0.9,
  minReviews: 100,
  seed: 0xa1b2c3,
  yieldEveryNSteps: 1,
};

// ---------- Replay ----------

interface CardSequence {
  cardId: string;
  reviews: OptimizerReviewInput[]; // sorted ascending by reviewedAt
}

function buildSequences(logs: OptimizerReviewInput[]): CardSequence[] {
  const byCard = new Map<string, OptimizerReviewInput[]>();
  for (const log of logs) {
    let arr = byCard.get(log.flashcardId);
    if (!arr) {
      arr = [];
      byCard.set(log.flashcardId, arr);
    }
    arr.push(log);
  }
  const out: CardSequence[] = [];
  for (const [cardId, reviews] of byCard) {
    reviews.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
    out.push({ cardId, reviews });
  }
  return out;
}

function makeNewFlashcard(cardId: string): Flashcard {
  return {
    id: cardId,
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

interface LossPair {
  p: number;
  y: 0 | 1;
}

/**
 * Replay all sequences through `fsrs` (already configured with target weights).
 * Returns the (predicted_R, actual_y) pairs that go into the loss.
 *
 * Same-day reviews (elapsedDays === 0) are excluded from the loss but still
 * advance card state — including them would cause `p = forgettingCurve(0, S) = 1`
 * on every same-day review, blowing up BCE when the user actually fails.
 */
function replay(fsrs: FSRS, sequences: CardSequence[]): LossPair[] {
  const pairs: LossPair[] = [];
  for (const seq of sequences) {
    let card = makeNewFlashcard(seq.cardId);
    for (let i = 0; i < seq.reviews.length; i++) {
      const r = seq.reviews[i];
      const now = new Date(r.reviewedAt);
      if (i > 0 && r.elapsedDays > 0) {
        const p = fsrs.forgettingCurve(r.elapsedDays, card.stability);
        const y: 0 | 1 = r.rating !== 1 ? 1 : 0;
        pairs.push({ p, y });
      }
      card = fsrs.updateCard(card, r.ratingLabel, now);
    }
  }
  return pairs;
}

function bceLoss(pairs: LossPair[]): number {
  if (pairs.length === 0) return 0;
  let sum = 0;
  for (const { p, y } of pairs) {
    const pc = Math.min(Math.max(p, EPS_LOG), 1 - EPS_LOG);
    sum += y === 1 ? -Math.log(pc) : -Math.log(1 - pc);
  }
  return sum / pairs.length;
}

// ---------- Optimizer ----------

function evalLoss(
  weights: number[],
  fsrs: FSRS,
  sequences: CardSequence[]
): number {
  fsrs.updateParameters({ weights });
  return bceLoss(replay(fsrs, sequences));
}

function centralDiffGradient(
  weights: number[],
  fsrs: FSRS,
  sequences: CardSequence[],
  fdEps: number
): number[] {
  const grad = new Array<number>(weights.length).fill(0);
  for (let i = 0; i < weights.length; i++) {
    const range = UPPER_BOUNDS[i] - LOWER_BOUNDS[i];
    const h = Math.max(fdEps * range, 1e-9);
    const wPlus = weights.slice();
    const wMinus = weights.slice();
    wPlus[i] = Math.min(weights[i] + h, UPPER_BOUNDS[i]);
    wMinus[i] = Math.max(weights[i] - h, LOWER_BOUNDS[i]);
    const denom = wPlus[i] - wMinus[i];
    if (denom <= 0) {
      grad[i] = 0;
      continue;
    }
    const lossPlus = evalLoss(wPlus, fsrs, sequences);
    const lossMinus = evalLoss(wMinus, fsrs, sequences);
    grad[i] = (lossPlus - lossMinus) / denom;
  }
  return grad;
}

function lcgRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sampleBatch(
  sequences: CardSequence[],
  n: number,
  rand: () => number
): CardSequence[] {
  if (sequences.length <= n) return sequences;
  const out: CardSequence[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = sequences[Math.floor(rand() * sequences.length)];
  }
  return out;
}

function cosineLR(stepIdx: number, totalSteps: number, lr0: number): number {
  if (totalSteps <= 1) return lr0;
  return lr0 * 0.5 * (1 + Math.cos((Math.PI * stepIdx) / (totalSteps - 1)));
}

// ---------- Entry point ----------

export async function optimizeWeights(
  logs: OptimizerReviewInput[],
  options?: Partial<TrainingOptions>
): Promise<TrainingResult> {
  const start = Date.now();
  const opts: TrainingOptions = { ...DEFAULT_TRAINING_OPTIONS, ...options };
  if (opts.initial.length !== 21) {
    throw new Error(`initial must have 21 weights, got ${opts.initial.length}`);
  }

  const sequences = buildSequences(logs);
  const reviewCount = logs.length;

  if (reviewCount < opts.minReviews) {
    return {
      ok: false,
      reason: `Need at least ${opts.minReviews} reviews to train, found ${reviewCount}`,
      weights: opts.initial.slice(),
      beforeLogLoss: Number.NaN,
      afterLogLoss: Number.NaN,
      reviewsTrained: reviewCount,
      cardsTrained: sequences.length,
      steps: 0,
      durationMs: Date.now() - start,
    };
  }

  const fsrs = new FSRS({
    profile: opts.profile,
    requestRetention: opts.requestRetention,
    weights: opts.initial.slice(),
  });

  const beforeLogLoss = bceLoss(replay(fsrs, sequences));

  let weights = clampWeights(opts.initial.slice());
  const m = new Array<number>(21).fill(0);
  const v = new Array<number>(21).fill(0);
  const rand = lcgRng(opts.seed);
  const yieldN = opts.yieldEveryNSteps ?? 0;

  let stepsRun = 0;
  for (let step = 0; step < opts.steps; step++) {
    const batch = sampleBatch(sequences, opts.batchCards, rand);
    const grad = centralDiffGradient(weights, fsrs, batch, opts.fdEps);

    const lrT = cosineLR(step, opts.steps, opts.lr);
    const t = step + 1;
    const next = new Array<number>(21);
    for (let i = 0; i < 21; i++) {
      m[i] = opts.beta1 * m[i] + (1 - opts.beta1) * grad[i];
      v[i] = opts.beta2 * v[i] + (1 - opts.beta2) * grad[i] * grad[i];
      const mHat = m[i] / (1 - Math.pow(opts.beta1, t));
      const vHat = v[i] / (1 - Math.pow(opts.beta2, t));
      next[i] = weights[i] - (lrT * mHat) / (Math.sqrt(vHat) + opts.epsilon);
    }
    weights = clampWeights(next);
    stepsRun = step + 1;

    if (opts.onProgress) {
      opts.onProgress({ step: stepsRun, totalSteps: opts.steps });
    }
    if (yieldN > 0 && opts.yieldFn && stepsRun % yieldN === 0) {
      await opts.yieldFn();
    }
  }

  const afterLogLoss = evalLoss(weights, fsrs, sequences);

  return {
    ok: true,
    weights,
    beforeLogLoss,
    afterLogLoss,
    reviewsTrained: reviewCount,
    cardsTrained: sequences.length,
    steps: stepsRun,
    durationMs: Date.now() - start,
  };
}
