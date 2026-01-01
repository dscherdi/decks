// Simplified Worker entry point for database operations
// Handles only: init, close, executesql, export

// Worker environment type declarations
interface CustomWorkerGlobalScope {
  window?: CustomWorkerGlobalScope;
  process?: NodeJS.Process;
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void | Promise<void>) | null;
}
declare const self: CustomWorkerGlobalScope;

// Import SQL.js types only (not the runtime code)
import type { Database, InitSqlJsStatic, SqlJsStatic, SqlValue } from "sql.js";

// SQL.js runtime will be loaded dynamically
declare const initSqlJs: InitSqlJsStatic;

// Web Worker API declaration
declare function importScripts(...urls: string[]): void;

import { FlashcardParser } from "../services/FlashcardParser";
import type { ParsedFlashcard } from "../services/FlashcardParser";
import { FlashcardSynchronizer } from "../services/FlashcardSynchronizer";
import type { SyncResult, SyncData } from "../services/FlashcardSynchronizer";
import {
  CREATE_TABLES_SQL,
  CURRENT_SCHEMA_VERSION,
  buildMigrationSQL,
} from "../database/schemas";

export interface QueryConfig {
  asObject?: boolean;
}

export interface DatabaseWorkerMessage {
  id: string;
  type: string;
  data?: object;
  sqlJsCode?: string;
  wasmBytes?: ArrayBuffer;
}

export interface DatabaseWorkerResponse {
  id: string;
  success: boolean;
  data?: string | number | object;
  error?: string;
}

class SimpleDatabaseWorker {
  private initialized = false;
  public db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private flashcardSynchronizer: FlashcardSynchronizer | null = null;

  async initialize(
    dbBuffer?: Uint8Array,
    sqlJsCode?: string,
    wasmBytes?: ArrayBuffer
  ): Promise<void> {
    try {
      if (sqlJsCode && wasmBytes) {
        // Initialize from assets passed from main thread
        // Force browser path; kill Node detection in Electron workers
        self.window = self;
        try {
          delete self.process;
        } catch {
          // in case Electron injects it
        }

        const jsUrl = URL.createObjectURL(
          new Blob([sqlJsCode], { type: "application/javascript" })
        );
        const wasmUrl = URL.createObjectURL(
          new Blob([wasmBytes], { type: "application/wasm" })
        );

        // Load sql.js into the worker
        importScripts(jsUrl);
        URL.revokeObjectURL(jsUrl);

        self.postMessage({ type: "dbg", hasInit: typeof initSqlJs });
        self.postMessage({ type: "dbg", wasmLen: wasmBytes.byteLength });

        // Initialize with explicit wasm location

        this.SQL = await initSqlJs({
          locateFile: () => wasmUrl,
        });
        self.postMessage({ type: "dbg", sqlobj: typeof this.SQL });

        if (this.SQL === undefined) {
          throw new Error(`SQL is undefined ${wasmUrl}`);
        }
        if (dbBuffer) {
          this.db = new this.SQL!.Database(new Uint8Array(dbBuffer));
        } else {
          this.db = new this.SQL!.Database();
        }

        // Clean up blob URLs
        URL.revokeObjectURL(wasmUrl);
      } else {
        throw new Error("Missing sqlJsCode and wasmBytes for initialization");
      }

      this.initialized = true;
      if (this.db) {
        this.flashcardSynchronizer = new FlashcardSynchronizer(this.db);
      }
    } catch (error) {
      self.postMessage({ type: "error", error });
      throw new Error(
        `Failed to initialize database: ${(error as Error).message}`
      );
    }
  }

  executeSql(sql: string, params: SqlValue[] = []): void {
    if (!this.db || !this.initialized) {
      throw new Error("Database not initialized");
    }

    const stmt = this.db.prepare(sql);
    try {
      stmt.run(params);
    } catch (error) {
      self.postMessage({ type: "error", error });
      throw new Error(`Failed to execute sql: ${(error as Error).message}`);
    } finally {
      stmt.free();
    }
  }

