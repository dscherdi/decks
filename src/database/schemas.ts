import { Database } from "sql.js";

// Current Schema Version
export const CURRENT_SCHEMA_VERSION = 2;

// SQL Table Creation Schema - Used when database file doesn't exist
export const CREATE_TABLES_SQL = `
  PRAGMA foreign_keys = OFF;
  BEGIN;

  -- Decks table
  CREATE TABLE decks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filepath TEXT NOT NULL UNIQUE,
    tag TEXT NOT NULL,
    last_reviewed TEXT,
    config TEXT NOT NULL DEFAULT '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date","fsrs":{"requestRetention":0.9,"profile":"STANDARD"}}',
    created TEXT NOT NULL,
    modified TEXT NOT NULL
  );

  -- Flashcards table
  CREATE TABLE flashcards (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('header-paragraph', 'table')),
    source_file TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    header_level INTEGER CHECK (header_level >= 1 AND header_level <= 6),
    state TEXT NOT NULL CHECK (state IN ('new', 'review')),
    due_date TEXT NOT NULL,
    interval REAL NOT NULL,
    repetitions INTEGER NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 5.0,
    stability REAL NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_reviewed TEXT,
    created TEXT NOT NULL,
    modified TEXT NOT NULL,
    FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
  );

  -- Review logs table
  CREATE TABLE review_logs (
    id TEXT PRIMARY KEY,
    flashcard_id TEXT NOT NULL,
    last_reviewed_at TEXT NOT NULL,
    shown_at TEXT,
    reviewed_at TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating IN (1, 2, 3, 4)),
    rating_label TEXT NOT NULL CHECK (rating_label IN ('again', 'hard', 'good', 'easy')),
    time_elapsed_ms INTEGER,
    old_state TEXT NOT NULL CHECK (old_state IN ('new', 'review')),
    old_repetitions INTEGER NOT NULL DEFAULT 0,
    old_lapses INTEGER NOT NULL DEFAULT 0,
    old_stability REAL NOT NULL DEFAULT 0,
    old_difficulty REAL NOT NULL DEFAULT 5.0,
    new_state TEXT NOT NULL CHECK (new_state IN ('new', 'review')),
    new_repetitions INTEGER NOT NULL DEFAULT 0,
    new_lapses INTEGER NOT NULL DEFAULT 0,
    new_stability REAL NOT NULL DEFAULT 2.5,
    new_difficulty REAL NOT NULL DEFAULT 5.0,
    old_interval_minutes INTEGER NOT NULL,
    new_interval_minutes INTEGER NOT NULL,
    old_due_at TEXT NOT NULL,
    new_due_at TEXT NOT NULL,
    elapsed_days REAL NOT NULL,
    retrievability REAL NOT NULL,
    request_retention REAL NOT NULL,
    profile TEXT NOT NULL DEFAULT 'STANDARD' CHECK (profile IN ('INTENSIVE', 'STANDARD')),
    maximum_interval_days INTEGER NOT NULL,
    min_minutes INTEGER NOT NULL,
    fsrs_weights_version TEXT NOT NULL,
    scheduler_version TEXT NOT NULL,
    note_model_id TEXT,
    card_template_id TEXT,
    content_hash TEXT,
    client TEXT,
    FOREIGN KEY (flashcard_id) REFERENCES flashcards(id)
  );

  -- Create indexes
  CREATE INDEX IF NOT EXISTS idx_flashcards_deck_id ON flashcards(deck_id);
  CREATE INDEX IF NOT EXISTS idx_flashcards_due_date ON flashcards(due_date);
  CREATE INDEX IF NOT EXISTS idx_review_logs_flashcard_id ON review_logs(flashcard_id);
  CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);

  -- Set schema version
  PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};

  COMMIT;
  PRAGMA foreign_keys = ON;
`;

function getColumnNames(db: Database, tableName: string): string[] {
  try {
    const stmt = db.prepare(`PRAGMA table_info(${tableName})`);
    const columns: string[] = [];
    while (stmt.step()) {
      const row = stmt.get();
      columns.push(row[1] as string); // column name is at index 1
    }
    stmt.free();
    return columns;
  } catch {
    return [];
  }
}

