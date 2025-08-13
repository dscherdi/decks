import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import { DataAdapter } from "obsidian";
import {
  Deck,
  Flashcard,
  ReviewLog,
  DeckStats,
  DEFAULT_DECK_CONFIG,
  Statistics,
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
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.GET_DECK_BY_TAG);
    stmt.bind([tag]);

    if (stmt.step()) {
      const result = stmt.get();
      stmt.free();
      return this.parseDeckRow(result);
    }

    stmt.free();
    return null;
  }

  async getDeckByFilepath(filepath: string): Promise<Deck | null> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.GET_DECK_BY_FILEPATH);
    stmt.bind([filepath]);

    if (stmt.step()) {
      const result = stmt.get();
      stmt.free();
      return this.parseDeckRow(result);
    }

    stmt.free();
    return null;
  }

  async getDeckById(id: string): Promise<Deck | null> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.GET_DECK_BY_ID);
    stmt.bind([id]);

    if (stmt.step()) {
      const result = stmt.get();
      stmt.free();
      return this.parseDeckRow(result);
    }

    stmt.free();
    return null;
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

  async updateDeckTimestamp(deckId: string, timestamp: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.UPDATE_DECK_TIMESTAMP);
    stmt.run([timestamp, deckId]);
    stmt.free();
    await this.save();
  }

  async getAllDecks(): Promise<Deck[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.GET_ALL_DECKS);
    const decks: Deck[] = [];

    while (stmt.step()) {
      const row = stmt.get();
      decks.push(this.parseDeckRow(row));
    }

    stmt.free();
    return decks;
  }

  async updateDeckLastReviewed(deckId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.UPDATE_DECK_LAST_REVIEWED);

    stmt.run([new Date().toISOString(), new Date().toISOString(), deckId]);
    stmt.free();
    await this.save();
  }

  async renameDeck(
    oldDeckId: string,
    newDeckId: string,
    newName: string,
    newFilepath: string,
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();

    // Update the deck with new ID, name, and filepath
    const stmt = this.db.prepare(SQL_QUERIES.RENAME_DECK);

    stmt.run([newDeckId, newName, newFilepath, now, oldDeckId]);
    stmt.free();
    await this.save();
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
  async createFlashcard(
    flashcard: Omit<Flashcard, "created" | "modified">,
  ): Promise<Flashcard> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();
    const fullFlashcard: Flashcard = {
      ...flashcard,
      created: now,
      modified: now,
    };

    const stmt = this.db.prepare(SQL_QUERIES.INSERT_FLASHCARD);

    stmt.run([
      fullFlashcard.id,
      fullFlashcard.deckId,
      fullFlashcard.front,
      fullFlashcard.back,
      fullFlashcard.type,
      fullFlashcard.sourceFile,
      fullFlashcard.contentHash,
      fullFlashcard.headerLevel || null,
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

    await this.save();
    return fullFlashcard;
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
        | "headerLevel"
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
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();
    const updateFields = Object.keys(updates)
      .map((key) => {
        const dbField =
          key === "contentHash"
            ? "content_hash"
            : key === "sourceFile"
              ? "source_file"
              : key === "dueDate"
                ? "due_date"
                : key === "difficulty"
                  ? "difficulty"
                  : key === "lastReviewed"
                    ? "last_reviewed"
                    : key === "headerLevel"
                      ? "header_level"
                      : key.replace(/([A-Z])/g, "_$1").toLowerCase();
        return `${dbField} = ?`;
      })
      .join(", ");

    const sql = `UPDATE flashcards SET ${updateFields}, modified = ? WHERE id = ?`;
    const stmt = this.db.prepare(sql);

    const values = Object.values(updates);
    values.push(now, flashcardId);
    stmt.run(values);
    stmt.free();
    await this.save();
  }

  async deleteFlashcard(flashcardId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.DELETE_FLASHCARD);
    stmt.run([flashcardId]);
    stmt.free();
    await this.save();
  }

  async updateFlashcardDeckIds(
    oldDeckId: string,
    newDeckId: string,
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.UPDATE_FLASHCARD_DECK_IDS);
    stmt.run([newDeckId, oldDeckId]);
    stmt.free();
    await this.save();
  }

  async getFlashcardsByDeck(deckId: string): Promise<Flashcard[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.GET_FLASHCARDS_BY_DECK);
    stmt.bind([deckId]);
    const flashcards: Flashcard[] = [];

    while (stmt.step()) {
      const row = stmt.get();
      flashcards.push(this.rowToFlashcard(row));
    }

    stmt.free();
    return flashcards;
  }

  async getFlashcardsByDeckFiltered(
    deckId: string,
    headerLevel?: number,
  ): Promise<Flashcard[]> {
    if (!this.db) throw new Error("Database not initialized");

    let query = "SELECT * FROM flashcards WHERE deck_id = ?";
    const params = [deckId];

    if (headerLevel !== undefined) {
      query += " AND (type = 'table' OR header_level = ?)";
      params.push(headerLevel.toString());
    }

    const stmt = this.db.prepare(query);
    stmt.bind(params);
    const flashcards: Flashcard[] = [];

    while (stmt.step()) {
      const row = stmt.get();
      flashcards.push(this.rowToFlashcard(row));
    }

    stmt.free();
    return flashcards;
  }

  async getDueFlashcards(deckId: string): Promise<Flashcard[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.GET_DUE_FLASHCARDS);

    const now = new Date().toISOString();
    stmt.bind([deckId, now]);
    const flashcards: Flashcard[] = [];

    while (stmt.step()) {
      const row = stmt.get();
      flashcards.push(this.rowToFlashcard(row));
    }

    stmt.free();
    return flashcards;
  }

  async getDueFlashcardsFiltered(
    deckId: string,
    headerLevel?: number,
  ): Promise<Flashcard[]> {
    if (!this.db) throw new Error("Database not initialized");

    let query = `
      SELECT * FROM flashcards
      WHERE deck_id = ? AND due_date <= ?
    `;
    const now = new Date().toISOString();
    const params = [deckId, now];

    if (headerLevel !== undefined) {
      query += " AND (type = 'table' OR header_level = ?)";
      params.push(headerLevel.toString());
    }

    query += " ORDER BY due_date";

    const stmt = this.db.prepare(query);
    stmt.bind(params);
    const flashcards: Flashcard[] = [];

    while (stmt.step()) {
      const row = stmt.get();
      flashcards.push(this.rowToFlashcard(row));
    }

    stmt.free();
    return flashcards;
  }

  async getDailyReviewCounts(
    deckId: string,
  ): Promise<{ newCount: number; reviewCount: number }> {
    if (!this.db) throw new Error("Database not initialized");

    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format
    const todayStart = `${today}T00:00:00.000Z`;
    const todayEnd = `${today}T23:59:59.999Z`;

    // Count new cards reviewed today (reviews where old_repetitions was 0)
    const newCardsStmt = this.db.prepare(SQL_QUERIES.COUNT_NEW_CARDS_TODAY);
    newCardsStmt.bind([deckId, todayStart, todayEnd]);
    const newResult = newCardsStmt.step() ? newCardsStmt.get() : [0];
    const newCount = Number(newResult[0]) || 0;
    newCardsStmt.free();

    // Count review cards reviewed today (reviews where old_interval_minutes > 0)
    const reviewCardsStmt = this.db.prepare(
      SQL_QUERIES.COUNT_REVIEW_CARDS_TODAY,
    );
    reviewCardsStmt.bind([deckId, todayStart, todayEnd]);
    const reviewResult = reviewCardsStmt.step() ? reviewCardsStmt.get() : [0];
    const reviewCount = Number(reviewResult[0]) || 0;
    reviewCardsStmt.free();

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
    const newCardsLimit = Number(config.newCardsLimit) || 0;
    const newCountToday = Number(dailyCounts.newCount) || 0;
    const remainingNewCards =
      config.enableNewCardsLimit && newCardsLimit > 0
        ? Math.max(0, newCardsLimit - newCountToday)
        : config.enableNewCardsLimit && newCardsLimit === 0
          ? 0
          : Number.MAX_SAFE_INTEGER;

    if (remainingNewCards > 0) {
      const sql = `${SQL_QUERIES.GET_NEW_CARDS_FOR_REVIEW}${config.enableNewCardsLimit ? ` LIMIT ${remainingNewCards}` : ""}`;
      const newCardsStmt = this.db.prepare(sql);
      newCardsStmt.bind([deckId, now]);
      while (newCardsStmt.step()) {
        const row = newCardsStmt.get();
        flashcards.push(this.rowToFlashcard(row));
      }
      newCardsStmt.free();
    }

    // 3. Get review cards with remaining daily limit
    const reviewCardsLimit = Number(config.reviewCardsLimit) || 0;
    const reviewCountToday = Number(dailyCounts.reviewCount) || 0;
    const remainingReviewCards =
      config.enableReviewCardsLimit && reviewCardsLimit > 0
        ? Math.max(0, reviewCardsLimit - reviewCountToday)
        : config.enableReviewCardsLimit && reviewCardsLimit === 0
          ? 0
          : Number.MAX_SAFE_INTEGER;

    if (remainingReviewCards > 0) {
      const sql = `${SQL_QUERIES.GET_REVIEW_CARDS_FOR_REVIEW}${config.enableReviewCardsLimit ? ` LIMIT ${remainingReviewCards}` : ""}`;
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

  async getReviewableFlashcardsFiltered(
    deckId: string,
    headerLevel?: number,
  ): Promise<Flashcard[]> {
    if (!this.db) throw new Error("Database not initialized");

    const deck = await this.getDeckById(deckId);
    if (!deck) throw new Error(`Deck not found: ${deckId}`);

    const config = deck.config;
    const now = new Date().toISOString();
    const flashcards: Flashcard[] = [];

    // Header level filter clause
    const headerFilter =
      headerLevel !== undefined
        ? " AND (type = 'table' OR header_level = ?)"
        : "";

    // 1. No learning cards in pure FSRS - skip learning card retrieval

    // 2. Get daily review counts to check limits
    const dailyCounts = await this.getDailyReviewCounts(deckId);

    // 3. Get new cards (if limit allows)
    if (
      !config.enableNewCardsLimit ||
      dailyCounts.newCount < config.newCardsLimit
    ) {
      const remainingNewCards = config.enableNewCardsLimit
        ? config.newCardsLimit - dailyCounts.newCount
        : Number.MAX_SAFE_INTEGER;

      let newCardsQuery = `
        SELECT * FROM flashcards
        WHERE deck_id = ? AND due_date <= ? AND state = 'new'${headerFilter}
        ORDER BY due_date
        ${config.enableNewCardsLimit ? `LIMIT ${remainingNewCards}` : ""}
      `;
      const newCardsStmt = this.db.prepare(newCardsQuery);
      const newCardsParams = [deckId, now];
      if (headerLevel !== undefined)
        newCardsParams.push(headerLevel.toString());
      newCardsStmt.bind(newCardsParams);

      while (newCardsStmt.step()) {
        const row = newCardsStmt.get();
        flashcards.push(this.rowToFlashcard(row));
      }
      newCardsStmt.free();
    }

    // 4. Get review cards (if limit allows)
    if (
      !config.enableReviewCardsLimit ||
      dailyCounts.reviewCount < config.reviewCardsLimit
    ) {
      const remainingReviewCards = config.enableReviewCardsLimit
        ? config.reviewCardsLimit - dailyCounts.reviewCount
        : Number.MAX_SAFE_INTEGER;

      let reviewCardsQuery = `
        SELECT * FROM flashcards
        WHERE deck_id = ? AND due_date <= ? AND state = 'review'${headerFilter}
        ORDER BY due_date
        ${config.enableReviewCardsLimit ? `LIMIT ${remainingReviewCards}` : ""}
      `;
      const reviewCardsStmt = this.db.prepare(reviewCardsQuery);
      const reviewCardsParams = [deckId, now];
      if (headerLevel !== undefined)
        reviewCardsParams.push(headerLevel.toString());
      reviewCardsStmt.bind(reviewCardsParams);

      while (reviewCardsStmt.step()) {
        const row = reviewCardsStmt.get();
        flashcards.push(this.rowToFlashcard(row));
      }
      reviewCardsStmt.free();
    }

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
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(SQL_QUERIES.DELETE_FLASHCARDS_BY_FILE);
    stmt.run([sourceFile]);
    stmt.free();
    await this.save();
  }

  // Review log operations
  async createReviewLog(log: Omit<ReviewLog, "id">): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const id = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const stmt = this.db.prepare(SQL_QUERIES.INSERT_REVIEW_LOG);

    stmt.run([
      id,
      log.flashcardId,
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
    const newCardsLimit = Number(config.newCardsLimit) || 0;
    const newCountToday = Number(dailyCounts.newCount) || 0;
    if (config.enableNewCardsLimit && newCardsLimit > 0) {
      const remainingNew = Math.max(0, newCardsLimit - newCountToday);
      newCount = Math.min(totalNewCards, remainingNew);
    } else if (config.enableNewCardsLimit && newCardsLimit === 0) {
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
    const reviewCardsLimit = Number(config.reviewCardsLimit) || 0;
    const reviewCountToday = Number(dailyCounts.reviewCount) || 0;
    if (config.enableReviewCardsLimit && reviewCardsLimit > 0) {
      const remainingReview = Math.max(0, reviewCardsLimit - reviewCountToday);
      dueCount = Math.min(totalDueCards, remainingReview);
    } else if (config.enableReviewCardsLimit && reviewCardsLimit === 0) {
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

  async getDeckStatsFiltered(
    deckId: string,
    headerLevel?: number,
  ): Promise<{
    name: string;
    newCount: number;
    dueCount: number;
    totalCount: number;
  }> {
    if (!this.db) throw new Error("Database not initialized");

    const deck = await this.getDeckById(deckId);
    if (!deck) {
      throw new Error(`Deck not found: ${deckId}`);
    }

    const now = new Date().toISOString();
    const headerFilter =
      headerLevel !== undefined
        ? " AND (type = 'table' OR header_level = ?)"
        : "";

    // New cards count
    const newQuery = `
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND state = 'new' AND due_date <= ?${headerFilter}
    `;
    const newStmt = this.db.prepare(newQuery);
    const newParams = [deckId, now];
    if (headerLevel !== undefined) newParams.push(headerLevel.toString());
    newStmt.bind(newParams);
    newStmt.step();
    const newCount = newStmt.get()[0] as number;
    newStmt.free();

    // No learning cards in pure FSRS
    const learningCount = 0;

    // Due cards count (review cards that are due)
    const dueQuery = `
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND state = 'review' AND due_date <= ?${headerFilter}
    `;
    const dueStmt = this.db.prepare(dueQuery);
    const dueParams = [deckId, now];
    if (headerLevel !== undefined) dueParams.push(headerLevel.toString());
    dueStmt.bind(dueParams);
    dueStmt.step();
    const dueCount = dueStmt.get()[0] as number;
    dueStmt.free();

    // Total cards count
    const totalQuery = `
      SELECT COUNT(*) FROM flashcards WHERE deck_id = ?${headerFilter}
    `;
    const totalStmt = this.db.prepare(totalQuery);
    const totalParams = [deckId];
    if (headerLevel !== undefined) totalParams.push(headerLevel.toString());
    totalStmt.bind(totalParams);
    totalStmt.step();
    const totalCount = totalStmt.get()[0] as number;
    totalStmt.free();

    return {
      name: deck.name,
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

  async getAllDeckStatsFiltered(headerLevel?: number): Promise<DeckStats[]> {
    if (!this.db) throw new Error("Database not initialized");

    const decks = await this.getAllDecks();
    const stats: DeckStats[] = [];

    for (const deck of decks) {
      const deckStats = await this.getDeckStatsFiltered(deck.id, headerLevel);
      stats.push({
        deckId: deck.id,
        newCount: deckStats.newCount,
        dueCount: deckStats.dueCount,
        totalCount: deckStats.totalCount,
      });
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
      headerLevel: (row[7] as number | null) || undefined,
      state: row[8] as "new" | "review",
      dueDate: row[9] as string,
      interval: row[10] as number,
      repetitions: row[11] as number,
      difficulty: row[12] as number,
      stability: row[13] as number,
      lapses: row[14] as number,
      lastReviewed: row[15] as string | null,
      created: row[16] as string,
      modified: row[17] as string,
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
        mature: 0,
      };

      if (deckFilterCondition) {
        cardStatsStmt.bind(deckFilterParams);
      }

      while (cardStatsStmt.step()) {
        const row = cardStatsStmt.get();
        const state = row[0] as string;
        const count = row[1] as number;
        if (state === "new") cardStats.new = count;
        else if (state === "review") cardStats.mature = count;
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
        cardStats: { new: 0, mature: 0 },
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

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
