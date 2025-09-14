import { DataAdapter } from "obsidian";
import { IDatabaseService } from "./DatabaseFactory";
import {
  Deck,
  Flashcard,
  ReviewLog,
  ReviewSession,
  DeckStats,
  Statistics,
  DEFAULT_DECK_CONFIG,
  DeckConfig,
} from "./types";
import { SQL_QUERIES } from "./schemas";

export abstract class BaseDatabaseService implements IDatabaseService {
  protected dbPath: string;
  protected adapter: DataAdapter;
  protected debugLog: (message: string, ...args: any[]) => void;

  constructor(
    dbPath: string,
    adapter: DataAdapter,
    debugLog: (message: string, ...args: any[]) => void,
  ) {
    this.dbPath = dbPath;
    this.adapter = adapter;
    this.debugLog = debugLog;
  }

  // Abstract methods to be implemented by concrete classes
  abstract initialize(): Promise<void>;
  abstract close(): Promise<void>;
  abstract save(): Promise<void>;
  abstract beginTransaction(): void;
  abstract commitTransaction(): void;
  abstract rollbackTransaction(): void;
  abstract executeSql(sql: string, params?: any[]): Promise<void>;
  abstract querySql(sql: string, params?: any[]): Promise<any[]>;

  // Template method for running transactions
  async runInTransaction<T>(operations: () => Promise<T>): Promise<T> {
    this.beginTransaction();
    try {
      const result = await operations();
      this.commitTransaction();
      return result;
    } catch (error) {
      this.rollbackTransaction();
      throw error;
    }
  }

