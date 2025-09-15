import { DataAdapter } from "obsidian";
import { BaseDatabaseService, QueryConfig } from "./BaseDatabaseService";
import {
  DatabaseWorkerMessage,
  DatabaseWorkerResponse,
} from "../workers/worker-entry";
import { ProgressTracker } from "../utils/progress";

export class WorkerDatabaseService extends BaseDatabaseService {
  private worker: Worker | null = null;
  private configDir: string;
  private messageId = 0;
  private pendingRequests = new Map<
    string,
    { resolve: Function; reject: Function }
  >();
  private progressTracker?: ProgressTracker;

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

        if (type === "progress") {
          // Handle progress updates from worker
          if (this.progressTracker) {
            this.progressTracker.update(
              event.data.message,
              event.data.progress,
            );
          }
          return;
        }

        if (type === "error") {
          this.debugLog("Database worker error:", error);
          return;
        }

        if (type === "migrationComplete") {
          if (event.data.success) {
            this.debugLog("Database migration completed successfully");
          }
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

      // data.buffer is a Uint8Array from worker.export()
      // Obsidian's writeBinary expects a Uint8Array
      await this.adapter.writeBinary(this.dbPath, data.buffer);
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

  // Transaction methods removed - no longer using transactions

  // Core SQL execution methods - delegate to worker
  async executeSql(sql: string, params: any[] = []): Promise<void> {
    if (!this.worker) throw new Error("Worker not initialized");
    await this.sendMessage("executeSql", { sql, params });
  }

  async querySql(
    sql: string,
    params: any[] = [],
    config?: QueryConfig,
  ): Promise<any[]> {
    if (!this.worker) throw new Error("Worker not initialized");
    return await this.sendMessage("querySql", { sql, params, config });
  }

  // BACKUP OPERATIONS - Abstract method implementations
  async exportDatabaseToBuffer(): Promise<Uint8Array> {
    if (!this.worker) throw new Error("Worker not initialized");
    const data = await this.sendMessage("export");
    return data.buffer;
  }

  async createBackupDatabaseInstance(backupData: Uint8Array): Promise<any> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      const response = await this.sendMessage("createBackupDb", { backupData });
      return response.backupDbId;
    } catch (error) {
      console.error("Failed to create backup database instance:", error);
      throw error;
    }
  }

  async queryBackupDatabase(backupDbId: any, sql: string): Promise<any[]> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      const response = await this.sendMessage("queryBackupDb", {
        backupDbId,
        sql,
      });
      return response.data || [];
    } catch (error) {
      console.error("Failed to query backup database:", error);
      throw error;
    }
  }

  async closeBackupDatabaseInstance(backupDbId: any): Promise<void> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      await this.sendMessage("closeBackupDb", { backupDbId });
      this.debugLog("Backup database instance closed");
    } catch (error) {
      console.error("Failed to close backup database instance:", error);
      throw error;
    }
  }

  // Worker-specific operations
  async syncFlashcardsForDeckWorker(
    data: {
      deckId: string;
      deckName: string;
      deckFilepath: string;
      deckConfig: any;
      fileContent: string;
      force: boolean;
    },
    progressTracker?: ProgressTracker,
  ): Promise<{
    success: boolean;
    parsedCount: number;
    operationsCount: number;
  }> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      // Set progress tracker for this operation
      this.progressTracker = progressTracker;

      const result = await this.sendMessage("syncFlashcardsForDeck", data);

      // Clear progress tracker after operation
      this.progressTracker = undefined;

      return {
        success: result.success,
        parsedCount: result.parsedCount,
        operationsCount: result.operationsCount,
      };
    } catch (error) {
      console.error("Worker sync failed:", error);
      throw error;
    }
  }
}
