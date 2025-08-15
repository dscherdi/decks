import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import { DataAdapter } from "obsidian";
import {
  Deck,
  DeckConfig,
  ReviewOrder,
  Flashcard,
  ReviewLog,
  ReviewSession,
  DeckStats,
  Statistics,
  DEFAULT_DECK_CONFIG,
  hasNewCardsLimit,
  hasReviewCardsLimit,
} from "./types";
import { SQL_QUERIES } from "./schemas";
import { createTables, migrate, needsMigration } from "./migrations";

export class DatabaseService {
  private db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private dbPath: string;
  private adapter: DataAdapter;
  private debugLog: (message: string, ...args: any[]) => void;

  constructor(
    dbPath: string,
    adapter: DataAdapter,
    debugLog: (message: string, ...args: any[]) => void,
  ) {
    this.dbPath = dbPath;
    this.adapter = adapter;
    this.debugLog = debugLog;
  }

  async initialize(): Promise<void> {
    try {
      // Initialize sql.js
      this.SQL = await initSqlJs({
        locateFile: (file) => `https://sql.js.org/dist/${file}`,
      });

      // Try to load existing database or create new one
      const buffer = await this.loadDatabaseFile();
      if (buffer) {
        // Existing database file - load and check for migration
        this.db = new this.SQL.Database(new Uint8Array(buffer));
        await this.migrateSchemaIfNeeded();
      } else {
        // No database file exists - create fresh database
        this.db = new this.SQL.Database();
        await this.createFreshDatabase();
      }
    } catch (error) {
      console.error("Failed to initialize database:", error);
      throw error;
    }
  }

  private async loadDatabaseFile(): Promise<ArrayBuffer | null> {
    try {
      if (await this.adapter.exists(this.dbPath)) {
        const data = await this.adapter.readBinary(this.dbPath);
        return data;
      }
      return null;
    } catch (error) {
      this.debugLog("Database file doesn't exist yet, will create new one");
      return null;
    }
  }

  async save(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    try {
      const data = this.db.export();

      // Ensure directory exists
      const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
      if (!(await this.adapter.exists(dir))) {
        await this.adapter.mkdir(dir);
      }

      await this.adapter.writeBinary(this.dbPath, Buffer.from(data));
    } catch (error) {
      console.error("Failed to save database:", error);
      throw error;
    }
  }

  // Generic CRUD helper methods
  private executeStatement(sql: string, params: any[] = []): void {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
  }

  private executeStatementWithSave(
    sql: string,
    params: any[] = [],
  ): Promise<void> {
    return this.executeStatementWithCallback(sql, params, () => this.save());
  }

  private async executeStatementWithCallback(
    sql: string,
    params: any[],
    callback?: () => Promise<void>,
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    let stmt;
    try {
      stmt = this.db.prepare(sql);
      stmt.run(params);
      stmt.free();
      stmt = null;
      if (callback) {
        await callback();
      }
    } catch (error) {
      if (stmt) {
        try {
          stmt.free();
        } catch (freeError) {
          console.error(`Failed to free statement:`, freeError);
        }
      }
      throw error;
    }
  }

  private queryAll<T>(
    sql: string,
    params: any[] = [],
    parser: (row: any) => T,
  ): T[] {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(sql);
    const results: T[] = [];
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      while (stmt.step()) {
        results.push(parser(stmt.get()));
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  private queryOne<T>(
    sql: string,
    params: any[] = [],
    parser: (row: any) => T,
  ): T | null {
    const results = this.queryAll(sql, params, parser);
    return results.length > 0 ? results[0] : null;
  }

  // Transaction methods
  beginTransaction(): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.run("BEGIN TRANSACTION;");
  }

  commitTransaction(): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.run("COMMIT;");
  }