  // Shared business logic methods
  protected parseDeckRow(row: any[]): Deck {
    let config = DEFAULT_DECK_CONFIG;

    if (row[5]) {
      try {
        const parsedConfig = JSON.parse(row[5] as string);

        // Handle legacy config format
        if (typeof parsedConfig.newCardsEnabled === "boolean") {
          const legacyConfig = parsedConfig as any;
          config = {
            ...DEFAULT_DECK_CONFIG,
            newCardsPerDay: legacyConfig.newCardsEnabled
              ? legacyConfig.newCardsLimit || 20
              : 0,
            reviewCardsPerDay: legacyConfig.reviewCardsEnabled
              ? legacyConfig.reviewCardsLimit || 100
              : 0,
            reviewOrder: legacyConfig.reviewOrder || "oldest-first",
            headerLevel: legacyConfig.headerLevel || 2,
          };
        } else {
          config = { ...DEFAULT_DECK_CONFIG, ...parsedConfig };
        }
      } catch (error) {
        this.debugLog("Failed to parse deck config, using defaults:", error);
        config = DEFAULT_DECK_CONFIG;
      }
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

  protected rowToFlashcard(row: any[]): Flashcard {
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

  protected rowToReviewSession(row: any[]): ReviewSession {
    return {
      id: row[0] as string,
      deckId: row[1] as string,
      startedAt: row[2] as string,
      endedAt: row[3] as string | null,
      goalTotal: row[4] as number,
      doneUnique: row[5] as number,
    };
  }

  // Utility methods
  protected generateFlashcardId(frontText: string): string {
    const crypto = require("crypto");
    return crypto
      .createHash("sha256")
      .update(frontText)
      .digest("hex")
      .substring(0, 16);
  }

  protected getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  protected getRatingLabel(rating: number): "again" | "hard" | "good" | "easy" {
    switch (rating) {
      case 1:
        return "again";
      case 2:
        return "hard";
      case 3:
        return "good";
      case 4:
        return "easy";
      default:
        return "good";
    }
  }

  // DECK OPERATIONS - Implemented using abstract SQL methods
  async createDeck(
    deck: Omit<Deck, "id" | "created" | "modified">,
  ): Promise<string> {
    const now = this.getCurrentTimestamp();
    const deckId = deck.filepath || `deck_${Date.now()}`;

    const fullDeck: Deck = {
      ...deck,
      id: deckId,
      created: now,
      modified: now,
    };

    const sql = `INSERT INTO decks (id, name, filepath, tag, last_reviewed, config, created, modified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    await this.executeSql(sql, [
      fullDeck.id,
      fullDeck.name,
      fullDeck.filepath,
      fullDeck.tag,
      fullDeck.lastReviewed,
      JSON.stringify(fullDeck.config),
      fullDeck.created,
      fullDeck.modified,
    ]);

    return fullDeck.id;
  }

  async getDeckById(id: string): Promise<Deck | null> {
    const sql = `SELECT id, name, filepath, tag, last_reviewed, config, created, modified FROM decks WHERE id = ?`;
    const results = await this.querySql(sql, [id]);
    return results.length > 0 ? this.parseDeckRow(results[0]) : null;
  }

  async getDeckByFilepath(filepath: string): Promise<Deck | null> {
    const sql = `SELECT id, name, filepath, tag, last_reviewed, config, created, modified FROM decks WHERE filepath = ?`;
    const results = await this.querySql(sql, [filepath]);
    return results.length > 0 ? this.parseDeckRow(results[0]) : null;
  }

  async getDeckByTag(tag: string): Promise<Deck | null> {
    const sql = `SELECT id, name, filepath, tag, last_reviewed, config, created, modified FROM decks WHERE tag = ?`;
    const results = await this.querySql(sql, [tag]);
    return results.length > 0 ? this.parseDeckRow(results[0]) : null;
  }

  async getAllDecks(): Promise<Deck[]> {
    const sql = `SELECT id, name, filepath, tag, last_reviewed, config, created, modified FROM decks ORDER BY name`;
    const results = await this.querySql(sql, []);
    return results.map((row) => this.parseDeckRow(row));
  }

  async updateDeck(id: string, updates: Partial<Deck>): Promise<void> {
    const updateFields: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) {
      updateFields.push("name = ?");
      params.push(updates.name);
    }
    if (updates.filepath !== undefined) {
      updateFields.push("filepath = ?");
      params.push(updates.filepath);
    }
    if (updates.tag !== undefined) {
      updateFields.push("tag = ?");
      params.push(updates.tag);
    }
    if (updates.lastReviewed !== undefined) {
      updateFields.push("last_reviewed = ?");
      params.push(updates.lastReviewed);
    }
    if (updates.config !== undefined) {
      updateFields.push("config = ?");
      params.push(JSON.stringify(updates.config));
    }

    updateFields.push("modified = ?");
    params.push(this.getCurrentTimestamp());
    params.push(id);

    const sql = `UPDATE decks SET ${updateFields.join(", ")} WHERE id = ?`;
    await this.executeSql(sql, params);
  }

  async updateDeckTimestamp(deckId: string): Promise<void> {
    const sql = `UPDATE decks SET modified = ? WHERE id = ?`;
    await this.executeSql(sql, [this.getCurrentTimestamp(), deckId]);
  }

  async updateDeckLastReviewed(
    deckId: string,
    timestamp: string,
  ): Promise<void> {
    const sql = `UPDATE decks SET last_reviewed = ?, modified = ? WHERE id = ?`;
    await this.executeSql(sql, [timestamp, this.getCurrentTimestamp(), deckId]);
  }

  async updateDeckHeaderLevel(
    deckId: string,
    headerLevel: number,
  ): Promise<void> {
    const deck = await this.getDeckById(deckId);
    if (deck) {
      const updatedConfig = { ...deck.config, headerLevel };
      await this.updateDeck(deckId, { config: updatedConfig });
    }
  }

  async renameDeck(
    oldDeckId: string,
    newDeckId: string,
    newName: string,
    newFilepath: string,
  ): Promise<void> {
    await this.runInTransaction(async () => {
      // Update deck
      const sql1 = `UPDATE decks SET id = ?, name = ?, filepath = ?, modified = ? WHERE id = ?`;
      await this.executeSql(sql1, [
        newDeckId,
        newName,
        newFilepath,
        this.getCurrentTimestamp(),
        oldDeckId,
      ]);

      // Update flashcards
      const sql2 = `UPDATE flashcards SET deck_id = ? WHERE deck_id = ?`;
      await this.executeSql(sql2, [newDeckId, oldDeckId]);

      // Update review logs
      const sql3 = `UPDATE review_logs SET deck_id = ? WHERE deck_id = ?`;
      await this.executeSql(sql3, [newDeckId, oldDeckId]);

      // Update review sessions
      const sql4 = `UPDATE review_sessions SET deck_id = ? WHERE deck_id = ?`;
      await this.executeSql(sql4, [newDeckId, oldDeckId]);
    });
  }

  async deleteDeck(id: string): Promise<void> {
    const sql = `DELETE FROM decks WHERE id = ?`;
    await this.executeSql(sql, [id]);
  }

  async deleteDeckByFilepath(filepath: string): Promise<void> {
    const sql = `DELETE FROM decks WHERE filepath = ?`;
    await this.executeSql(sql, [filepath]);
  }

  // FLASHCARD OPERATIONS
  async createFlashcard(
    flashcard: Omit<Flashcard, "id" | "created" | "modified">,
  ): Promise<void> {
    const now = this.getCurrentTimestamp();
    const flashcardWithId = {
      ...flashcard,
      id: this.generateFlashcardId(flashcard.front),
      created: now,
      modified: now,
    };

    const sql = `INSERT INTO flashcards
                 (id, deck_id, front, back, type, source_file, content_hash, state, due_date,
                  interval, repetitions, difficulty, stability, lapses, last_reviewed, created, modified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await this.executeSql(sql, [
      flashcardWithId.id,
      flashcardWithId.deckId,
      flashcardWithId.front,
      flashcardWithId.back,
      flashcardWithId.type,
      flashcardWithId.sourceFile,
      flashcardWithId.contentHash,
      flashcardWithId.state,
      flashcardWithId.dueDate,
      flashcardWithId.interval,
      flashcardWithId.repetitions,
      flashcardWithId.difficulty,
      flashcardWithId.stability,
      flashcardWithId.lapses,
      flashcardWithId.lastReviewed,
      flashcardWithId.created,
      flashcardWithId.modified,
    ]);
  }

  async getFlashcardById(flashcardId: string): Promise<Flashcard | null> {
    const sql = `SELECT * FROM flashcards WHERE id = ?`;
    const results = await this.querySql(sql, [flashcardId]);
    return results.length > 0 ? this.rowToFlashcard(results[0]) : null;
  }

  async getFlashcardsByDeck(deckId: string): Promise<Flashcard[]> {
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? ORDER BY created`;
    const results = await this.querySql(sql, [deckId]);
    return results.map((row) => this.rowToFlashcard(row));
  }

  async getDueFlashcards(deckId: string): Promise<Flashcard[]> {
    const now = this.getCurrentTimestamp();
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND due_date <= ? ORDER BY due_date`;
    const results = await this.querySql(sql, [deckId, now]);
    return results.map((row) => this.rowToFlashcard(row));
  }

  async getReviewableFlashcards(deckId: string): Promise<Flashcard[]> {
    const now = this.getCurrentTimestamp();
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND (state = 'new' OR due_date <= ?) ORDER BY due_date`;
    const results = await this.querySql(sql, [deckId, now]);
    return results.map((row) => this.rowToFlashcard(row));
  }

  async getNewCardsForReview(
    deckId: string,
    now: string,
  ): Promise<Flashcard[]> {
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND state = 'new' ORDER BY created LIMIT 100`;
    const results = await this.querySql(sql, [deckId]);
    return results.map((row) => this.rowToFlashcard(row));
  }

  async getReviewCardsForReview(
    deckId: string,
    now: string,
  ): Promise<Flashcard[]> {
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND state = 'review' AND due_date <= ? ORDER BY due_date LIMIT 100`;
    const results = await this.querySql(sql, [deckId, now]);
    return results.map((row) => this.rowToFlashcard(row));
  }

  async updateFlashcard(
    flashcardId: string,
    updates: Partial<Flashcard>,
  ): Promise<void> {
    const updateFields: string[] = [];
    const params: any[] = [];

    Object.keys(updates).forEach((key) => {
      if (updates[key as keyof Flashcard] !== undefined && key !== "id") {
        if (key === "deckId") {
          updateFields.push("deck_id = ?");
        } else if (key === "sourceFile") {
          updateFields.push("source_file = ?");
        } else if (key === "contentHash") {
          updateFields.push("content_hash = ?");
        } else if (key === "dueDate") {
          updateFields.push("due_date = ?");
        } else if (key === "lastReviewed") {
          updateFields.push("last_reviewed = ?");
        } else {
          updateFields.push(`${key} = ?`);
        }
        params.push(updates[key as keyof Flashcard]);
      }
    });

    updateFields.push("modified = ?");
    params.push(this.getCurrentTimestamp());
    params.push(flashcardId);

    const sql = `UPDATE flashcards SET ${updateFields.join(", ")} WHERE id = ?`;
    await this.executeSql(sql, params);
  }

  async updateFlashcardDeckIds(
    oldDeckId: string,
    newDeckId: string,
  ): Promise<void> {
    const sql = `UPDATE flashcards SET deck_id = ? WHERE deck_id = ?`;
    await this.executeSql(sql, [newDeckId, oldDeckId]);
  }

  async deleteFlashcard(id: string): Promise<void> {
    const sql = `DELETE FROM flashcards WHERE id = ?`;
    await this.executeSql(sql, [id]);
  }

  async deleteFlashcardsByFile(sourceFile: string): Promise<void> {
    const sql = `DELETE FROM flashcards WHERE source_file = ?`;
    await this.executeSql(sql, [sourceFile]);
  }

  // BATCH OPERATIONS
  async batchCreateFlashcards(
    flashcards: Array<Omit<Flashcard, "created" | "modified">>,
  ): Promise<void> {
    if (flashcards.length === 0) return;

    await this.runInTransaction(async () => {
      const now = this.getCurrentTimestamp();
      const sql = `INSERT INTO flashcards
                   (id, deck_id, front, back, type, source_file, content_hash, state, due_date,
                    interval, repetitions, difficulty, stability, lapses, last_reviewed, created, modified)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      for (const flashcard of flashcards) {
        await this.executeSql(sql, [
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
          now,
          now,
        ]);
      }
    });
  }

  async batchUpdateFlashcards(
    updates: Array<{ id: string; updates: Partial<Flashcard> }>,
  ): Promise<void> {
    if (updates.length === 0) return;

    await this.runInTransaction(async () => {
      for (const update of updates) {
        await this.updateFlashcard(update.id, update.updates);
      }
    });
  }

  async batchDeleteFlashcards(flashcardIds: string[]): Promise<void> {
    if (flashcardIds.length === 0) return;

    const placeholders = flashcardIds.map(() => "?").join(",");
    const sql = `DELETE FROM flashcards WHERE id IN (${placeholders})`;
    await this.executeSql(sql, flashcardIds);
  }

  // COUNT OPERATIONS
  async countNewCards(deckId: string, now: string): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ? AND state = 'new'`;
    const results = await this.querySql(sql, [deckId]);
    return results[0]?.count || 0;
  }

  async countDueCards(deckId: string, now: string): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ? AND due_date <= ?`;
    const results = await this.querySql(sql, [deckId, now]);
    return results[0]?.count || 0;
  }

  async countTotalCards(deckId: string): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ?`;
    const results = await this.querySql(sql, [deckId]);
    return results[0]?.count || 0;
  }

  async countNewCardsToday(
    deckId: string,
    startOfDay: string,
    endOfDay: string,
  ): Promise<number> {
    const sql = `SELECT COUNT(DISTINCT r.flashcard_id) as count
                 FROM review_logs r
                 JOIN flashcards f ON r.flashcard_id = f.id
                 WHERE f.deck_id = ? AND r.reviewed_at >= ? AND r.reviewed_at <= ? AND r.old_state = 'new'`;
    const results = await this.querySql(sql, [deckId, startOfDay, endOfDay]);
    return results[0]?.count || 0;
  }

  async countReviewCardsToday(
    deckId: string,
    startOfDay: string,
    endOfDay: string,
  ): Promise<number> {
    const sql = `SELECT COUNT(DISTINCT r.flashcard_id) as count
                 FROM review_logs r
                 JOIN flashcards f ON r.flashcard_id = f.id
                 WHERE f.deck_id = ? AND r.reviewed_at >= ? AND r.reviewed_at <= ? AND r.old_state = 'review'`;
    const results = await this.querySql(sql, [deckId, startOfDay, endOfDay]);
    return results[0]?.count || 0;
  }

  // REVIEW LOG OPERATIONS
  async createReviewLog(log: Omit<ReviewLog, "id">): Promise<void> {
    const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.insertReviewLog({ ...log, id: logId });
  }

  async insertReviewLog(reviewLog: ReviewLog): Promise<void> {
    // Build dynamic SQL to only include defined values
    this.debugLog("Inserting review log: ", reviewLog);
    const columns: string[] = [];
    const placeholders: string[] = [];
    const params: any[] = [];

    // Required fields
    const requiredFields = [
      ["id", reviewLog.id],
      ["flashcard_id", reviewLog.flashcardId],
      ["last_reviewed_at", reviewLog.lastReviewedAt],
      ["reviewed_at", reviewLog.reviewedAt],
      ["rating", reviewLog.rating],
      ["rating_label", reviewLog.ratingLabel],
      ["old_state", reviewLog.oldState],
      ["old_repetitions", reviewLog.oldRepetitions],
      ["old_lapses", reviewLog.oldLapses],
      ["old_stability", reviewLog.oldStability],
      ["old_difficulty", reviewLog.oldDifficulty],
      ["new_state", reviewLog.newState],
      ["new_repetitions", reviewLog.newRepetitions],
      ["new_lapses", reviewLog.newLapses],
      ["new_stability", reviewLog.newStability],
      ["new_difficulty", reviewLog.newDifficulty],
      ["old_interval_minutes", reviewLog.oldIntervalMinutes],
      ["new_interval_minutes", reviewLog.newIntervalMinutes],
      ["old_due_at", reviewLog.oldDueAt],
      ["new_due_at", reviewLog.newDueAt],
      ["elapsed_days", reviewLog.elapsedDays],
      ["retrievability", reviewLog.retrievability],
      ["request_retention", reviewLog.requestRetention],
      ["profile", reviewLog.profile],
      ["maximum_interval_days", reviewLog.maximumIntervalDays],
      ["min_minutes", reviewLog.minMinutes],
      ["fsrs_weights_version", reviewLog.fsrsWeightsVersion],
      ["scheduler_version", reviewLog.schedulerVersion],
    ];

    // Optional fields - only include if defined
    const optionalFields = [
      ["session_id", reviewLog.sessionId],
      ["shown_at", reviewLog.shownAt],
      ["time_elapsed_ms", reviewLog.timeElapsedMs],
      ["note_model_id", reviewLog.noteModelId],
      ["card_template_id", reviewLog.cardTemplateId],
      ["content_hash", reviewLog.contentHash],
      ["client", reviewLog.client],
    ];

    // Add all required fields
    for (const [column, value] of requiredFields) {
      columns.push(column);
      placeholders.push("?");
      params.push(value);
    }

    // Add optional fields if they have values
    for (const [column, value] of optionalFields) {
      if (value !== undefined) {
        columns.push(column);
        placeholders.push("?");
        params.push(value);
      }
    }

    const sql = `INSERT INTO review_logs (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
    await this.executeSql(sql, params);
  }

  async getLatestReviewLogForFlashcard(
    flashcardId: string,
  ): Promise<ReviewLog | null> {
    const sql = `SELECT * FROM review_logs WHERE flashcard_id = ? ORDER BY reviewed_at DESC LIMIT 1`;
    const results = await this.querySql(sql, [flashcardId]);

    if (results.length === 0) return null;

    const row = results[0];
    return {
      id: row[0],
      flashcardId: row[1],
      sessionId: row[17],
      lastReviewedAt: row[2],
      reviewedAt: row[3],
      rating: row[4],
      ratingLabel: this.getRatingLabel(row[4]),
      timeElapsedMs: row[5],
      oldState: row[6],
      oldRepetitions: row[10],
      oldLapses: row[12],
      oldStability: row[16],
      oldDifficulty: row[14],
      newState: row[7],
      newRepetitions: row[11],
      newLapses: row[13],
      newStability: row[16],
      newDifficulty: row[15],
      oldIntervalMinutes: row[8],
      newIntervalMinutes: row[9],
      oldDueAt: "",
      newDueAt: "",
      elapsedDays: 0,
      retrievability: 0,
      requestRetention: 0.9,
      profile: "STANDARD",
      maximumIntervalDays: 36500,
      minMinutes: 1440,
      fsrsWeightsVersion: "4.5",
      schedulerVersion: "1.0",
    };
  }

  async getAllReviewLogs(): Promise<ReviewLog[]> {
    const sql = `SELECT * FROM review_logs ORDER BY reviewed_at DESC`;
    const results = await this.querySql(sql, []);

    return results.map((row) => ({
      id: row[0],
      flashcardId: row[1],
      sessionId: row[17],
      lastReviewedAt: row[2],
      reviewedAt: row[3],
      rating: row[4],
      ratingLabel: this.getRatingLabel(row[4]),
      timeElapsedMs: row[5],
      oldState: row[6],
      oldRepetitions: row[10],
      oldLapses: row[12],
      oldStability: row[16],
      oldDifficulty: row[14],
      newState: row[7],
      newRepetitions: row[11],
      newLapses: row[13],
      newStability: row[16],
      newDifficulty: row[15],
      oldIntervalMinutes: row[8],
      newIntervalMinutes: row[9],
      oldDueAt: "",
      newDueAt: "",
      elapsedDays: 0,
      retrievability: 0,
      requestRetention: 0.9,
      profile: "STANDARD",
      maximumIntervalDays: 36500,
      minMinutes: 1440,
      fsrsWeightsVersion: "4.5",
      schedulerVersion: "1.0",
    }));
  }

  async reviewLogExists(reviewLogId: string): Promise<boolean> {
    const sql = `SELECT 1 FROM review_logs WHERE id = ? LIMIT 1`;
    const results = await this.querySql(sql, [reviewLogId]);
    return results.length > 0;
  }

  // REVIEW SESSION OPERATIONS
  async createReviewSession(
    session: Omit<ReviewSession, "id">,
  ): Promise<string> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.insertReviewSession({ ...session, id: sessionId });
    return sessionId;
  }

