import { strict as assert } from "node:assert";
import { FSRS } from "../src/algorithm/fsrs";
import { replayUser } from "./replayEngine";
import { computeMetrics } from "./metrics";
import type { UserData, ReviewRecord } from "./loadDataset";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildSyntheticUser(userId: number, numCards: number, seed: number): UserData {
  const rand = rng(seed);
  const reviews: ReviewRecord[] = [];
  for (let c = 0; c < numCards; c++) {
    const cardId = `c${userId}_${c}`;
    let dayOffset = Math.floor(rand() * 30);
    const numReviews = 3 + Math.floor(rand() * 12);
    let prevDay = -1;
    for (let r = 0; r < numReviews; r++) {
      const elapsed = prevDay < 0 ? -1 : dayOffset - prevDay;
      const u = rand();
      let rating: 1 | 2 | 3 | 4;
      if (r === 0) rating = u < 0.7 ? 3 : u < 0.85 ? 4 : u < 0.95 ? 2 : 1;
      else if (elapsed > 30 && u < 0.4) rating = 1;
      else rating = u < 0.7 ? 3 : u < 0.85 ? 4 : u < 0.95 ? 2 : 1;
      reviews.push({ cardId, dayOffset, rating, elapsedDays: elapsed });
      prevDay = dayOffset;
      const gap = rating === 1 ? 1 : Math.max(1, Math.floor(rand() * 30));
      dayOffset += gap;
    }
  }
  return { userId, reviews };
}

async function main(): Promise<void> {
  const fsrs = new FSRS({ profile: "STANDARD", requestRetention: 0.9 });
  const allPredictions = [];
  for (let u = 1; u <= 20; u++) {
    const user = buildSyntheticUser(u, 25, u * 7919);
    const preds = replayUser(user, fsrs, { includeSameDay: false });
    allPredictions.push(...preds);
  }

  const metrics = computeMetrics(allPredictions);

  console.log(`predictions:      ${metrics.count}`);
  console.log(`mean predicted R: ${metrics.meanPredicted.toFixed(4)}`);
  console.log(`mean actual y:    ${metrics.meanActual.toFixed(4)}`);
  console.log(`LogLoss:          ${metrics.logLoss.toFixed(4)}`);
  console.log(`RMSE(bins):       ${metrics.rmseBins.toFixed(4)}`);
  console.log(`AUC:              ${metrics.auc.toFixed(4)}`);
  console.log(`bins:             ${metrics.bins.length}`);

  assert.ok(metrics.count > 100, `too few predictions: ${metrics.count}`);
  assert.ok(metrics.logLoss > 0, "LogLoss should be > 0");
  assert.ok(metrics.logLoss < 2, `LogLoss out of envelope: ${metrics.logLoss}`);
  assert.ok(metrics.rmseBins >= 0 && metrics.rmseBins < 1, "RMSE-bins out of range");
  assert.ok(metrics.auc >= 0 && metrics.auc <= 1, "AUC out of range");
  assert.ok(metrics.meanPredicted > 0 && metrics.meanPredicted < 1, "mean R out of range");

  console.log("\nsmoke OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
