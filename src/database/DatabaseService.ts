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

export class DatabaseService {
  private db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private dbPath: string;
  private adapter: DataAdapter;
  private debugLog: (message: string, ...args: any[]) => void;

  constructor(
    dbPath: string,
    adapter: DataAdapter,
    debugLog?: (message: string, ...args: any[]) => void,
  ) {
    this.dbPath = dbPath;
    this.adapter = adapter;
    this.debugLog = debugLog || (() => {}); // No-op if not provided
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
        this.db = new this.SQL.Database(new Uint8Array(buffer));
        await this.migrateSchemaIfNeeded();
      } else {
        this.db = new this.SQL.Database();
        await this.createTables();
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

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // First, create table with new schema
    const sql = `
      -- Decks table
      CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        filepath TEXT NOT NULL UNIQUE,
        tag TEXT NOT NULL,
        last_reviewed TEXT,
        config TEXT NOT NULL DEFAULT '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date"}',
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );

      -- Flashcards table
      CREATE TABLE IF NOT EXISTS flashcards (
        id TEXT PRIMARY KEY,
        deck_id TEXT NOT NULL,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('header-paragraph', 'table')),
        source_file TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        header_level INTEGER CHECK (header_level >= 1 AND header_level <= 6),
        state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review')),
        due_date TEXT NOT NULL,
        interval INTEGER NOT NULL DEFAULT 0,
        repetitions INTEGER NOT NULL DEFAULT 0,
        ease_factor REAL NOT NULL DEFAULT 2.5,
        stability REAL NOT NULL DEFAULT 2.5,
        lapses INTEGER NOT NULL DEFAULT 0,
        last_reviewed TEXT,
        created TEXT NOT NULL,
        modified TEXT NOT NULL,
        FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
      );

      -- Review logs table
      CREATE TABLE IF NOT EXISTS review_logs (
        id TEXT PRIMARY KEY,
        flashcard_id TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        difficulty TEXT NOT NULL CHECK (difficulty IN ('again', 'hard', 'good', 'easy')),
        old_interval INTEGER NOT NULL,
        new_interval INTEGER NOT NULL,
        old_ease_factor REAL NOT NULL,
        new_ease_factor REAL NOT NULL,
        time_elapsed INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (flashcard_id) REFERENCES flashcards(id)
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_flashcards_deck_id ON flashcards(deck_id);
      CREATE INDEX IF NOT EXISTS idx_flashcards_due_date ON flashcards(due_date);
      CREATE INDEX IF NOT EXISTS idx_review_logs_flashcard_id ON review_logs(flashcard_id);
      CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);
    `;

    this.db.run(sql);
  }

  // Helper method to parse deck rows
  private parseDeckRow(row: any[]): Deck {
    return {
      id: row[0] as string,
      name: row[1] as string,
      filepath: row[2] as string,
      tag: row[3] as string,
      lastReviewed: row[4] as string | null,
      config: row[5] ? JSON.parse(row[5] as string) : DEFAULT_DECK_CONFIG,
      created: row[6] as string,
      modified: row[7] as string,
    };
  }

  // Deck operations
  async createDeck(deck: Omit<Deck, "created">): Promise<Deck> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();
    const fullDeck: Deck = {
      ...deck,
      created: now,
    };

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO decks (
          id, name, filepath, tag, last_reviewed, config, created, modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

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

    const stmt = this.db.prepare("SELECT * FROM decks WHERE tag = ?");
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

    const stmt = this.db.prepare("SELECT * FROM decks WHERE filepath = ?");
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

    const stmt = this.db.prepare("SELECT * FROM decks WHERE id = ?");
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

    const stmt = this.db.prepare(`
      UPDATE decks
      SET ${updateFields}, modified = ?
      WHERE id = ?
    `);

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

    const stmt = this.db.prepare(`
      UPDATE decks
      SET modified = ?
      WHERE id = ?
    `);
    stmt.run([timestamp, deckId]);
    stmt.free();
    await this.save();
  }

  async getAllDecks(): Promise<Deck[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("SELECT * FROM decks ORDER BY name");
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

    const stmt = this.db.prepare(`
      UPDATE decks
      SET last_reviewed = ?, modified = ?
      WHERE id = ?
    `);

    stmt.run([new Date().toISOString(), new Date().toISOString(), deckId]);
    stmt.free();
    await this.save();
  }

