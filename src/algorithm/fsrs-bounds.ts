/**
 * Per-weight clipping bounds for FSRS-6 parameter optimization.
 * Lifted verbatim from py-fsrs scheduler.py — same array order as the 21-element
 * weight vector. Used by the optimizer to keep gradient steps inside the regime
 * where the FSRS formulas remain numerically well-behaved.
 *
 * Reference: open-spaced-repetition/py-fsrs scheduler.py @ main (2026-05).
 */

const STABILITY_MIN = 0.001;
const INITIAL_STABILITY_MAX = 100.0;

export const LOWER_BOUNDS: readonly number[] = [
  STABILITY_MIN, // w[0]
  STABILITY_MIN, // w[1]
  STABILITY_MIN, // w[2]
  STABILITY_MIN, // w[3]
  1.0,           // w[4]
  0.001,         // w[5]
  0.001,         // w[6]
  0.001,         // w[7]
  0.0,           // w[8]
  0.0,           // w[9]
  0.001,         // w[10]
  0.001,         // w[11]
  0.001,         // w[12]
  0.001,         // w[13]
  0.0,           // w[14]
  0.0,           // w[15]
  1.0,           // w[16]
  0.0,           // w[17]
  0.0,           // w[18]
  0.0,           // w[19]
  0.1,           // w[20] — decay
];

export const UPPER_BOUNDS: readonly number[] = [
  INITIAL_STABILITY_MAX,
  INITIAL_STABILITY_MAX,
  INITIAL_STABILITY_MAX,
  INITIAL_STABILITY_MAX,
  10.0,
  4.0,
  4.0,
  0.75,
  4.5,
  0.8,
  3.5,
  5.0,
  0.25,
  0.9,
  4.0,
  1.0,
  6.0,
  2.0,
  2.0,
  0.8,
  0.8,
];

export function clampWeights(weights: number[]): number[] {
  if (weights.length !== 21) {
    throw new Error(`Expected 21 weights, got ${weights.length}`);
  }
  return weights.map((w, i) =>
    Math.min(Math.max(w, LOWER_BOUNDS[i]), UPPER_BOUNDS[i])
  );
}
