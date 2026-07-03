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

import { FlashcardParser, FlashcardSynchronizer } from "@decks/core";
import type { ParsedFlashcard, SyncResult, SyncData } from "@decks/core";
import {
  CREATE_TABLES_SQL,
  CURRENT_SCHEMA_VERSION,
  buildMigrationSQL,
  remapCardIdsToDeckIndependent,
} from "@decks/core";

// Schema version at which card IDs became deck-independent. Upgrading from an
// earlier version re-points review history to the new IDs before the rebuild.
const DECK_INDEPENDENT_ID_VERSION = 36;

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
          this.db = new this.SQL.Database(new Uint8Array(dbBuffer));
        } else {
          this.db = new this.SQL.Database();
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
      const backupDb = new this.SQL.Database(backupData);
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

  // Count review_logs rows, tolerating the table not existing yet.
  private getReviewLogsCount(): number {
    if (!this.db) return 0;
    try {
      const result = this.db.exec("SELECT COUNT(*) FROM review_logs");
      return Number(result[0]?.values[0]?.[0]) || 0;
    } catch {
      return 0;
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
        const reviewLogsBefore = this.getReviewLogsCount();
        try {
          // Re-point review history to deck-independent card IDs while the old
          // IDs are still present — buildMigrationSQL then drops and rebuilds
          // the flashcards table.
          if (
            currentVersion > 0 &&
            currentVersion < DECK_INDEPENDENT_ID_VERSION
          ) {
            remapCardIdsToDeckIndependent(this.db);
          }
          const migrationSQL = buildMigrationSQL(this.db);
          this.db.exec(migrationSQL);

          // Guard against silent review-history loss: if the rebuild dropped any
          // rows (an unforeseen value the normalization didn't cover), surface it
          // instead of failing quietly.
          const dropped = reviewLogsBefore - this.getReviewLogsCount();
          self.postMessage({
            type: "migrationComplete",
            success: true,
            ...(dropped > 0
              ? {
                  migrationNotice: `Database upgraded, but ${dropped} review log ${
                    dropped === 1 ? "entry" : "entries"
                  } could not be migrated and were skipped.`,
                }
              : {}),
          });
        } catch (migrationError) {
          // Do NOT drop tables or recreate a fresh database — that is what
          // destroyed review history before. Roll back the partial migration and
          // leave the user's existing data untouched so they can restore/upgrade.
          try {
            this.db.exec("ROLLBACK");
          } catch {
            // Transaction may not be open
          }
          self.postMessage({
            type: "migrationComplete",
            success: false,
            migrationNotice:
              "Database migration failed. Your existing data was left untouched — no cards or review history were deleted. Please update the plugin or restore a recent backup.",
            error: (migrationError as Error).message,
          });
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
    headerLevel: number | number[] = 2
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
   * Sync with disk file - performs merge entirely in worker.
   * Merges the remote DB's state into the in-memory DB. Does NOT write back to disk.
   * Same code path is used by reloadFromDiskIfNewer (auto-refresh on focus).
   */
  syncWithDisk(fileBuffer: Uint8Array): void {
    if (!this.db || !this.initialized) {
      throw new Error("Database not initialized");
    }
    if (!this.SQL) throw new Error("SQL.js not initialized");

    let remoteDb: Database | null = null;
    try {
      remoteDb = new this.SQL.Database(fileBuffer);
      this.performMerge(remoteDb);
    } finally {
      if (remoteDb) remoteDb.close();
    }
  }

  /**
   * Core merge: take a fully-opened remote DB and merge its data into the
   * in-memory DB. Wrapped in a transaction; rolled back on error.
   *
   * Conflict resolution:
   *   - Append-only tables (review_sessions, review_logs, custom_deck_cards):
   *     INSERT OR IGNORE — both sides' rows survive.
   *   - decks, flashcards: conditional replace by `modified` (markdown is the
   *     source of truth, no tombstones).
   *   - deckprofiles, custom_decks: conditional replace by effective timestamp
   *     COALESCE(deleted_at, modified) — propagates tombstones.
   *   - profile_tag_mappings: conditional replace by COALESCE(deleted_at, created).
   *
   * Excluded (local-only): journal_state, custom_deck_card_tombstones.
   */
  private performMerge(remoteDb: Database): void {
    if (!this.db) throw new Error("Database not initialized");

    this.db.exec("BEGIN TRANSACTION");
    try {
      this.mergeAppendOnly(remoteDb, "review_sessions");
      this.mergeAppendOnly(remoteDb, "review_logs");
      this.mergeDecks(remoteDb);
      this.mergeFlashcards(remoteDb);
      this.mergeProfiles(remoteDb);
      // profile_tag_mappings: bulk merge stays additive (first writer wins per tag);
      // the sync log path (HLC-ordered tag_mapping_upsert/_delete) handles cross-
      // device conflicts and tombstones precisely.
      this.mergeAppendOnly(remoteDb, "profile_tag_mappings");
      this.mergeCustomDecks(remoteDb);
      this.mergeAppendOnly(remoteDb, "custom_deck_cards");
      // Trained weight sets: immutable history + soft-delete, newer-wins by effective ts.
      this.mergeByEffectiveTimestamp(remoteDb, "fsrs_weight_sets");
      // Cram (drill) state: mutable, per-device but resumable across devices — newer-wins by modified.
      this.mergeByModified(remoteDb, "cram_sessions");
      this.mergeByModified(remoteDb, "cram_cards");

      this.db.exec("COMMIT");
      self.postMessage({ type: "dbg", message: "Sync with disk completed" });
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private mergeAppendOnly(remoteDb: Database, table: string): void {
    if (!this.db) return;
    try {
      const result = remoteDb.exec(`SELECT * FROM ${table}`);
      if (result.length === 0) return;
      const columns = result[0].columns;
      const placeholders = columns.map(() => "?").join(",");
      const columnList = columns.join(",");
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO ${table} (${columnList}) VALUES (${placeholders})`
      );
      for (const row of result[0].values) stmt.run(row);
      stmt.free();
    } catch {
      // Remote may lack the table on older schemas.
    }
  }

  private mergeByModified(remoteDb: Database, table: string): void {
    if (!this.db) return;
    try {
      const result = remoteDb.exec(`SELECT * FROM ${table}`);
      if (result.length === 0) return;
      const columns = result[0].columns;
      const modIndex = columns.indexOf("modified");
      const idIndex = columns.indexOf("id");
      const placeholders = columns.map(() => "?").join(",");
      const columnList = columns.join(",");
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO ${table} (${columnList}) VALUES (${placeholders})`
      );
      for (const row of result[0].values) {
        const id = row[idIndex] as string;
        const remoteMod = row[modIndex] as string;
        const localRes = this.db.exec(
          `SELECT modified FROM ${table} WHERE id = ?`,
          [id]
        );
        const localMod = localRes.length
          ? (localRes[0].values[0][0] as string)
          : null;
        if (!localMod || remoteMod > localMod) stmt.run(row);
      }
      stmt.free();
    } catch {
      // Remote may lack the table.
    }
  }

  /**
   * Specialized decks merge: preserves the local `last_synced_mtime` value
   * across cross-device sync. That column is per-device (each device sees
   * its own wall-clock mtime when iCloud delivers the source markdown), so
   * the remote's value would be wrong for us. We read local mtime first and
   * splice it into the row before INSERT OR REPLACE.
   */
  private mergeDecks(remoteDb: Database): void {
    if (!this.db) return;
    try {
      const result = remoteDb.exec("SELECT * FROM decks");
      if (result.length === 0) return;
      const columns = result[0].columns;
      const modIndex = columns.indexOf("modified");
      const idIndex = columns.indexOf("id");
      const localMtimeIndex = columns.indexOf("last_synced_mtime");
      const placeholders = columns.map(() => "?").join(",");
      const columnList = columns.join(",");
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO decks (${columnList}) VALUES (${placeholders})`
      );
      for (const row of result[0].values) {
        const id = row[idIndex] as string;
        const remoteMod = row[modIndex] as string;
        const localRes = this.db.exec(
          "SELECT modified, last_synced_mtime FROM decks WHERE id = ?",
          [id]
        );
        const localRow = localRes.length ? localRes[0].values[0] : null;
        const localMod = localRow ? (localRow[0] as string) : null;
        if (!localMod || remoteMod > localMod) {
          // Preserve local mtime (or 0 for brand-new rows).
          if (localMtimeIndex >= 0) {
            const localMtime = localRow ? (localRow[1] as number) || 0 : 0;
            // Mutate a copy so we don't poison subsequent iterations.
            const writeRow = [...row];
            writeRow[localMtimeIndex] = localMtime;
            stmt.run(writeRow);
          } else {
            stmt.run(row);
          }
        }
      }
      stmt.free();
    } catch {
      // Remote may have a pre-v18 schema. Fall back to the generic merge,
      // accepting that the local column keeps its current value (since
      // INSERT OR REPLACE without that column in the list reverts to default).
      this.mergeByModified(remoteDb, "decks");
    }
  }

  private mergeFlashcards(remoteDb: Database): void {
    if (!this.db) return;
    try {
      const result = remoteDb.exec("SELECT * FROM flashcards");
      if (result.length === 0) return;
      const remoteColumns = result[0].columns;
      const modIndex = remoteColumns.indexOf("modified");
      const idIndex = remoteColumns.indexOf("id");
      // Exclude `suspended_at` and `buried_until` from the bulk merge.
      // Those columns are converged exclusively by their dedicated SyncLog
      // op handlers (handleCardSuspend, handleCardBury, etc.) so that a
      // later rate on a different device cannot accidentally clobber a
      // remote device's suspend/bury — the rate path does not touch those
      // columns, but INSERT OR REPLACE on the whole row would overwrite
      // them with whatever value the rating device happened to have.
      const skipCols = new Set(["suspended_at", "buried_until"]);
      const colIndexes: number[] = [];
      const insertColumns: string[] = [];
      for (let i = 0; i < remoteColumns.length; i++) {
        if (skipCols.has(remoteColumns[i])) continue;
        colIndexes.push(i);
        insertColumns.push(remoteColumns[i]);
      }
      // Use only the remote's columns in the INSERT. Columns missing on the
      // remote (e.g., `notes` on pre-v15 DBs, `source_node_id` on pre-v19
      // DBs) are not listed, so SQLite uses their local DEFAULT (NULL for
      // source_node_id; '' for notes).
      const columnList = insertColumns.join(",");
      const placeholders = insertColumns.map(() => "?").join(",");
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO flashcards (${columnList}) VALUES (${placeholders})`
      );
      for (const row of result[0].values) {
        const id = row[idIndex] as string;
        const remoteMod = row[modIndex] as string;
        const localRes = this.db.exec(
          "SELECT modified FROM flashcards WHERE id = ?",
          [id]
        );
        const localMod = localRes.length
          ? (localRes[0].values[0][0] as string)
          : null;
        if (!localMod || remoteMod > localMod) {
          const projected = colIndexes.map((i) => row[i]);
          stmt.run(projected);
        }
      }
      stmt.free();
    } catch {
      // Schema or table missing on remote.
    }
  }

  /**
   * Tombstone-aware merge by effective timestamp = COALESCE(deleted_at, modified).
   * A deletion on one device wins over a stale local row even when the local
   * `modified` was bumped later, because deleted_at takes precedence.
   * Pre-v17 remote schemas lack deleted_at; treated as alive (degrades to plain
   * modified comparison).
   */
  private mergeByEffectiveTimestamp(remoteDb: Database, table: string): void {
    if (!this.db) return;
    try {
      const result = remoteDb.exec(`SELECT * FROM ${table}`);
      if (result.length === 0) return;
      const remoteColumns = result[0].columns;
      // Only copy columns that exist locally too. Across an upgrade boundary the two
      // devices' schemas can differ (e.g. a column was dropped); intersecting avoids an
      // "INSERT into a non-existent column" failure that would silently skip the merge.
      const localColumns = new Set(
        (this.db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map(
          (info) => info[1] as string
        )
      );
      const useIndexes = remoteColumns
        .map((name, index) => ({ name, index }))
        .filter((c) => localColumns.has(c.name));

      const idIndex = remoteColumns.indexOf("id");
      const modIndex = remoteColumns.indexOf("modified");
      const deletedIndex = remoteColumns.indexOf("deleted_at");
      const placeholders = useIndexes.map(() => "?").join(",");
      const columnList = useIndexes.map((c) => c.name).join(",");
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO ${table} (${columnList}) VALUES (${placeholders})`
      );
      for (const row of result[0].values) {
        const id = row[idIndex] as string;
        const remoteMod = row[modIndex] as string;
        const remoteDel = deletedIndex >= 0 ? (row[deletedIndex] as string | null) : null;
        const remoteEffective = remoteDel || remoteMod;

        const localRes = this.db.exec(
          `SELECT COALESCE(deleted_at, modified) FROM ${table} WHERE id = ?`,
          [id]
        );
        const localEffective = localRes.length
          ? (localRes[0].values[0][0] as string)
          : null;

        if (!localEffective || remoteEffective > localEffective) {
          stmt.run(useIndexes.map((c) => row[c.index]));
        }
      }
      stmt.free();
    } catch {
      // Table may not exist on remote.
    }
  }

  private mergeProfiles(remoteDb: Database): void {
    if (!this.db) return;
    // deckprofiles has both `modified` and `deleted_at` (v17+).
    // Schema-mismatch fallback: if remote lacks learning_steps, inject defaults.
    try {
      const result = remoteDb.exec("SELECT * FROM deckprofiles");
      if (result.length === 0) return;
      const columns = result[0].columns;
      const hasLearningSteps = columns.includes("learning_steps");
      if (hasLearningSteps) {
        // Hot path: schemas match, use the generic merge.
        this.mergeByEffectiveTimestamp(remoteDb, "deckprofiles");
        return;
      }
      // Cold path: pre-v9 remote schema. Mirror the old explicit-column logic.
      const idIndex = columns.indexOf("id");
      const modIndex = columns.indexOf("modified");
      const reviewOrderIndex = columns.indexOf("review_order");
      const effectiveColumns = [
        ...columns.slice(0, reviewOrderIndex + 1),
        "learning_steps",
        "relearning_steps",
        ...columns.slice(reviewOrderIndex + 1),
      ];
      const columnList = effectiveColumns.join(",");
      const placeholders = effectiveColumns.map(() => "?").join(",");
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO deckprofiles (${columnList}) VALUES (${placeholders})`
      );
      for (const row of result[0].values) {
        const id = row[idIndex] as string;
        const remoteMod = row[modIndex] as string;
        const localRes = this.db.exec(
          "SELECT COALESCE(deleted_at, modified) FROM deckprofiles WHERE id = ?",
          [id]
        );
        const localEff = localRes.length
          ? (localRes[0].values[0][0] as string)
          : null;
        if (!localEff || remoteMod > localEff) {
          const effectiveRow = [
            ...row.slice(0, reviewOrderIndex + 1),
            "1m",
            "10m",
            ...row.slice(reviewOrderIndex + 1),
          ];
          stmt.run(effectiveRow);
        }
      }
      stmt.free();
    } catch {
      // Remote may lack the table.
    }
  }

  private mergeCustomDecks(remoteDb: Database): void {
    this.mergeByEffectiveTimestamp(remoteDb, "custom_decks");
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