  async getReviewSessionById(sessionId: string): Promise<ReviewSession | null> {
    const sql = `SELECT * FROM review_sessions WHERE id = ?`;
    const results = await this.querySql(sql, [sessionId]);
    return results.length > 0 ? this.rowToReviewSession(results[0]) : null;
  }

  async getActiveReviewSession(deckId: string): Promise<ReviewSession | null> {
    const sql = `SELECT * FROM review_sessions WHERE deck_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`;
    const results = await this.querySql(sql, [deckId]);
    return results.length > 0 ? this.rowToReviewSession(results[0]) : null;
  }

  async getAllReviewSessions(): Promise<ReviewSession[]> {
    const sql = `SELECT * FROM review_sessions ORDER BY started_at DESC`;
    const results = await this.querySql(sql, []);
    return results.map((row) => this.rowToReviewSession(row));
  }

  async updateReviewSessionDoneUnique(
    sessionId: string,
    doneUnique: number,
  ): Promise<void> {
    const sql = `UPDATE review_sessions SET done_unique = ? WHERE id = ?`;
    await this.executeSql(sql, [doneUnique, sessionId]);
  }

  async endReviewSession(sessionId: string): Promise<void> {
    const sql = `UPDATE review_sessions SET ended_at = ? WHERE id = ?`;
    await this.executeSql(sql, [this.getCurrentTimestamp(), sessionId]);
  }

