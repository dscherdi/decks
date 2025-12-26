import type { DataAdapter } from "obsidian";
import { BaseDatabaseService } from "./BaseDatabaseService";
import type { QueryConfig } from "./BaseDatabaseService";
import {
  CREATE_TABLES_SQL,
  buildMigrationSQL,
  CURRENT_SCHEMA_VERSION,
} from "./schemas";
import type { Database, InitSqlJsStatic } from "sql.js";
import { FlashcardSynchronizer } from "../services/FlashcardSynchronizer";
import type { SyncData, SyncResult } from "../services/FlashcardSynchronizer";
import type { SqlJsValue } from "./sql-types";

export class MainDatabaseService extends BaseDatabaseService {
  private db: Database | null = null;
  private SQL: InitSqlJsStatic | null = null;
  private lastKnownModified = 0;

  constructor(
    dbPath: string,
    adapter: DataAdapter,
    debugLog: (message: string, ...args: (string | number | object)[]) => void,
  ) {
    super(dbPath, adapter, debugLog);
  }

  async initialize(): Promise<void> {
    try {
      // Load SQL.js
      if (
        typeof window !== "undefined" &&
        (window as Window & { initSqlJs?: InitSqlJsStatic }).initSqlJs
      ) {
        this.SQL = (
          window as Window & { initSqlJs: InitSqlJsStatic }
        ).initSqlJs;
      } else if (
        typeof global !== "undefined" &&
        (global as typeof global & { initSqlJs?: InitSqlJsStatic }).initSqlJs
      ) {
        // For Node.js test environment with global initSqlJs
        this.SQL = (
          global as typeof global & { initSqlJs: InitSqlJsStatic }
        ).initSqlJs;
      } else {
        // For environments where SQL.js is not globally available
        const sqlJs = await import("sql.js");
        this.SQL = sqlJs.default;
      }

      // Initialize SQL.js
      if (!this.SQL) {
        throw new Error("Failed to load SQL.js");
      }
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
      console.log(`[DEBUG] Buffer exists: ${!!buffer}, SQL.Database type: ${typeof SQL.Database}`);
      if (buffer) {
        this.db = new SQL.Database(buffer);
        console.log(`[DEBUG] Loaded existing database. Has exec: ${typeof this.db?.exec}`);

        // Update lastKnownModified
        await this.updateLastKnownModified();

        // Run migrations if needed
        await this.migrateSchemaIfNeeded();
      } else {
        this.db = new SQL.Database();
        console.log(`[DEBUG] Created database instance. Has exec: ${typeof this.db?.exec}, Constructor: ${SQL.Database?.name}`);
        await this.createFreshDatabase();
        this.debugLog("Created new database");
        this.lastKnownModified = 0;
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
    } catch {
      this.debugLog("Database file doesn't exist yet, will create new one");
      return null;
    }
  }

  async save(): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    try {
      // Sync with disk before saving
      await this.syncWithDisk();

      // Ensure directory exists
      const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
      if (!(await this.adapter.exists(dir))) {
        await this.adapter.mkdir(dir);
      }

      // Export database and save
      const data = this.db.export();
      await this.adapter.writeBinary(this.dbPath, data.buffer.slice(0) as ArrayBuffer);

      // Update lastKnownModified after successful save
      await this.updateLastKnownModified();

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

  // Core SQL execution methods
  async executeSql(sql: string, params: SqlJsValue[] = []): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
  }

  // Generic overload for object queries
  async querySql<T>(
    sql: string,
    params: SqlJsValue[],
    config: { asObject: true },
  ): Promise<T[]>;

  // Overload for array queries
  async querySql(
    sql: string,
    params?: SqlJsValue[],
    config?: { asObject?: false },
  ): Promise<SqlJsValue[][]>;

  // Implementation
  async querySql<T = Record<string, SqlJsValue>>(
    sql: string,
    params: SqlJsValue[] = [],
    config?: QueryConfig,
  ): Promise<T[] | SqlJsValue[][]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(sql);

    try {
      stmt.bind(params);
      if (config?.asObject) {
        const results: T[] = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject() as T);
        }
        return results;
      } else {
        const results: (string | number | null)[][] = [];
        while (stmt.step()) {
          results.push(stmt.get() as (string | number | null)[]);
        }
        return results;
      }
    } finally {
      stmt.free();
    }
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
      this.debugLog(
        `PRAGMA user_version result: ${JSON.stringify(versionResult)}`,
      );
      // Handle both empty array (new database) and result with values
      const currentVersion =
        versionResult && versionResult.length > 0 && versionResult[0].values
          ? Number(versionResult[0].values[0][0])
          : 0;

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

  async createBackupDatabaseInstance(
    backupData: Uint8Array,
  ): Promise<Database> {
    if (!this.SQL) throw new Error("SQL.js not initialized");

    const SQL = await this.SQL({
      locateFile: (file: string) => {
        if (file.endsWith(".wasm")) {
          return `https://sql.js.org/dist/${file}`;
        }
        return file;
      },
    });

    return new SQL.Database(backupData);
  }

  async queryBackupDatabase(
    backupDb: Database,
    sql: string,
  ): Promise<SqlJsValue[][]> {
    const result = backupDb.exec(sql);
    if (result.length === 0) return [];

    // Convert SQL.js result format to array of row arrays
    const resultData = result[0];
    return (resultData.values || []) as (string | number | null)[][];
  }

  async closeBackupDatabaseInstance(backupDb: Database): Promise<void> {
    backupDb.close();
  }

  private async updateLastKnownModified(): Promise<void> {
    try {
      if (await this.adapter.exists(this.dbPath)) {
        const stat = await this.adapter.stat(this.dbPath);
        if (stat) {
          this.lastKnownModified = stat.mtime;
        }
      }
    } catch (error) {
      this.debugLog("Failed to update lastKnownModified:", error);
    }
  }

  async syncWithDisk(): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    try {
      // Check if file exists on disk
      if (!(await this.adapter.exists(this.dbPath))) {
        this.debugLog("No file on disk to sync with");
        return;
      }

      // Check if file is newer than our last known version
      const stat = await this.adapter.stat(this.dbPath);
      if (!stat || stat.mtime <= this.lastKnownModified) {
        this.debugLog("Disk file is not newer, no sync needed");
        return;
      }

      this.debugLog(
        `Syncing with newer disk file (${stat.mtime} > ${this.lastKnownModified})`,
      );

      // Read the disk file
      const diskData = await this.adapter.readBinary(this.dbPath);
      const diskBuffer = new Uint8Array(diskData);

      // Create temporary file path for mounting
      const tempPath = `/tmp_remote_${Date.now()}.db`;

      // Mount the disk database as a temporary file in sql.js filesystem
      this.db.exec(`SELECT 1`); // Ensure database is active
      const FS =
        (
          this.db as Database & {
            FS?: {
              createDataFile?: (
                parent: string,
                name: string,
                data: Uint8Array,
                canRead: boolean,
                canWrite: boolean,
                canOwn: boolean,
              ) => void;
              unlink?: (path: string) => void;
            };
          }
        ).FS ||
        (
          globalThis as typeof globalThis & {
            FS?: {
              createDataFile?: (
                parent: string,
                name: string,
                data: Uint8Array,
                canRead: boolean,
                canWrite: boolean,
                canOwn: boolean,
              ) => void;
              unlink?: (path: string) => void;
            };
          }
        ).FS;

      if (FS?.createDataFile) {
        // Create the temporary file in the virtual filesystem
        FS.createDataFile(
          "/",
          tempPath.substring(1),
          diskBuffer,
          true,
          true,
          true,
        );

        try {
          // Attach the remote database
          this.db.exec(`ATTACH DATABASE '${tempPath}' AS remote`);

          // Begin transaction for atomic merge
          this.db.exec("BEGIN TRANSACTION");

          try {
            // Merge Review Sessions (INSERT OR IGNORE - never overwrite)
            this.db.exec(`
              INSERT OR IGNORE INTO review_sessions
              SELECT * FROM remote.review_sessions
            `);

            // Merge Review Logs (INSERT OR IGNORE - never overwrite)
            this.db.exec(`
              INSERT OR IGNORE INTO review_logs
              SELECT * FROM remote.review_logs
            `);

            // Merge Decks (REPLACE only if remote.modified > main.modified)
            this.db.exec(`
              INSERT OR REPLACE INTO decks
              SELECT remote.* FROM remote.decks
              LEFT JOIN decks AS main ON remote.id = main.id
              WHERE main.id IS NULL OR remote.modified > main.modified
            `);

            // Merge Flashcards (REPLACE only if remote.modified > main.modified)
            this.db.exec(`
              INSERT OR REPLACE INTO flashcards
              SELECT remote.* FROM remote.flashcards
              LEFT JOIN flashcards AS main ON remote.id = main.id
              WHERE main.id IS NULL OR remote.modified > main.modified
            `);

            // Commit the transaction
            this.db.exec("COMMIT");
            this.debugLog("Successfully merged data from disk");
          } catch (error) {
            // Rollback on error
            this.db.exec("ROLLBACK");
            throw error;
          }

          // Detach the remote database
          this.db.exec("DETACH DATABASE remote");
        } finally {
          // Clean up the temporary file
          if (FS?.unlink) {
            try {
              FS.unlink(tempPath);
            } catch (cleanupError) {
              this.debugLog("Failed to cleanup temp file:", cleanupError);
            }
          }
        }
      } else {
        // Fallback: Create a new database instance for merging
        if (!this.SQL) throw new Error("SQL.js not initialized");
        const SQL = await this.SQL({
          locateFile: (file: string) => {
            if (file.endsWith(".wasm")) {
              return `https://sql.js.org/dist/${file}`;
            }
            return file;
          },
        });

        const remoteDb = new SQL.Database(diskBuffer);

        try {
          // Begin transaction for atomic merge
          this.db.exec("BEGIN TRANSACTION");

          try {
            // Get data from remote database
            const remoteSessions = remoteDb.exec(
              "SELECT * FROM review_sessions",
            );
            const remoteLogs = remoteDb.exec("SELECT * FROM review_logs");
            const remoteDecks = remoteDb.exec("SELECT * FROM decks");
            const remoteFlashcards = remoteDb.exec("SELECT * FROM flashcards");

            // Merge sessions (INSERT OR IGNORE)
            if (remoteSessions.length > 0) {
              const sessionData = remoteSessions[0];
              const sessionStmt = this.db.prepare(`
                INSERT OR IGNORE INTO review_sessions
                VALUES (${sessionData.columns.map(() => "?").join(",")})
              `);

              for (const row of sessionData.values) {
                sessionStmt.run(row);
              }
              sessionStmt.free();
            }

            // Merge logs (INSERT OR IGNORE)
            if (remoteLogs.length > 0) {
              const logData = remoteLogs[0];
              const logStmt = this.db.prepare(`
                INSERT OR IGNORE INTO review_logs
                VALUES (${logData.columns.map(() => "?").join(",")})
              `);

              for (const row of logData.values) {
                logStmt.run(row);
              }
              logStmt.free();
            }

            // Merge decks (conditional replace)
            if (remoteDecks.length > 0) {
              const deckData = remoteDecks[0];
              const modifiedIndex = deckData.columns.indexOf("modified");

              for (const row of deckData.values) {
                const deckId = row[0]; // Assuming id is first column
                const remoteModified = row[modifiedIndex];

                const existingDeck = this.db.exec(
                  `SELECT modified FROM decks WHERE id = ?`,
                  [deckId],
                );
                const shouldReplace =
                  !existingDeck.length ||
                  (existingDeck[0]?.values?.[0]?.[0] || 0) <
                    (remoteModified || 0);

                if (shouldReplace) {
                  const deckStmt = this.db.prepare(`
                    INSERT OR REPLACE INTO decks
                    VALUES (${deckData.columns.map(() => "?").join(",")})
                  `);
                  deckStmt.run(row);
                  deckStmt.free();
                }
              }
            }

            // Merge flashcards (conditional replace)
            if (remoteFlashcards.length > 0) {
              const cardData = remoteFlashcards[0];
              const modifiedIndex = cardData.columns.indexOf("modified");

              for (const row of cardData.values) {
                const cardId = row[0]; // Assuming id is first column
                const remoteModified = row[modifiedIndex];

                const existingCard = this.db.exec(
                  `SELECT modified FROM flashcards WHERE id = ?`,
                  [cardId],
                );
                const shouldReplace =
                  !existingCard.length ||
                  (existingCard[0]?.values?.[0]?.[0] || 0) <
                    (remoteModified || 0);

                if (shouldReplace) {
                  const cardStmt = this.db.prepare(`
                    INSERT OR REPLACE INTO flashcards
                    VALUES (${cardData.columns.map(() => "?").join(",")})
                  `);
                  cardStmt.run(row);
                  cardStmt.free();
                }
              }
            }

            // Commit the transaction
            this.db.exec("COMMIT");
            this.debugLog(
              "Successfully merged data from disk using fallback method",
            );
          } catch (error) {
            // Rollback on error
            this.db.exec("ROLLBACK");
            throw error;
          }
        } finally {
          remoteDb.close();
        }
      }

      // Update our lastKnownModified to the disk file's timestamp
      if (stat) {
        this.lastKnownModified = stat.mtime;
      }
    } catch (error) {
      console.error("Failed to sync with disk:", error);
      throw error;
    }
  }

  /**
   * Unified sync method - runs in main thread for MainDatabaseService
   */
  async syncFlashcardsForDeck(
    data: SyncData,
    progressCallback?: (progress: number, message?: string) => void
  ): Promise<SyncResult> {
    if (!this.db) throw new Error("Database not initialized");

    const synchronizer = new FlashcardSynchronizer(this.db);
    return synchronizer.syncFlashcardsForDeck(data, progressCallback);
  }
}