export function buildMigrationSQL(db: Database): string {
  const decksColumns = getColumnNames(db, "decks");
  const flashcardsColumns = getColumnNames(db, "flashcards");
  const reviewLogsColumns = getColumnNames(db, "review_logs");

  // Build decks migration
  const decksSelect = [
    "id",
    "name",
    decksColumns.includes("filepath") ? "filepath" : `'' as filepath`,
    "tag",
    "last_reviewed",
    decksColumns.includes("config")
      ? "config"
      : `'{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date","fsrs":{"requestRetention":0.9,"profile":"STANDARD"}}' as config`,
    decksColumns.includes("created") ? "created" : `datetime('now') as created`,
    decksColumns.includes("modified")
      ? "modified"
      : `datetime('now') as modified`,
  ].join(", ");

  // Build flashcards migration
  const flashcardsSelect = [
    "id",
    "deck_id",
    "front",
    "back",
    flashcardsColumns.includes("type") ? "type" : `'header-paragraph' as type`,
    flashcardsColumns.includes("source_file")
      ? "source_file"
      : `'' as source_file`,
    flashcardsColumns.includes("content_hash")
      ? "content_hash"
      : `'' as content_hash`,
    "header_level",
    flashcardsColumns.includes("state") ? "state" : `'new' as state`,
    flashcardsColumns.includes("due_date")
      ? "due_date"
      : `datetime('now') as due_date`,
    flashcardsColumns.includes("interval") ? "interval" : `0 as interval`,
    flashcardsColumns.includes("repetitions")
      ? "repetitions"
      : `0 as repetitions`,
    flashcardsColumns.includes("difficulty")
      ? "difficulty"
      : `5.0 as difficulty`,
    flashcardsColumns.includes("stability") ? "stability" : `0 as stability`,
    flashcardsColumns.includes("lapses") ? "lapses" : `0 as lapses`,
    "last_reviewed",
    "created",
    "modified",
  ].join(", ");

  // Build review_logs migration
  const reviewLogsSelect = [
    "id",
    "flashcard_id",
    reviewLogsColumns.includes("last_reviewed_at")
      ? "last_reviewed_at"
      : `datetime('now') as last_reviewed_at`,
    reviewLogsColumns.includes("shown_at") ? "shown_at" : "NULL as shown_at",
    reviewLogsColumns.includes("reviewed_at")
      ? "reviewed_at"
      : `datetime('now') as reviewed_at`,
    reviewLogsColumns.includes("rating") ? "rating" : `3 as rating`,
    reviewLogsColumns.includes("rating_label")
      ? "rating_label"
      : `'good' as rating_label`,
    reviewLogsColumns.includes("time_elapsed_ms")
      ? "time_elapsed_ms"
      : "NULL as time_elapsed_ms",
    reviewLogsColumns.includes("old_state")
      ? "old_state"
      : `'new' as old_state`,
    reviewLogsColumns.includes("old_repetitions")
      ? "old_repetitions"
      : `0 as old_repetitions`,
    reviewLogsColumns.includes("old_lapses") ? "old_lapses" : `0 as old_lapses`,
    reviewLogsColumns.includes("old_stability")
      ? "old_stability"
      : `0 as old_stability`,
    reviewLogsColumns.includes("old_difficulty")
      ? "old_difficulty"
      : `5.0 as old_difficulty`,
    reviewLogsColumns.includes("new_state")
      ? "new_state"
      : `'review' as new_state`,
    reviewLogsColumns.includes("new_repetitions")
      ? "new_repetitions"
      : `1 as new_repetitions`,
    reviewLogsColumns.includes("new_lapses") ? "new_lapses" : `0 as new_lapses`,
    reviewLogsColumns.includes("new_stability")
      ? "new_stability"
      : `2.5 as new_stability`,
    reviewLogsColumns.includes("new_difficulty")
      ? "new_difficulty"
      : `5.0 as new_difficulty`,
    reviewLogsColumns.includes("old_interval_minutes")
      ? "old_interval_minutes"
      : `0 as old_interval_minutes`,
    reviewLogsColumns.includes("new_interval_minutes")
      ? "new_interval_minutes"
      : `1440 as new_interval_minutes`,
    reviewLogsColumns.includes("old_due_at")
      ? "old_due_at"
      : `datetime('now') as old_due_at`,
    reviewLogsColumns.includes("new_due_at")
      ? "new_due_at"
      : `datetime('now', '+1 day') as new_due_at`,
    reviewLogsColumns.includes("elapsed_days")
      ? "elapsed_days"
      : `1.0 as elapsed_days`,
    reviewLogsColumns.includes("retrievability")
      ? "retrievability"
      : `0.9 as retrievability`,
    reviewLogsColumns.includes("request_retention")
      ? "request_retention"
      : `0.9 as request_retention`,
    reviewLogsColumns.includes("profile") ? "profile" : `'STANDARD' as profile`,
    reviewLogsColumns.includes("maximum_interval_days")
      ? "maximum_interval_days"
      : `36500 as maximum_interval_days`,
    reviewLogsColumns.includes("min_minutes")
      ? "min_minutes"
      : `1 as min_minutes`,
    reviewLogsColumns.includes("fsrs_weights_version")
      ? "fsrs_weights_version"
      : `'1.0' as fsrs_weights_version`,
    reviewLogsColumns.includes("scheduler_version")
      ? "scheduler_version"
      : `'1.0' as scheduler_version`,
    reviewLogsColumns.includes("note_model_id")
      ? "note_model_id"
      : "NULL as note_model_id",
    reviewLogsColumns.includes("card_template_id")
      ? "card_template_id"
      : "NULL as card_template_id",
    reviewLogsColumns.includes("content_hash")
      ? "content_hash"
      : "NULL as content_hash",
    reviewLogsColumns.includes("client") ? "client" : "NULL as client",
  ].join(", ");

  return `
    PRAGMA foreign_keys = OFF;
    BEGIN;

    -- Create new tables
    CREATE TABLE decks_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filepath TEXT NOT NULL UNIQUE,
      tag TEXT NOT NULL,
      last_reviewed TEXT,
      config TEXT NOT NULL DEFAULT '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date","fsrs":{"requestRetention":0.9,"profile":"STANDARD"}}',
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );

    CREATE TABLE flashcards_new (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('header-paragraph', 'table')),
      source_file TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      header_level INTEGER CHECK (header_level >= 1 AND header_level <= 6),
      state TEXT NOT NULL CHECK (state IN ('new', 'review')),
      due_date TEXT NOT NULL,
      interval REAL NOT NULL,
      repetitions INTEGER NOT NULL DEFAULT 0,
      difficulty REAL NOT NULL DEFAULT 5.0,
      stability REAL NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      last_reviewed TEXT,
      created TEXT NOT NULL,
      modified TEXT NOT NULL,
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE review_logs_new (
      id TEXT PRIMARY KEY,
      flashcard_id TEXT NOT NULL,
      last_reviewed_at TEXT NOT NULL,
      shown_at TEXT,
      reviewed_at TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating IN (1, 2, 3, 4)),
      rating_label TEXT NOT NULL CHECK (rating_label IN ('again', 'hard', 'good', 'easy')),
      time_elapsed_ms INTEGER,
      old_state TEXT NOT NULL CHECK (old_state IN ('new', 'review')),
      old_repetitions INTEGER NOT NULL DEFAULT 0,
      old_lapses INTEGER NOT NULL DEFAULT 0,
      old_stability REAL NOT NULL DEFAULT 0,
      old_difficulty REAL NOT NULL DEFAULT 5.0,
      new_state TEXT NOT NULL CHECK (new_state IN ('new', 'review')),
      new_repetitions INTEGER NOT NULL DEFAULT 0,
      new_lapses INTEGER NOT NULL DEFAULT 0,
      new_stability REAL NOT NULL DEFAULT 2.5,
      new_difficulty REAL NOT NULL DEFAULT 5.0,
      old_interval_minutes INTEGER NOT NULL,
      new_interval_minutes INTEGER NOT NULL,
      old_due_at TEXT NOT NULL,
      new_due_at TEXT NOT NULL,
      elapsed_days REAL NOT NULL,
      retrievability REAL NOT NULL,
      request_retention REAL NOT NULL,
      profile TEXT NOT NULL DEFAULT 'STANDARD' CHECK (profile IN ('INTENSIVE', 'STANDARD')),
      maximum_interval_days INTEGER NOT NULL,
      min_minutes INTEGER NOT NULL,
      fsrs_weights_version TEXT NOT NULL,
      scheduler_version TEXT NOT NULL,
      note_model_id TEXT,
      card_template_id TEXT,
      content_hash TEXT,
      client TEXT,
      FOREIGN KEY (flashcard_id) REFERENCES flashcards(id)
    );

    -- Copy data with dynamic column mapping
    INSERT OR IGNORE INTO decks_new (id, name, filepath, tag, last_reviewed, config, created, modified)
    SELECT ${decksSelect} FROM decks WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='decks');

    INSERT OR IGNORE INTO flashcards_new (id, deck_id, front, back, type, source_file, content_hash, header_level, state, due_date, interval, repetitions, difficulty, stability, lapses, last_reviewed, created, modified)
    SELECT ${flashcardsSelect} FROM flashcards WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='flashcards');

    INSERT OR IGNORE INTO review_logs_new (id, flashcard_id, last_reviewed_at, shown_at, reviewed_at, rating, rating_label, time_elapsed_ms, old_state, old_repetitions, old_lapses, old_stability, old_difficulty, new_state, new_repetitions, new_lapses, new_stability, new_difficulty, old_interval_minutes, new_interval_minutes, old_due_at, new_due_at, elapsed_days, retrievability, request_retention, profile, maximum_interval_days, min_minutes, fsrs_weights_version, scheduler_version, note_model_id, card_template_id, content_hash, client)
    SELECT ${reviewLogsSelect} FROM review_logs WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='review_logs');

    -- Drop old tables
    DROP TABLE IF EXISTS review_logs;
    DROP TABLE IF EXISTS flashcards;
    DROP TABLE IF EXISTS decks;

    -- Rename new tables
    ALTER TABLE decks_new RENAME TO decks;
    ALTER TABLE flashcards_new RENAME TO flashcards;
    ALTER TABLE review_logs_new RENAME TO review_logs;

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_flashcards_deck_id ON flashcards(deck_id);
    CREATE INDEX IF NOT EXISTS idx_flashcards_due_date ON flashcards(due_date);
    CREATE INDEX IF NOT EXISTS idx_review_logs_flashcard_id ON review_logs(flashcard_id);
    CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);

    -- Set schema version
    PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};

    COMMIT;
    PRAGMA foreign_keys = ON;
  `;
}

