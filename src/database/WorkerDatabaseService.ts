import type { DataAdapter } from "obsidian";
import { BaseDatabaseService } from "./BaseDatabaseService";
import type { QueryConfig } from "./BaseDatabaseService";
import type { SqlJsValue } from "./sql-types";
import type { DatabaseWorkerMessage } from "../workers/worker-entry";
import { ProgressTracker } from "../utils/progress";
import type { SyncData, SyncResult } from "../services/FlashcardSynchronizer";
import { getEmbeddedAssets } from "./embedded-assets";

export class WorkerDatabaseService extends BaseDatabaseService {
  private worker: Worker | null = null;
  private configDir: string;
  private messageId = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value?: string | number | object) => void;
      reject: (reason?: Error) => void;
    }
  >();
  private progressTracker?: ProgressTracker;

  constructor(
    dbPath: string,
    adapter: DataAdapter,
    configDir: string,
    debugLog: (message: string, ...args: (string | number | object)[]) => void
  ) {
    super(dbPath, adapter, debugLog);
    this.configDir = configDir;
  }

  async initialize(): Promise<void> {
    try {
      // Get embedded assets (all assets are now embedded in main.js)
      const embeddedAssets = getEmbeddedAssets();

      if (!embeddedAssets) {
        throw new Error(
          "Embedded assets not found. This should not happen - please report this issue."
        );
      }

      this.debugLog("Using embedded assets for worker initialization");

      // Extract worker code and SQL.js assets
      const workerScript = embeddedAssets.workerCode;
      const sqlJsCode = embeddedAssets.sqlJsCode;

      // Convert base64 WASM to ArrayBuffer
      const binaryString = atob(embeddedAssets.sqlWasmBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const wasmBytes = bytes.buffer;

      // Start worker using the embedded worker script
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
              event.data.progress
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
        [wasmBytes] // transfer for zero-copy
      );

      // Wait for worker to be ready
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Worker initialization timeout")),
          10000
        );

        const originalHandler = this.worker?.onmessage || null;
        if (this.worker) {
          this.worker.onmessage = (event) => {
            if (event.data.type === "ready") {
              clearTimeout(timeout);
              if (this.worker) {
                this.worker.onmessage = originalHandler;
              }
              resolve(void 0);
            } else if (event.data.type === "initError") {
              clearTimeout(timeout);
              reject(new Error(event.data.error));
            } else if (originalHandler) {
              originalHandler.call(this.worker, event);
            }
          };
        }
      });

      // Initialize lastKnownModified
      await this.updateLastKnownModified();

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
    } catch {
      this.debugLog("Database file doesn't exist yet, will create new one");
      return null;
    }
  }

  private sendMessage(
    type: string,
    data?: object,
    transferables?: Transferable[]
  ): Promise<string | number | object> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const id = (this.messageId++).toString();
      this.pendingRequests.set(id, { resolve, reject });

      const message: DatabaseWorkerMessage = {
        id,
        type,
        data,
      };

      if (transferables) {
        this.worker.postMessage(message, transferables);
      } else {
        this.worker.postMessage(message);
      }
    });
  }

  async save(): Promise<void> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      // Sync with disk before saving
      await this.syncWithDisk();

      const data = await this.sendMessage("export");
      const exportData = data as { buffer: Uint8Array };

      // Ensure directory exists
      const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
      if (!(await this.adapter.exists(dir))) {
        await this.adapter.mkdir(dir);
      }

      // data.buffer is a Uint8Array from worker.export()
      // Obsidian's writeBinary expects an ArrayBuffer
      await this.adapter.writeBinary(
        this.dbPath,
        exportData.buffer.buffer.slice(0) as ArrayBuffer
      );

      // Update lastKnownModified after successful save
      await this.updateLastKnownModified();

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
  async executeSql(sql: string, params: SqlJsValue[] = []): Promise<void> {
    if (!this.worker) throw new Error("Worker not initialized");
    await this.sendMessage("executeSql", { sql, params });
  }

  // Generic overload for object queries
  async querySql<T>(
    sql: string,
    params: SqlJsValue[],
    config: { asObject: true }
  ): Promise<T[]>;

  // Overload for array queries
  async querySql(
    sql: string,
    params?: SqlJsValue[],
    config?: { asObject?: false }
  ): Promise<SqlJsValue[][]>;

  // Implementation
  async querySql<T = Record<string, SqlJsValue>>(
    sql: string,
    params: SqlJsValue[] = [],
    config?: QueryConfig
  ): Promise<T[] | SqlJsValue[][]> {
    if (!this.worker) throw new Error("Worker not initialized");
    return (await this.sendMessage("querySql", { sql, params, config })) as
      | T[]
      | SqlJsValue[][];
  }

  // BACKUP OPERATIONS - Abstract method implementations
  async exportDatabaseToBuffer(): Promise<Uint8Array> {
    if (!this.worker) throw new Error("Worker not initialized");
    const data = await this.sendMessage("export");
    return (data as { buffer: Uint8Array }).buffer;
  }

  async createBackupDatabaseInstance(backupData: Uint8Array): Promise<string> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      const response = (await this.sendMessage("createBackupDb", {
        backupData,
      })) as { backupDbId: string };
      return response.backupDbId;
    } catch (error) {
      console.error("Failed to create backup database instance:", error);
      throw error;
    }
  }

  async queryBackupDatabase(
    backupDbId: string,
    sql: string
  ): Promise<SqlJsValue[][]> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      const response = (await this.sendMessage("queryBackupDb", {
        backupDbId,
        sql,
      })) as { data: (string | number | null)[][] };
      return response.data || [];
    } catch (error) {
      console.error("Failed to query backup database:", error);
      throw error;
    }
  }

  async closeBackupDatabaseInstance(backupDbId: string): Promise<void> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      await this.sendMessage("closeBackupDb", { backupDbId });
      this.debugLog("Backup database instance closed");
    } catch (error) {
      console.error("Failed to close backup database instance:", error);
      throw error;
    }
  }

  // Synchronization operations
  private lastKnownModified = 0;

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
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      // 1. Check if file exists
      if (!(await this.adapter.exists(this.dbPath))) {
        this.debugLog("No file on disk to sync with");
        return;
      }

      // 2. Check timestamp
      const stat = await this.adapter.stat(this.dbPath);
      if (!stat || stat.mtime <= this.lastKnownModified) {
        this.debugLog("Disk file is not newer, no sync needed");
        return;
      }

      this.debugLog(
        `Syncing with newer disk file on worker (${stat.mtime} > ${this.lastKnownModified})`
      );

      // 3. Read file (Main Thread I/O)
      const diskData = await this.adapter.readBinary(this.dbPath);

      // 4. Send to Worker (Transferable for speed)
      // We pass the ArrayBuffer in the transfer list to avoid copying
      await this.sendMessage("syncWithDisk", { buffer: diskData }, [diskData]);

      // 5. Update Timestamp
      this.lastKnownModified = stat.mtime;
      this.debugLog("Worker completed disk sync");
    } catch (error) {
      console.error("Failed to sync with disk in worker:", error);
      throw error;
    }
  }

  /**
   * Unified sync method - runs in worker for WorkerDatabaseService
   * Note: progressCallback is currently not used in worker mode (worker handles progress internally)
   */
  async syncFlashcardsForDeck(
    data: SyncData,
    _progressCallback?: (progress: number, message?: string) => void
  ): Promise<SyncResult> {
    if (!this.worker) throw new Error("Worker not initialized");

    const result = await this.sendMessage("syncFlashcardsForDeck", data);

    const typedResult = result as SyncResult;

    return {
      success: typedResult.success,
      parsedCount: typedResult.parsedCount,
      operationsCount: typedResult.operationsCount,
    };
  }

  // Worker-specific operations (deprecated - use syncFlashcardsForDeck)
  async syncFlashcardsForDeckWorker(
    data: SyncData,
    progressTracker?: ProgressTracker
  ): Promise<SyncResult> {
    if (!this.worker) throw new Error("Worker not initialized");

    try {
      // Set progress tracker for this operation
      this.progressTracker = progressTracker;

      const result = await this.sendMessage("syncFlashcardsForDeck", data);

      // Clear progress tracker after operation
      this.progressTracker = undefined;

      const typedResult = result as SyncResult;

      return {
        success: typedResult.success,
        parsedCount: typedResult.parsedCount,
        operationsCount: typedResult.operationsCount,
      };
    } catch (error) {
      console.error("Worker sync failed:", error);
      throw error;
    }
  }
}
