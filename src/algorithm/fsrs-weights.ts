/**
 * FSRS Algorithm Weights Configuration
 *
 * Centralized configuration for FSRS-4.5 algorithm weights optimized for sub-day intervals.
 * These weights control the initial stability values for new card ratings and various
 * algorithm parameters for difficulty progression and stability updates.
 */

/**
 * FSRS-4.5 standard weights (day-based intervals)
 */
export const FSRS_WEIGHTS_STANDARD: number[] = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616,
  0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466,
];

/**
 * FSRS weights optimized for intensive sub-day intervals
 * w[0-3] set to match intensive targets in days: 1m/5m/10m/1day
 */
export const FSRS_WEIGHTS_SUBDAY: number[] = createSubDayWeights();

/**
 * Default FSRS weights
 */
export const DEFAULT_FSRS_WEIGHTS: number[] = FSRS_WEIGHTS_STANDARD;

/**
 * FSRS profile configuration
 */
export type FSRSProfile = "INTENSIVE" | "STANDARD";

/**
 * Profile-specific parameters (hardcoded, not user-editable)
 */
export const PROFILE_CONFIG = {
  INTENSIVE: {
    weights: FSRS_WEIGHTS_SUBDAY,
    minMinutes: 1,
    maximumIntervalDays: 36500,
  },
  STANDARD: {
    weights: FSRS_WEIGHTS_STANDARD,
    minMinutes: 1440, // 1 day minimum
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
  minMinutes: 1440,
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
 * @param weights - Array of 17 FSRS weights to validate
 * @returns true if valid, false otherwise
 */
export function validateFSRSWeights(weights: number[]): boolean {
  if (!Array.isArray(weights) || weights.length !== 17) {
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
 * Creates sub-day optimized weights with custom initial intervals
 * @param againMinutes - Target interval for Again rating (default: 1 minute)
 * @param hardMinutes - Target interval for Hard rating (default: 6 minutes)
 * @param goodMinutes - Target interval for Good rating (default: 10 minutes)
 * @param easyMinutes - Target interval for Easy rating (default: 1440 minutes)
 * @returns FSRS weights array optimized for specified intervals
 */
export function createSubDayWeights(
  againMinutes = 1,
  hardMinutes = 6,
  goodMinutes = 10,
  easyMinutes = 1440,
): number[] {
  return [
    againMinutes / 1440, // w[0] - Again stability
    hardMinutes / 1440, // w[1] - Hard stability
    goodMinutes / 1440, // w[2] - Good stability
    easyMinutes / 1440, // w[3] - Easy stability
    ...FSRS_WEIGHTS_STANDARD.slice(4), // Keep remaining weights
  ];
}

/**
 * Validate FSRS profile
 */
export function validateProfile(profile: string): profile is FSRSProfile {
  return profile === "INTENSIVE" || profile === "STANDARD";
}

/**
 * Validate request retention range
 */
export function validateRequestRetention(retention: number): boolean {
  return retention > 0.5 && retention < 0.995;
}

/**
 * Pre-configured weight sets for different use cases (deprecated)
 */
export const WEIGHT_PRESETS = {
  INTENSIVE: FSRS_WEIGHTS_SUBDAY,
  STANDARD: FSRS_WEIGHTS_STANDARD,
} as const;