  async deleteDeckByFilepath(filepath: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // First get the deck to find its ID
    const deck = await this.getDeckByFilepath(filepath);
    if (!deck) return; // Deck doesn't exist

    // Delete all flashcards in this deck (preserve review logs for historical data)
    const flashcardsStmt = this.db.prepare(
      "DELETE FROM flashcards WHERE deck_id = ?",
    );
    flashcardsStmt.run([deck.id]);
    flashcardsStmt.free();

    // Finally delete the deck
    const deckStmt = this.db.prepare("DELETE FROM decks WHERE filepath = ?");
    deckStmt.run([filepath]);
    deckStmt.free();

    await this.save();
  }

  async deleteDeck(deckId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Delete all flashcards in this deck (preserve review logs for historical data)
    const flashcardsStmt = this.db.prepare(
      "DELETE FROM flashcards WHERE deck_id = ?",
    );
    flashcardsStmt.run([deckId]);
    flashcardsStmt.free();

    // Finally delete the deck
    const deckStmt = this.db.prepare("DELETE FROM decks WHERE id = ?");
    deckStmt.run([deckId]);
    deckStmt.free();

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

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO flashcards (
        id, deck_id, front, back, type, source_file, content_hash, header_level,
        state, due_date, interval, repetitions, ease_factor, stability, lapses, last_reviewed, created, modified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

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
      fullFlashcard.interval,
      fullFlashcard.repetitions,
      fullFlashcard.easeFactor,
      fullFlashcard.stability,
      fullFlashcard.lapses,
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
        | "easeFactor"
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
                : key === "easeFactor"
                  ? "ease_factor"
                  : key === "lastReviewed"
                    ? "last_reviewed"
                    : key === "headerLevel"
                      ? "header_level"
                      : key.replace(/([A-Z])/g, "_$1").toLowerCase();
        return `${dbField} = ?`;
      })
      .join(", ");

    const stmt = this.db.prepare(`
      UPDATE flashcards
      SET ${updateFields}, modified = ?
      WHERE id = ?
    `);