// Migration helper functions

// SQL Query Constants
export const SQL_QUERIES = {
  // Deck operations
  INSERT_DECK: `
    INSERT OR REPLACE INTO decks (
      id, name, filepath, tag, last_reviewed, config, created, modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,

  GET_DECK_BY_TAG: `SELECT * FROM decks WHERE tag = ?`,

  GET_DECK_BY_FILEPATH: `SELECT * FROM decks WHERE filepath = ?`,

  GET_DECK_BY_ID: `SELECT * FROM decks WHERE id = ?`,

  GET_ALL_DECKS: `SELECT * FROM decks ORDER BY name`,

  UPDATE_DECK_TIMESTAMP: `
    UPDATE decks
    SET modified = ?
    WHERE id = ?
  `,

  UPDATE_DECK_LAST_REVIEWED: `
    UPDATE decks
    SET last_reviewed = ?, modified = ?
    WHERE id = ?
  `,

  RENAME_DECK: `
    UPDATE decks
    SET id = ?, name = ?, filepath = ?, modified = ?
    WHERE id = ?
  `,

  DELETE_DECK_BY_FILEPATH: `DELETE FROM decks WHERE filepath = ?`,

  DELETE_DECK: `DELETE FROM decks WHERE id = ?`,

  // Flashcard operations
  INSERT_FLASHCARD: `
    INSERT OR REPLACE INTO flashcards (
      id, deck_id, front, back, type, source_file, content_hash,
      header_level, state, due_date, interval, repetitions,
      difficulty, stability, lapses, last_reviewed, created, modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  DELETE_FLASHCARD: `DELETE FROM flashcards WHERE id = ?`,

  UPDATE_FLASHCARD_DECK_IDS: `
    UPDATE flashcards SET deck_id = ? WHERE deck_id = ?
  `,

  GET_FLASHCARDS_BY_DECK: `SELECT * FROM flashcards WHERE deck_id = ? ORDER BY created`,

  GET_DUE_FLASHCARDS: `SELECT * FROM flashcards WHERE deck_id = ? AND due_date <= ? ORDER BY due_date`,

  DELETE_FLASHCARDS_BY_FILE: `DELETE FROM flashcards WHERE source_file = ?`,

  GET_NEW_CARDS_FOR_REVIEW: `
    SELECT * FROM flashcards
    WHERE deck_id = ? AND due_date <= ? AND state = 'new'
    ORDER BY due_date
  `,

  GET_REVIEW_CARDS_FOR_REVIEW: `
    SELECT * FROM flashcards
    WHERE deck_id = ? AND due_date <= ? AND state = 'review'
    ORDER BY due_date
  `,

  // Review log operations
  INSERT_REVIEW_LOG: `
    INSERT INTO review_logs (
      id, flashcard_id, last_reviewed_at, shown_at, reviewed_at,
      rating, rating_label, time_elapsed_ms,
      old_state, old_repetitions, old_lapses, old_stability, old_difficulty,
      new_state, new_repetitions, new_lapses, new_stability, new_difficulty,
      old_interval_minutes, new_interval_minutes, old_due_at, new_due_at,
      elapsed_days, retrievability,
      request_retention, profile, maximum_interval_days, min_minutes,
      fsrs_weights_version, scheduler_version,
      note_model_id, card_template_id, content_hash, client
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  GET_LATEST_REVIEW_LOG: `
    SELECT
      rl.id, rl.flashcard_id, rl.last_reviewed_at, rl.shown_at, rl.reviewed_at,
      rl.rating, rl.rating_label, rl.time_elapsed_ms,
      rl.old_state, rl.old_repetitions, rl.old_lapses, rl.old_stability, rl.old_difficulty,
      rl.new_state, rl.new_repetitions, rl.new_lapses, rl.new_stability, rl.new_difficulty,
      rl.old_interval_minutes, rl.new_interval_minutes, rl.old_due_at, rl.new_due_at,
      rl.elapsed_days, rl.retrievability,
      rl.request_retention, rl.profile, rl.maximum_interval_days, rl.min_minutes,
      rl.fsrs_weights_version, rl.scheduler_version,
      rl.note_model_id, rl.card_template_id, rl.content_hash, rl.client
    FROM review_logs rl
    WHERE rl.flashcard_id = ?
    ORDER BY rl.reviewed_at DESC
    LIMIT 1
  `,

  // Daily review counts
  COUNT_NEW_CARDS_TODAY: `
    SELECT COUNT(*) as count FROM review_logs rl
    JOIN flashcards f ON rl.flashcard_id = f.id
    WHERE f.deck_id = ?
      AND rl.reviewed_at >= ?
      AND rl.reviewed_at <= ?
      AND (rl.old_interval_minutes = 0 OR f.repetitions = 1)
  `,

  COUNT_REVIEW_CARDS_TODAY: `
    SELECT COUNT(*) as count FROM review_logs rl
    JOIN flashcards f ON rl.flashcard_id = f.id
    WHERE f.deck_id = ?
      AND rl.reviewed_at >= ? AND rl.reviewed_at <= ?
      AND rl.old_interval_minutes > 0
  `,

  // Statistics queries
  COUNT_NEW_CARDS: `
    SELECT COUNT(*) FROM flashcards
    WHERE deck_id = ? AND state = 'new' AND due_date <= ?
  `,

  COUNT_DUE_CARDS: `
    SELECT COUNT(*) FROM flashcards
    WHERE deck_id = ? AND state = 'review' AND due_date <= ?
  `,

  COUNT_TOTAL_CARDS: `
    SELECT COUNT(*) FROM flashcards WHERE deck_id = ?
  `,

  GET_REVIEW_COUNTS_BY_DATE: `
    SELECT DATE(reviewed_at) as review_date, COUNT(*) as count
    FROM review_logs
    WHERE reviewed_at >= ? AND reviewed_at <= ?
    GROUP BY DATE(reviewed_at)
    ORDER BY review_date
  `,

  // Migration helpers
  CHECK_EXISTING_TABLES: `
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ('decks', 'flashcards', 'review_logs')
  `,

  // Statistics queries for overall stats
  GET_DAILY_STATS: `
    SELECT
      DATE(reviewed_at) as date,
      COUNT(*) as reviews,
      AVG(time_elapsed_ms / 1000.0) as avg_time_seconds,
      SUM(CASE WHEN old_repetitions = 0 THEN 1 ELSE 0 END) as new_cards,
      SUM(CASE WHEN old_repetitions > 0 AND old_repetitions < 3 THEN 1 ELSE 0 END) as learning_cards,
      SUM(CASE WHEN old_repetitions >= 3 THEN 1 ELSE 0 END) as review_cards,
      AVG(CASE WHEN rating >= 3 THEN 1.0 ELSE 0.0 END) as correct_rate
    FROM review_logs rl
    WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ?
    GROUP BY DATE(reviewed_at)
    ORDER BY date
  `,

  GET_DAILY_STATS_OVERALL: `
    SELECT
      DATE(reviewed_at) as date,
      COUNT(*) as reviews,
      COUNT(CASE WHEN rating_label != 'again' THEN 1 END) as correct,
      COUNT(CASE WHEN f.state = 'new' THEN 1 END) as new_cards,
      COUNT(CASE WHEN f.state = 'review' THEN 1 END) as review_cards
    FROM review_logs rl
    JOIN flashcards f ON rl.flashcard_id = f.id
    WHERE DATE(reviewed_at) >= DATE(?)
    GROUP BY DATE(reviewed_at)
    ORDER BY date DESC
  `,

  GET_CARD_STATS: `
    SELECT
      CASE
        WHEN f.state = 'new' THEN 'new'
        WHEN f.state = 'review' AND f.interval > 30240 THEN 'mature'
        ELSE 'review'
      END as card_type,
      COUNT(*) as count
    FROM flashcards f
    GROUP BY card_type
  `,

  GET_ANSWER_BUTTON_STATS: `
    SELECT
      rl.rating_label,
      COUNT(*) as count
    FROM review_logs rl
    WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ?
    GROUP BY rl.rating_label
  `,

  GET_INTERVAL_DISTRIBUTION: `
    SELECT
      CASE
        WHEN f.interval < 1440 THEN '<1d'
        WHEN f.interval < 10080 THEN '1-7d'
        WHEN f.interval < 43200 THEN '1-4w'
        WHEN f.interval < 129600 THEN '1-3m'
        WHEN f.interval < 525600 THEN '3-12m'
        ELSE '>1y'
      END as interval_range,
      COUNT(*) as count
    FROM flashcards f
    WHERE f.state = 'review'
    GROUP BY interval_range
    ORDER BY
      CASE interval_range
        WHEN '<1d' THEN 1
        WHEN '1-7d' THEN 2
        WHEN '1-4w' THEN 3
        WHEN '1-3m' THEN 4
        WHEN '3-12m' THEN 5
        WHEN '>1y' THEN 6
      END
  `,

  GET_FORECAST_DUE_COUNT: `
    SELECT COUNT(*) as due_count
    FROM flashcards f
    WHERE DATE(f.due_date) = DATE(?)
  `,

  GET_PACE_STATS: `
    SELECT
      AVG(rl.time_elapsed_ms / 1000.0) as avg_pace,
      SUM(rl.time_elapsed_ms / 1000.0) as total_time
    FROM review_logs rl
    WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ?
      AND rl.time_elapsed_ms IS NOT NULL
      AND rl.time_elapsed_ms > 0
  `,
};
