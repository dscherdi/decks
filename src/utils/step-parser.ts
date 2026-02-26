import type { FSRSProfile } from "../algorithm/fsrs-weights";

interface ValidationResult {
  valid: boolean;
  error?: string;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

/**
 * Parse a step string like "1m" or "10m" into an array of minutes.
 * Supported units: m (minutes), h (hours), d (days).
 * Returns empty array for empty/whitespace-only input.
 */
export function parseSteps(stepsString: string): number[] {
  const trimmed = stepsString.trim();
  if (trimmed === "") return [];

  const tokens = trimmed.split(/\s+/);
  const result: number[] = [];

  for (const token of tokens) {
    const parsed = parseStepToken(token);
    if (parsed === null) {
      return [];
    }
    result.push(parsed);
  }

  return result;
}

/**
 * Parse a single step token like "1m", "6h", or "3d" into minutes.
 * Returns null if invalid.
 */
function parseStepToken(token: string): number | null {
  const match = token.match(/^(\d+(?:\.\d+)?)(m|h|d)$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (!isFinite(value) || value <= 0) return null;

  const unit = match[2];
  switch (unit) {
    case "m":
      return value;
    case "h":
      return value * MINUTES_PER_HOUR;
    case "d":
      return value * MINUTES_PER_DAY;
    default:
      return null;
  }
}

/**
 * Validate a single again interval value (e.g. "1m", "10m", "1h").
 * Only a single value is accepted.
 */
export function validateLearningSteps(
  stepsString: string,
  _profile: FSRSProfile
): ValidationResult {
  const trimmed = stepsString.trim();
  if (trimmed === "") return { valid: true };

  const tokens = trimmed.split(/\s+/);
  if (tokens.length > 1) {
    return { valid: false, error: "Only a single interval value is allowed (e.g. 1m, 10m, 1h)." };
  }

  const parsed = parseStepToken(tokens[0]);
  if (parsed === null) {
    return { valid: false, error: `Invalid format: "${tokens[0]}". Use format like 1m, 10m, or 1h.` };
  }

  return { valid: true };
}

/**
 * Validate a single again interval value for review cards (lapses).
 * Only a single value is accepted.
 */
export function validateRelearningSteps(
  stepsString: string,
  _profile: FSRSProfile
): ValidationResult {
  const trimmed = stepsString.trim();
  if (trimmed === "") return { valid: true };

  const tokens = trimmed.split(/\s+/);
  if (tokens.length > 1) {
    return { valid: false, error: "Only a single interval value is allowed (e.g. 10m, 1h)." };
  }

  const parsed = parseStepToken(tokens[0]);
  if (parsed === null) {
    return { valid: false, error: `Invalid format: "${tokens[0]}". Use format like 10m, 1h, or 1d.` };
  }

  return { valid: true };
}

/**
 * Get default learning steps string for a profile.
 */
export function getDefaultLearningSteps(_profile: FSRSProfile): string {
  return "1m";
}

/**
 * Get default relearning steps string for a profile.
 */
export function getDefaultRelearningSteps(_profile: FSRSProfile): string {
  return "10m";
}

/**
 * Format a step interval in minutes to a display string.
 * Prefers the largest whole unit: 1440 → "1d", 60 → "1h", 10 → "10m".
 */
export function formatStepInterval(minutes: number): string {
  if (minutes >= MINUTES_PER_DAY && minutes % MINUTES_PER_DAY === 0) {
    return `${minutes / MINUTES_PER_DAY}d`;
  }
  if (minutes >= MINUTES_PER_HOUR && minutes % MINUTES_PER_HOUR === 0) {
    return `${minutes / MINUTES_PER_HOUR}h`;
  }
  return `${minutes}m`;
}
