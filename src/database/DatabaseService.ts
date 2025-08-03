import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import { Deck, Flashcard, ReviewLog, DeckStats } from "./types";

export class DatabaseService {
  private db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
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
      // In Obsidian, we'll store the database in the plugin folder
      const adapter = (window as any).app.vault.adapter;
      if (await adapter.exists(this.dbPath)) {
        const data = await adapter.readBinary(this.dbPath);
        return data;
      }
      return null;
    } catch (error) {
      console.log("Database file doesn't exist yet, will create new one");
      return null;
    }
  }

  async save(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    try {
      const data = this.db.export();
      const adapter = (window as any).app.vault.adapter;

      // Ensure directory exists
      const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
      if (!(await adapter.exists(dir))) {
        await adapter.mkdir(dir);
      }

      await adapter.writeBinary(this.dbPath, Buffer.from(data));
    } catch (error) {
      console.error("Failed to save database:", error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const sql = `
      -- Decks table
      CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tag TEXT NOT NULL UNIQUE,
        last_reviewed TEXT,
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
        line_number INTEGER NOT NULL,
        due_date TEXT NOT NULL,
        interval INTEGER NOT NULL DEFAULT 0,
        repetitions INTEGER NOT NULL DEFAULT 0,
        ease_factor REAL NOT NULL DEFAULT 2.5,
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
        FOREIGN KEY (flashcard_id) REFERENCES flashcards(id) ON DELETE CASCADE
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_flashcards_deck_id ON flashcards(deck_id);
      CREATE INDEX IF NOT EXISTS idx_flashcards_due_date ON flashcards(due_date);
      CREATE INDEX IF NOT EXISTS idx_review_logs_flashcard_id ON review_logs(flashcard_id);
      CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);
    `;

    this.db.run(sql);
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

    const stmt = this.db.prepare(`
      INSERT INTO decks (id, name, tag, last_reviewed, created, modified)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run([
      fullDeck.id,
      fullDeck.name,
      fullDeck.tag,
      fullDeck.lastReviewed,
      fullDeck.created,
      fullDeck.modified,
    ]);

    await this.save();
    return fullDeck;
  }

  async getDeckByTag(tag: string): Promise<Deck | null> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("SELECT * FROM decks WHERE tag = ?");
    stmt.bind([tag]);

    if (stmt.step()) {
      const result = stmt.get();
      stmt.free();

      return {
        id: result[0] as string,
        name: result[1] as string,
        tag: result[2] as string,
        lastReviewed: result[3] as string | null,
        created: result[4] as string,
        modified: result[5] as string,
      };
    }

    stmt.free();
    return null;
  }

  async getAllDecks(): Promise<Deck[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("SELECT * FROM decks ORDER BY name");
    const decks: Deck[] = [];

    while (stmt.step()) {
      const row = stmt.get();
      decks.push({
        id: row[0] as string,
        name: row[1] as string,
        tag: row[2] as string,
        lastReviewed: row[3] as string | null,
        created: row[4] as string,
        modified: row[5] as string,
      });
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
        id, deck_id, front, back, type, source_file, line_number,
        due_date, interval, repetitions, ease_factor, created, modified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run([
      fullFlashcard.id,
      fullFlashcard.deckId,
      fullFlashcard.front,
      fullFlashcard.back,
      fullFlashcard.type,
      fullFlashcard.sourceFile,
      fullFlashcard.lineNumber,
      fullFlashcard.dueDate,
      fullFlashcard.interval,
      fullFlashcard.repetitions,
      fullFlashcard.easeFactor,
      fullFlashcard.created,
      fullFlashcard.modified,
    ]);

    await this.save();
    return fullFlashcard;
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

  async getDueFlashcards(deckId: string): Promise<Flashcard[]> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM flashcards
      WHERE deck_id = ? AND due_date <= ?
      ORDER BY due_date
    `);

    stmt.bind([deckId, now]);
    const flashcards: Flashcard[] = [];

    while (stmt.step()) {
      const row = stmt.get();
      flashcards.push(this.rowToFlashcard(row));
    }

    stmt.free();
    return flashcards;
  }

  async updateFlashcard(flashcard: Flashcard): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`
      UPDATE flashcards SET
        front = ?, back = ?, due_date = ?, interval = ?,
        repetitions = ?, ease_factor = ?, modified = ?
      WHERE id = ?
    `);

    stmt.run([
      flashcard.front,
      flashcard.back,
      flashcard.dueDate,
      flashcard.interval,
      flashcard.repetitions,
      flashcard.easeFactor,
      new Date().toISOString(),
      flashcard.id,
    ]);

    await this.save();
  }

  async deleteFlashcardsByFile(sourceFile: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "DELETE FROM flashcards WHERE source_file = ?",
    );
    stmt.run([sourceFile]);
    await this.save();
  }

  // Review log operations
  async createReviewLog(log: Omit<ReviewLog, "id">): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const id = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const stmt = this.db.prepare(`
      INSERT INTO review_logs (
        id, flashcard_id, reviewed_at, difficulty,
        old_interval, new_interval, old_ease_factor, new_ease_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    ]);

    await this.save();
  }

  // Statistics operations
  async getDeckStats(deckId: string): Promise<DeckStats> {
    if (!this.db) throw new Error("Database not initialized");

    const now = new Date().toISOString();

    // Count new cards (never reviewed)
    const newStmt = this.db.prepare(`
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND repetitions = 0
    `);
    newStmt.bind([deckId]);
    newStmt.step();
    const newCount = (newStmt.get()[0] as number) || 0;
    newStmt.free();

    // Count learning cards (repetitions > 0 but interval < 1 day)
    const learningStmt = this.db.prepare(`
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND repetitions > 0 AND interval < 1440
    `);
    learningStmt.bind([deckId]);
    learningStmt.step();
    const learningCount = (learningStmt.get()[0] as number) || 0;
    learningStmt.free();

    // Count due cards
    const dueStmt = this.db.prepare(`
      SELECT COUNT(*) FROM flashcards
      WHERE deck_id = ? AND due_date <= ? AND interval >= 1440
    `);
    dueStmt.bind([deckId, now]);
    dueStmt.step();
    const dueCount = (dueStmt.get()[0] as number) || 0;
    dueStmt.free();

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

  // Helper methods
  private rowToFlashcard(row: any[]): Flashcard {
    return {
      id: row[0] as string,
      deckId: row[1] as string,
      front: row[2] as string,
      back: row[3] as string,
      type: row[4] as "header-paragraph" | "table",
      sourceFile: row[5] as string,
      lineNumber: row[6] as number,
      dueDate: row[7] as string,
      interval: row[8] as number,
      repetitions: row[9] as number,
      easeFactor: row[10] as number,
      created: row[11] as string,
      modified: row[12] as string,
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
