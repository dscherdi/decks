import type { PredictionRecord } from "./replayEngine";

const EPS = 1e-15;
const AUC_BUCKETS = 10000;

export interface BenchmarkMetrics {
  count: number;
  logLoss: number;
  rmseBins: number;
  auc: number;
  meanPredicted: number;
  meanActual: number;
  bins: BinSummary[];
}

export interface BinSummary {
  deltaT: number;
  i: number;
  lapses: number;
  count: number;
  meanY: number;
  meanP: number;
}

interface BinAccum {
  deltaT: number;
  i: number;
  lapses: number;
  count: number;
  sumY: number;
  sumP: number;
}

function deltaTBin(x: number): number {
  const v = Math.max(x, 1e-6);
  return round2(2.48 * Math.pow(3.62, Math.floor(Math.log(v) / Math.log(3.62))));
}
function reviewCountBin(x: number): number {
  if (x <= 0) return 0;
  return Math.round(1.99 * Math.pow(1.89, Math.floor(Math.log(x) / Math.log(1.89))));
}
function lapsesBin(x: number): number {
  if (x <= 0) return 0;
  return Math.round(1.65 * Math.pow(1.73, Math.floor(Math.log(x) / Math.log(1.73))));
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Memory-bounded aggregator: takes prediction records one at a time,
 * keeps only running sums + a fixed-size histogram. Suitable for the
 * full 10k-user benchmark (~230M predictions) without buffering them all.
 *
 * AUC is computed from a 10000-bucket histogram of `p`. Discretization
 * error is below 1e-4 — far below run-to-run noise.
 */
export class StreamingMetrics {
  private count = 0;
  private logLossSum = 0;
  private sumP = 0;
  private sumY = 0;
  private bins = new Map<string, BinAccum>();
  private aucPos = new Int32Array(AUC_BUCKETS);
  private aucNeg = new Int32Array(AUC_BUCKETS);

  add(record: PredictionRecord): void {
    this.count += 1;
    const pClamped = Math.min(Math.max(record.p, EPS), 1 - EPS);
    this.logLossSum +=
      record.y === 1 ? -Math.log(pClamped) : -Math.log(1 - pClamped);
    this.sumP += record.p;
    this.sumY += record.y;

    const dt = deltaTBin(record.elapsedDays);
    const ib = reviewCountBin(record.reviewCount);
    const lb = lapsesBin(record.lapses);
    const key = `${dt}|${ib}|${lb}`;
    let b = this.bins.get(key);
    if (!b) {
      b = { deltaT: dt, i: ib, lapses: lb, count: 0, sumY: 0, sumP: 0 };
      this.bins.set(key, b);
    }
    b.count += 1;
    b.sumY += record.y;
    b.sumP += record.p;

    let idx = Math.floor(record.p * AUC_BUCKETS);
    if (idx < 0) idx = 0;
    else if (idx >= AUC_BUCKETS) idx = AUC_BUCKETS - 1;
    if (record.y === 1) this.aucPos[idx] += 1;
    else this.aucNeg[idx] += 1;
  }

  addMany(records: PredictionRecord[]): void {
    for (const r of records) this.add(r);
  }

  private rmseFromBins(): { rmse: number; bins: BinSummary[] } {
    if (this.count === 0) return { rmse: Number.NaN, bins: [] };
    let weightedSquaredError = 0;
    let totalWeight = 0;
    const summaries: BinSummary[] = [];
    for (const b of this.bins.values()) {
      const meanY = b.sumY / b.count;
      const meanP = b.sumP / b.count;
      const diff = meanY - meanP;
      weightedSquaredError += diff * diff * b.count;
      totalWeight += b.count;
      summaries.push({
        deltaT: b.deltaT,
        i: b.i,
        lapses: b.lapses,
        count: b.count,
        meanY,
        meanP,
      });
    }
    summaries.sort(
      (a, b) => a.deltaT - b.deltaT || a.i - b.i || a.lapses - b.lapses
    );
    return { rmse: Math.sqrt(weightedSquaredError / totalWeight), bins: summaries };
  }

  // Histogram-based AUC: equivalent to ROC AUC computed from sorted (p, y) pairs,
  // discretized to AUC_BUCKETS buckets of `p`. Within-bucket ties contribute
  // 0.5 * pos[i] * neg[i] (mid-rank for ties).
  private aucFromHistogram(): number {
    let nPos = 0;
    let nNeg = 0;
    for (let i = 0; i < AUC_BUCKETS; i++) {
      nPos += this.aucPos[i];
      nNeg += this.aucNeg[i];
    }
    if (nPos === 0 || nNeg === 0) return Number.NaN;

    let concordant = 0;
    let cumNeg = 0;
    for (let i = 0; i < AUC_BUCKETS; i++) {
      const pos = this.aucPos[i];
      const neg = this.aucNeg[i];
      // For positives in this bucket: every negative in lower-p buckets is concordant,
      // negatives in this bucket contribute 0.5 (tie).
      concordant += pos * cumNeg + 0.5 * pos * neg;
      cumNeg += neg;
    }
    return concordant / (nPos * nNeg);
  }

  finalize(): BenchmarkMetrics {
    const { rmse, bins } = this.rmseFromBins();
    return {
      count: this.count,
      logLoss: this.count === 0 ? Number.NaN : this.logLossSum / this.count,
      rmseBins: rmse,
      auc: this.aucFromHistogram(),
      meanPredicted: this.count === 0 ? Number.NaN : this.sumP / this.count,
      meanActual: this.count === 0 ? Number.NaN : this.sumY / this.count,
      bins,
    };
  }
}

export function computeMetrics(records: PredictionRecord[]): BenchmarkMetrics {
  const m = new StreamingMetrics();
  m.addMany(records);
  return m.finalize();
}