  async insertReviewSession(session: ReviewSession): Promise<void> {
    const sql = `INSERT INTO review_sessions (id, deck_id, started_at, ended_at, goal_total, done_unique)
                 VALUES (?, ?, ?, ?, ?, ?)`;

    await this.executeSql(sql, [
      session.id,
      session.deckId,
      session.startedAt,
      session.endedAt,
      session.goalTotal,
      session.doneUnique,
    ]);
  }

  async reviewSessionExists(sessionId: string): Promise<boolean> {
    const sql = `SELECT 1 FROM review_sessions WHERE id = ? LIMIT 1`;
    const results = await this.querySql(sql, [sessionId]);
    return results.length > 0;
  }

  async isCardReviewedInSession(
    sessionId: string,
    flashcardId: string,
  ): Promise<boolean> {
    const sql = `SELECT 1 FROM review_logs WHERE session_id = ? AND flashcard_id = ? LIMIT 1`;
    const results = await this.querySql(sql, [sessionId, flashcardId]);
    return results.length > 0;
  }

  // STATISTICS OPERATIONS
  async getDeckStats(
    deckId: string,
    respectDailyLimits: boolean = true,
  ): Promise<DeckStats> {
    const now = this.getCurrentTimestamp();

    try {
      // Original complex query with array/object compatibility
      const sql = `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END) as new_count,
          SUM(CASE WHEN state = 'review' AND due_date <= ? THEN 1 ELSE 0 END) as due_count,
          SUM(CASE WHEN state = 'review' AND interval > 30240 THEN 1 ELSE 0 END) as mature_count
        FROM flashcards
        WHERE deck_id = ?
      `;

      const results = await this.querySql(sql, [now, deckId]);
      this.debugLog(`Complex query result:`, results);

      // Handle both array and object result formats
      const row = Array.isArray(results[0])
        ? {
            total: results[0][0],
            new_count: results[0][1],
            due_count: results[0][2],
            mature_count: results[0][3],
          }
        : results[0] || {};

      let newCount = row.new_count || 0;
      let dueCount = row.due_count || 0;

      // Apply daily limits if requested
      if (respectDailyLimits) {
        const deck = await this.getDeckById(deckId);
        if (deck) {
          const dailyCounts = await this.getDailyReviewCounts(deckId);

          // Calculate remaining daily allowance for new cards
          if (deck.config.hasNewCardsLimitEnabled) {
            if (deck.config.newCardsPerDay === 0) {
              newCount = 0; // No new cards allowed
            } else {
              const remainingNew = Math.max(
                0,
                deck.config.newCardsPerDay - dailyCounts.newCount,
              );
              newCount = Math.min(newCount, remainingNew);
            }
          }

          // Calculate remaining daily allowance for review cards
          if (deck.config.hasReviewCardsLimitEnabled) {
            if (deck.config.reviewCardsPerDay === 0) {
              dueCount = 0; // No review cards allowed
            } else {
              const remainingReview = Math.max(
                0,
                deck.config.reviewCardsPerDay - dailyCounts.reviewCount,
              );
              dueCount = Math.min(dueCount, remainingReview);
            }
          }
        }
      }

      // Debug: Log actual values returned from query
      this.debugLog(
        `getDeckStats for ${deckId}: total=${row.total}, new_count=${row.new_count}, due_count=${row.due_count}, mature_count=${row.mature_count}`,
      );

      return {
        deckId,
        newCount,
        dueCount,
        totalCount: row.total || 0,
        matureCount: row.mature_count || 0,
      };
    } catch (error) {
      this.debugLog(`getDeckStats error for ${deckId}:`, error);
      // Return empty stats on error
      return {
        deckId,
        newCount: 0,
        dueCount: 0,
        totalCount: 0,
        matureCount: 0,
      };
    }
  }

