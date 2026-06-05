/**
 * Cross-check our FSRS implementation against the py-fsrs reference math.
 *
 * Reference: open-spaced-repetition/py-fsrs scheduler.py @ main (2026-05).
 * https://github.com/open-spaced-repetition/py-fsrs/blob/main/fsrs/scheduler.py
 *
 * Strategy: vendor py-fsrs's primitive formulas verbatim into pyfsrsRef below,
 * then diff against our private methods on a grid of inputs. Any per-formula
 * delta > 1e-9 indicates a math divergence.
 */
import { FSRS } from "../src/algorithm/fsrs";
import { FSRS_WEIGHTS_STANDARD } from "../src/algorithm/fsrs-weights";

type FsrsPrivate = {
  initStability(rating: number): number;
  initDifficulty(rating: number): number;
  forgettingCurve(elapsedDays: number, stability: number): number;
  nextDifficulty(difficulty: number, rating: number): number;
  nextStability(d: number, s: number, r: number, rating: number): number;
  forgettingStability(d: number, s: number, r: number): number;
  shortTermStability(stability: number, rating: number): number;
};

// ----- py-fsrs reference math (direct port of scheduler.py:660-810) -----

const W = FSRS_WEIGHTS_STANDARD;
const STABILITY_MIN = 0.001;
const PY_DECAY = -W[20];
const PY_FACTOR = Math.pow(0.9, 1 / PY_DECAY) - 1;

const pyfsrsRef = {
  initStability(rating: number): number {
    return Math.max(W[rating - 1], STABILITY_MIN);
  },
  initDifficulty(rating: number, clamp = true): number {
    const d = W[4] - Math.exp(W[5] * (rating - 1)) + 1;
    return clamp ? Math.max(1, Math.min(10, d)) : d;
  },
  forgettingCurve(elapsedDays: number, stability: number): number {
    return Math.pow(1 + (PY_FACTOR * elapsedDays) / stability, PY_DECAY);
  },
  nextDifficulty(difficulty: number, rating: number): number {
    const arg1 = pyfsrsRef.initDifficulty(4, /* clamp */ false);
    const deltaDifficulty = -(W[6] * (rating - 3));
    const arg2 = difficulty + ((10 - difficulty) * deltaDifficulty) / 9;
    const next = W[7] * arg1 + (1 - W[7]) * arg2;
    return Math.max(1, Math.min(10, next));
  },
  shortTermStability(stability: number, rating: number): number {
    let inc = Math.exp(W[17] * (rating - 3 + W[18])) * Math.pow(stability, -W[19]);
    if (rating === 3 || rating === 4) inc = Math.max(inc, 1.0);
    return Math.max(stability * inc, STABILITY_MIN);
  },
  nextRecallStability(d: number, s: number, r: number, rating: number): number {
    const hardPenalty = rating === 2 ? W[15] : 1;
    const easyBonus = rating === 4 ? W[16] : 1;
    return (
      s *
      (1 +
        Math.exp(W[8]) *
          (11 - d) *
          Math.pow(s, -W[9]) *
          (Math.exp((1 - r) * W[10]) - 1) *
          hardPenalty *
          easyBonus)
    );
  },
  nextForgetStability(d: number, s: number, r: number): number {
    const longTerm =
      W[11] *
      Math.pow(d, -W[12]) *
      (Math.pow(s + 1, W[13]) - 1) *
      Math.exp((1 - r) * W[14]);
    const shortTerm = s / Math.exp(W[17] * W[18]);
    return Math.min(longTerm, shortTerm);
  },
  nextStability(d: number, s: number, r: number, rating: number): number {
    const v =
      rating === 1
        ? pyfsrsRef.nextForgetStability(d, s, r)
        : pyfsrsRef.nextRecallStability(d, s, r, rating);
    return Math.max(v, STABILITY_MIN);
  },
};

// ----- Diff harness -----

interface Diff {
  name: string;
  inputs: string;
  ours: number;
  theirs: number;
  absDelta: number;
  relDelta: number;
}

interface FormulaResult {
  name: string;
  cases: number;
  maxAbsDelta: number;
  maxRelDelta: number;
  examples: Diff[];
  divergent: number;
}

const TOL_ABS = 1e-9;
const TOL_REL = 1e-9;

function record(
  name: string,
  inputs: string,
  ours: number,
  theirs: number,
  bucket: Diff[]
): void {
  const absDelta = Math.abs(ours - theirs);
  const denom = Math.max(Math.abs(theirs), 1e-12);
  const relDelta = absDelta / denom;
  if (absDelta > TOL_ABS && relDelta > TOL_REL) {
    bucket.push({ name, inputs, ours, theirs, absDelta, relDelta });
  }
}

function summarize(name: string, diffs: Diff[], cases: number): FormulaResult {
  const maxAbsDelta = diffs.reduce((m, d) => Math.max(m, d.absDelta), 0);
  const maxRelDelta = diffs.reduce((m, d) => Math.max(m, d.relDelta), 0);
  const examples = diffs
    .slice()
    .sort((a, b) => b.absDelta - a.absDelta)
    .slice(0, 5);
  return { name, cases, maxAbsDelta, maxRelDelta, examples, divergent: diffs.length };
}

