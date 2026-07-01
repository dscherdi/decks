import type { DataAdapter } from "obsidian";
import { WorkerDatabaseService } from "./WorkerDatabaseService";
import type {
  IDatabaseService,
  JournalStateRow,
  ISyncLog,
} from "@decks/core";

// Re-export for consumers that import from this file
export type { IDatabaseService, JournalStateRow, ISyncLog };

export interface DatabaseServiceOptions {
  configDir?: string;
}

export class DatabaseFactory {
  private static instance: IDatabaseService | null = null;
  private static currentPath: string | null = null;

  static async create(
    dbPath: string,
    adapter: DataAdapter,
    debugLog: (message: string, ...args: (string | number | object)[]) => void,
    options: DatabaseServiceOptions = {}
  ): Promise<IDatabaseService> {
    if (this.instance && this.currentPath === dbPath) {
      debugLog("Returning existing database instance");
      return this.instance;
    }

    if (this.instance && this.currentPath !== dbPath) {
      debugLog("Database path changed, closing existing instance");
      await this.instance.close();
      this.instance = null;
    }

    const { configDir = "" } = options;

    try {
      debugLog("Creating WorkerDatabaseService instance");
      this.instance = new WorkerDatabaseService(
        dbPath,
        adapter,
        configDir,
        debugLog
      );

      // Kick off worker/SQL.js init in the background (do NOT await) so the
      // plugin's onload returns fast. The instance queues every op behind
      // whenReady(), so callers transparently wait for init to finish.
      void this.instance.initialize();
      this.currentPath = dbPath;

      debugLog(`Database instance created (init running) for path: ${dbPath}`);
      return this.instance;
    } catch (error) {
      debugLog("Failed to create database instance:", error);
      throw error;
    }
  }

  static async close(): Promise<void> {
    if (this.instance) {
      await this.instance.close();
      this.instance = null;
      this.currentPath = null;
    }
  }

  static getInstance(): IDatabaseService | null {
    return this.instance;
  }

  static getCurrentPath(): string | null {
    return this.currentPath;
  }
}
