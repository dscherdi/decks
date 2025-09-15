// Simplified Worker entry point for database operations
// Handles only: init, close, executesql, export

// Worker environment type declarations
declare var self: any;

// Import SQL.js types only (not the runtime code)
import type { Database, InitSqlJsStatic, SqlJsStatic } from "sql.js";

// SQL.js runtime will be loaded dynamically
declare var initSqlJs: InitSqlJsStatic;
declare var SQL: SqlJsStatic;

// Web Worker API declaration
declare function importScripts(...urls: string[]): void;

import { FlashcardParser, ParsedFlashcard } from "../services/FlashcardParser";
import {
  FlashcardSynchronizer,
  BatchOperation,
  SyncResult,
  SyncData,
} from "../services/FlashcardSynchronizer";
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
  data?: any;
  sqlJsCode?: string;
  wasmBytes?: ArrayBuffer;
}

export interface DatabaseWorkerResponse {
  id: string;
  success: boolean;
  data?: any;
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
    wasmBytes?: ArrayBuffer,
  ): Promise<void> {
    try {
      if (sqlJsCode && wasmBytes) {
        // Initialize from assets passed from main thread
        // Force browser path; kill Node detection in Electron workers
        self.window = self;
        try {
          delete self.process;
        } catch {} // in case Electron injects it

        const jsUrl = URL.createObjectURL(
          new Blob([sqlJsCode], { type: "application/javascript" }),
        );
        const wasmUrl = URL.createObjectURL(
          new Blob([wasmBytes], { type: "application/wasm" }),
        );

        // Load sql.js into the worker
        importScripts(jsUrl);
        URL.revokeObjectURL(jsUrl);

        self.postMessage({ type: "dbg", hasInit: typeof initSqlJs });
        self.postMessage({ type: "dbg", wasmLen: wasmBytes.byteLength });

        // Initialize with explicit wasm location
        // eslint-disable-next-line no-undef
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
        `Failed to initialize database: ${(error as Error).message}`,
      );
    }
  }

  executeSql(sql: string, params: any[] = []): void {
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

  querySql(sql: string, params: any[] = [], config?: QueryConfig): any[] {
    if (!this.db || !this.initialized) {
      throw new Error("Database not initialized");
    }

    const stmt = this.db.prepare(sql);
    const results: any[] = [];

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
        `Failed to create backup database: ${(error as Error).message}`,
      );
    }
  }

  queryBackupDatabase(backupDbId: string, sql: string): any[] {
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
        `Failed to query backup database: ${(error as Error).message}`,
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
    headerLevel: number = 2,
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
      progressCallback,
    );
  }
}

// Worker instance
const worker = new SimpleDatabaseWorker();

// Message handler
self.onmessage = async (event: MessageEvent<DatabaseWorkerMessage>) => {
  const { id, type, data, sqlJsCode, wasmBytes } = event.data;

  try {
    let result: any;

    switch (type) {
      case "init":
        if (sqlJsCode && wasmBytes) {
          await worker.initialize(data?.data, sqlJsCode, wasmBytes);

          // Handle fresh database creation or migration check
          if (!data?.data) {
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
        worker.executeSql(data.sql, data.params);
        result = { executed: true };
        break;

      case "querySql":
        result = worker.querySql(data.sql, data.params, data.config);
        break;

      case "export":
        result = { buffer: worker.export() };
        break;

      case "close":
        worker.close();
        result = { closed: true };
        break;

      case "createBackupDb":
        result = {
          backupDbId: worker.createBackupDatabase(
            data.backupData instanceof Uint8Array
              ? data.backupData
              : new Uint8Array(Object.values(data.backupData)),
          ),
        };
        break;

      case "queryBackupDb":
        result = {
          data: worker.queryBackupDatabase(data.backupDbId, data.sql),
        };
        break;

      case "closeBackupDb":
        worker.closeBackupDatabase(data.backupDbId);
        result = { success: true };
        break;

      case "syncFlashcardsForDeck":
        result = worker.syncFlashcardsForDeck(data);
        break;

      case "parseFlashcardsFromContent":
        result = {
          flashcards: FlashcardParser.parseFlashcardsFromContent(
            data.content,
            data.headerLevel,
          ),
        };
        break;

      default:
        throw new Error(`Unknown operation: ${type}`);
    }

    const response: DatabaseWorkerResponse = {
      id,
      success: true,
      data: result,
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