  querySql(
    sql: string,
    params: SqlValue[] = [],
    config?: QueryConfig
  ): unknown[] {
    if (!this.db || !this.initialized) {
      throw new Error("Database not initialized");
    }

    const stmt = this.db.prepare(sql);
    const results: unknown[] = [];

    try {
      stmt.bind(params);
      while (stmt.step()) {
        if (config?.asObject) {
          results.push(stmt.getAsObject());
        } else {
          results.push(stmt.get());
        }
      }
    } catch (error) {
      self.postMessage({ type: "error", error });
      throw new Error(`Failed to query sql: ${(error as Error).message}`);
    } finally {
      stmt.free();
    }

    return results;
  }

  export(): Uint8Array {
    if (!this.db || !this.initialized) {
      throw new Error("Database not initialized");
    }
    return this.db.export();
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  // Database initialization method using imported SQL
  createFreshDatabase(): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.exec(CREATE_TABLES_SQL);
  }

  // Backup database management
  private backupDatabases = new Map<string, Database>();
  private nextBackupId = 1;

  createBackupDatabase(backupData: Uint8Array): string {
    if (!this.SQL) throw new Error("SQL.js not initialized");

    try {
      const backupDbId = `backup_${this.nextBackupId++}`;
      const backupDb = new this.SQL!.Database(backupData);
      this.backupDatabases.set(backupDbId, backupDb);
      return backupDbId;
    } catch (error) {
      throw new Error(
        `Failed to create backup database: ${(error as Error).message}`
      );
    }
  }

  queryBackupDatabase(backupDbId: string, sql: string): unknown[] {
    const backupDb = this.backupDatabases.get(backupDbId);
    if (!backupDb) {
      throw new Error(`Backup database not found: ${backupDbId}`);
    }

    try {
      const result = backupDb.exec(sql);
      if (result.length === 0) return [];

      // Convert SQL.js result format to array of row arrays
      const resultData = result[0];
      return resultData.values || [];
    } catch (error) {
      throw new Error(
        `Failed to query backup database: ${(error as Error).message}`
      );
    }
  }

  closeBackupDatabase(backupDbId: string): void {
    const backupDb = this.backupDatabases.get(backupDbId);
    if (backupDb) {
      backupDb.close();
      this.backupDatabases.delete(backupDbId);
    }
  }

  // Check if migration is needed and execute it directly
  checkMigrationNeeded(): void {
    if (!this.db) throw new Error("Database not initialized");

    try {
      // Check current schema version
      const versionResult = this.db.exec("PRAGMA user_version");
      const currentVersion = Number(versionResult[0]?.values[0]?.[0]) || 0;

      if (currentVersion < CURRENT_SCHEMA_VERSION) {
        // Execute migration directly
        try {
          const migrationSQL = buildMigrationSQL(this.db);
          this.db.exec(migrationSQL);
          self.postMessage({
            type: "migrationComplete",
            success: true,
          });
        } catch (error) {
          self.postMessage({
            type: "migrationError",
            error: (error as Error).message,
          });
          throw error;
        }
      } else {
        // No migration needed
        self.postMessage({
          type: "migrationComplete",
          success: true,
        });
      }
    } catch (error) {
      self.postMessage({
        type: "migrationError",
        error: (error as Error).message,
      });
    }
  }

  /**
   * Parse flashcards from content string (delegates to FlashcardParser)
   */
  parseFlashcardsFromContent(
    content: string,
    headerLevel = 2
  ): ParsedFlashcard[] {
    return FlashcardParser.parseFlashcardsFromContent(content, headerLevel);
  }

