/**
 * Formatting utilities for time, pace, and other display values
 */

/**
 * Format time in seconds to human-readable format (e.g., "1h 30m", "45m")
 */
export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

/**
 * Format review pace in seconds to human-readable format (e.g., "45.0s", "1m 15s")
 */
export function formatPace(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
