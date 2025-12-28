/**
 * Date utility functions for consistent local date handling
 *
 * ## Timezone Strategy for the Codebase
 *
 * ### Storage (Database):
 * - ALL timestamps in the database are stored as ISO 8601 strings in UTC
 * - This includes: created, modified, due_date, last_reviewed, reviewed_at
 * - Use `new Date().toISOString()` when creating/updating records
 * - Rationale: UTC provides consistent cross-device synchronization
 *
 * ### Display & Grouping (Queries/UI):
 * - ALL date grouping and display operations use LOCAL TIME
 * - Use utilities from this file to convert UTC to local time
 * - Rationale: Users expect to see their local calendar day/hour
 *
 * ### Why This Matters:
 * - Without local time conversion, a review at 11 PM PST (7 AM UTC next day)
 *   would be grouped into tomorrow's statistics instead of today's
 * - Backup filenames would get tomorrow's date if created before midnight UTC
 * - Hourly breakdowns would show wrong hours (e.g., 7 AM UTC = 11 PM PST previous day)
 *
 * ### Usage Examples:
 *
 * ✅ CORRECT - Display/Grouping:
 * ```typescript
 * // For chart labels, backup filenames, date comparisons
 * const today = toLocalDateString(new Date());
 *
 * // For SQL queries that group by date
 * const sql = `SELECT ${getLocalDateSQL("reviewed_at")} as date FROM review_logs`;
 * ```
 *
 * ✅ CORRECT - Storage:
 * ```typescript
 * // When creating/updating database records
 * const timestamp = new Date().toISOString();
 * ```
 *
 * ❌ WRONG - Don't use UTC for display/grouping:
 * ```typescript
 * const today = new Date().toISOString().split("T")[0]; // UTC date!
 * const sql = `SELECT DATE(reviewed_at) as date`; // UTC date!
 * ```
 */

/**
 * Converts a Date object to a local date string in YYYY-MM-DD format
 * This should be used instead of toISOString().split("T")[0]
 */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Converts a Date object to a local datetime string in YYYY-MM-DD HH:MM:SS format
 * For use in SQL queries that need local time
 */
export function toLocalDateTimeString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * SQL fragment for extracting local date from an ISO timestamp column
 *
 * SQLite's DATE() function uses UTC, which causes timezone drift.
 * This function converts the ISO timestamp to local time before extracting the date.
 *
 * @param columnName - The column name containing the ISO timestamp (e.g., "reviewed_at")
 * @returns SQL fragment that extracts the local date in YYYY-MM-DD format
 *
 * @example
 * // Instead of: DATE(reviewed_at)
 * // Use: getLocalDateSQL("reviewed_at")
 * const sql = `SELECT ${getLocalDateSQL("reviewed_at")} as date FROM review_logs`;
 */
export function getLocalDateSQL(columnName: string): string {
  // Convert ISO timestamp to local time by using datetime() with 'localtime' modifier
  // Then extract just the date part
  return `DATE(${columnName}, 'localtime')`;
}

/**
 * SQL fragment for extracting hour from an ISO timestamp in local time
 *
 * @param columnName - The column name containing the ISO timestamp
 * @returns SQL fragment that extracts the local hour (0-23)
 *
 * @example
 * const sql = `SELECT ${getLocalHourSQL("reviewed_at")} as hour FROM review_logs`;
 */
export function getLocalHourSQL(columnName: string): string {
  // CAST to INTEGER to get numeric hour (0-23) in local time
  return `CAST(STRFTIME('%H', ${columnName}, 'localtime') AS INTEGER)`;
}