  rollbackTransaction(): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.run("ROLLBACK;");
  }

  // Batch operations using single prepared statements
  batchCreateFlashcards(
    flashcards: Array<Omit<Flashcard, "created" | "modified">>,
  ): void {
    if (!this.db) throw new Error("Database not initialized");
    if (flashcards.length === 0) return;

    const stmt = this.db.prepare(SQL_QUERIES.INSERT_FLASHCARD);
    const now = new Date().toISOString();

    try {
      for (const flashcard of flashcards) {
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
          now, // created
          now, // modified
        ]);
      }
    } finally {
      stmt.free();
    }
  }

  batchUpdateFlashcards(
    updates: Array<{
      id: string;
      updates: Partial<
        Pick<
          Flashcard,
          | "front"
          | "back"
          | "type"
          | "contentHash"
          | "state"
          | "dueDate"
          | "interval"
          | "repetitions"
          | "difficulty"
          | "stability"
          | "lapses"
          | "lastReviewed"
        >
      >;
    }>,
  ): void {
    if (!this.db) throw new Error("Database not initialized");
    if (updates.length === 0) return;

    const now = new Date().toISOString();

    // Group updates by fields to minimize prepared statements
    const updateGroups = new Map<
      string,
      Array<{ id: string; values: any[] }>
    >();

    for (const { id, updates: updateData } of updates) {
      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(updateData)) {
        if (value !== undefined) {
          const dbField =
            key === "dueDate"
              ? "due_date"
              : key === "lastReviewed"
                ? "last_reviewed"
                : key === "contentHash"
                  ? "content_hash"
                  : key;
          fields.push(`${dbField} = ?`);
          values.push(value);
        }
      }

      if (fields.length === 0) continue;

      fields.push("modified = ?");
      values.push(now, id);

      const fieldSignature = fields.slice(0, -1).join(","); // Exclude modified field for grouping
      if (!updateGroups.has(fieldSignature)) {
        updateGroups.set(fieldSignature, []);
      }
      updateGroups.get(fieldSignature)!.push({ id, values });
    }

    // Execute grouped updates
    for (const [fieldSignature, groupUpdates] of updateGroups) {
      const fields = fieldSignature.split(",").map((f) => f.trim());
      fields.push("modified = ?");
      const sql = `UPDATE flashcards SET ${fields.join(", ")} WHERE id = ?`;
      const stmt = this.db.prepare(sql);

      try {
        for (const { values } of groupUpdates) {
          stmt.run(values);
        }
      } finally {
        stmt.free();
      }
    }
  }

  batchDeleteFlashcards(flashcardIds: string[]): void {
    if (!this.db) throw new Error("Database not initialized");
    if (flashcardIds.length === 0) return;

    const stmt = this.db.prepare(SQL_QUERIES.DELETE_FLASHCARD);

    try {
      for (const id of flashcardIds) {
        stmt.run([id]);
      }
    } finally {
      stmt.free();
    }
  }

  private async createFreshDatabase(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    try {
      this.debugLog("Creating fresh database schema...");
      createTables(this.db, this.debugLog.bind(this));
      await this.save();
      this.debugLog("Fresh database created successfully");
    } catch (error) {
      this.debugLog(`Fresh database creation failed: ${error}`);
      throw new Error(`Fresh database creation failed: ${error}`);
    }
  }

  // Helper method to parse deck rows
  private parseDeckRow(row: any[]): Deck {
    let config = DEFAULT_DECK_CONFIG;

    if (row[5]) {
      try {
        config = JSON.parse(row[5] as string);
      } catch (error) {
        this.debugLog(
          `Failed to parse deck config JSON: ${row[5]}, using default config. Error: ${error}`,
        );
        config = DEFAULT_DECK_CONFIG;
      }
    }

    // Migration: Add FSRS settings if missing
    if (!config.fsrs) {
      config = {
        ...config,
        fsrs: DEFAULT_DECK_CONFIG.fsrs,
      };
    }

    // Migration: Add new property names if missing
    if (
      config.newCardsPerDay === undefined &&
      (config as any).newCardsLimit !== undefined
    ) {
      config = {
        ...config,
        newCardsPerDay: (config as any).enableNewCardsLimit
          ? (config as any).newCardsLimit
          : 0,
        reviewCardsPerDay: (config as any).enableReviewCardsLimit
          ? (config as any).reviewCardsLimit
          : 0,
      };
    }

    // Migration: Add headerLevel if missing
    if (config.headerLevel === undefined) {
      config = {
        ...config,
        headerLevel: DEFAULT_DECK_CONFIG.headerLevel,
      };
    }

    return {
      id: row[0] as string,
      name: row[1] as string,
      filepath: row[2] as string,
      tag: row[3] as string,
      lastReviewed: row[4] as string | null,
      config,
      created: row[6] as string,
      modified: row[7] as string,
    };
  }

  // Deck operations
  async createDeck(deck: Omit<Deck, "created" | "modified">): Promise<Deck> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();
    const fullDeck: Deck = {
      ...deck,
      created: now,
      modified: now,
    };

    try {
      const stmt = this.db.prepare(SQL_QUERIES.INSERT_DECK);

      stmt.run([
        fullDeck.id,
        fullDeck.name,
        fullDeck.filepath,
        fullDeck.tag,
        fullDeck.lastReviewed,
        JSON.stringify(fullDeck.config),
        fullDeck.created,
        fullDeck.modified,
      ]);
      stmt.free();

      await this.save();
      return fullDeck;
    } catch (error) {
      throw error;
    }
  }

  async getDeckByTag(tag: string): Promise<Deck | null> {
    return this.queryOne(
      SQL_QUERIES.GET_DECK_BY_TAG,
      [tag],
      this.parseDeckRow.bind(this),
    );
  }

  async getDeckByFilepath(filepath: string): Promise<Deck | null> {
    return this.queryOne(
      SQL_QUERIES.GET_DECK_BY_FILEPATH,
      [filepath],
      this.parseDeckRow.bind(this),
    );
  }

  async getDeckById(id: string): Promise<Deck | null> {
    return this.queryOne(
      SQL_QUERIES.GET_DECK_BY_ID,
      [id],
      this.parseDeckRow.bind(this),
    );
  }

  async updateDeck(
    deckId: string,
    updates: Partial<Pick<Deck, "name" | "tag" | "lastReviewed" | "config">>,
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();

    // Handle empty updates object - no database changes needed
    if (Object.keys(updates).length === 0) {
      return;
    }

    const updateFields = Object.keys(updates)
      .map((key) => {
        const dbField = key === "lastReviewed" ? "last_reviewed" : key;
        return `${dbField} = ?`;
      })
      .join(", ");

    const sql = `UPDATE decks SET ${updateFields}, modified = ? WHERE id = ?`;
    const stmt = this.db.prepare(sql);

    const values: (string | null)[] = Object.values(updates).map(
      (value, index) => {
        const key = Object.keys(updates)[index];
        return key === "config"
          ? JSON.stringify(value)
          : (value as string | null);
      },
    );
    values.push(now, deckId);
    stmt.run(values);
    stmt.free();
    await this.save();
  }

  private updateDeckTimestampCore(deckId: string, timestamp: string): void {
    this.executeStatement(SQL_QUERIES.UPDATE_DECK_TIMESTAMP, [
      timestamp,
      deckId,
    ]);
  }

  async updateDeckTimestamp(deckId: string, timestamp: string): Promise<void> {
    this.updateDeckTimestampCore(deckId, timestamp);
    await this.save();
  }

  // Version without save for use in transactions
  async updateDeckTimestampWithoutSave(
    deckId: string,
    timestamp: string,
  ): Promise<void> {
    this.updateDeckTimestampCore(deckId, timestamp);
  }

  async getAllDecks(): Promise<Deck[]> {
    return this.queryAll(
      SQL_QUERIES.GET_ALL_DECKS,
      [],
      this.parseDeckRow.bind(this),
    );
  }

  async updateDeckLastReviewed(deckId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.executeStatementWithSave(SQL_QUERIES.UPDATE_DECK_LAST_REVIEWED, [
      now,
      now,
      deckId,
    ]);
  }

  async updateDeckHeaderLevel(
    deckId: string,
    headerLevel: number,
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();

    // Update the header_level column directly
    const stmt = this.db.prepare(`
      UPDATE decks
      SET header_level = ?, modified = ?
      WHERE id = ?
    `);

    stmt.run([headerLevel, now, deckId]);
    stmt.free();
    await this.save();
  }

  async renameDeck(
    oldDeckId: string,
    newDeckId: string,
    newName: string,
    newFilepath: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.executeStatementWithSave(SQL_QUERIES.RENAME_DECK, [
      newDeckId,
      newName,
      newFilepath,
      now,
      oldDeckId,
    ]);
  }

  async deleteDeckByFilepath(filepath: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // First get the deck to find its ID
    const deck = await this.getDeckByFilepath(filepath);
    if (!deck) return; // Deck doesn't exist

    // Don't delete flashcards to preserve progress - they will be orphaned but can be reassigned later
    // Only review logs are preserved for historical data

    // Finally delete the deck
    const stmt = this.db.prepare(SQL_QUERIES.DELETE_DECK_BY_FILEPATH);
    stmt.run([filepath]);
    stmt.free();

    await this.save();
  }

  async deleteDeck(deckId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Don't delete flashcards to preserve progress - they will be orphaned but can be reassigned later
    // Only review logs are preserved for historical data

    // Finally delete the deck
    const stmt = this.db.prepare(SQL_QUERIES.DELETE_DECK);
    stmt.run([deckId]);
    stmt.free();

    await this.save();
  }

  // Flashcard operations
  private createFlashcardCore(
    flashcard: Omit<Flashcard, "created" | "modified">,
  ): Flashcard {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();
    const fullFlashcard: Flashcard = {
      ...flashcard,
      created: now,
      modified: now,
    };

    let stmt;
    try {
      stmt = this.db.prepare(SQL_QUERIES.INSERT_FLASHCARD);
      stmt.run([
        fullFlashcard.id,
        fullFlashcard.deckId,
        fullFlashcard.front,
        fullFlashcard.back,
        fullFlashcard.type,
        fullFlashcard.sourceFile,
        fullFlashcard.contentHash,
        fullFlashcard.state,
        fullFlashcard.dueDate,
        flashcard.interval,
        flashcard.repetitions,
        flashcard.difficulty,
        flashcard.stability,
        flashcard.lapses,
        fullFlashcard.lastReviewed,
        fullFlashcard.created,
        fullFlashcard.modified,
      ]);
      stmt.free();
      return fullFlashcard;
    } catch (error) {
      console.error(`Failed to create flashcard ${fullFlashcard.id}:`, error);
      if (stmt) {
        try {
          stmt.free();
        } catch (freeError) {
          console.error(`Failed to free statement:`, freeError);
        }
      }
      throw error;
    }
  }

  async createFlashcard(
    flashcard: Omit<Flashcard, "created" | "modified">,
  ): Promise<Flashcard> {
    const result = this.createFlashcardCore(flashcard);
    await this.save();
    return result;
  }

  // Version without save for use in transactions
  async createFlashcardWithoutSave(
    flashcard: Omit<Flashcard, "created" | "modified">,
  ): Promise<Flashcard> {
    return this.createFlashcardCore(flashcard);
  }

  private updateFlashcardCore(
    flashcardId: string,
    updates: Partial<
      Pick<
        Flashcard,
        | "front"
        | "back"
        | "type"
        | "contentHash"
        | "state"
        | "dueDate"
        | "interval"
        | "repetitions"
        | "difficulty"
        | "stability"
        | "lapses"
        | "lastReviewed"
      >
    >,
  ): void {
    const now = new Date().toISOString();
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const dbField =
          key === "dueDate"
            ? "due_date"
            : key === "lastReviewed"
              ? "last_reviewed"
              : key === "contentHash"
                ? "content_hash"
                : key;
        fields.push(`${dbField} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) return;

    fields.push("modified = ?");
    values.push(now, flashcardId);

    const sql = `UPDATE flashcards SET ${fields.join(", ")} WHERE id = ?`;
    this.executeStatement(sql, values);
  }

  async updateFlashcard(
    flashcardId: string,
    updates: Partial<
      Pick<
        Flashcard,
        | "front"
        | "back"
        | "type"
        | "contentHash"
        | "state"
        | "dueDate"
        | "interval"
        | "repetitions"
        | "difficulty"
        | "stability"
        | "lapses"
        | "lastReviewed"
      >
    >,
  ): Promise<void> {
    this.updateFlashcardCore(flashcardId, updates);
    await this.save();
  }

  // Version without save for use in transactions
  async updateFlashcardWithoutSave(
    flashcardId: string,
    updates: Partial<
      Pick<
        Flashcard,
        | "front"
        | "back"
        | "type"
        | "contentHash"
        | "state"
        | "dueDate"
        | "interval"
        | "repetitions"
        | "difficulty"
        | "stability"
        | "lapses"
        | "lastReviewed"
      >
    >,
  ): Promise<void> {
    this.updateFlashcardCore(flashcardId, updates);
  }

  private deleteFlashcardCore(flashcardId: string): void {
    this.executeStatement(SQL_QUERIES.DELETE_FLASHCARD, [flashcardId]);
  }

  async deleteFlashcard(flashcardId: string): Promise<void> {
    this.deleteFlashcardCore(flashcardId);
    await this.save();
  }

  // Version without save for use in transactions
  async deleteFlashcardWithoutSave(flashcardId: string): Promise<void> {
    this.deleteFlashcardCore(flashcardId);
  }

  async updateFlashcardDeckIds(
    oldDeckId: string,
    newDeckId: string,
  ): Promise<void> {
    await this.executeStatementWithSave(SQL_QUERIES.UPDATE_FLASHCARD_DECK_IDS, [
      newDeckId,
      oldDeckId,
    ]);
  }

  async getFlashcardsByDeck(deckId: string): Promise<Flashcard[]> {
    return this.queryAll(
      SQL_QUERIES.GET_FLASHCARDS_BY_DECK,
      [deckId],
      this.rowToFlashcard.bind(this),
    );
  }

  async getDueFlashcards(deckId: string): Promise<Flashcard[]> {
    const now = new Date().toISOString();
    return this.queryAll(
      SQL_QUERIES.GET_DUE_FLASHCARDS,
      [deckId, now],
      this.rowToFlashcard.bind(this),
    );
  }

  async getDailyReviewCounts(
    deckId: string,
  ): Promise<{ newCount: number; reviewCount: number }> {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format
    const todayStart = `${today}T00:00:00.000Z`;
    const todayEnd = `${today}T23:59:59.999Z`;

    // Count new cards reviewed today (reviews where old_repetitions was 0)
    const newResult = this.queryOne(
      SQL_QUERIES.COUNT_NEW_CARDS_TODAY,
      [deckId, todayStart, todayEnd],
      (row) => Number(row[0]),
    );
    const newCount = newResult || 0;

    // Count review cards reviewed today (reviews where old_interval_minutes > 0)
    const reviewResult = this.queryOne(
      SQL_QUERIES.COUNT_REVIEW_CARDS_TODAY,
      [deckId, todayStart, todayEnd],
      (row) => Number(row[0]),
    );
    const reviewCount = reviewResult || 0;

    return { newCount, reviewCount };
  }

  async getReviewableFlashcards(deckId: string): Promise<Flashcard[]> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();

    // Get deck config to check limits
    const deck = await this.getDeckById(deckId);
    if (!deck) {
      throw new Error(`Deck not found: ${deckId}`);
    }

    const config = deck.config;
    const flashcards: Flashcard[] = [];

    // Get today's review counts to calculate remaining daily allowance
    const dailyCounts = await this.getDailyReviewCounts(deckId);

    // 1. No learning cards in pure FSRS - skip learning card retrieval

    // 2. Get new cards with remaining daily limit
    const newCardsLimit = Number(config.newCardsPerDay) || 0;
    const newCountToday = Number(dailyCounts.newCount) || 0;
    const remainingNewCards =
      hasNewCardsLimit(config) && newCardsLimit > 0
        ? Math.max(0, newCardsLimit - newCountToday)
        : hasNewCardsLimit(config) && newCardsLimit === 0
          ? 0
          : Number.MAX_SAFE_INTEGER;

    if (remainingNewCards > 0) {
      const sql = `${SQL_QUERIES.GET_NEW_CARDS_FOR_REVIEW}${hasNewCardsLimit(config) ? ` LIMIT ${remainingNewCards}` : ""}`;
      const newCardsStmt = this.db.prepare(sql);
      newCardsStmt.bind([deckId, now]);
      while (newCardsStmt.step()) {
        const row = newCardsStmt.get();
        flashcards.push(this.rowToFlashcard(row));
      }
      newCardsStmt.free();
    }

    // 3. Get review cards with remaining daily limit
    const reviewCardsLimit = Number(config.reviewCardsPerDay) || 0;
    const reviewCountToday = Number(dailyCounts.reviewCount) || 0;
    const remainingReviewCards =
      hasReviewCardsLimit(config) && reviewCardsLimit > 0
        ? Math.max(0, reviewCardsLimit - reviewCountToday)
        : hasReviewCardsLimit(config) && reviewCardsLimit === 0
          ? 0
          : Number.MAX_SAFE_INTEGER;

    if (remainingReviewCards > 0) {
      const sql = `${SQL_QUERIES.GET_REVIEW_CARDS_FOR_REVIEW}${hasReviewCardsLimit(config) ? ` LIMIT ${remainingReviewCards}` : ""}`;
      const reviewCardsStmt = this.db.prepare(sql);
      reviewCardsStmt.bind([deckId, now]);
      while (reviewCardsStmt.step()) {
        const row = reviewCardsStmt.get();
        flashcards.push(this.rowToFlashcard(row));
      }
      reviewCardsStmt.free();
    }

    // Sort final result: review first, then new
    flashcards.sort((a, b) => {
      const stateOrder = { review: 1, new: 2 };
      const aOrder = stateOrder[a.state];
      const bOrder = stateOrder[b.state];

      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      // Within same state, apply specific ordering rules
      if (a.state === "review") {
        // Review cards: follow deck config preference
        if (config.reviewOrder === "random") {
          return Math.random() - 0.5;
        } else {
          // Default: oldest due first
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        }
      } else if (a.state === "new") {
        // New cards: always by due date (earliest first)
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }

      return 0;
    });

    return flashcards;
  }

  async getLatestReviewLogForFlashcard(
    flashcardId: string,
  ): Promise<ReviewLog | null> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.GET_LATEST_REVIEW_LOG);

    stmt.bind([flashcardId]);

    if (stmt.step()) {
      const row = stmt.get();
      stmt.free();

      return {
        id: row[0] as string,
        flashcardId: row[1] as string,
        lastReviewedAt: row[2] as string,
        shownAt: row[3] as string | undefined,
        reviewedAt: row[4] as string,
        rating: row[5] as 1 | 2 | 3 | 4,
        ratingLabel: row[6] as "again" | "hard" | "good" | "easy",
        timeElapsedMs: row[7] as number | undefined,
        oldState: row[8] as "new" | "review",
        oldRepetitions: row[9] as number,
        oldLapses: row[10] as number,
        oldStability: row[11] as number,
        oldDifficulty: row[12] as number,
        newState: row[13] as "new" | "review",
        newRepetitions: row[14] as number,
        newLapses: row[15] as number,
        newStability: row[16] as number,
        newDifficulty: row[17] as number,
        oldIntervalMinutes: row[18] as number,
        newIntervalMinutes: row[19] as number,
        oldDueAt: row[20] as string,
        newDueAt: row[21] as string,
        elapsedDays: row[22] as number,
        retrievability: row[23] as number,
        requestRetention: row[24] as number,
        profile: ((row[25] as string) || "STANDARD") as
          | "INTENSIVE"
          | "STANDARD",
        maximumIntervalDays: row[26] as number,
        minMinutes: row[27] as number,
        fsrsWeightsVersion: row[28] as string,
        schedulerVersion: row[29] as string,
        noteModelId: row[30] as string | undefined,
        cardTemplateId: row[31] as string | undefined,
        contentHash: row[32] as string | undefined,
        client: row[33] as "web" | "desktop" | "mobile" | undefined,
      };
    }

    stmt.free();
    return null;
  }

  async deleteFlashcardsByFile(sourceFile: string): Promise<void> {
    await this.executeStatementWithSave(SQL_QUERIES.DELETE_FLASHCARDS_BY_FILE, [
      sourceFile,
    ]);
  }

  // Review log operations
  async createReviewLog(log: Omit<ReviewLog, "id">): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const id = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const stmt = this.db.prepare(SQL_QUERIES.INSERT_REVIEW_LOG);

    stmt.run([
      id,
      log.flashcardId,
      log.sessionId || null,
      log.lastReviewedAt,
      log.shownAt || null,
      log.reviewedAt,
      log.rating,
      log.ratingLabel,
      log.timeElapsedMs || null,
      log.oldState,
      log.oldRepetitions,
      log.oldLapses,
      log.oldStability,
      log.oldDifficulty,
      log.newState,
      log.newRepetitions,
      log.newLapses,
      log.newStability,
      log.newDifficulty,
      log.oldIntervalMinutes,
      log.newIntervalMinutes,
      log.oldDueAt,
      log.newDueAt,
      log.elapsedDays,
      log.retrievability,
      log.requestRetention,
      log.profile,
      log.maximumIntervalDays,
      log.minMinutes,
      log.fsrsWeightsVersion,
      log.schedulerVersion,
      log.noteModelId || null,
      log.cardTemplateId || null,
      log.contentHash || null,
      log.client || null,
    ]);
    stmt.free();

    await this.save();
  }

  // Review session operations
  async createReviewSession(
    session: Omit<ReviewSession, "id">,
  ): Promise<string> {
    if (!this.db) throw new Error("Database not initialized");

    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const stmt = this.db.prepare(SQL_QUERIES.INSERT_REVIEW_SESSION);
    stmt.run([
      id,
      session.deckId,
      session.startedAt,
      session.endedAt || null,
      session.goalTotal,
      session.doneUnique,
    ]);
    stmt.free();

    await this.save();
    return id;
  }

  async getReviewSessionById(sessionId: string): Promise<ReviewSession | null> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.GET_REVIEW_SESSION_BY_ID);
    stmt.bind([sessionId]);

    if (stmt.step()) {
      const row = stmt.get();
      stmt.free();
      return this.rowToReviewSession(row);
    }

    stmt.free();
    return null;
  }

  async getActiveReviewSession(deckId: string): Promise<ReviewSession | null> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.GET_ACTIVE_REVIEW_SESSION);
    stmt.bind([deckId]);

    if (stmt.step()) {
      const row = stmt.get();
      stmt.free();
      return this.rowToReviewSession(row);
    }

    stmt.free();
    return null;
  }

  async updateReviewSessionDoneUnique(
    sessionId: string,
    doneUnique: number,
  ): Promise<void> {
    await this.executeStatementWithSave(
      SQL_QUERIES.UPDATE_REVIEW_SESSION_DONE_UNIQUE,
      [doneUnique, sessionId],
    );
  }

  async endReviewSession(sessionId: string, endedAt: string): Promise<void> {
    await this.executeStatementWithSave(SQL_QUERIES.UPDATE_REVIEW_SESSION_END, [
      endedAt,
      sessionId,
    ]);
  }

  async isCardReviewedInSession(
    sessionId: string,
    flashcardId: string,
  ): Promise<boolean> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.CHECK_CARD_REVIEWED_IN_SESSION);
    stmt.bind([sessionId, flashcardId]);

    let count = 0;
    if (stmt.step()) {
      const row = stmt.get();
      count = row[0] as number;
    }
    stmt.free();

    return count > 0;
  }

  // Statistics operations
  async getDeckStats(deckId: string): Promise<DeckStats> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();

    // Get deck config to check limits
    const deck = await this.getDeckById(deckId);
    if (!deck) {
      throw new Error(`Deck not found: ${deckId}`);
    }

    const config = deck.config;

    // Get today's review counts to calculate remaining daily allowance
    const dailyCounts = await this.getDailyReviewCounts(deckId);

    // Count new cards (state = 'new' and due for first review)
    const newStmt = this.db.prepare(SQL_QUERIES.COUNT_NEW_CARDS);
    newStmt.bind([deckId, now]);
    newStmt.step();
    const totalNewCards = (newStmt.get()[0] as number) || 0;
    newStmt.free();

    // Calculate remaining new cards based on daily limit
    let newCount = totalNewCards;
    const newCardsLimit = Number(config.newCardsPerDay) || 0;
    const newCountToday = Number(dailyCounts.newCount) || 0;
    if (hasNewCardsLimit(config) && newCardsLimit > 0) {
      const remainingNew = Math.max(0, newCardsLimit - newCountToday);
      newCount = Math.min(totalNewCards, remainingNew);
    } else if (hasNewCardsLimit(config) && newCardsLimit === 0) {
      newCount = 0; // No new cards allowed when limit is 0
    }

    // No learning cards in pure FSRS
    const learningCount = 0;

    // Count review cards (state = 'review' and due)
    const dueStmt = this.db.prepare(SQL_QUERIES.COUNT_DUE_CARDS);
    dueStmt.bind([deckId, now]);
    dueStmt.step();
    const totalDueCards = (dueStmt.get()[0] as number) || 0;
    dueStmt.free();

    // Calculate remaining review cards based on daily limit
    let dueCount = totalDueCards;
    const reviewCardsLimit = Number(config.reviewCardsPerDay) || 0;
    const reviewCountToday = Number(dailyCounts.reviewCount) || 0;
    if (hasReviewCardsLimit(config) && reviewCardsLimit > 0) {
      const remainingReview = Math.max(0, reviewCardsLimit - reviewCountToday);
      dueCount = Math.min(totalDueCards, remainingReview);
    } else if (hasReviewCardsLimit(config) && reviewCardsLimit === 0) {
      dueCount = 0; // No review cards allowed when limit is 0
    }

    // Total count
    const totalStmt = this.db.prepare(SQL_QUERIES.COUNT_TOTAL_CARDS);
    totalStmt.bind([deckId]);
    totalStmt.step();
    const totalCount = (totalStmt.get()[0] as number) || 0;
    totalStmt.free();

    return {
      deckId,
      newCount,
      dueCount,
      totalCount,
    };
  }

  async getAllDeckStats(): Promise<DeckStats[]> {
    if (!this.db) throw new Error("Database not initialized");

    const decks = await this.getAllDecks();
    const stats: DeckStats[] = [];

    for (const deck of decks) {
      const deckStats = await this.getDeckStats(deck.id);
      stats.push(deckStats);
    }

    return stats;
  }

  async getReviewCountsByDate(
    days: number = 365,
  ): Promise<Map<string, number>> {
    if (!this.db) throw new Error("Database not initialized");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const stmt = this.db.prepare(SQL_QUERIES.GET_REVIEW_COUNTS_BY_DATE);

    stmt.bind([startDate.toISOString(), endDate.toISOString()]);
    const reviewCounts = new Map<string, number>();

    while (stmt.step()) {
      const row = stmt.get();
      const date = row[0] as string;
      const count = row[1] as number;
      reviewCounts.set(date, count);
    }

    stmt.free();
    return reviewCounts;
  }

  private async migrateSchemaIfNeeded(): Promise<void> {
    if (!this.db) return;

    try {
      this.debugLog("Starting database migration check...");

      if (needsMigration(this.db)) {
        this.debugLog("Migration needed, applying...");
        migrate(this.db, this.debugLog.bind(this));
        await this.save();
        this.debugLog("Migration completed successfully");
      } else {
        this.debugLog("Database schema is up to date");
      }
    } catch (error) {
      this.debugLog(`Migration failed: ${error}`);
      throw new Error(`Database migration failed: ${error}`);
    }
  }
  // Helper methods
  private rowToFlashcard(row: any[]): Flashcard {
    return {
      id: row[0] as string,
      deckId: row[1] as string,
      front: row[2] as string,
      back: row[3] as string,
      type: row[4] as "header-paragraph" | "table",
      sourceFile: row[5] as string,
      contentHash: row[6] as string,
      state: row[7] as "new" | "review",
      dueDate: row[8] as string,
      interval: row[9] as number,
      repetitions: row[10] as number,
      difficulty: row[11] as number,
      stability: row[12] as number,
      lapses: row[13] as number,
      lastReviewed: row[14] as string | null,
      created: row[15] as string,
      modified: row[16] as string,
    };
  }

  private rowToReviewSession(row: any[]): ReviewSession {
    return {
      id: row[0] as string,
      deckId: row[1] as string,
      startedAt: row[2] as string,
      endedAt: row[3] as string | null,
      goalTotal: row[4] as number,
      doneUnique: row[5] as number,
    };
  }

  async getOverallStatistics(
    deckFilter: string = "all",
    timeframe: string = "12months",
  ): Promise<Statistics> {
    if (!this.db) throw new Error("Database not initialized");

    try {
      // Determine date range based on timeframe
      const cutoffDate = new Date();
      if (timeframe === "12months") {
        cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
      } else {
        // For "all", go back 10 years (effectively all data)
        cutoffDate.setFullYear(cutoffDate.getFullYear() - 10);
      }

      // Build deck filter conditions
      let deckFilterCondition = "";
      let deckFilterParams: string[] = [];

      if (deckFilter.startsWith("deck:")) {
        const deckId = deckFilter.substring(5);
        deckFilterCondition = "AND f.deck_id = ?";
        deckFilterParams.push(deckId);
      } else if (deckFilter.startsWith("tag:")) {
        const tag = deckFilter.substring(4);
        deckFilterCondition = "AND d.tag = ?";
        deckFilterParams.push(tag);
      }
      // For "all", no additional filter needed

      const dailyStatsStmt = this.db.prepare(
        deckFilterCondition
          ? SQL_QUERIES.GET_DAILY_STATS_OVERALL.replace(
              "FROM review_logs rl",
              "FROM review_logs rl",
            )
              .replace(
                "JOIN flashcards f ON rl.flashcard_id = f.id",
                "JOIN flashcards f ON rl.flashcard_id = f.id JOIN decks d ON f.deck_id = d.id",
              )
              .replace(
                "WHERE DATE(reviewed_at) >= DATE(?)",
                `WHERE DATE(reviewed_at) >= DATE(?) ${deckFilterCondition}`,
              )
          : SQL_QUERIES.GET_DAILY_STATS_OVERALL,
      );

      dailyStatsStmt.bind([
        cutoffDate.toISOString().split("T")[0],
        ...deckFilterParams,
      ]);
      const dailyStats = [];

      while (dailyStatsStmt.step()) {
        const row = dailyStatsStmt.get();
        const reviews = row[1] as number;
        const correct = row[2] as number;
        dailyStats.push({
          date: row[0] as string,
          reviews: reviews,
          timeSpent: reviews * 30, // Estimate 30 seconds per review
          newCards: row[3] as number,
          learningCards: 0, // No learning cards in pure FSRS
          reviewCards: row[4] as number,
          correctRate: reviews > 0 ? (correct / reviews) * 100 : 0,
        });
      }
      dailyStatsStmt.free();

      // Get card stats by status
      const cardStatsStmt = this.db.prepare(
        deckFilterCondition
          ? SQL_QUERIES.GET_CARD_STATS.replace(
              "FROM flashcards f",
              "FROM flashcards f JOIN decks d ON f.deck_id = d.id",
            ).replace(
              "GROUP BY f.state",
              `WHERE ${deckFilterCondition.replace("d.", "d.")} GROUP BY f.state`,
            )
          : SQL_QUERIES.GET_CARD_STATS,
      );

      const cardStats = {
        new: 0,
        review: 0,
        mature: 0,
      };

      if (deckFilterCondition) {
        cardStatsStmt.bind(deckFilterParams);
      }

      while (cardStatsStmt.step()) {
        const row = cardStatsStmt.get();
        const cardType = row[0] as string;
        const count = row[1] as number;
        if (cardType === "new") cardStats.new = count;
        else if (cardType === "review") cardStats.review = count;
        else if (cardType === "mature") cardStats.mature = count;
      }
      cardStatsStmt.free();

      // Get answer button stats
      const answerButtonsStmt = this.db.prepare(
        deckFilterCondition
          ? SQL_QUERIES.GET_ANSWER_BUTTON_STATS.replace(
              "FROM review_logs rl",
              "FROM review_logs rl JOIN flashcards f ON rl.flashcard_id = f.id JOIN decks d ON f.deck_id = d.id",
            ).replace(
              "WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ?",
              `WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ? ${deckFilterCondition}`,
            )
          : SQL_QUERIES.GET_ANSWER_BUTTON_STATS,
      );

      const answerButtons = {
        again: 0,
        hard: 0,
        good: 0,
        easy: 0,
      };

      answerButtonsStmt.bind([
        cutoffDate.toISOString().split("T")[0],
        ...deckFilterParams,
      ]);

      while (answerButtonsStmt.step()) {
        const row = answerButtonsStmt.get();
        const ratingLabel = row[0] as string;
        const count = row[1] as number;
        answerButtons[ratingLabel as keyof typeof answerButtons] = count;
      }
      answerButtonsStmt.free();

      // Calculate retention rate
      const totalReviews = Object.values(answerButtons).reduce(
        (sum, count) => sum + count,
        0,
      );
      const correctReviews = totalReviews - answerButtons.again;
      const retentionRate =
        totalReviews > 0 ? (correctReviews / totalReviews) * 100 : 0;

      // Get interval distribution
      const intervalsStmt = this.db.prepare(`
      SELECT
        CASE
          WHEN f.interval < 1440 THEN CAST(f.interval / 60 AS INTEGER) || 'h'
          WHEN f.interval < 43200 THEN CAST(f.interval / 1440 AS INTEGER) || 'd'
          ELSE CAST(f.interval / 43200 AS INTEGER) || 'm'
        END as interval_group,
        COUNT(*) as count
      FROM flashcards f
      ${deckFilterCondition ? "JOIN decks d ON f.deck_id = d.id" : ""}
      WHERE f.state != 'new'
      ${deckFilterCondition}
      GROUP BY interval_group
      ORDER BY f.interval
    `);

      if (deckFilterCondition) {
        intervalsStmt.bind(deckFilterParams);
      }

      const intervals = [];
      while (intervalsStmt.step()) {
        const row = intervalsStmt.get();
        intervals.push({
          interval: row[0] as string,
          count: row[1] as number,
        });
      }
      intervalsStmt.free();

      // Generate forecast for next 90 days
      const forecast = [];
      const today = new Date();

      for (let i = 0; i < 90; i++) {
        const forecastDate = new Date(today);
        forecastDate.setDate(today.getDate() + i);
        const dateStr = forecastDate.toISOString().split("T")[0];

        const forecastStmt = this.db.prepare(
          deckFilterCondition
            ? SQL_QUERIES.GET_FORECAST_DUE_COUNT.replace(
                "FROM flashcards f",
                "FROM flashcards f JOIN decks d ON f.deck_id = d.id",
              ).replace(
                "WHERE DATE(f.due_date) = DATE(?)",
                `WHERE DATE(f.due_date) = DATE(?) ${deckFilterCondition}`,
              )
            : SQL_QUERIES.GET_FORECAST_DUE_COUNT,
        );

        forecastStmt.bind([dateStr, ...deckFilterParams]);
        let dueCount = 0;
        if (forecastStmt.step()) {
          const row = forecastStmt.get();
          dueCount = row[0] as number;
        }
        forecastStmt.free();

        forecast.push({
          date: dateStr,
          dueCount: dueCount,
        });
      }

      // Calculate pace statistics from time_elapsed_ms data
      const paceStmt = this.db.prepare(
        deckFilterCondition
          ? SQL_QUERIES.GET_PACE_STATS.replace(
              "FROM review_logs rl",
              "FROM review_logs rl JOIN flashcards f ON rl.flashcard_id = f.id JOIN decks d ON f.deck_id = d.id",
            ).replace(
              "WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ?",
              `WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ? ${deckFilterCondition}`,
            )
          : SQL_QUERIES.GET_PACE_STATS,
      );

      const endDate = new Date().toISOString();
      if (deckFilterCondition) {
        paceStmt.bind([cutoffDate.toISOString(), endDate, ...deckFilterParams]);
      } else {
        paceStmt.bind([cutoffDate.toISOString(), endDate]);
      }

      let averagePace = 0;
      let totalReviewTime = 0;
      if (paceStmt.step()) {
        const row = paceStmt.get();
        averagePace = (row[0] as number) || 0;
        totalReviewTime = (row[1] as number) || 0;
      }
      paceStmt.free();

      return {
        dailyStats,
        cardStats,
        answerButtons,
        retentionRate,
        intervals,
        forecast,
        averagePace,
        totalReviewTime,
      };
    } catch (error) {
      console.error("Error in getOverallStatistics:", error);
      // Return empty data structure instead of throwing
      return {
        dailyStats: [],
        cardStats: { new: 0, review: 0, mature: 0 },
        answerButtons: { again: 0, hard: 0, good: 0, easy: 0 },
        retentionRate: 0,
        intervals: [],
        forecast: [],
        averagePace: 0,
        totalReviewTime: 0,
      };
    }
  }

  async purgeDatabase(): Promise<void> {
    this.debugLog("Purging database - deleting all data");

    try {
      if (this.db) {
        // Drop all tables to completely reset the database
        this.db.exec(`
          DROP TABLE IF EXISTS review_logs;
          DROP TABLE IF EXISTS flashcards;
          DROP TABLE IF EXISTS decks;
        `);

        this.debugLog("All tables dropped, recreating schema");

        // Recreate tables with fresh schema
        await this.createFreshDatabase();
        await this.save();

        this.debugLog("Database purged and recreated successfully");
      }
    } catch (error) {
      console.error("Error purging database:", error);
      throw error;
    }
  }

  async getFlashcardById(cardId: string): Promise<Flashcard | null> {
    return this.queryOne(
      "SELECT * FROM flashcards WHERE id = ?",
      [cardId],
      this.rowToFlashcard.bind(this),
    );
  }

  /**
   * Execute multiple operations in a database transaction
   * Note: For sql.js compatibility, avoid using this for now
   */
  async runInTransaction<T>(operations: () => Promise<T>): Promise<T> {
    if (!this.db) throw new Error("Database not initialized");

    try {
      this.db.exec("BEGIN TRANSACTION");
      const result = await operations();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        // Ignore rollback errors - transaction may have already been rolled back
        console.warn("Transaction rollback failed:", rollbackError);
      }
      throw error;
    }
  }

  /**
   * Execute a raw SQL query and return results
   */
  async query(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.get());
    }

    stmt.free();
    return results;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