function main(): void {
  const fsrs = new FSRS({ profile: "STANDARD", requestRetention: 0.9 });
  const ours = fsrs as unknown as FsrsPrivate;

  const ratings = [1, 2, 3, 4];
  const stabilities = [0.01, 0.5, 1, 5, 10, 50, 100, 365, 1825];
  const difficulties = [1, 2.5, 5, 7.5, 10];
  const retrievabilities = [0.05, 0.3, 0.5, 0.7, 0.85, 0.95, 0.99];
  const elapseds = [0, 0.5, 1, 5, 30, 180, 365, 1825];

  const results: FormulaResult[] = [];

  // initStability
  let diffs: Diff[] = [];
  let cases = 0;
  for (const r of ratings) {
    cases += 1;
    record(
      "initStability",
      `rating=${r}`,
      ours.initStability(r),
      pyfsrsRef.initStability(r),
      diffs
    );
  }
  results.push(summarize("initStability", diffs, cases));

  // initDifficulty
  diffs = [];
  cases = 0;
  for (const r of ratings) {
    cases += 1;
    record(
      "initDifficulty",
      `rating=${r}`,
      ours.initDifficulty(r),
      pyfsrsRef.initDifficulty(r, true),
      diffs
    );
  }
  results.push(summarize("initDifficulty", diffs, cases));

  // forgettingCurve
  diffs = [];
  cases = 0;
  for (const t of elapseds) {
    for (const s of stabilities) {
      cases += 1;
      record(
        "forgettingCurve",
        `t=${t},S=${s}`,
        ours.forgettingCurve(t, s),
        pyfsrsRef.forgettingCurve(t, s),
        diffs
      );
    }
  }
  results.push(summarize("forgettingCurve", diffs, cases));

  // nextDifficulty
  diffs = [];
  cases = 0;
  for (const d of difficulties) {
    for (const r of ratings) {
      cases += 1;
      record(
        "nextDifficulty",
        `D=${d},rating=${r}`,
        ours.nextDifficulty(d, r),
        pyfsrsRef.nextDifficulty(d, r),
        diffs
      );
    }
  }
  results.push(summarize("nextDifficulty", diffs, cases));

  // shortTermStability
  diffs = [];
  cases = 0;
  for (const s of stabilities) {
    for (const r of ratings) {
      cases += 1;
      record(
        "shortTermStability",
        `S=${s},rating=${r}`,
        ours.shortTermStability(s, r),
        pyfsrsRef.shortTermStability(s, r),
        diffs
      );
    }
  }
  results.push(summarize("shortTermStability", diffs, cases));

  // nextStability — recall path (rating 2/3/4)
  diffs = [];
  cases = 0;
  for (const d of difficulties) {
    for (const s of stabilities) {
      for (const r of retrievabilities) {
        for (const rating of [2, 3, 4]) {
          cases += 1;
          record(
            "nextStability(recall)",
            `D=${d},S=${s},R=${r},rating=${rating}`,
            ours.nextStability(d, s, r, rating),
            pyfsrsRef.nextStability(d, s, r, rating),
            diffs
          );
        }
      }
    }
  }
  results.push(summarize("nextStability(recall)", diffs, cases));

  // forgettingStability (rating=1, the lapse case)
  diffs = [];
  cases = 0;
  for (const d of difficulties) {
    for (const s of stabilities) {
      for (const r of retrievabilities) {
        cases += 1;
        record(
          "forgettingStability",
          `D=${d},S=${s},R=${r}`,
          ours.forgettingStability(d, s, r),
          pyfsrsRef.nextForgetStability(d, s, r),
          diffs
        );
      }
    }
  }
  results.push(summarize("forgettingStability", diffs, cases));

  // ----- Report -----
  for (const r of results) {
    const status = r.divergent === 0 ? "OK" : "DIVERGENT";
    console.log(
      `${status.padEnd(10)} ${r.name.padEnd(28)} cases=${r.cases.toString().padStart(5)}  divergent=${r.divergent.toString().padStart(4)}  maxAbsΔ=${r.maxAbsDelta.toExponential(2)}  maxRelΔ=${r.maxRelDelta.toExponential(2)}`
    );
    if (r.divergent > 0) {
      for (const ex of r.examples) {
        console.log(
          `             ${ex.inputs.padEnd(40)} ours=${ex.ours.toFixed(8)} theirs=${ex.theirs.toFixed(8)} Δ=${ex.absDelta.toExponential(3)}`
        );
      }
    }
  }

  const allOk = results.every((r) => r.divergent === 0);
  console.log("");
  console.log(allOk ? "All formulas match py-fsrs reference." : "Divergences found. See above.");
  process.exit(allOk ? 0 : 1);
}

main();
