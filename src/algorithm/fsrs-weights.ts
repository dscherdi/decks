/**
 * FSRS Algorithm Weights Configuration
 *
 * Centralized configuration for FSRS-6 algorithm weights. These weights control the
 * initial stability values for new card ratings and various algorithm parameters for
 * difficulty progression and stability updates. 21 weights total (w[0]–w[20]).
 */

/**
 * FSRS-6 standard weights. FSRS produces continuous floating-point intervals, so a single
 * profile covers both day-scale and sub-day scheduling — the per-profile minMinutes floor
 * (always 1 minute) decides how short an interval is honoured.
 */
export const FSRS_WEIGHTS_STANDARD: number[] = [
  0.212,  1.2931, 2.3065, 8.2956,  // w[0-3]:  initial stability per rating (Again/Hard/Good/Easy)
  6.4133, 0.8334, 3.0194, 0.001,   // w[4-7]:  difficulty params + mean reversion strength
  1.8722, 0.1666, 0.796,  1.4835,  // w[8-11]: recall stability scaling
  0.0614, 0.2629, 1.6483, 0.6014,  // w[12-15]: lapse stability + hard modifier
  1.8729,                           // w[16]:   easy modifier (recall stability)
  0.5425, 0.0912, 0.0658,           // w[17-19]: short-term scheduling
  0.1542,                           // w[20]:   forgetting curve decay (trainable)
];

/**
 * Default FSRS weights
 */
export const DEFAULT_FSRS_WEIGHTS: number[] = FSRS_WEIGHTS_STANDARD;

/**
 * FSRS profile configuration.
 * - STANDARD: shipped weights.
 * - TRAINED: the user's globally-optimized weights, injected at runtime by the Scheduler from
 *   settings.fsrs.trainedWeights. The weights here are the fallback used when no trained
 *   weights exist yet.
 */
export type FSRSProfile = "STANDARD" | "TRAINED";

/**
 * Profile-specific parameters (hardcoded, not user-editable)
 */
export const PROFILE_CONFIG = {
  STANDARD: {
    weights: FSRS_WEIGHTS_STANDARD,
    minMinutes: 1,
    maximumIntervalDays: 36500,
  },
  TRAINED: {
    weights: FSRS_WEIGHTS_STANDARD,
    minMinutes: 1,
    maximumIntervalDays: 36500,
  },
} as const;

/**
 * Default FSRS algorithm parameters (backward compatibility)
 */
export const DEFAULT_FSRS_PARAMETERS = {
  w: DEFAULT_FSRS_WEIGHTS,
  requestRetention: 0.9,
  maximumInterval: 36500,
  minMinutes: 1,
} as const;

/**
 * Get weights for a specific profile
 */
export function getWeightsForProfile(profile: FSRSProfile): number[] {
  return PROFILE_CONFIG[profile].weights;
}

/**
 * Get minimum minutes for a specific profile
 */
export function getMinMinutesForProfile(profile: FSRSProfile): number {
  return PROFILE_CONFIG[profile].minMinutes;
}

/**
 * Get maximum interval days for a specific profile
 */
export function getMaxIntervalDaysForProfile(profile: FSRSProfile): number {
  return PROFILE_CONFIG[profile].maximumIntervalDays;
}

/**
 * Validates FSRS weights array
 * @param weights - Array of 21 FSRS weights to validate
 * @returns true if valid, false otherwise
 */
export function validateFSRSWeights(weights: number[]): boolean {
  if (!Array.isArray(weights) || weights.length !== 21) {
    return false;
  }

  return weights.every((w) => isFinite(w));
}

/**
 * Helper function for UI-only formatting - never use in calculations
 * Preserves full precision in all internal calculations
 */
export function roundForDisplay(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/**
 * Validate FSRS profile
 */
export function validateProfile(profile: string): profile is FSRSProfile {
  return profile === "STANDARD" || profile === "TRAINED";
}

/**
 * Normalize a stored/legacy profile string to a current FSRSProfile. The only opt-in is
 * TRAINED; legacy "INTENSIVE" (and any unknown value) collapses to STANDARD.
 */
export function normalizeProfile(value: string | null | undefined): FSRSProfile {
  return value === "TRAINED" ? "TRAINED" : "STANDARD";
}

/**
 * Validate request retention range
 */
export function validateRequestRetention(retention: number): boolean {
  return retention > 0.5 && retention < 0.995;
}