    const values = Object.values(updates);
    values.push(now, flashcardId);
    stmt.run(values);
    stmt.free();
    await this.save();
  }

  async deleteFlashcard(flashcardId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("DELETE FROM flashcards WHERE id = ?");
    stmt.run([flashcardId]);
    stmt.free();
    await this.save();
  }

  async getFlashcardsByDeck(deckId: string): Promise<Flashcard[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("SELECT * FROM flashcards WHERE deck_id = ?");
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
      params.push(headerLevel);
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

    const stmt = this.db.prepare(`
      SELECT * FROM flashcards
      WHERE deck_id = ? AND due_date <= ?
      ORDER BY due_date
    `);

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
      params.push(headerLevel);
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
    const newCardsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM review_logs rl
      JOIN flashcards f ON rl.flashcard_id = f.id
      WHERE f.deck_id = ?
        AND rl.reviewed_at >= ?
        AND rl.reviewed_at <= ?
        AND (rl.old_interval = 0 OR f.repetitions = 1)
    `);
    newCardsStmt.bind([deckId, todayStart, todayEnd]);
    const newResult = newCardsStmt.step() ? newCardsStmt.get() : [0];
    const newCount = Number(newResult[0]) || 0;
    newCardsStmt.free();

    // Count review cards reviewed today (reviews where old_interval > 0)
    const reviewCardsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM review_logs rl
      JOIN flashcards f ON rl.flashcard_id = f.id
      WHERE f.deck_id = ?
        AND rl.reviewed_at >= ?
        AND rl.reviewed_at <= ?
        AND rl.old_interval > 0
    `);
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

    // 1. Always get ALL learning cards (not subject to limits per Anki behavior)
    const learningStmt = this.db.prepare(`
      SELECT * FROM flashcards
      WHERE deck_id = ? AND due_date <= ? AND state = 'learning'
      ORDER BY due_date
    `);
    learningStmt.bind([deckId, now]);
    while (learningStmt.step()) {
      const row = learningStmt.get();
      flashcards.push(this.rowToFlashcard(row));
    }
    learningStmt.free();

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
      const newCardsStmt = this.db.prepare(`
        SELECT * FROM flashcards
        WHERE deck_id = ? AND due_date <= ? AND state = 'new'
        ORDER BY due_date
        ${config.enableNewCardsLimit ? `LIMIT ${remainingNewCards}` : ""}
      `);
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
      const reviewCardsStmt = this.db.prepare(`
        SELECT * FROM flashcards
        WHERE deck_id = ? AND due_date <= ? AND state = 'review'
        ORDER BY due_date
        ${config.enableReviewCardsLimit ? `LIMIT ${remainingReviewCards}` : ""}
      `);
      reviewCardsStmt.bind([deckId, now]);
      while (reviewCardsStmt.step()) {
        const row = reviewCardsStmt.get();
        flashcards.push(this.rowToFlashcard(row));
      }
      reviewCardsStmt.free();
    }

    // Sort final result: Anki order - learning first, then review, then new
    flashcards.sort((a, b) => {
      const stateOrder = { learning: 1, review: 2, new: 3 };
      const aOrder = stateOrder[a.state];
      const bOrder = stateOrder[b.state];

      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      // Within same state, apply specific ordering rules
      if (a.state === "learning") {
        // Learning cards: always by due date (earliest first)
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      } else if (a.state === "review") {
        // Review cards: follow deck config preference
        if (config.reviewOrder === "random") {
          return Math.random() - 0.5;
        } else {
          // Default: oldest due first
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        }
      } else {
        // New cards: by due date (creation order)
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
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

    // 1. Get learning cards (highest priority)
    let learningQuery = `
      SELECT * FROM flashcards
      WHERE deck_id = ? AND due_date <= ? AND state = 'learning'${headerFilter}
      ORDER BY due_date
    `;
    const learningStmt = this.db.prepare(learningQuery);
    const learningParams = [deckId, now];
    if (headerLevel !== undefined) learningParams.push(headerLevel);
    learningStmt.bind(learningParams);

    while (learningStmt.step()) {
      const row = learningStmt.get();
      flashcards.push(this.rowToFlashcard(row));
    }
    learningStmt.free();

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
      if (headerLevel !== undefined) newCardsParams.push(headerLevel);
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
      if (headerLevel !== undefined) reviewCardsParams.push(headerLevel);
      reviewCardsStmt.bind(reviewCardsParams);

      while (reviewCardsStmt.step()) {
        const row = reviewCardsStmt.get();
        flashcards.push(this.rowToFlashcard(row));
      }
      reviewCardsStmt.free();
    }

    return flashcards;
  }

  async deleteFlashcardsByFile(sourceFile: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "DELETE FROM flashcards WHERE source_file = ?",
    );
    stmt.run([sourceFile]);
    stmt.free();
    await this.save();
  }

  // Review log operations
  async createReviewLog(log: Omit<ReviewLog, "id">): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const id = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const stmt = this.db.prepare(`
      INSERT INTO review_logs (
        id, flashcard_id, reviewed_at, difficulty,
        old_interval, new_interval, old_ease_factor, new_ease_factor, time_elapsed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run([
      id,
      log.flashcardId,
      log.reviewedAt,
      log.difficulty,
      log.oldInterval,
      log.newInterval,
      log.oldEaseFactor,
      log.newEaseFactor,
      log.timeElapsed,
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
    const newStmt = this.db.prepare(`
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND state = 'new' AND due_date <= ?
    `);
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

    // Count learning cards (state = 'learning' and due)
    const learningStmt = this.db.prepare(`
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND state = 'learning' AND due_date <= ?
    `);
    learningStmt.bind([deckId, now]);
    learningStmt.step();
    const learningCount = (learningStmt.get()[0] as number) || 0;
    learningStmt.free();

    // Count review cards (state = 'review' and due)
    const dueStmt = this.db.prepare(`
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND state = 'review' AND due_date <= ?
    `);
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
    const totalStmt = this.db.prepare(`
      SELECT COUNT(*) FROM flashcards WHERE deck_id = ?
    `);
    totalStmt.bind([deckId]);
    totalStmt.step();
    const totalCount = (totalStmt.get()[0] as number) || 0;
    totalStmt.free();

    return {
      deckId,
      newCount,
      learningCount,
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
    learningCount: number;
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
    if (headerLevel !== undefined) newParams.push(headerLevel);
    newStmt.bind(newParams);
    newStmt.step();
    const newCount = newStmt.get()[0] as number;
    newStmt.free();

    // Learning cards count
    const learningQuery = `
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND state = 'learning' AND due_date <= ?${headerFilter}
    `;
    const learningStmt = this.db.prepare(learningQuery);
    const learningParams = [deckId, now];
    if (headerLevel !== undefined) learningParams.push(headerLevel);
    learningStmt.bind(learningParams);
    learningStmt.step();
    const learningCount = learningStmt.get()[0] as number;
    learningStmt.free();

    // Due cards count (review cards that are due)
    const dueQuery = `
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND state = 'review' AND due_date <= ?${headerFilter}
    `;
    const dueStmt = this.db.prepare(dueQuery);
    const dueParams = [deckId, now];
    if (headerLevel !== undefined) dueParams.push(headerLevel);
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
    if (headerLevel !== undefined) totalParams.push(headerLevel);
    totalStmt.bind(totalParams);
    totalStmt.step();
    const totalCount = totalStmt.get()[0] as number;
    totalStmt.free();

    return {
      name: deck.name,
      newCount,
      learningCount,
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
        name: deckStats.name,
        newCount: deckStats.newCount,
        learningCount: deckStats.learningCount,
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

    const stmt = this.db.prepare(`
      SELECT DATE(reviewed_at) as review_date, COUNT(*) as count
      FROM review_logs
      WHERE reviewed_at >= ? AND reviewed_at <= ?
      GROUP BY DATE(reviewed_at)
      ORDER BY review_date
    `);

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
      // Check if tables exist first
      const tablesStmt = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name IN ('decks', 'flashcards', 'review_logs')
      `);

      const existingTables: string[] = [];
      while (tablesStmt.step()) {
        const row = tablesStmt.get();
        existingTables.push(row[0] as string);
      }
      tablesStmt.free();

      // If no tables exist, create them and return
      if (existingTables.length === 0) {
        this.debugLog("No existing tables found. Creating initial schema...");
        await this.createTables();
        await this.save();
        return;
      }

      // Check if we have the old schema (tag UNIQUE constraint)
      let hasFilepath = true;
      let hasConfig = true;
      let hasTimeElapsed = true;
      let hasHeaderLevel = true;

      // Check decks table columns if it exists
      if (existingTables.includes("decks")) {
        const stmt = this.db.prepare("PRAGMA table_info(decks)");
        const columns: any[] = [];

        while (stmt.step()) {
          columns.push(stmt.get());
        }
        stmt.free();

        hasFilepath = columns.some((col) => col[1] === "filepath");
        hasConfig = columns.some((col) => col[1] === "config");
      } else {
        hasFilepath = false;
        hasConfig = false;
      }

      // Check flashcards table columns if it exists
      if (existingTables.includes("flashcards")) {
        const flashcardsStmt = this.db.prepare("PRAGMA table_info(flashcards)");
        const flashcardsColumns: any[] = [];
        while (flashcardsStmt.step()) {
          flashcardsColumns.push(flashcardsStmt.get());
        }
        flashcardsStmt.free();
        hasHeaderLevel = flashcardsColumns.some(
          (col) => col[1] === "header_level",
        );
      } else {
        hasHeaderLevel = false;
      }

      // Check review_logs table columns if it exists
      if (existingTables.includes("review_logs")) {
        try {
          const reviewLogsStmt = this.db.prepare(
            "PRAGMA table_info(review_logs)",
          );
          const reviewLogsColumns: any[] = [];
          while (reviewLogsStmt.step()) {
            reviewLogsColumns.push(reviewLogsStmt.get());
          }
          reviewLogsStmt.free();
          hasTimeElapsed = reviewLogsColumns.some(
            (col) => col[1] === "time_elapsed",
          );
        } catch (error) {
          hasTimeElapsed = false;
        }
      } else {
        hasTimeElapsed = false;
      }

      if (!hasFilepath || !hasConfig || !hasTimeElapsed || !hasHeaderLevel) {
        this.debugLog(
          "Migrating database schema to support filepath, config, time_elapsed, and header_level columns...",
        );

        // Add missing columns to existing tables instead of dropping them
        try {
          // Ensure all tables exist first
          if (
            !existingTables.includes("decks") ||
            !existingTables.includes("flashcards") ||
            !existingTables.includes("review_logs")
          ) {
            this.debugLog(
              "Missing tables detected. Creating missing tables...",
            );
            await this.createTables();
          } else {
            // Add missing columns to existing tables
            if (!hasFilepath) {
              this.debugLog("Adding filepath column to decks table...");
              this.db.exec(`ALTER TABLE decks ADD COLUMN filepath TEXT`);
            }

            if (!hasConfig) {
              this.debugLog("Adding config column to decks table...");
              this.db.exec(
                `ALTER TABLE decks ADD COLUMN config TEXT DEFAULT '{}'`,
              );
            }

            if (!hasTimeElapsed) {
              this.debugLog(
                "Adding time_elapsed column to review_logs table...",
              );
              this.db.exec(
                `ALTER TABLE review_logs ADD COLUMN time_elapsed INTEGER NOT NULL DEFAULT 0`,
              );
            }

            if (!hasHeaderLevel) {
              this.debugLog(
                "Adding header_level column to flashcards table...",
              );
              this.db.exec(
                `ALTER TABLE flashcards ADD COLUMN header_level INTEGER CHECK (header_level >= 1 AND header_level <= 6)`,
              );
            }
          }

          this.debugLog(
            "Database schema migration completed. All user data preserved.",
          );
          await this.save();
        } catch (error) {
          console.error("Error during column migration:", error);
          this.debugLog("Falling back to table recreation...");

          // Only if ALTER TABLE fails, recreate tables
          this.db.exec(`
            DROP TABLE IF EXISTS review_logs;
            DROP TABLE IF EXISTS flashcards;
            DROP TABLE IF EXISTS decks;
          `);
          await this.createTables();
          this.debugLog(
            "Database recreated. Data will be rebuilt from vault files.",
          );
          await this.save();
        }
      }
    } catch (error) {
      console.error("Error during schema migration:", error);
      // Don't throw - let the app continue with potentially old schema
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
      headerLevel: row[7] as number | null,
      state: row[8] as "new" | "learning" | "review",
      dueDate: row[9] as string,
      interval: row[10] as number,
      repetitions: row[11] as number,
      easeFactor: row[12] as number,
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

      const dailyStatsStmt = this.db.prepare(`
      SELECT
        DATE(reviewed_at) as date,
        COUNT(*) as reviews,
        COUNT(CASE WHEN difficulty != 'again' THEN 1 END) as correct,
        COUNT(CASE WHEN f.state = 'new' THEN 1 END) as new_cards,
        COUNT(CASE WHEN f.state = 'learning' THEN 1 END) as learning_cards,
        COUNT(CASE WHEN f.state = 'review' THEN 1 END) as review_cards
      FROM review_logs rl
      JOIN flashcards f ON rl.flashcard_id = f.id
      ${deckFilterCondition ? "JOIN decks d ON f.deck_id = d.id" : ""}
      WHERE DATE(reviewed_at) >= DATE(?)
      ${deckFilterCondition}
      GROUP BY DATE(reviewed_at)
      ORDER BY date DESC
    `);

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
          learningCards: row[4] as number,
          reviewCards: row[5] as number,
          correctRate: reviews > 0 ? (correct / reviews) * 100 : 0,
        });
      }
      dailyStatsStmt.free();

      // Get card stats by status
      const cardStatsStmt = this.db.prepare(`
      SELECT
        f.state,
        COUNT(*) as count
      FROM flashcards f
      ${deckFilterCondition ? "JOIN decks d ON f.deck_id = d.id" : ""}
      WHERE 1=1
      ${deckFilterCondition}
      GROUP BY f.state
    `);

      const cardStats = {
        new: 0,
        learning: 0,
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
        else if (state === "learning") cardStats.learning = count;
        else if (state === "review") cardStats.mature = count;
      }
      cardStatsStmt.free();

      // Get answer button stats
      const answerButtonsStmt = this.db.prepare(`
      SELECT
        rl.difficulty,
        COUNT(*) as count
      FROM review_logs rl
      JOIN flashcards f ON rl.flashcard_id = f.id
      ${deckFilterCondition ? "JOIN decks d ON f.deck_id = d.id" : ""}
      WHERE DATE(rl.reviewed_at) >= DATE(?)
      ${deckFilterCondition}
      GROUP BY rl.difficulty
    `);

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
        const difficulty = row[0] as string;
        const count = row[1] as number;
        answerButtons[difficulty as keyof typeof answerButtons] = count;
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

        const forecastStmt = this.db.prepare(`
        SELECT COUNT(*) as due_count
        FROM flashcards f
        ${deckFilterCondition ? "JOIN decks d ON f.deck_id = d.id" : ""}
        WHERE DATE(f.due_date) = DATE(?)
        ${deckFilterCondition}
      `);

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

      // Calculate pace statistics from time_elapsed data
      const paceStmt = this.db.prepare(`
      SELECT
        AVG(rl.time_elapsed / 1000.0) as avg_pace,
        SUM(rl.time_elapsed / 1000.0) as total_time
      FROM review_logs rl
      JOIN flashcards f ON rl.flashcard_id = f.id
      ${deckFilterCondition ? "JOIN decks d ON f.deck_id = d.id" : ""}
      WHERE rl.reviewed_at >= ?
      ${deckFilterCondition}
    `);

      if (deckFilterCondition) {
        paceStmt.bind([cutoffDate.toISOString(), ...deckFilterParams]);
      } else {
        paceStmt.bind([cutoffDate.toISOString()]);
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
        cardStats: { new: 0, learning: 0, mature: 0 },
        answerButtons: { again: 0, hard: 0, good: 0, easy: 0 },
        retentionRate: 0,
        intervals: [],
        forecast: [],
        averagePace: 0,
        totalReviewTime: 0,
      };
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
