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
    // Create tables if they don't exist
    db.run(CREATE_TABLES_SQL);
    const migrationSQL = buildMigrationSQL(db);
    db.run(migrationSQL);
    log(`✅ Migration completed successfully`);
  } catch (error) {
    log(`❌ Migration failed: ${error}`);
  }
}