  async getAllDeckStats(): Promise<DeckStats[]> {
    const decks = await this.getAllDecks();
    const stats = [];

    for (const deck of decks) {
      const deckStats = await this.getDeckStats(deck.id);
      stats.push(deckStats);
    }

    return stats;
  }

  async getDailyReviewCounts(
    deckId: string,
  ): Promise<{ newCount: number; reviewCount: number }> {
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).toISOString();
    const endOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    ).toISOString();

    const newCount = await this.countNewCardsToday(
      deckId,
      startOfDay,
      endOfDay,
    );
    const reviewCount = await this.countReviewCardsToday(
      deckId,
      startOfDay,
      endOfDay,
    );

    return { newCount, reviewCount };
  }

  async getReviewCountsByDate(
    days: number = 365,
  ): Promise<Map<string, number>> {
    const sql = `
      SELECT DATE(reviewed_at) as date, COUNT(*) as count
      FROM review_logs
      WHERE reviewed_at >= date('now', '-${days} days')
      GROUP BY DATE(reviewed_at)
    `;

    const results = await this.querySql(sql, []);
    const countMap = new Map<string, number>();

    results.forEach((row) => {
      countMap.set(row[0], row[1]);
    });

    return countMap;
  }

  async getStudyStats(): Promise<{
    totalHours: number;
    pastMonthHours: number;
  }> {
    const sql1 = `SELECT SUM(time_elapsed_ms) as total FROM review_logs`;
    const sql2 = `SELECT SUM(time_elapsed_ms) as total FROM review_logs WHERE reviewed_at >= date('now', '-30 days')`;

    const totalResults = await this.querySql(sql1, []);
    const monthResults = await this.querySql(sql2, []);

    const totalMs = totalResults[0]?.total || 0;
    const monthMs = monthResults[0]?.total || 0;

    return {
      totalHours: totalMs / (1000 * 60 * 60),
      pastMonthHours: monthMs / (1000 * 60 * 60),
    };
  }

  async getOverallStatistics(
    deckFilter: string = "all",
    timeframe: string = "12months",
  ): Promise<Statistics> {
    // Return basic statistics implementation matching the correct interface
    return {
      dailyStats: [],
      cardStats: {
        new: 0,
        review: 0,
        mature: 0,
      },
      answerButtons: { again: 0, hard: 0, good: 0, easy: 0 },
      retentionRate: 0,
      intervals: [],
      forecast: [],
      averagePace: 0,
      totalReviewTime: 0,
    };
  }

  // UTILITY OPERATIONS
  async purgeDatabase(): Promise<void> {
    await this.runInTransaction(async () => {
      await this.executeSql("DELETE FROM review_logs");
      await this.executeSql("DELETE FROM review_sessions");
      await this.executeSql("DELETE FROM flashcards");
      await this.executeSql("DELETE FROM decks");
    });
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    return await this.querySql(sql, params);
  }

  // BACKUP OPERATIONS - Concrete implementations using abstract db methods
  async createBackupDatabase(backupPath: string): Promise<void> {
    try {
      // Export current database to buffer
      const data = await this.exportDatabaseToBuffer();

      // Write the SQLite database file
      await this.adapter.writeBinary(backupPath, data);

      this.debugLog(`SQLite backup created at: ${backupPath}`);
    } catch (error) {
      console.error("Failed to create backup database:", error);
      throw error;
    }
  }

  async restoreFromBackupDatabase(backupPath: string): Promise<void> {
    try {
      // Check if backup file exists
      if (!(await this.adapter.exists(backupPath))) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      // Read the backup SQLite file
      const backupData = await this.adapter.readBinary(backupPath);

      // Restore from backup using concrete implementation
      await this.restoreFromBackupData(new Uint8Array(backupData));

      // Save the updated database
      await this.save();

      this.debugLog(`Database restored from backup: ${backupPath}`);
    } catch (error) {
      console.error("Failed to restore from backup database:", error);
      throw error;
    }
  }

  async restoreFromBackupData(backupData: Uint8Array): Promise<void> {
    try {
      // Create a backup database instance to read data from
      const backupDb = await this.createBackupDatabaseInstance(backupData);

      // Get all data from backup database
      const reviewLogs = await this.queryBackupDatabase(
        backupDb,
        "SELECT * FROM review_logs",
      );
      const reviewSessions = await this.queryBackupDatabase(
        backupDb,
        "SELECT * FROM review_sessions",
      );

      // Insert data into current database, avoiding duplicates
      if (reviewSessions.length > 0) {
        for (const session of reviewSessions) {
          const sessionId = session[0]; // Assuming id is first column

          // Check if session already exists
          const existsResult = await this.querySql(
            "SELECT 1 FROM review_sessions WHERE id = ?",
            [sessionId],
          );

          if (existsResult.length === 0) {
            // Insert session if it doesn't exist - need to map columns properly
            const columns = [
              "id",
              "deck_id",
              "started_at",
              "ended_at",
              "goal_total",
              "done_unique",
            ];
            const placeholders = columns.map(() => "?").join(", ");
            await this.executeSql(
              `INSERT INTO review_sessions (${columns.join(", ")}) VALUES (${placeholders})`,
              session,
            );
          }
        }
      }

      if (reviewLogs.length > 0) {
        for (const log of reviewLogs) {
          const logId = log[0]; // Assuming id is first column

          // Check if log already exists
          const existsResult = await this.querySql(
            "SELECT 1 FROM review_logs WHERE id = ?",
            [logId],
          );

          if (existsResult.length === 0) {
            // Insert log if it doesn't exist - need to map all columns
            const columns = [
              "id",
              "flashcard_id",
              "reviewed_at",
              "rating",
              "elapsed_days",
              "new_state",
              "new_due_date",
              "new_stability",
              "new_difficulty",
              "new_interval",
              "new_repetitions",
              "new_lapses",
              "old_state",
              "old_due_date",
              "old_stability",
              "old_difficulty",
              "old_interval",
              "old_repetitions",
              "old_lapses",
              "request_retention",
              "profile",
              "weights_version",
              "time_elapsed",
              "session_id",
            ];
            const placeholders = columns.map(() => "?").join(", ");
            await this.executeSql(
              `INSERT INTO review_logs (${columns.join(", ")}) VALUES (${placeholders})`,
              log,
            );
          }
        }
      }

      // Clean up backup database
      await this.closeBackupDatabaseInstance(backupDb);

      this.debugLog("Database restored from backup data");
    } catch (error) {
      console.error("Failed to restore from backup data:", error);
      throw error;
    }
  }

  // Abstract methods for database-specific operations
  abstract exportDatabaseToBuffer(): Promise<Uint8Array>;
  abstract createBackupDatabaseInstance(backupData: Uint8Array): Promise<any>;
  abstract queryBackupDatabase(backupDb: any, sql: string): Promise<any[]>;
  abstract closeBackupDatabaseInstance(backupDb: any): Promise<void>;
}
