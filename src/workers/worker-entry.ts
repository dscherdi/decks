// Simplified Worker entry point for database operations
// Handles only: init, close, executesql, export

// Worker environment type declarations
declare var self: any;

// SQL.js types for worker context
declare var initSqlJs: any;
declare var SQL: any;

// Web Worker API declaration
declare function importScripts(...urls: string[]): void;

export interface DatabaseWorkerMessage {
  id: string;
  type: string;
  data?: any;
  sqlJsCode?: string;
  wasmBytes?: ArrayBuffer;
  createTablesSQL?: string;
  currentSchemaVersion?: number;
}

export interface DatabaseWorkerResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
}

class SimpleDatabaseWorker {
  private initialized = false;
  public db: any = null;
  private SQL: any = null;

  async initialize(
    dbBuffer?: Uint8Array,
    sqlJsCode?: string,
    wasmBytes?: ArrayBuffer,
  ): Promise<void> {
    try {
      if (sqlJsCode && wasmBytes) {
        // Initialize from assets passed from main thread
        // 1) Force browser path; kill Node detection in Electron workers
        self.window = self;
        try {
          delete self.process;
        } catch {} // in case Electron injects it

        // 2) Provide wasm bytes directly to Emscripten
        // self.Module = { wasmBinary: wasmBytes }; // <— key line

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
          this.db = new this.SQL.Database(new Uint8Array(dbBuffer));
        } else {
          this.db = new this.SQL.Database();
        }

        // Clean up blob URLs
        // URL.revokeObjectURL(wasmUrl);
      } else {
        throw new Error("Missing sqlJsCode and wasmBytes for initialization");
      }

      this.initialized = true;
    } catch (error) {
      self.postMessage({ type: "initError", error });
      throw new Error(
        `Failed to initialize database: ${(error as Error).message}`,
      );
    }
  }

  load(dbBuffer: Uint8Array): void {
    if (!this.SQL) throw new Error("SQL.js not initialized");

    if (this.db) {
      this.db.close();
    }

    this.db = new SQL.Database(new Uint8Array(dbBuffer));
    this.initialized = true;
  }

  executeSql(sql: string, params: any[] = []): void {
    if (!this.db || !this.initialized) {
      throw new Error("Database not initialized");
    }

    const stmt = this.db.prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
  }

  querySql(sql: string, params: any[] = []): any[] {
    if (!this.db || !this.initialized) {
      throw new Error("Database not initialized");
    }

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

  // Transaction support
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

  // Database initialization method using passed SQL
  createFreshDatabase(createTablesSQL: string): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.exec(createTablesSQL);
  }

  // Schema migration method using migration SQL from main thread
  executeMigration(migrationSQL: string): void {
    if (!this.db) throw new Error("Database not initialized");

    try {
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
  }

  // Check if migration is needed and request it from main thread
  checkMigrationNeeded(currentSchemaVersion: number): void {
    if (!this.db) throw new Error("Database not initialized");

    try {
      // Check current schema version
      const versionResult = this.db.exec("PRAGMA user_version");
      const currentVersion = versionResult[0]?.values[0]?.[0] || 0;

      if (currentVersion < currentSchemaVersion) {
        // Request migration SQL from main thread
        self.postMessage({
          type: "migrationNeeded",
          currentVersion,
          targetVersion: currentSchemaVersion,
        });
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
}

// Worker instance
const worker = new SimpleDatabaseWorker();

// Message handler
self.onmessage = async (event: MessageEvent<DatabaseWorkerMessage>) => {
  const {
    id,
    type,
    data,
    sqlJsCode,
    wasmBytes,
    createTablesSQL,
    currentSchemaVersion,
  } = event.data;

  try {
    let result: any;

    switch (type) {
      case "init":
        if (sqlJsCode && wasmBytes && createTablesSQL && currentSchemaVersion) {
          await worker.initialize(data?.data, sqlJsCode, wasmBytes);

          // Handle fresh database creation or migration check
          if (!data?.data) {
            worker.createFreshDatabase(createTablesSQL);
            self.postMessage({ type: "ready" });
          } else {
            worker.checkMigrationNeeded(currentSchemaVersion);
          }
          return;
        } else {
          throw new Error("Missing required initialization parameters");
        }

      case "load":
        if (data?.data) {
          worker.load(data.data);
          result = { loaded: true };
        }
        break;

      case "executeSql":
        worker.executeSql(data.sql, data.params);
        result = { executed: true };
        break;

      case "querySql":
        result = worker.querySql(data.sql, data.params);
        break;

      case "export":
        result = { buffer: worker.export() };
        break;

      case "close":
        worker.close();
        result = { closed: true };
        break;

      case "beginTransaction":
        worker.beginTransaction();
        result = { success: true };
        break;

      case "commitTransaction":
        worker.commitTransaction();
        result = { success: true };
        break;

      case "rollbackTransaction":
        worker.rollbackTransaction();
        result = { success: true };
        break;

      case "executeMigration":
        worker.executeMigration(data.migrationSQL);
        result = { success: true };
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
