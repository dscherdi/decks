import { DataAdapter } from "obsidian";
import { BaseDatabaseService } from "./BaseDatabaseService";
import {
  CREATE_TABLES_SQL,
  buildMigrationSQL,
  CURRENT_SCHEMA_VERSION,
} from "./schemas";

// Import SQL.js types
declare const initSqlJs: any;

export class MainDatabaseService extends BaseDatabaseService {
  private db: any = null;
  private SQL: any = null;

  constructor(
    dbPath: string,
    adapter: DataAdapter,
    debugLog: (message: string, ...args: any[]) => void,
  ) {
    super(dbPath, adapter, debugLog);
  }

  async initialize(): Promise<void> {
    try {
      // Load SQL.js
      if (typeof window !== "undefined" && (window as any).initSqlJs) {
        this.SQL = (window as any).initSqlJs;
      } else {
        // For environments where SQL.js is not globally available
        const sqlJs = await import("sql.js");
        this.SQL = sqlJs.default;
      }

      // Initialize SQL.js
      const SQL = await this.SQL({
        locateFile: (file: string) => {
          if (file.endsWith(".wasm")) {
            return `https://sql.js.org/dist/${file}`;
          }
          return file;
        },
      });

      // Load existing database or create new one
      const buffer = await this.loadDatabaseFile();
      if (buffer) {
        this.db = new SQL.Database(buffer);
        this.debugLog("Loaded existing database");

        // Run migrations if needed
        await this.migrateSchemaIfNeeded();
      } else {
        this.db = new SQL.Database();
        await this.createFreshDatabase();
        this.debugLog("Created new database");
      }

      this.debugLog("MainDatabaseService initialized successfully");
    } catch (error) {
      console.error("Failed to initialize MainDatabaseService:", error);
      throw error;
    }
  }

  private async loadDatabaseFile(): Promise<Uint8Array | null> {
    try {
      if (await this.adapter.exists(this.dbPath)) {
        const data = await this.adapter.readBinary(this.dbPath);
        return new Uint8Array(data);
      }
      return null;
    } catch (error) {
      this.debugLog("Database file doesn't exist yet, will create new one");
      return null;
    }
  }

  async save(): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    try {
      // Ensure directory exists
      const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
      if (!(await this.adapter.exists(dir))) {
        await this.adapter.mkdir(dir);
      }

      // Export database and save
      const data = this.db.export();
      await this.adapter.writeBinary(this.dbPath, data);
      this.debugLog("Database saved successfully");
    } catch (error) {
      console.error("Failed to save database:", error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.save();
        this.db.close();
        this.db = null;
        this.debugLog("Database closed successfully");
      } catch (error) {
        console.error("Error closing database:", error);
        this.db = null; // Still null it out even if save failed
        throw error;
      }
    }
  }

  // Transaction methods
  beginTransaction(): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.exec("BEGIN TRANSACTION;");
  }

  commitTransaction(): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.exec("COMMIT;");
  }

  rollbackTransaction(): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.exec("ROLLBACK;");
  }

  // Core SQL execution methods
  async executeSql(sql: string, params: any[] = []): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
  }

  async querySql(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(sql);
    const results: any[] = [];

    try {
      stmt.bind(params);
      while (stmt.step()) {
        results.push(stmt.get());
      }
    } finally {
      stmt.free();
    }

    return results;
  }

  // Database initialization and migration methods
  private async createFreshDatabase(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    this.db.exec(CREATE_TABLES_SQL);
    this.debugLog("Fresh database created with all tables");
  }

  private async migrateSchemaIfNeeded(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    try {
      // Check current schema version
      const versionResult = this.db.exec("PRAGMA user_version");
      const currentVersion = versionResult[0]?.values[0]?.[0] || 0;

      if (currentVersion < CURRENT_SCHEMA_VERSION) {
        this.debugLog(
          `Migrating database from version ${currentVersion} to ${CURRENT_SCHEMA_VERSION}`,
        );

        // Use centralized migration SQL
        const migrationSQL = buildMigrationSQL(this.db);
        this.db.exec(migrationSQL);

        this.debugLog(`Database migrated to version ${CURRENT_SCHEMA_VERSION}`);
      }
    } catch (error) {
      console.error("Schema migration failed:", error);
      // Don't throw here - continue with existing schema
    }
  }

  // BACKUP OPERATIONS - Abstract method implementations
  async exportDatabaseToBuffer(): Promise<Uint8Array> {
    if (!this.db) throw new Error("Database not initialized");
    return this.db.export();
  }

  async restoreFromBackupData(backupData: Uint8Array): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    try {
      // Create a new database from the backup
      const SQL = await this.SQL({
        locateFile: (file: string) => {
          if (file.endsWith(".wasm")) {
            return `https://sql.js.org/dist/${file}`;
          }
          return file;
        },
      });

      const backupDb = new SQL.Database(backupData);

      // Get all data from backup database
      const reviewLogs = backupDb.exec("SELECT * FROM review_logs");
      const reviewSessions = backupDb.exec("SELECT * FROM review_sessions");

      // Insert data into current database, avoiding duplicates
      if (reviewSessions.length > 0) {
        const sessionData = reviewSessions[0];
        for (const row of sessionData.values) {
          const sessionId = row[0]; // Assuming id is first column

          // Check if session already exists
          const existsResult = this.db.exec(
            "SELECT 1 FROM review_sessions WHERE id = ?",
            [sessionId],
          );

          if (existsResult.length === 0) {
            // Insert session if it doesn't exist
            const columns = sessionData.columns.join(", ");
            const placeholders = sessionData.columns.map(() => "?").join(", ");
            this.db.exec(
              `INSERT INTO review_sessions (${columns}) VALUES (${placeholders})`,
              row,
            );
          }
        }
      }

      if (reviewLogs.length > 0) {
        const logData = reviewLogs[0];
        for (const row of logData.values) {
          const logId = row[0]; // Assuming id is first column

          // Check if log already exists
          const existsResult = this.db.exec(
            "SELECT 1 FROM review_logs WHERE id = ?",
            [logId],
          );

          if (existsResult.length === 0) {
            // Insert log if it doesn't exist
            const columns = logData.columns.join(", ");
            const placeholders = logData.columns.map(() => "?").join(", ");
            this.db.exec(
              `INSERT INTO review_logs (${columns}) VALUES (${placeholders})`,
              row,
            );
          }
        }
      }

      // Clean up backup database
      backupDb.close();

      this.debugLog("Database restored from backup data");
    } catch (error) {
      console.error("Failed to restore from backup data:", error);
      throw error;
    }
  }
}
