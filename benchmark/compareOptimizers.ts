/**
 * Side-by-side comparison: our pure-TS FSRS-6 optimizer vs the reference Rust
 * fsrs-rs (FSRS-5, via fsrs-rs-nodejs native binding).
 *
 * Methodology per user:
 *   1. Sort reviews chronologically across cards.
 *   2. 80/20 chronological split.
 *   3. Train both optimizers on the train slice.
 *   4. Evaluate each optimizer's trained weights on the test slice using its
 *      own evaluation: rust → FSRS.evaluate(items); ts → replay + metrics.
 *   5. Report per-user LogLoss/RMSE-bins/runtime side by side.
 *
 * The Rust impl is FSRS-5 (19 weights); ours is FSRS-6 (21 weights). Published
 * baselines differ by only ~0.01 LogLoss between versions, so most of any gap
 * here reflects optimizer quality (numerical vs analytical gradients,
 * card-batch vs review-batch sampling) rather than algorithm version.
 *
 * Benchmark-only — fsrs-rs-nodejs is a native binding that doesn't load in
 * Obsidian's renderer; nothing here ships with the plugin.
 */
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { discoverUsers, loadUser, type ReviewRecord, type UserData } from "./loadDataset";
import { FSRS, type RatingLabel } from "../src/algorithm/fsrs";
import {
  optimizeWeights,
  type OptimizerReviewInput,
} from "../src/algorithm/fsrs-optimizer";
import { replayUser } from "./replayEngine";
import { computeMetrics } from "./metrics";

interface FsrsRsBinding {
  FSRS: new (params: number[] | null) => {
    computeParameters(items: unknown[], enableShortTerm: boolean): Promise<number[]>;
    evaluate(items: unknown[]): { logLoss: number; rmseBins: number };
  };
  FSRSReview: new (rating: number, deltaT: number) => unknown;
  FSRSItem: new (reviews: unknown[]) => unknown;
  DEFAULT_PARAMETERS: number[];
}

const RATING_LABELS: readonly RatingLabel[] = [
  "again",
  "hard",
  "good",
  "easy",
] as const;
const EPOCH_MS = Date.UTC(2020, 0, 1, 12, 0, 0);

interface UserCompareResult {
  userId: number;
  trainReviews: number;
  testReviews: number;
  rust: { logLoss: number; rmseBins: number; trainMs: number };
  ts: {
    logLoss: number;
    rmseBins: number;
    auc: number;
    meanPredicted: number;
    meanActual: number;
    trainMs: number;
    evalMs: number;
  };
}

function recordToOptimizerInput(r: ReviewRecord, userId: number): OptimizerReviewInput {
  return {
    flashcardId: `${userId}-${r.cardId}`,
    reviewedAt: new Date(EPOCH_MS + r.dayOffset * 86400000).toISOString(),
    rating: r.rating,
    ratingLabel: RATING_LABELS[r.rating - 1],
    elapsedDays: r.elapsedDays,
  };
}

function chronologicalSplit(
  user: UserData,
  fraction: number
): { train: ReviewRecord[]; test: ReviewRecord[] } {
  const sorted = user.reviews.slice().sort((a, b) => a.dayOffset - b.dayOffset);
  const cutoff = Math.floor(sorted.length * fraction);
  return { train: sorted.slice(0, cutoff), test: sorted.slice(cutoff) };
}

/**
 * Build FSRSItems for fsrs-rs-nodejs from a flat list of ReviewRecords.
 * Each (card, target_index) pair becomes one FSRSItem containing all reviews
 * up to and including the target. Targets with elapsed_days=0 are skipped
 * (rust crate rejects items where the last review's delta_t is 0).
 */
