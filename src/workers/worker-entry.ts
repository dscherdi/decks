// Simplified Worker entry point for database operations
// Handles only: init, close, executesql, export

// Worker environment type declarations
declare var self: any;

// SQL.js types for worker context
declare var initSqlJs: any;
declare var SQL: any;

// Web Worker API declaration
declare function importScripts(...urls: string[]): void;

export interface ParsedFlashcard {
  front: string;
  back: string;
  type: "header-paragraph" | "table";
}

export interface QueryConfig {
  asObject?: boolean;
}

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

interface BatchOperation {
  type: "create" | "update" | "delete";
  flashcardId?: string;
  flashcard?: any;
  updates?: any;
}

class SimpleDatabaseWorker {
  private initialized = false;
  public db: any = null;
  private SQL: any = null;

  // Pre-compiled regex patterns for better performance
  private static readonly HEADER_REGEX = /^(#{1,6})\s+/;
  private static readonly TABLE_ROW_REGEX = /^\|.*\|$/;
  private static readonly TABLE_SEPARATOR_REGEX = /^\|[\s-]+\|[\s-]+\|$/;

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
        URL.revokeObjectURL(wasmUrl);
      } else {
        throw new Error("Missing sqlJsCode and wasmBytes for initialization");
      }

      this.initialized = true;
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

  // Transaction support
  beginTransaction(): void {
    // Transactions disabled - no-op
  }

  commitTransaction(): void {
    // Transactions disabled - no-op
  }

