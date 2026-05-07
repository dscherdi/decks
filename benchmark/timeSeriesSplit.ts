/**
 * sklearn-style TimeSeriesSplit. Given N items in chronological order and K
 * splits, yields K (trainEnd, testEnd) index pairs where:
 *   train = items[0..trainEnd)
 *   test  = items[trainEnd..testEnd)
 *
 * Chunk size = floor(N / (K + 1)). Each fold's train set grows monotonically;
 * the final fold has trainEnd = K * chunk and testEnd = N.
 *
 * Matches the methodology used by open-spaced-repetition/srs-benchmark.
 */
export interface SplitFold {
  index: number;
  trainEnd: number; // exclusive
  testEnd: number; // exclusive
}

export function timeSeriesSplit(n: number, nSplits: number): SplitFold[] {
  if (nSplits < 2) {
    throw new Error(`nSplits must be >= 2, got ${nSplits}`);
  }
  if (n < nSplits + 1) {
    return [];
  }
  const chunk = Math.floor(n / (nSplits + 1));
  const folds: SplitFold[] = [];
  for (let i = 0; i < nSplits; i++) {
    const trainEnd = (i + 1) * chunk;
    // Final fold consumes any remainder so the test set covers the tail.
    const testEnd = i === nSplits - 1 ? n : trainEnd + chunk;
    if (trainEnd >= n || testEnd > n) break;
    folds.push({ index: i, trainEnd, testEnd });
  }
  return folds;
}
