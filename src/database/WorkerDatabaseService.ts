import { DataAdapter } from "obsidian";
import { BaseDatabaseService } from "./BaseDatabaseService";
import {
  DatabaseWorkerMessage,
  DatabaseWorkerResponse,
} from "../workers/worker-entry";
import {
  CREATE_TABLES_SQL,
  CURRENT_SCHEMA_VERSION,
  buildMigrationSQL,
} from "./schemas";

export class WorkerDatabaseService extends BaseDatabaseService {
  private worker: Worker | null = null;
  private configDir: string;
  private messageId = 0;
  private pendingRequests = new Map<
    string,
    { resolve: Function; reject: Function }
  >();

  constructor(
    dbPath: string,
    adapter: DataAdapter,
    configDir: string,
    debugLog: (message: string, ...args: any[]) => void,
  ) {
    super(dbPath, adapter, debugLog);
    this.configDir = configDir;
  }

  async initialize(): Promise<void> {
    try {
      // 1) Read assets on main thread (worker can't access vault)
      const manifestDir = `${this.configDir}/plugins/decks`;
      const sqlJsCode = await this.adapter.read(
        manifestDir + "/assets/sql-wasm.js",
      ); // text
      const wasmBytes = await this.adapter.readBinary(
        manifestDir + "/assets/sql-wasm.wasm",
      ); // ArrayBuffer

      // 2) Start worker using the built database worker
      const workerScript = await this.adapter.read(
        manifestDir + "/database-worker.js",
      );
      const workerBlob = new Blob([workerScript], {
        type: "application/javascript",
      });
      const workerUrl = URL.createObjectURL(workerBlob);
      this.worker = new Worker(workerUrl, { type: "classic" });

      // Load database file if exists
      const buffer = await this.loadDatabaseFile();

      // Setup message handler
      this.worker.onmessage = (event: MessageEvent) => {
        const { type, id, success, data, error } = event.data;

        if (type === "ready") {
          this.debugLog("Database worker ready");
          return;
        }

        if (type === "initError") {
          this.debugLog("Database worker init error:", error);
          return;
        }

        if (type === "migrationNeeded") {
          this.handleMigrationRequest(event.data);
          return;
        }

        if (type === "migrationComplete") {
          if (event.data.success) {
            this.debugLog("Database migration completed successfully");
          }
          return;
        }

        if (type === "migrationError") {
          this.debugLog("Database migration error:", event.data.error);
          return;
        }

        if (type === "dbg") {
          this.debugLog(event.data);
          return;
        }

        if (id) {
          const request = this.pendingRequests.get(id);
          if (request) {
            this.pendingRequests.delete(id);
            if (success) {
              request.resolve(data);
            } else {
              request.reject(new Error(error || "Worker operation failed"));
            }
          }
        }
      };

      this.worker.onerror = (error) => {
        console.error("Database worker error:", error);
        // Reject all pending requests
        this.pendingRequests.forEach((request) => {
          request.reject(new Error("Worker error"));
        });
        this.pendingRequests.clear();
      };
      // Transfer assets to worker for initialization
      this.worker.postMessage(
        {
          type: "init",
          data: { data: buffer },
          sqlJsCode,
          wasmBytes,
          createTablesSQL: CREATE_TABLES_SQL,
          currentSchemaVersion: CURRENT_SCHEMA_VERSION,
        },
        [wasmBytes], // transfer for zero-copy
      );

      // Wait for worker to be ready
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Worker initialization timeout")),
          10000,
        );

        const originalHandler = this.worker!.onmessage;
        this.worker!.onmessage = (event) => {
          if (event.data.type === "ready") {
            clearTimeout(timeout);
            this.worker!.onmessage = originalHandler;
            resolve(void 0);
          } else if (event.data.type === "initError") {
            clearTimeout(timeout);
            reject(new Error(event.data.error));
          } else if (originalHandler) {
            originalHandler.call(this.worker, event);
          }
        };
      });

      this.debugLog("WorkerDatabaseService initialized successfully");
    } catch (error) {
      console.error("Failed to initialize WorkerDatabaseService:", error);
      throw error;
    }
  }

  private async handleMigrationRequest(data: any): Promise<void> {
    try {
      this.debugLog(
        `Migration needed from version ${data.currentVersion} to ${data.targetVersion}`,
      );

      // For complex migrations, fall back to main thread
      // Export current database, migrate on main thread, then reload
      const currentBuffer = await this.sendMessage("export", {});

      if (!currentBuffer?.buffer) {
        this.debugLog("No database buffer to migrate");
        return;
      }

      // Initialize temporary SQL.js on main thread for migration
      if (typeof window !== "undefined" && (window as any).initSqlJs) {
        const SQL = await (window as any).initSqlJs({
          locateFile: (file: string) => {
            if (file.endsWith(".wasm")) {
              return `https://sql.js.org/dist/${file}`;
            }
            return file;
          },
        });

        const tempDb = new SQL.Database(currentBuffer.buffer);
        const migrationSQL = buildMigrationSQL(tempDb);
        tempDb.close();

        // Send migration SQL to worker
        if (this.worker) {
          this.worker.postMessage({
            type: "executeMigration",
            data: { migrationSQL },
          });
        }
      }
    } catch (error) {
      console.error("Failed to handle migration request:", error);
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

  private sendMessage(type: string, data?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const id = (this.messageId++).toString();
      this.pendingRequests.set(id, { resolve, reject });

      const message: DatabaseWorkerMessage = {
        id,
        type: type as any,
        data,
      };

      this.worker.postMessage(message);
    });
  }

  async save(): Promise<void> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      const data = await this.sendMessage("export");

      // Ensure directory exists
      const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
      if (!(await this.adapter.exists(dir))) {
        await this.adapter.mkdir(dir);
      }

      await this.adapter.writeBinary(this.dbPath, new Uint8Array(data.buffer));
      this.debugLog("Database saved successfully!");
    } catch (error) {
      console.error("Failed to save database:", error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.sendMessage("close");
      this.worker.terminate();
      this.worker = null;
    }
  }

  // Transaction support - delegate to worker
  beginTransaction(): void {
    if (!this.worker) throw new Error("Worker not initialized");
    this.sendMessage("beginTransaction");
  }

  commitTransaction(): void {
    if (!this.worker) throw new Error("Worker not initialized");
    this.sendMessage("commitTransaction");
  }

  rollbackTransaction(): void {
    if (!this.worker) throw new Error("Worker not initialized");
    this.sendMessage("rollbackTransaction");
  }

  // Core SQL execution methods - delegate to worker
  async executeSql(sql: string, params: any[] = []): Promise<void> {
    if (!this.worker) throw new Error("Worker not initialized");
    await this.sendMessage("executeSql", { sql, params });
  }

  async querySql(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.worker) throw new Error("Worker not initialized");
    return await this.sendMessage("querySql", { sql, params });
  }

  // BACKUP OPERATIONS - Abstract method implementations
  async exportDatabaseToBuffer(): Promise<Uint8Array> {
    if (!this.worker) throw new Error("Worker not initialized");
    return await this.sendMessage("exportDatabase");
  }

  async restoreFromBackupData(backupData: Uint8Array): Promise<void> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      // Send backup data to worker for restoration
      await this.sendMessage("restoreFromBackup", { backupData });

      this.debugLog("Database restored from backup data");
    } catch (error) {
      console.error("Failed to restore from backup data:", error);
      throw error;
    }
  }
}