  rollbackTransaction(): void {
    // Transactions disabled - no-op
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
        type: "error",
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // Backup database management
  private backupDatabases = new Map<string, any>();
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

  // Check if migration is needed and request it from main thread
  checkMigrationNeeded(currentSchemaVersion: number): void {
    if (!this.db) throw new Error("Database not initialized");

    try {
      // Check current schema version
      const versionResult = this.db.exec("PRAGMA user_version");
      const currentVersion = Number(versionResult[0]?.values[0]?.[0]) || 0;

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

  /**
   * Parse flashcards from content string (optimized single-pass parsing)
   */
  parseFlashcardsFromContent(
    content: string,
    headerLevel: number = 2,
  ): ParsedFlashcard[] {
    const lines = content.split("\n");
    const flashcards: ParsedFlashcard[] = [];

    // Single pass through lines for both table and header parsing
    let inTable = false;
    let headerSeen = false;
    let currentHeader: { text: string; level: number } | null = null;
    let currentContent: string[] = [];
    let inFrontmatter = false;
    let skipNextParagraph = false;

    // Use pre-compiled regex patterns for better performance

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Handle frontmatter
      if (i === 0 && trimmedLine === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (trimmedLine === "---") {
          inFrontmatter = false;
        }
        continue;
      }

      // Check for table rows
      if (SimpleDatabaseWorker.TABLE_ROW_REGEX.test(trimmedLine)) {
        if (!inTable) {
          inTable = true;
          headerSeen = false;
        }

        // Skip header and separator rows
        if (!headerSeen) {
          headerSeen = true;
          continue;
        }
        if (SimpleDatabaseWorker.TABLE_SEPARATOR_REGEX.test(trimmedLine)) {
          continue;
        }

        // Parse table row
        const cells = trimmedLine
          .slice(1, -1) // Remove leading/trailing pipes
          .split("|")
          .map((cell) => cell.trim());

        if (cells.length >= 2 && cells[0] && cells[1]) {
          flashcards.push({
            front: cells[0],
            back: cells[1],
            type: "table",
          });
        }
      } else {
        // Not a table row, end table processing
        if (inTable) {
          inTable = false;
        }

        // Check for headers
        const headerMatch = SimpleDatabaseWorker.HEADER_REGEX.exec(line);
        if (headerMatch) {
          const currentHeaderLevel = headerMatch[1].length;

          // Check for title headers to skip
          if (line.match(/^#\s+/) && line.toLowerCase().includes("flashcard")) {
            skipNextParagraph = true;
            this.finalizeCurrentHeader(
              currentHeader,
              currentContent,
              flashcards,
              headerLevel,
            );
            currentHeader = null;
            currentContent = [];
            continue;
          }

          // Finalize previous header
          this.finalizeCurrentHeader(
            currentHeader,
            currentContent,
            flashcards,
            headerLevel,
          );

          // Start new header
          currentHeader = {
            text: line,
            level: currentHeaderLevel,
          };
          currentContent = [];
          skipNextParagraph = false;
        } else if (skipNextParagraph) {
          if (trimmedLine === "") {
            skipNextParagraph = false;
          }
        } else if (currentHeader) {
          // Skip empty lines at the beginning of content
          if (trimmedLine === "" && currentContent.length === 0) {
            continue;
          }
          currentContent.push(line);
        }
      }
    }

    // Finalize last header
    this.finalizeCurrentHeader(
      currentHeader,
      currentContent,
      flashcards,
      headerLevel,
    );

    return flashcards;
  }

  /**
   * Helper to finalize current header flashcard
   */
  private finalizeCurrentHeader(
    currentHeader: { text: string; level: number } | null,
    currentContent: string[],
    flashcards: ParsedFlashcard[],
    targetHeaderLevel: number,
  ): void {
    if (
      currentHeader &&
      currentContent.length > 0 &&
      currentHeader.level === targetHeaderLevel
    ) {
      flashcards.push({
        front: currentHeader.text.replace(/^#{1,6}\s+/, ""),
        back: currentContent.join("\n").trim(),
        type: "header-paragraph",
      });
    }
  }

  /**
   * Generate unique flashcard ID using hash of front text only
   */
  generateFlashcardId(frontText: string): string {
    // Use only front text for ID generation to preserve progress across deck changes
    let hash = 0;
    for (let i = 0; i < frontText.length; i++) {
      const char = frontText.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `card_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Generate content hash for flashcard back content (front is used for ID)
   */
  generateContentHash(back: string): string {
    let hash = 0;
    for (let i = 0; i < back.length; i++) {
      const char = back.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Execute batch database operations using transactions
   */
  executeBatchOperations(operations: BatchOperation[]): void {
    if (!this.db) throw new Error("Database not initialized");

    // Group operations by type for batch processing
    const deleteOps = operations.filter(
      (op) => op.type === "delete" && op.flashcardId,
    );
    const createOps = operations.filter(
      (op) => op.type === "create" && op.flashcard,
    );
    const updateOps = operations.filter(
      (op) => op.type === "update" && op.flashcardId && op.updates,
    );

    // Execute DELETE operations
    for (const op of deleteOps) {
      const stmt = this.db.prepare("DELETE FROM flashcards WHERE id = ?");
      stmt.run([op.flashcardId]);
      stmt.free();
    }

    // Execute CREATE operations with INSERT OR REPLACE to handle duplicates
    for (const op of createOps) {
      const flashcard = op.flashcard;
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO flashcards (
          id, deck_id, front, back, type, source_file, content_hash,
          state, due_date, interval, repetitions, difficulty, stability,
          lapses, last_reviewed, created, modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      stmt.run([
        flashcard.id,
        flashcard.deckId,
        flashcard.front,
        flashcard.back,
        flashcard.type,
        flashcard.sourceFile,
        flashcard.contentHash,
        flashcard.state,
        flashcard.dueDate,
        flashcard.interval,
        flashcard.repetitions,
        flashcard.difficulty,
        flashcard.stability,
        flashcard.lapses,
        flashcard.lastReviewed,
      ]);
      stmt.free();
    }

    // Execute UPDATE operations
    for (const op of updateOps) {
      const updates = op.updates;
      const stmt = this.db.prepare(`
        UPDATE flashcards SET
          front = ?, back = ?, type = ?, content_hash = ?, modified = datetime('now')
        WHERE id = ?
      `);
      stmt.run([
        updates.front,
        updates.back,
        updates.type,
        updates.contentHash,
        op.flashcardId,
      ]);
      stmt.free();
    }
  }

  /**
   * Sync flashcards for a deck - main worker operation
   */
  syncFlashcardsForDeck(data: {
    deckId: string;
    deckName: string;
    deckFilepath: string;
    deckConfig: any;
    fileContent: string;
    force: boolean;
  }): any {
    try {
      // Parse flashcards from content
      const parsedCards = this.parseFlashcardsFromContent(
        data.fileContent,
        data.deckConfig.headerLevel || 2,
      );

      // Get existing flashcards
      const existingFlashcardsStmt = this.db.prepare(
        "SELECT * FROM flashcards WHERE deck_id = ?",
      );
      const existingFlashcardsResult = [];
      existingFlashcardsStmt.bind([data.deckId]);
      while (existingFlashcardsStmt.step()) {
        existingFlashcardsResult.push(existingFlashcardsStmt.get());
      }
      existingFlashcardsStmt.free();

      // Convert to map for easier lookup
      const existingById = new Map();
      existingFlashcardsResult.forEach((row: any[]) => {
        const flashcard = {
          id: row[0],
          deckId: row[1],
          front: row[2],
          back: row[3],
          type: row[4],
          sourceFile: row[5],
          contentHash: row[6],
          state: row[7],
          dueDate: row[8],
          interval: row[9],
          repetitions: row[10],
          difficulty: row[11],
          stability: row[12],
          lapses: row[13],
          lastReviewed: row[14],
        };
        existingById.set(flashcard.id, flashcard);
      });

      const processedIds = new Set<string>();
      const batchOperations: BatchOperation[] = [];

      // Process parsed cards
      for (const parsed of parsedCards.slice(0, 50000)) {
        // Limit to 50k cards
        const flashcardId = this.generateFlashcardId(parsed.front);
        const contentHash = this.generateContentHash(parsed.back);
        const existingCard = existingById.get(flashcardId);

        if (processedIds.has(flashcardId)) {
          continue; // Skip duplicates
        }

        processedIds.add(flashcardId);

        if (existingCard) {
          // Update if content has changed
          if (existingCard.contentHash !== contentHash) {
            batchOperations.push({
              type: "update",
              flashcardId: existingCard.id,
              updates: {
                front: parsed.front,
                back: parsed.back,
                type: parsed.type,
                contentHash: contentHash,
              },
            });
          }
        } else {
          // Check for existing review logs to restore progress
          const reviewLogStmt = this.db.prepare(`
            SELECT new_state, new_interval_minutes, new_repetitions, new_difficulty,
                   new_stability, new_lapses, reviewed_at
            FROM review_logs
            WHERE flashcard_id = ?
            ORDER BY reviewed_at DESC
            LIMIT 1
          `);
          reviewLogStmt.bind([flashcardId]);
          const reviewLogRow = reviewLogStmt.step()
            ? reviewLogStmt.get()
            : null;
          reviewLogStmt.free();

          // Create new flashcard with restored progress if available
          const flashcard = {
            id: flashcardId,
            deckId: data.deckId,
            front: parsed.front,
            back: parsed.back,
            type: parsed.type,
            sourceFile: data.deckFilepath,
            contentHash: contentHash,

            // Restore progress from review logs or use defaults
            state: reviewLogRow ? reviewLogRow[0] : "new",
            dueDate: reviewLogRow
              ? new Date(
                  new Date(reviewLogRow[6]).getTime() +
                    reviewLogRow[1] * 60 * 1000,
                ).toISOString()
              : new Date().toISOString(),
            interval: reviewLogRow ? reviewLogRow[1] : 0,
            repetitions: reviewLogRow ? reviewLogRow[2] : 0,
            difficulty: reviewLogRow ? reviewLogRow[3] : 5.0,
            stability: reviewLogRow ? reviewLogRow[4] : 2.5,
            lapses: reviewLogRow ? reviewLogRow[5] : 0,
            lastReviewed: reviewLogRow ? reviewLogRow[6] : null,
          };

          batchOperations.push({
            type: "create",
            flashcard: flashcard,
          });
        }
      }

      // Delete flashcards that are no longer in the file
      for (const [flashcardId, existingCard] of existingById) {
        if (!processedIds.has(flashcardId)) {
          batchOperations.push({
            type: "delete",
            flashcardId: existingCard.id,
          });
        }
      }

      // Execute all batch operations
      if (batchOperations.length > 0) {
        this.executeBatchOperations(batchOperations);
      }

      // Update deck's modified timestamp
      const updateDeckStmt = this.db.prepare(
        "UPDATE decks SET modified = datetime('now') WHERE id = ?",
      );
      updateDeckStmt.run([data.deckId]);
      updateDeckStmt.free();

      return {
        success: true,
        parsedCount: parsedCards.length,
        operationsCount: batchOperations.length,
      };
    } catch (error) {
      throw new Error(`Sync failed: ${(error as Error).message}`);
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
          } else {
            worker.checkMigrationNeeded(currentSchemaVersion);
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
          flashcards: worker.parseFlashcardsFromContent(
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
