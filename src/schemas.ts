import { Database } from "sql.js";

// Current Schema Version
export const CURRENT_SCHEMA_VERSION = 2;

// SQL Table Creation Schema
export const CREATE_TABLES_SQL = `
  PRAGMA foreign_keys = OFF;
  BEGIN;

  -- Decks table
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

  -- Flashcards table
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

  -- Review logs table
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
    FOREIGN KEY (flashcard_id) REFERENCES flashcards(id) ON DELETE CASCADE
  );

  -- Copy existing data if tables exist
  INSERT OR IGNORE INTO decks_new SELECT * FROM decks WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='decks');
  INSERT OR IGNORE INTO flashcards_new SELECT * FROM flashcards WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='flashcards');
  INSERT OR IGNORE INTO review_logs_new SELECT * FROM review_logs WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='review_logs');

  -- Drop old tables if they exist
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

// Deck SQL Queries
export const SQL_QUERIES = {
  // Deck operations
  INSERT_DECK: `
    INSERT OR REPLACE INTO decks (
      id, name, filepath, tag, last_reviewed, config, created, modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,

  GET_DECK_BY_TAG: `
    SELECT * FROM decks WHERE tag = ?
  `,

  GET_DECK_BY_FILEPATH: `
    SELECT * FROM decks WHERE filepath = ?
  `,

  GET_DECK_BY_ID: `
    SELECT * FROM decks WHERE id = ?
  `,

  GET_ALL_DECKS: `
    SELECT * FROM decks ORDER BY name
  `,

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

  DELETE_DECK_BY_FILEPATH: `
    DELETE FROM decks WHERE filepath = ?
  `,

  DELETE_DECK: `
    DELETE FROM decks WHERE id = ?
  `,

  // Flashcard operations
  INSERT_FLASHCARD: `
    INSERT OR REPLACE INTO flashcards (
      id, deck_id, front, back, type, source_file, content_hash,
      header_level, state, due_date, interval, repetitions,
      difficulty, stability, lapses, last_reviewed, created, modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  DELETE_FLASHCARD: `
    DELETE FROM flashcards WHERE id = ?
  `,

  UPDATE_FLASHCARD_DECK_IDS: `
    UPDATE flashcards SET deck_id = ? WHERE deck_id = ?
  `,

  GET_FLASHCARDS_BY_DECK: `
    SELECT * FROM flashcards WHERE deck_id = ? ORDER BY created
  `,

  GET_DUE_FLASHCARDS: `
    SELECT * FROM flashcards
    WHERE deck_id = ? AND due_date <= ?
    ORDER BY due_date
  `,

  DELETE_FLASHCARDS_BY_FILE: `
    DELETE FROM flashcards WHERE source_file = ?
  `,

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
      AND rl.reviewed_at >= ? AND rl.reviewed_at <= ?
      AND rl.old_repetitions = 0
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

  GET_CARD_STATS: `
    SELECT
      f.state,
      COUNT(*) as count,
      AVG(f.repetitions) as avg_repetitions
    FROM flashcards f
    GROUP BY f.state
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

// Migration helper functions
export function getCurrentSchemaVersion(db: Database): number {
  try {
    const stmt = db.prepare(`PRAGMA user_version`);
    let version = 0;
    if (stmt.step()) {
      const row = stmt.get();
      version = Number(row[0]) || 0;
    }
    stmt.free();
    return version;
  } catch (error) {
    return 0;
  }
}

export function needsMigration(db: Database): boolean {
  return getCurrentSchemaVersion(db) !== CURRENT_SCHEMA_VERSION;
}

export function migrate(
  db: Database,
  debugLog?: (message: string) => void,
): void {
  const log = debugLog || (() => {});
  const currentVersion = getCurrentSchemaVersion(db);

  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    log(`Schema is already up to date (version ${CURRENT_SCHEMA_VERSION})`);
    return;
  }

  log(
    `Migrating schema from version ${currentVersion} to ${CURRENT_SCHEMA_VERSION}`,
  );

  try {
    db.run(CREATE_TABLES_SQL);
    log(`✅ Migration completed successfully`);
  } catch (error) {
    log(`❌ Migration failed: ${error}`);
    throw new Error(`Migration failed: ${error}`);
  }
}