  /**
   * Sync flashcards for a deck - delegates to DeckSynchronizer
   */
  syncFlashcardsForDeck(data: SyncData): SyncResult {
    if (!this.flashcardSynchronizer) {
      throw new Error("FlashcardSynchronizer not initialized");
    }

    // Create progress callback that sends messages to main thread
    const progressCallback = (progress: number, message?: string) => {
      self.postMessage({
        type: "progress",
        progress: progress,
        message: message,
      });
    };

    return this.flashcardSynchronizer.syncFlashcardsForDeck(
      data,
      progressCallback
    );
  }

  /**
   * Sync with disk file - performs merge entirely in worker
   */
  syncWithDisk(fileBuffer: Uint8Array): void {
    if (!this.db || !this.initialized) {
      throw new Error("Database not initialized");
    }

    let remoteDb: Database | null = null;

    try {
      // Create a temporary database connection for the disk file
      if (!this.SQL) throw new Error("SQL.js not initialized");
      remoteDb = new this.SQL.Database(fileBuffer);

      // Begin Transaction on MAIN DB
      this.db.exec("BEGIN TRANSACTION");

      try {
        // 1. Merge Review Sessions (INSERT OR IGNORE)
        const sessionsResult = remoteDb.exec("SELECT * FROM review_sessions");
        if (sessionsResult.length > 0) {
          const columns = sessionsResult[0].columns;
          const values = sessionsResult[0].values;
          const placeholders = columns.map(() => "?").join(",");

          const stmt = this.db.prepare(
            `INSERT OR IGNORE INTO review_sessions VALUES (${placeholders})`
          );
          for (const row of values) {
            stmt.run(row);
          }
          stmt.free();
        }

        // 2. Merge Review Logs (INSERT OR IGNORE)
        const logsResult = remoteDb.exec("SELECT * FROM review_logs");
        if (logsResult.length > 0) {
          const columns = logsResult[0].columns;
          const values = logsResult[0].values;
          const placeholders = columns.map(() => "?").join(",");

          const stmt = this.db.prepare(
            `INSERT OR IGNORE INTO review_logs VALUES (${placeholders})`
          );
          for (const row of values) {
            stmt.run(row);
          }
          stmt.free();
        }

        // 3. Merge Decks (Conditional Replace)
        const decksResult = remoteDb.exec("SELECT * FROM decks");
        if (decksResult.length > 0) {
          const columns = decksResult[0].columns;
          const values = decksResult[0].values;
          const placeholders = columns.map(() => "?").join(",");
          const modIndex = columns.indexOf("modified");
          const idIndex = columns.indexOf("id");

          const insertStmt = this.db.prepare(
            `INSERT OR REPLACE INTO decks VALUES (${placeholders})`
          );

          for (const row of values) {
            const remoteMod = row[modIndex] as string;
            const id = row[idIndex] as string;

            // Check local
            const localRes = this.db.exec(
              "SELECT modified FROM decks WHERE id = ?",
              [id]
            );
            const localMod = localRes.length
              ? (localRes[0].values[0][0] as string)
              : null;

            if (!localMod || remoteMod > localMod) {
              insertStmt.run(row);
            }
          }
          insertStmt.free();
        }

        // 4. Merge Flashcards (Conditional Replace)
        const cardsResult = remoteDb.exec("SELECT * FROM flashcards");
        if (cardsResult.length > 0) {
          const columns = cardsResult[0].columns;
          const values = cardsResult[0].values;
          const placeholders = columns.map(() => "?").join(",");
          const modIndex = columns.indexOf("modified");
          const idIndex = columns.indexOf("id");

          const insertStmt = this.db.prepare(
            `INSERT OR REPLACE INTO flashcards VALUES (${placeholders})`
          );

          for (const row of values) {
            const remoteMod = row[modIndex] as string;
            const id = row[idIndex] as string;

            const localRes = this.db.exec(
              "SELECT modified FROM flashcards WHERE id = ?",
              [id]
            );
            const localMod = localRes.length
              ? (localRes[0].values[0][0] as string)
              : null;

            if (!localMod || remoteMod > localMod) {
              insertStmt.run(row);
            }
          }
          insertStmt.free();
        }

        this.db.exec("COMMIT");
        self.postMessage({ type: "dbg", message: "Sync with disk completed" });
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    } finally {
      if (remoteDb) remoteDb.close();
    }
  }
}

// Worker instance
const worker = new SimpleDatabaseWorker();

// Message handler
self.onmessage = async (event: MessageEvent<DatabaseWorkerMessage>) => {
  const { id, type, data, sqlJsCode, wasmBytes } = event.data;

  try {
    let result: unknown;

    switch (type) {
      case "init":
        if (sqlJsCode && wasmBytes) {
          await worker.initialize(
            (data as { data?: Uint8Array })?.data,
            sqlJsCode,
            wasmBytes
          );

          // Handle fresh database creation or migration check
          if (!(data as { data?: Uint8Array })?.data) {
            worker.createFreshDatabase();
          } else {
            worker.checkMigrationNeeded();
          }
          self.postMessage({ type: "ready" });
          return;
        } else {
          throw new Error("Missing required initialization parameters");
        }

      case "executeSql":
        if (
          data &&
          typeof data === "object" &&
          "sql" in data &&
          "params" in data
        ) {
          const execData = data as { sql: string; params?: SqlValue[] };
          worker.executeSql(execData.sql, execData.params);
          result = { executed: true };
        }
        break;

      case "querySql":
        if (
          data &&
          typeof data === "object" &&
          "sql" in data &&
          "params" in data
        ) {
          const queryData = data as {
            sql: string;
            params?: SqlValue[];
            config?: QueryConfig;
          };
          result = worker.querySql(
            queryData.sql,
            queryData.params,
            queryData.config
          );
        }
        break;

      case "export":
        result = { buffer: worker.export() };
        break;

      case "close":
        worker.close();
        result = { closed: true };
        break;

      case "createBackupDb":
        if (data && typeof data === "object" && "backupData" in data) {
          const backupData = (
            data as { backupData: Uint8Array | Record<string, number> }
          ).backupData;
          result = {
            backupDbId: worker.createBackupDatabase(
              backupData instanceof Uint8Array
                ? backupData
                : new Uint8Array(Object.values(backupData))
            ),
          };
        }
        break;

      case "queryBackupDb":
        if (
          data &&
          typeof data === "object" &&
          "backupDbId" in data &&
          "sql" in data
        ) {
          result = {
            data: worker.queryBackupDatabase(
              (data as { backupDbId: string }).backupDbId,
              (data as { sql: string }).sql
            ),
          };
        }
        break;

      case "closeBackupDb":
        if (data && typeof data === "object" && "backupDbId" in data) {
          worker.closeBackupDatabase(
            (data as { backupDbId: string }).backupDbId
          );
          result = { success: true };
        }
        break;

      case "syncFlashcardsForDeck":
        if (data && typeof data === "object") {
          result = worker.syncFlashcardsForDeck(data as SyncData);
        }
        break;

      case "parseFlashcardsFromContent":
        if (
          data &&
          typeof data === "object" &&
          "content" in data &&
          "headerLevel" in data
        ) {
          result = {
            flashcards: FlashcardParser.parseFlashcardsFromContent(
              (data as { content: string }).content,
              (data as { headerLevel: number }).headerLevel
            ),
          };
        }
        break;

      case "syncWithDisk":
        if (data && typeof data === "object" && "buffer" in data) {
          worker.syncWithDisk(
            new Uint8Array(
              (data as { buffer: ArrayBuffer | number[] }).buffer as number[]
            )
          );
          result = { success: true };
        }
        break;

      default:
        throw new Error(`Unknown operation: ${type}`);
    }

    const response: DatabaseWorkerResponse = {
      id,
      success: true,
      data: result as string | number | object | undefined,
    };

    self.postMessage(response);
  } catch (error) {
    const response: DatabaseWorkerResponse = {
      id,
      success: false,
      error: (error as Error).message,
    };

    self.postMessage(response);
  }
};