function buildFsrsItems(
  records: ReviewRecord[],
  rust: FsrsRsBinding
): unknown[] {
  const byCard = new Map<string, ReviewRecord[]>();
  for (const r of records) {
    const arr = byCard.get(r.cardId) ?? [];
    arr.push(r);
    byCard.set(r.cardId, arr);
  }
  const items: unknown[] = [];
  for (const reviews of byCard.values()) {
    reviews.sort((a, b) => a.dayOffset - b.dayOffset);
    const fsrsReviews = reviews.map(
      (r, i) =>
        new rust.FSRSReview(
          r.rating,
          i === 0 ? 0 : Math.max(0, r.elapsedDays)
        )
    );
    for (let i = 1; i < fsrsReviews.length; i++) {
      if (Math.max(0, reviews[i].elapsedDays) === 0) continue;
      items.push(new rust.FSRSItem(fsrsReviews.slice(0, i + 1)));
    }
  }
  return items;
}

async function compareForUser(
  user: UserData,
  rust: FsrsRsBinding
): Promise<UserCompareResult | null> {
  const { train, test } = chronologicalSplit(user, 0.8);
  if (train.length < 100 || test.length < 20) return null;

  // ---- Rust: train on train, evaluate on test ----
  const trainItemsRust = buildFsrsItems(train, rust);
  const testItemsRust = buildFsrsItems(test, rust);
  if (trainItemsRust.length === 0 || testItemsRust.length === 0) return null;

  let rustLogLoss = Number.NaN;
  let rustRmse = Number.NaN;
  let rustTrainMs = 0;
  try {
    const rustStart = Date.now();
    const rustWeights = await new rust.FSRS(null).computeParameters(
      trainItemsRust,
      true
    );
    rustTrainMs = Date.now() - rustStart;
    const ev = new rust.FSRS(rustWeights).evaluate(testItemsRust);
    rustLogLoss = ev.logLoss;
    rustRmse = ev.rmseBins;
  } catch (e) {
    process.stderr.write(
      `  user_id=${user.userId}: rust optimizer failed (${
        e instanceof Error ? e.message : String(e)
      })\n`
    );
  }

  // ---- TS: train on train, evaluate via replay+metrics on test ----
  const trainInputsTs = train.map((r) => recordToOptimizerInput(r, user.userId));
  const tsTrainStart = Date.now();
  const tsTraining = await optimizeWeights(trainInputsTs, {
    yieldEveryNSteps: 0,
  });
  const tsTrainMs = Date.now() - tsTrainStart;

  const trainedFsrs = new FSRS({
    profile: "STANDARD",
    requestRetention: 0.9,
    weights: tsTraining.weights,
  });
  const tsEvalStart = Date.now();
  const testUser: UserData = { userId: user.userId, reviews: test };
  const preds = replayUser(testUser, trainedFsrs, { includeSameDay: false });
  const tsMetrics = computeMetrics(preds);
  const tsEvalMs = Date.now() - tsEvalStart;

  return {
    userId: user.userId,
    trainReviews: train.length,
    testReviews: test.length,
    rust: { logLoss: rustLogLoss, rmseBins: rustRmse, trainMs: rustTrainMs },
    ts: {
      logLoss: tsMetrics.logLoss,
      rmseBins: tsMetrics.rmseBins,
      auc: tsMetrics.auc,
      meanPredicted: tsMetrics.meanPredicted,
      meanActual: tsMetrics.meanActual,
      trainMs: tsTrainMs,
      evalMs: tsEvalMs,
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let dataPath = "";
  let users = 5;
  let outPath = resolve(
    "benchmark/results",
    `compare-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data") dataPath = argv[++i];
    else if (a === "--users") users = parseInt(argv[++i], 10);
    else if (a === "--out") outPath = argv[++i];
  }
  if (!dataPath) {
    process.stderr.write(
      "Usage: compareOptimizers --data <revlogs_root> [--users N] [--out <path>]\n"
    );
    process.exit(1);
  }

  const rust = (await import("fsrs-rs-nodejs")) as unknown as FsrsRsBinding;
  process.stderr.write(
    `fsrs-rs-nodejs default param count: ${rust.DEFAULT_PARAMETERS.length} (FSRS-${rust.DEFAULT_PARAMETERS.length === 19 ? "5" : "?"})\n`
  );

  const allUserIds = discoverUsers(dataPath);
  if (allUserIds.length === 0) {
    throw new Error(`No user_id=* partitions under ${dataPath}`);
  }
  const userIds = allUserIds.slice(0, users);

  const results: UserCompareResult[] = [];
  for (const userId of userIds) {
    try {
      const user = await loadUser(dataPath, userId);
      if (user.reviews.length < 200) continue;
      process.stderr.write(`user ${userId} (${user.reviews.length} reviews)…\n`);
      const r = await compareForUser(user, rust);
      if (r) results.push(r);
    } catch (e) {
      process.stderr.write(
        `user_id=${userId}: skipped (${e instanceof Error ? e.message : String(e)})\n`
      );
    }
  }

  // ---- Aggregate (sample-weighted by test review count) ----
  let totalTest = 0;
  let weightedRustLogLoss = 0;
  let weightedRustRmse = 0;
  let weightedTsLogLoss = 0;
  let weightedTsRmse = 0;
  let weightedTsAuc = 0;
  let totalRustMs = 0;
  let totalTsMs = 0;
  for (const r of results) {
    if (!Number.isFinite(r.rust.logLoss) || !Number.isFinite(r.ts.logLoss)) continue;
    const w = r.testReviews;
    totalTest += w;
    weightedRustLogLoss += r.rust.logLoss * w;
    weightedRustRmse += r.rust.rmseBins * w;
    weightedTsLogLoss += r.ts.logLoss * w;
    weightedTsRmse += r.ts.rmseBins * w;
    weightedTsAuc += r.ts.auc * w;
    totalRustMs += r.rust.trainMs;
    totalTsMs += r.ts.trainMs;
  }

  const summary = {
    users: results.length,
    totalTestReviews: totalTest,
    rust: {
      version: "FSRS-5 (fsrs-rs-nodejs)",
      weightedLogLoss: totalTest > 0 ? weightedRustLogLoss / totalTest : Number.NaN,
      weightedRmseBins: totalTest > 0 ? weightedRustRmse / totalTest : Number.NaN,
      totalTrainMs: totalRustMs,
    },
    ts: {
      version: "FSRS-6 (in-house)",
      weightedLogLoss: totalTest > 0 ? weightedTsLogLoss / totalTest : Number.NaN,
      weightedRmseBins: totalTest > 0 ? weightedTsRmse / totalTest : Number.NaN,
      weightedAuc: totalTest > 0 ? weightedTsAuc / totalTest : Number.NaN,
      totalTrainMs: totalTsMs,
    },
    perUser: results,
  };

  // Console summary
  process.stdout.write("\n=== Side-by-side comparison ===\n");
  process.stdout.write(`Users: ${summary.users}, total test reviews: ${summary.totalTestReviews}\n`);
  process.stdout.write(`Rust  (FSRS-5): LogLoss ${summary.rust.weightedLogLoss.toFixed(4)}  RMSE ${summary.rust.weightedRmseBins.toFixed(4)}  train ${(summary.rust.totalTrainMs / 1000).toFixed(1)}s\n`);
  process.stdout.write(`TS    (FSRS-6): LogLoss ${summary.ts.weightedLogLoss.toFixed(4)}  RMSE ${summary.ts.weightedRmseBins.toFixed(4)}  AUC ${summary.ts.weightedAuc.toFixed(4)}  train ${(summary.ts.totalTrainMs / 1000).toFixed(1)}s\n`);
  process.stdout.write(`Gap  (TS - Rust): LogLoss ${(summary.ts.weightedLogLoss - summary.rust.weightedLogLoss).toFixed(4)}  RMSE ${(summary.ts.weightedRmseBins - summary.rust.weightedRmseBins).toFixed(4)}\n`);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  process.stdout.write(`\noutput: ${outPath}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
