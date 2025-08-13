import { Database } from "sql.js";
import {
  CREATE_TABLES_SQL,
  CURRENT_SCHEMA_VERSION,
  buildMigrationSQL,
} from "./schemas";

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

/**
 * Creates fresh database tables when no database file exists
 */
export function createTables(
  db: Database,
  debugLog?: (message: string) => void,
): void {
  const log = debugLog || (() => {});

  try {
    log(`Creating fresh database schema (version ${CURRENT_SCHEMA_VERSION})`);
    db.run(CREATE_TABLES_SQL);
    log(`✅ Database schema created successfully`);
  } catch (error) {
    log(`❌ Schema creation failed: ${error}`);
    throw new Error(`Schema creation failed: ${error}`);
  }
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
    // Check for database corruption before migration
    if (isDatabaseCorrupted(db, log)) {
      log(`⚠️ Database corruption detected, performing recovery migration`);
      performRecoveryMigration(db, log);
      return;
    }

    const migrationSQL = buildMigrationSQL(db);
    db.run(migrationSQL);
    log(`✅ Migration completed successfully`);
  } catch (error) {
    log(`❌ Migration failed: ${error}, attempting recovery...`);

    try {
      performRecoveryMigration(db, log);
      log(`✅ Recovery migration completed successfully`);
    } catch (recoveryError) {
      log(`❌ Recovery migration also failed: ${recoveryError}`);
      throw new Error(`Migration and recovery both failed: ${error}`);
    }
  }
}

/**
 * Check if database is corrupted
 */
function isDatabaseCorrupted(
  db: Database,
  log: (message: string) => void,
): boolean {
  try {
    // Test basic table queries
    const tables = ["decks", "flashcards", "review_logs"];
    for (const table of tables) {
      const stmt = db.prepare(`SELECT COUNT(*) FROM ${table} LIMIT 1`);
      stmt.step();
      stmt.free();
    }
    return false;
  } catch (error) {
    log(`Database corruption detected: ${error}`);
    return true;
  }
}

/**
 * Perform recovery migration when database is corrupted
 */
function performRecoveryMigration(
  db: Database,
  log: (message: string) => void,
): void {
  log(`Starting recovery migration - creating fresh schema`);

  try {
    // Drop all existing tables and start fresh
    db.run(`
      PRAGMA foreign_keys = OFF;
      BEGIN;

      DROP TABLE IF EXISTS review_logs;
      DROP TABLE IF EXISTS flashcards;
      DROP TABLE IF EXISTS decks;

      COMMIT;
      PRAGMA foreign_keys = ON;
    `);

    // Create fresh tables
    db.run(CREATE_TABLES_SQL);
    log(`✅ Recovery migration completed - fresh schema created`);
  } catch (error) {
    log(`❌ Recovery migration failed: ${error}`);
    throw new Error(`Recovery migration failed: ${error}`);
  }
}
