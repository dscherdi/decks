import type { Database } from "sql.js";

// Current Schema Version
export const CURRENT_SCHEMA_VERSION = 14;

// SQL Table Creation Schema - Used when database file doesn't exist
export const CREATE_TABLES_SQL = `
  PRAGMA foreign_keys = OFF;
  BEGIN;

  -- Deck profiles table
  CREATE TABLE IF NOT EXISTS deckprofiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    has_new_cards_limit_enabled INTEGER NOT NULL DEFAULT 0,
    new_cards_per_day INTEGER NOT NULL DEFAULT 20,
    has_review_cards_limit_enabled INTEGER NOT NULL DEFAULT 0,
    review_cards_per_day INTEGER NOT NULL DEFAULT 100,
    header_level INTEGER NOT NULL DEFAULT 2,
    review_order TEXT NOT NULL DEFAULT 'due-date' CHECK (review_order IN ('due-date', 'random')),
    learning_steps TEXT NOT NULL DEFAULT '1m',
    relearning_steps TEXT NOT NULL DEFAULT '10m',
    fsrs_request_retention REAL NOT NULL DEFAULT 0.9,
    fsrs_profile TEXT NOT NULL DEFAULT 'STANDARD' CHECK (fsrs_profile IN ('INTENSIVE', 'STANDARD')),
    cloze_enabled INTEGER NOT NULL DEFAULT 1,
    cloze_show_context TEXT NOT NULL DEFAULT 'hidden' CHECK (cloze_show_context IN ('open', 'hidden')),
    is_default INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL,
    modified TEXT NOT NULL
  );

  -- Profile tag mappings table
  CREATE TABLE IF NOT EXISTS profile_tag_mappings (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    created TEXT NOT NULL,
    UNIQUE(tag)
  );

  -- Decks table
  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filepath TEXT NOT NULL UNIQUE,
    tag TEXT NOT NULL,
    last_reviewed TEXT,
    profile_id TEXT NOT NULL,
    created TEXT NOT NULL,
    modified TEXT NOT NULL
  );

  -- Flashcards table
  CREATE TABLE IF NOT EXISTS flashcards (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('header-paragraph', 'table', 'cloze', 'image-occlusion')),
    source_file TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    breadcrumb TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    cloze_text TEXT,
    cloze_order INTEGER,

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

  -- Review sessions table
  CREATE TABLE IF NOT EXISTS review_sessions (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    goal_total INTEGER NOT NULL,
    done_unique INTEGER NOT NULL DEFAULT 0
  );

  -- Review logs table
  CREATE TABLE IF NOT EXISTS review_logs (
    id TEXT PRIMARY KEY,
    flashcard_id TEXT NOT NULL,
    session_id TEXT,
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
    client TEXT
  );

  -- Custom decks table
  CREATE TABLE IF NOT EXISTS custom_decks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    deck_type TEXT NOT NULL DEFAULT 'manual',
    filter_definition TEXT,
    last_reviewed TEXT,
    created TEXT NOT NULL,
    modified TEXT NOT NULL
  );

  -- Custom deck cards junction table (many-to-many)
  CREATE TABLE IF NOT EXISTS custom_deck_cards (
    id TEXT PRIMARY KEY,
    custom_deck_id TEXT NOT NULL,
    flashcard_id TEXT NOT NULL,
    created TEXT NOT NULL,
    UNIQUE(custom_deck_id, flashcard_id),
    FOREIGN KEY (custom_deck_id) REFERENCES custom_decks(id) ON DELETE CASCADE,
    FOREIGN KEY (flashcard_id) REFERENCES flashcards(id) ON DELETE CASCADE
  );

  -- Insert DEFAULT profile
  INSERT OR IGNORE INTO deckprofiles (
    id, name,
    has_new_cards_limit_enabled, new_cards_per_day,
    has_review_cards_limit_enabled, review_cards_per_day,
    header_level, review_order,
    learning_steps, relearning_steps,
    fsrs_request_retention, fsrs_profile,
    is_default, created, modified
  ) VALUES (
    'profile_default',
    'DEFAULT',
    0, 20,
    0, 100,
    2, 'due-date',
    '1m', '10m',
    0.9, 'STANDARD',
    1,
    datetime('now'),
    datetime('now')
  );

  -- Create indexes
  CREATE INDEX IF NOT EXISTS idx_deckprofiles_name ON deckprofiles(name);
  CREATE INDEX IF NOT EXISTS idx_deckprofiles_is_default ON deckprofiles(is_default);
  CREATE INDEX IF NOT EXISTS idx_profile_tag_mappings_profile ON profile_tag_mappings(profile_id);
  CREATE INDEX IF NOT EXISTS idx_profile_tag_mappings_tag ON profile_tag_mappings(tag);
  CREATE INDEX IF NOT EXISTS idx_decks_profile_id ON decks(profile_id);
  CREATE INDEX IF NOT EXISTS idx_decks_tag ON decks(tag);
  CREATE INDEX IF NOT EXISTS idx_flashcards_deck_id ON flashcards(deck_id);
  CREATE INDEX IF NOT EXISTS idx_flashcards_due_date ON flashcards(due_date);
  CREATE INDEX IF NOT EXISTS idx_review_sessions_deck_id ON review_sessions(deck_id);
  CREATE INDEX IF NOT EXISTS idx_review_logs_flashcard_id ON review_logs(flashcard_id);
  CREATE INDEX IF NOT EXISTS idx_review_logs_session_id ON review_logs(session_id);
  CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);

  -- Forecast-optimized indexes
  CREATE INDEX IF NOT EXISTS idx_flashcards_deck_due ON flashcards(deck_id, due_date);
  CREATE INDEX IF NOT EXISTS idx_review_logs_join ON review_logs(flashcard_id, reviewed_at);

  -- Custom deck indexes
  CREATE INDEX IF NOT EXISTS idx_custom_deck_cards_deck ON custom_deck_cards(custom_deck_id);
  CREATE INDEX IF NOT EXISTS idx_custom_deck_cards_card ON custom_deck_cards(flashcard_id);

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
  const reviewLogsColumns = getColumnNames(db, "review_logs");
  const reviewLogsExists = reviewLogsColumns.length > 0;
  const deckprofilesColumns = getColumnNames(db, "deckprofiles");
  const needsLearningSteps = deckprofilesColumns.length > 0 && !deckprofilesColumns.includes("learning_steps");
  const needsCloze = deckprofilesColumns.length > 0 && !deckprofilesColumns.includes("cloze_enabled");
  const customDecksColumns = getColumnNames(db, "custom_decks");
  const needsDeckType = customDecksColumns.length > 0 && !customDecksColumns.includes("deck_type");

  // Helper: pick current column, fall back to old renamed column, then default
  const col = (
    columns: string[],
    currentName: string,
    oldName: string | null,
    fallback: string
  ): string => {
    if (columns.includes(currentName)) return currentName;
    if (oldName && columns.includes(oldName)) return `${oldName} as ${currentName}`;
    return `${fallback} as ${currentName}`;
  };

  // Build review_logs migration (with fallbacks for renamed columns)
  const rl = reviewLogsColumns;
  const reviewLogsSelect = [
    "id",
    "flashcard_id",
    col(rl, "session_id", null, "NULL"),
    col(rl, "last_reviewed_at", null, "datetime('now')"),
    col(rl, "shown_at", null, "NULL"),
    col(rl, "reviewed_at", null, "datetime('now')"),
    col(rl, "rating", null, "3"),
    col(rl, "rating_label", null, "'good'"),
    col(rl, "time_elapsed_ms", "time_elapsed", "NULL"),
    col(rl, "old_state", null, "'new'"),
    col(rl, "old_repetitions", null, "0"),
    col(rl, "old_lapses", null, "0"),
    col(rl, "old_stability", null, "0"),
    col(rl, "old_difficulty", null, "5.0"),
    col(rl, "new_state", null, "'review'"),
    col(rl, "new_repetitions", null, "1"),
    col(rl, "new_lapses", null, "0"),
    col(rl, "new_stability", null, "2.5"),
    col(rl, "new_difficulty", null, "5.0"),
    col(rl, "old_interval_minutes", "old_interval", "0"),
    col(rl, "new_interval_minutes", "new_interval", "1440"),
    col(rl, "old_due_at", "old_due_date", "datetime('now')"),
    col(rl, "new_due_at", "new_due_date", "datetime('now', '+1 day')"),
    col(rl, "elapsed_days", null, "1.0"),
    col(rl, "retrievability", null, "0.9"),
    col(rl, "request_retention", null, "0.9"),
    col(rl, "profile", null, "'STANDARD'"),
    col(rl, "maximum_interval_days", null, "36500"),
    col(rl, "min_minutes", null, "1"),
    col(rl, "fsrs_weights_version", "weights_version", "'1.0'"),
    col(rl, "scheduler_version", null, "'1.0'"),
    col(rl, "note_model_id", null, "NULL"),
    col(rl, "card_template_id", null, "NULL"),
    col(rl, "content_hash", null, "NULL"),
    col(rl, "client", null, "NULL"),
  ].join(", ");

  return `
    PRAGMA foreign_keys = OFF;
    BEGIN;

    -- Preserve deckprofiles (schema unchanged, CREATE IF NOT EXISTS keeps existing)
    CREATE TABLE IF NOT EXISTS deckprofiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      has_new_cards_limit_enabled INTEGER NOT NULL DEFAULT 0,
      new_cards_per_day INTEGER NOT NULL DEFAULT 20,
      has_review_cards_limit_enabled INTEGER NOT NULL DEFAULT 0,
      review_cards_per_day INTEGER NOT NULL DEFAULT 100,
      header_level INTEGER NOT NULL DEFAULT 2,
      review_order TEXT NOT NULL DEFAULT 'due-date' CHECK (review_order IN ('due-date', 'random')),
      learning_steps TEXT NOT NULL DEFAULT '1m',
      relearning_steps TEXT NOT NULL DEFAULT '10m',
      fsrs_request_retention REAL NOT NULL DEFAULT 0.9,
      fsrs_profile TEXT NOT NULL DEFAULT 'STANDARD' CHECK (fsrs_profile IN ('INTENSIVE', 'STANDARD')),
      cloze_enabled INTEGER NOT NULL DEFAULT 0,
      cloze_show_context TEXT NOT NULL DEFAULT 'open' CHECK (cloze_show_context IN ('open', 'hidden')),
      is_default INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );

    ${needsLearningSteps ? `
    ALTER TABLE deckprofiles ADD COLUMN learning_steps TEXT NOT NULL DEFAULT '1m';
    ALTER TABLE deckprofiles ADD COLUMN relearning_steps TEXT NOT NULL DEFAULT '10m';
    UPDATE deckprofiles SET learning_steps = '1m' WHERE fsrs_profile = 'INTENSIVE';
    ` : ""}

    ${needsCloze ? `
    ALTER TABLE deckprofiles ADD COLUMN cloze_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE deckprofiles ADD COLUMN cloze_show_context TEXT NOT NULL DEFAULT 'open';
    ` : ""}

    INSERT OR IGNORE INTO deckprofiles (
      id, name,
      has_new_cards_limit_enabled, new_cards_per_day,
      has_review_cards_limit_enabled, review_cards_per_day,
      header_level, review_order,
      learning_steps, relearning_steps,
      fsrs_request_retention, fsrs_profile,
      is_default, created, modified
    ) VALUES (
      'profile_default',
      'DEFAULT',
      0, 20,
      0, 100,
      2, 'due-date',
      '1m', '10m',
      0.9, 'STANDARD',
      1,
      datetime('now'),
      datetime('now')
    );

    -- Preserve profile_tag_mappings (recreate with UNIQUE(tag) constraint)
    CREATE TABLE IF NOT EXISTS profile_tag_mappings (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      created TEXT NOT NULL
    );

    CREATE TABLE profile_tag_mappings_new (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      created TEXT NOT NULL,
      UNIQUE(tag)
    );

    INSERT OR IGNORE INTO profile_tag_mappings_new (id, profile_id, tag, created)
    SELECT id, profile_id, tag, created
    FROM profile_tag_mappings
    ORDER BY created DESC;

    DROP TABLE profile_tag_mappings;
    ALTER TABLE profile_tag_mappings_new RENAME TO profile_tag_mappings;

    -- Preserve review_sessions (schema stable, CREATE IF NOT EXISTS keeps existing)
    CREATE TABLE IF NOT EXISTS review_sessions (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      goal_total INTEGER NOT NULL,
      done_unique INTEGER NOT NULL DEFAULT 0
    );

    -- Migrate review_logs (column renames handled, JS-level table existence guard)
    CREATE TABLE review_logs_new (
      id TEXT PRIMARY KEY,
      flashcard_id TEXT NOT NULL,
      session_id TEXT,
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
      client TEXT
    );

    ${reviewLogsExists ? `INSERT OR IGNORE INTO review_logs_new (id, flashcard_id, session_id, last_reviewed_at, shown_at, reviewed_at, rating, rating_label, time_elapsed_ms, old_state, old_repetitions, old_lapses, old_stability, old_difficulty, new_state, new_repetitions, new_lapses, new_stability, new_difficulty, old_interval_minutes, new_interval_minutes, old_due_at, new_due_at, elapsed_days, retrievability, request_retention, profile, maximum_interval_days, min_minutes, fsrs_weights_version, scheduler_version, note_model_id, card_template_id, content_hash, client)
    SELECT ${reviewLogsSelect} FROM review_logs;` : ""}

    DROP TABLE IF EXISTS review_logs;
    ALTER TABLE review_logs_new RENAME TO review_logs;

    -- Drop and recreate decks/flashcards fresh (sync repopulates from vault)
    DROP TABLE IF EXISTS flashcards;
    DROP TABLE IF EXISTS decks;

    CREATE TABLE decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filepath TEXT NOT NULL UNIQUE,
      tag TEXT NOT NULL,
      last_reviewed TEXT,
      profile_id TEXT NOT NULL,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );

    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('header-paragraph', 'table', 'cloze', 'image-occlusion')),
      source_file TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      breadcrumb TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      cloze_text TEXT,
      cloze_order INTEGER,
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

    -- Custom decks table
    CREATE TABLE IF NOT EXISTS custom_decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      deck_type TEXT NOT NULL DEFAULT 'manual',
      filter_definition TEXT,
      last_reviewed TEXT,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );

    ${needsDeckType ? `
    ALTER TABLE custom_decks ADD COLUMN deck_type TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE custom_decks ADD COLUMN filter_definition TEXT;
    ` : ""}

    -- Custom deck cards junction table (many-to-many)
    CREATE TABLE IF NOT EXISTS custom_deck_cards (
      id TEXT PRIMARY KEY,
      custom_deck_id TEXT NOT NULL,
      flashcard_id TEXT NOT NULL,
      created TEXT NOT NULL,
      UNIQUE(custom_deck_id, flashcard_id),
      FOREIGN KEY (custom_deck_id) REFERENCES custom_decks(id) ON DELETE CASCADE,
      FOREIGN KEY (flashcard_id) REFERENCES flashcards(id) ON DELETE CASCADE
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_deckprofiles_name ON deckprofiles(name);
    CREATE INDEX IF NOT EXISTS idx_deckprofiles_is_default ON deckprofiles(is_default);
    CREATE INDEX IF NOT EXISTS idx_profile_tag_mappings_profile ON profile_tag_mappings(profile_id);
    CREATE INDEX IF NOT EXISTS idx_profile_tag_mappings_tag ON profile_tag_mappings(tag);
    CREATE INDEX IF NOT EXISTS idx_decks_profile_id ON decks(profile_id);
    CREATE INDEX IF NOT EXISTS idx_decks_tag ON decks(tag);
    CREATE INDEX IF NOT EXISTS idx_flashcards_deck_id ON flashcards(deck_id);
    CREATE INDEX IF NOT EXISTS idx_flashcards_due_date ON flashcards(due_date);
    CREATE INDEX IF NOT EXISTS idx_review_sessions_deck_id ON review_sessions(deck_id);
    CREATE INDEX IF NOT EXISTS idx_review_logs_flashcard_id ON review_logs(flashcard_id);
    CREATE INDEX IF NOT EXISTS idx_review_logs_session_id ON review_logs(session_id);
    CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);
    CREATE INDEX IF NOT EXISTS idx_flashcards_deck_due ON flashcards(deck_id, due_date);
    CREATE INDEX IF NOT EXISTS idx_review_logs_join ON review_logs(flashcard_id, reviewed_at);
    CREATE INDEX IF NOT EXISTS idx_custom_deck_cards_deck ON custom_deck_cards(custom_deck_id);
    CREATE INDEX IF NOT EXISTS idx_custom_deck_cards_card ON custom_deck_cards(flashcard_id);

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
      id, name, filepath, tag, last_reviewed, profile_id, created, modified
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

  GET_DECKS_BY_TAG: `SELECT * FROM decks WHERE tag = ? ORDER BY name`,

  // Profile operations
  INSERT_PROFILE: `
    INSERT INTO deckprofiles (
      id, name,
      has_new_cards_limit_enabled, new_cards_per_day,
      has_review_cards_limit_enabled, review_cards_per_day,
      header_level, review_order,
      learning_steps, relearning_steps,
      fsrs_request_retention, fsrs_profile,
      cloze_enabled, cloze_show_context,
      is_default, created, modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  GET_PROFILE_BY_ID: `
    SELECT id, name, has_new_cards_limit_enabled, new_cards_per_day,
      has_review_cards_limit_enabled, review_cards_per_day,
      header_level, review_order, learning_steps, relearning_steps,
      fsrs_request_retention, fsrs_profile,
      cloze_enabled, cloze_show_context,
      is_default, created, modified
    FROM deckprofiles WHERE id = ?
  `,

  GET_PROFILE_BY_NAME: `
    SELECT id, name, has_new_cards_limit_enabled, new_cards_per_day,
      has_review_cards_limit_enabled, review_cards_per_day,
      header_level, review_order, learning_steps, relearning_steps,
      fsrs_request_retention, fsrs_profile,
      cloze_enabled, cloze_show_context,
      is_default, created, modified
    FROM deckprofiles WHERE name = ?
  `,

  GET_ALL_PROFILES: `
    SELECT id, name, has_new_cards_limit_enabled, new_cards_per_day,
      has_review_cards_limit_enabled, review_cards_per_day,
      header_level, review_order, learning_steps, relearning_steps,
      fsrs_request_retention, fsrs_profile,
      cloze_enabled, cloze_show_context,
      is_default, created, modified
    FROM deckprofiles
    ORDER BY CASE WHEN is_default = 1 THEN 0 ELSE 1 END, name
  `,

  GET_DEFAULT_PROFILE: `
    SELECT id, name, has_new_cards_limit_enabled, new_cards_per_day,
      has_review_cards_limit_enabled, review_cards_per_day,
      header_level, review_order, learning_steps, relearning_steps,
      fsrs_request_retention, fsrs_profile,
      cloze_enabled, cloze_show_context,
      is_default, created, modified
    FROM deckprofiles WHERE is_default = 1 LIMIT 1
  `,

  UPDATE_PROFILE: `
    UPDATE deckprofiles SET
      name = ?,
      has_new_cards_limit_enabled = ?, new_cards_per_day = ?,
      has_review_cards_limit_enabled = ?, review_cards_per_day = ?,
      header_level = ?, review_order = ?,
      learning_steps = ?, relearning_steps = ?,
      fsrs_request_retention = ?, fsrs_profile = ?,
      cloze_enabled = ?, cloze_show_context = ?,
      modified = ?
    WHERE id = ?
  `,

  DELETE_PROFILE: `DELETE FROM deckprofiles WHERE id = ? AND is_default = 0`,

  COUNT_DECKS_USING_PROFILE: `
    SELECT COUNT(*) as count FROM decks WHERE profile_id = ?
  `,

  RESET_DECKS_TO_DEFAULT_PROFILE: `
    UPDATE decks SET profile_id = ?, modified = ? WHERE profile_id = ?
  `,

  GET_DECKS_BY_PROFILE: `
    SELECT * FROM decks WHERE profile_id = ? ORDER BY name
  `,

  // Profile tag mapping operations
  INSERT_PROFILE_TAG_MAPPING: `
    INSERT OR REPLACE INTO profile_tag_mappings (id, profile_id, tag, created)
    VALUES (?, ?, ?, ?)
  `,

  GET_TAG_MAPPINGS_FOR_PROFILE: `
    SELECT * FROM profile_tag_mappings WHERE profile_id = ?
  `,

  GET_ALL_TAG_MAPPINGS: `
    SELECT * FROM profile_tag_mappings
  `,

  GET_PROFILE_FOR_TAG: `
    SELECT * FROM profile_tag_mappings WHERE tag = ?
  `,

  DELETE_TAG_MAPPING: `
    DELETE FROM profile_tag_mappings WHERE id = ?
  `,

  DELETE_TAG_MAPPINGS_FOR_PROFILE: `
    DELETE FROM profile_tag_mappings WHERE profile_id = ?
  `,

  // Flashcard operations
  INSERT_FLASHCARD: `
    INSERT OR REPLACE INTO flashcards (
      id, deck_id, front, back, type, source_file, content_hash, breadcrumb, notes,
      cloze_text, cloze_order,
      state, due_date, interval, repetitions,
      difficulty, stability, lapses, last_reviewed, created, modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      id, flashcard_id, session_id, last_reviewed_at, shown_at, reviewed_at,
      rating, rating_label, time_elapsed_ms,
      old_state, old_repetitions, old_lapses, old_stability, old_difficulty,
      new_state, new_repetitions, new_lapses, new_stability, new_difficulty,
      old_interval_minutes, new_interval_minutes, old_due_at, new_due_at,
      elapsed_days, retrievability,
      request_retention, profile, maximum_interval_days, min_minutes,
      fsrs_weights_version, scheduler_version,
      note_model_id, card_template_id, content_hash, client
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      AND rl.reviewed_at >= datetime('now', 'start of day')
      AND rl.reviewed_at < datetime('now', 'start of day', '+1 day')
      AND (rl.old_interval_minutes = 0 OR f.repetitions = 1)
  `,

  COUNT_REVIEW_CARDS_TODAY: `
    SELECT COUNT(*) as count FROM review_logs rl
    JOIN flashcards f ON rl.flashcard_id = f.id
    WHERE f.deck_id = ?
      AND rl.reviewed_at >= datetime('now', 'start of day')
      AND rl.reviewed_at < datetime('now', 'start of day', '+1 day')
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

  // Optimized forecast queries with index-friendly SQL
  GET_SCHEDULED_DUE_BY_DAY: `
    SELECT substr(due_date,1,10) AS day, COUNT(*) AS c
    FROM flashcards
    WHERE deck_id = ? AND state='review'
      AND due_date >= ? AND due_date < ?
    GROUP BY day
    ORDER BY day
  `,

  GET_CURRENT_BACKLOG: `
    SELECT COUNT(*) AS n
    FROM flashcards
    WHERE deck_id = ? AND state='review' AND due_date < ?
  `,

  GET_DECK_REVIEW_COUNT_RANGE: `
    SELECT COUNT(*) AS n
    FROM review_logs rl
    JOIN flashcards f ON f.id = rl.flashcard_id
    WHERE f.deck_id = ?
      AND rl.reviewed_at >= ?
      AND rl.reviewed_at < ?
  `,

  // Migration helpers
  CHECK_EXISTING_TABLES: `
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ('decks', 'flashcards', 'review_logs')
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

  GET_PACE_STATS: `
    SELECT
      AVG(rl.time_elapsed_ms / 1000.0) as avg_pace,
      SUM(rl.time_elapsed_ms / 1000.0) as total_time
    FROM review_logs rl
    WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ?
      AND rl.time_elapsed_ms IS NOT NULL
      AND rl.time_elapsed_ms > 0
  `,

  // Review Session operations
  INSERT_REVIEW_SESSION: `
    INSERT INTO review_sessions (
      id, deck_id, started_at, ended_at, goal_total, done_unique
    ) VALUES (?, ?, ?, ?, ?, ?)
  `,

  GET_REVIEW_SESSION_BY_ID: `SELECT * FROM review_sessions WHERE id = ?`,

  UPDATE_REVIEW_SESSION_DONE_UNIQUE: `
    UPDATE review_sessions
    SET done_unique = ?
    WHERE id = ?
  `,

  UPDATE_REVIEW_SESSION_END: `
    UPDATE review_sessions
    SET ended_at = ?
    WHERE id = ?
  `,

  GET_ACTIVE_REVIEW_SESSION: `
    SELECT * FROM review_sessions
    WHERE deck_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `,

  CHECK_CARD_REVIEWED_IN_SESSION: `
    SELECT COUNT(*) as count
    FROM review_logs
    WHERE session_id = ? AND flashcard_id = ?
  `,

  RESET_DECK_FLASHCARDS: `
    UPDATE flashcards SET
      state = 'new',
      due_date = datetime('now'),
      interval = 0,
      repetitions = 0,
      difficulty = 5.0,
      stability = 0,
      lapses = 0,
      last_reviewed = NULL,
      modified = ?
    WHERE deck_id = ?
  `,

  DELETE_REVIEW_LOGS_FOR_DECK: `
    DELETE FROM review_logs
    WHERE flashcard_id IN (
      SELECT id FROM flashcards WHERE deck_id = ?
    )
  `,

  DELETE_REVIEW_SESSIONS_FOR_DECK: `
    DELETE FROM review_sessions WHERE deck_id = ?
  `,

  // Custom deck operations
  INSERT_CUSTOM_DECK: `
    INSERT INTO custom_decks (id, name, deck_type, filter_definition, last_reviewed, created, modified)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  GET_CUSTOM_DECK_BY_ID: `SELECT * FROM custom_decks WHERE id = ?`,

  GET_CUSTOM_DECK_BY_NAME: `SELECT * FROM custom_decks WHERE name = ?`,

  GET_ALL_CUSTOM_DECKS: `SELECT * FROM custom_decks ORDER BY name`,

  UPDATE_CUSTOM_DECK: `
    UPDATE custom_decks SET name = ?, filter_definition = ?, modified = ?
    WHERE id = ?
  `,

  UPDATE_CUSTOM_DECK_LAST_REVIEWED: `
    UPDATE custom_decks SET last_reviewed = ?, modified = ?
    WHERE id = ?
  `,

  DELETE_CUSTOM_DECK: `DELETE FROM custom_decks WHERE id = ?`,

  // Custom deck card membership operations
  INSERT_CUSTOM_DECK_CARD: `
    INSERT OR IGNORE INTO custom_deck_cards (id, custom_deck_id, flashcard_id, created)
    VALUES (?, ?, ?, ?)
  `,

  DELETE_CUSTOM_DECK_CARD: `
    DELETE FROM custom_deck_cards
    WHERE custom_deck_id = ? AND flashcard_id = ?
  `,

  DELETE_ALL_CUSTOM_DECK_CARDS: `
    DELETE FROM custom_deck_cards WHERE custom_deck_id = ?
  `,

  GET_FLASHCARDS_FOR_CUSTOM_DECK: `
    SELECT f.* FROM flashcards f
    INNER JOIN custom_deck_cards cdc ON f.id = cdc.flashcard_id
    WHERE cdc.custom_deck_id = ?
    ORDER BY f.created
  `,

  GET_CUSTOM_DECKS_FOR_FLASHCARD: `
    SELECT cd.* FROM custom_decks cd
    INNER JOIN custom_deck_cards cdc ON cd.id = cdc.custom_deck_id
    WHERE cdc.flashcard_id = ?
    ORDER BY cd.name
  `,

  GET_FLASHCARD_IDS_FOR_CUSTOM_DECK: `
    SELECT flashcard_id FROM custom_deck_cards
    WHERE custom_deck_id = ?
  `,

  // Custom deck stats
  COUNT_NEW_CARDS_CUSTOM_DECK: `
    SELECT COUNT(*) FROM flashcards f
    INNER JOIN custom_deck_cards cdc ON f.id = cdc.flashcard_id
    WHERE cdc.custom_deck_id = ? AND f.state = 'new' AND f.due_date <= ?
  `,

  COUNT_DUE_CARDS_CUSTOM_DECK: `
    SELECT COUNT(*) FROM flashcards f
    INNER JOIN custom_deck_cards cdc ON f.id = cdc.flashcard_id
    WHERE cdc.custom_deck_id = ? AND f.state = 'review' AND f.due_date <= ?
  `,

  COUNT_TOTAL_CARDS_CUSTOM_DECK: `
    SELECT COUNT(*) FROM custom_deck_cards WHERE custom_deck_id = ?
  `,

  // Custom deck review card selection
  GET_DUE_CARDS_FOR_CUSTOM_DECK: `
    SELECT f.* FROM flashcards f
    INNER JOIN custom_deck_cards cdc ON f.id = cdc.flashcard_id
    WHERE cdc.custom_deck_id = ? AND f.due_date <= ? AND f.state = 'review'
    ORDER BY f.due_date ASC
  `,

  GET_NEW_CARDS_FOR_CUSTOM_DECK: `
    SELECT f.* FROM flashcards f
    INNER JOIN custom_deck_cards cdc ON f.id = cdc.flashcard_id
    WHERE cdc.custom_deck_id = ? AND f.due_date <= ? AND f.state = 'new'
    ORDER BY f.due_date ASC
  `,

  RESET_CUSTOM_DECK_FLASHCARDS: `
    UPDATE flashcards SET
      state = 'new',
      due_date = datetime('now'),
      interval = 0,
      repetitions = 0,
      difficulty = 5.0,
      stability = 0,
      lapses = 0,
      last_reviewed = NULL,
      modified = ?
    WHERE id IN (
      SELECT flashcard_id FROM custom_deck_cards WHERE custom_deck_id = ?
    )
  `,

  DELETE_REVIEW_LOGS_FOR_CUSTOM_DECK: `
    DELETE FROM review_logs
    WHERE flashcard_id IN (
      SELECT flashcard_id FROM custom_deck_cards WHERE custom_deck_id = ?
    )
  `,
};

// Backup table creation SQL - matches main database schema exactly
export const BACKUP_TABLES_SQL = `
  CREATE TABLE review_logs (
    id TEXT PRIMARY KEY,
    flashcard_id TEXT NOT NULL,
    session_id TEXT,
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
    client TEXT
  );

  CREATE TABLE review_sessions (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    goal_total INTEGER NOT NULL,
    done_unique INTEGER NOT NULL DEFAULT 0
  );
`;
