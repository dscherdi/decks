/**
 * SQL query result types for type-safe database operations
 */

// Base types for SQL query results
export type SqlJsValue = number | string | Uint8Array | null;
export type SqlRow = SqlJsValue[];
export type SqlRecord = Record<string, SqlJsValue>;

// Count query results
export interface CountResult {
  count: number;
}

// Deck query results
export interface DeckRow {
  id: string;
  name: string;
  filepath: string;
  tag: string;
  last_reviewed: string | null;
  config: string;
  created: string;
  modified: string;
}

// Flashcard query results
export interface FlashcardRow {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  type: string;
  source_file: string;
  content_hash: string;
  state: string;
  due_date: string;
  interval: number;
  repetitions: number;
  difficulty: number;
  stability: number;
  lapses: number;
  last_reviewed: string | null;
  created: string;
  modified: string;
}

// Review log query results
export interface ReviewLogRow {
  id: string;
  flashcard_id: string;
  session_id: string | null;
  last_reviewed_at: string;
  reviewed_at: string;
  rating: number;
  time_elapsed_ms: number;
  old_state: string;
  old_repetitions: number;
  old_lapses: number;
  old_stability: number;
  old_difficulty: number;
  new_state: string;
  new_repetitions: number;
  new_lapses: number;
  new_stability: number;
  new_difficulty: number;
  old_interval_minutes: number;
  new_interval_minutes: number;
  old_due_at: string;
  new_due_at: string;
  elapsed_days: number;
  retrievability: number;
  request_retention: number;
  profile: string;
  maximum_interval_days: number;
  min_minutes: number;
  fsrs_weights_version: string;
  scheduler_version: string;
  content_hash: string;
}

// Review session query results
export interface ReviewSessionRow {
  id: string;
  deck_id: string;
  started_at: string;
  ended_at: string | null;
  goal_total: number;
  done_unique: number;
}

// Statistics query results
export interface DailyStatsRow {
  date: string;
  reviews: number;
  total_time_seconds: number;
  new_cards: number;
  learning_cards: number;
  review_cards: number;
  correct_rate: number;
}

export interface CardStatsRow {
  card_type: string;
  count: number;
}

export interface AnswerButtonStatsRow {
  rating_label: string;
  count: number;
}

export interface IntervalDistributionRow {
  interval_range: string;
  count: number;
}

export interface PaceStatsRow {
  avg_pace: number;
  total_time: number;
}

export interface BacklogRow {
  n: number;
}

export interface OverdueRow {
  overdue_count: number;
}

export interface ForecastRow {
  date: string;
  due_count: number;
}

// Daily review counts
export interface DailyReviewCountsRow {
  new_count: number;
  review_count: number;
}

// Generic single value queries
export interface SingleValueRow {
  value: SqlJsValue;
}

// Date count pairs for charts
export interface DateCountRow {
  date: string;
  count: number;
}

// Backup database queries
export interface BackupInfoRow {
  id: string;
  name: string;
  created_at: string;
  size_bytes: number;
}

// Union types for different query result patterns
export type QueryResult<T = SqlRecord> = T[];
export type ArrayQueryResult = SqlRow[];

// Helper types for query configuration
// Note: QueryConfig is now exported from BaseDatabaseService

// Type guards for result discrimination
export function isRecordArray(
  result: QueryResult | ArrayQueryResult,
): result is QueryResult {
  return (
    Array.isArray(result) &&
    result.length > 0 &&
    typeof result[0] === "object" &&
    !Array.isArray(result[0])
  );
}

export function isArrayResult(
  result: QueryResult | ArrayQueryResult,
): result is ArrayQueryResult {
  return (
    Array.isArray(result) && (result.length === 0 || Array.isArray(result[0]))
  );
}
