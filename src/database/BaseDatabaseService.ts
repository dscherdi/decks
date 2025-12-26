import type { DataAdapter } from "obsidian";
import type {
    Deck,
    Flashcard,
    ReviewLog,
    ReviewSession,
    Statistics,
} from "./types";
import { DEFAULT_DECK_CONFIG } from "./types";
import { SQL_QUERIES } from "./schemas";
import type { SyncData, SyncResult } from "../services/FlashcardSynchronizer";
import type {
    SqlJsValue,
    ReviewLogRow,
    CountResult,
    DailyStatsRow,
    CardStatsRow,
    AnswerButtonStatsRow,
    IntervalDistributionRow,
    PaceStatsRow,
    BacklogRow,
    OverdueRow,
    ForecastRow,
    DateCountRow,
    SqlRecord,
    SqlRow,
} from "./sql-types";
import type { IDatabaseService } from "./DatabaseFactory";
import { generateFlashcardId } from "../utils/hash";

export interface QueryConfig {
    asObject?: boolean;
}

export abstract class BaseDatabaseService implements IDatabaseService {
    protected dbPath: string;
    protected adapter: DataAdapter;
    protected debugLog: (
        message: string,
        ...args: (string | number | object)[]
    ) => void;

    constructor(
        dbPath: string,
        adapter: DataAdapter,
        debugLog: (
            message: string,
            ...args: (string | number | object)[]
        ) => void
    ) {
        this.dbPath = dbPath;
        this.adapter = adapter;
        this.debugLog = debugLog;
    }

    // Abstract methods to be implemented by concrete classes
    // Core abstract methods that must be implemented by subclasses
    abstract initialize(): Promise<void>;
    abstract close(): Promise<void>;
    abstract save(): Promise<void>;
    abstract executeSql(sql: string, params?: SqlJsValue[]): Promise<void>;
    abstract syncFlashcardsForDeck(
        data: SyncData,
        progressCallback?: (progress: number, message?: string) => void
    ): Promise<SyncResult>;

    // Shared business logic methods
    protected parseDeckRow(row: (string | number | null)[]): Deck {
        let config = DEFAULT_DECK_CONFIG;

        if (row[5]) {
            try {
                const parsedConfig: Record<string, string | number | boolean> =
                    JSON.parse(row[5] as string);

                // Handle legacy config format
                if (typeof parsedConfig.newCardsEnabled === "boolean") {
                    const legacyConfig = parsedConfig as Record<
                        string,
                        unknown
                    >;
                    config = {
                        ...DEFAULT_DECK_CONFIG,
                        newCardsPerDay: legacyConfig.newCardsEnabled
                            ? (legacyConfig.newCardsLimit as number) || 20
                            : 0,
                        reviewCardsPerDay: legacyConfig.reviewCardsEnabled
                            ? (legacyConfig.reviewCardsLimit as number) || 100
                            : 0,
                        reviewOrder:
                            (legacyConfig.reviewOrder as
                                | "due-date"
                                | "random") || "due-date",
                        headerLevel: (legacyConfig.headerLevel as number) || 2,
                    };
                } else {
                    config = { ...DEFAULT_DECK_CONFIG, ...parsedConfig };
                }
            } catch (error) {
                this.debugLog(
                    "Failed to parse deck config, using defaults:",
                    error
                );
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

    protected rowToFlashcard(row: (string | number | null)[]): Flashcard {
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

    protected rowToReviewSession(
        row: (string | number | null)[]
    ): ReviewSession {
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
    protected getCurrentTimestamp(): string {
        return new Date().toISOString();
    }

    protected getRatingLabel(
        rating: number
    ): "again" | "hard" | "good" | "easy" {
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
        deck: Omit<Deck, "created" | "modified">
    ): Promise<string> {
        const now = this.getCurrentTimestamp();

        const fullDeck: Deck = {
            ...deck,
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
        const results = (await this.querySql(sql, [id])) as (
            | string
            | number
            | null
        )[][];
        return results.length > 0 ? this.parseDeckRow(results[0]) : null;
    }

    async getDeckByFilepath(filepath: string): Promise<Deck | null> {
        const sql = `SELECT id, name, filepath, tag, last_reviewed, config, created, modified FROM decks WHERE filepath = ?`;
        const results = (await this.querySql(sql, [filepath])) as (
            | string
            | number
            | null
        )[][];
        return results.length > 0 ? this.parseDeckRow(results[0]) : null;
    }

    async getDeckByTag(tag: string): Promise<Deck | null> {
        const sql = `SELECT id, name, filepath, tag, last_reviewed, config, created, modified FROM decks WHERE tag = ?`;
        const results = (await this.querySql(sql, [tag])) as (
            | string
            | number
            | null
        )[][];
        return results.length > 0 ? this.parseDeckRow(results[0]) : null;
    }

    async getAllDecks(): Promise<Deck[]> {
        const sql = `SELECT id, name, filepath, tag, last_reviewed, config, created, modified FROM decks ORDER BY name`;
        const results = (await this.querySql(sql, [])) as (
            | string
            | number
            | null
        )[][];
        return results.map((row) => this.parseDeckRow(row));
    }

    async updateDeck(id: string, updates: Partial<Deck>): Promise<void> {
        const updateFields: string[] = [];
        const params: (string | number | null)[] = [];

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
            params.push(updates.lastReviewed || null);
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
        timestamp: string
    ): Promise<void> {
        const sql = `UPDATE decks SET last_reviewed = ?, modified = ? WHERE id = ?`;
        await this.executeSql(sql, [
            timestamp,
            this.getCurrentTimestamp(),
            deckId,
        ]);
    }

    async updateDeckHeaderLevel(
        deckId: string,
        headerLevel: number
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
        newFilepath: string
    ): Promise<void> {
        // Update deck
        const sql1 = `UPDATE decks SET id = ?, name = ?, filepath = ?, modified = ? WHERE id = ?`;
        await this.executeSql(sql1, [
            newDeckId,
            newName,
            newFilepath,
            this.getCurrentTimestamp(),
            oldDeckId,
        ]);

        // Update flashcard deck_id references
        const sql2 = `UPDATE flashcards SET deck_id = ? WHERE deck_id = ?`;
        await this.executeSql(sql2, [newDeckId, oldDeckId]);

        // Update review logs
        const sql3 = `UPDATE review_logs SET deck_id = ? WHERE deck_id = ?`;
        await this.executeSql(sql3, [newDeckId, oldDeckId]);

        // Update review sessions
        const sql4 = `UPDATE review_sessions SET deck_id = ? WHERE deck_id = ?`;
        await this.executeSql(sql4, [newDeckId, oldDeckId]);
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
        flashcard: Omit<Flashcard, "created" | "modified"> & { id?: string }
    ): Promise<void> {
        const now = this.getCurrentTimestamp();
        // Use provided ID first, then generate from front text
        const flashcardId =
            flashcard.id || generateFlashcardId(flashcard.front);
        const flashcardWithId = {
            ...flashcard,
            id: flashcardId,
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
        const results = (await this.querySql(sql, [flashcardId])) as (
            | string
            | number
            | null
        )[][];
        return results.length > 0 ? this.rowToFlashcard(results[0]) : null;
    }

    async getFlashcardsByDeck(deckId: string): Promise<Flashcard[]> {
        const sql = `SELECT * FROM flashcards WHERE deck_id = ? ORDER BY created`;
        const results = (await this.querySql(sql, [deckId])) as (
            | string
            | number
            | null
        )[][];
        return results.map((row: (string | number | null)[]) =>
            this.rowToFlashcard(row)
        );
    }

    async getAllFlashcards(): Promise<Flashcard[]> {
        const sql = `SELECT * FROM flashcards ORDER BY created`;
        const results = (await this.querySql(sql, [])) as (
            | string
            | number
            | null
        )[][];
        return results.map((row: (string | number | null)[]) =>
            this.rowToFlashcard(row)
        );
    }

    async getDueFlashcards(deckId: string): Promise<Flashcard[]> {
        const now = this.getCurrentTimestamp();
        const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND due_date <= ? ORDER BY due_date`;
        const results = (await this.querySql(sql, [deckId, now])) as (
            | string
            | number
            | null
        )[][];
        return results.map((row: (string | number | null)[]) =>
            this.rowToFlashcard(row)
        );
    }

    async getReviewableFlashcards(deckId: string): Promise<Flashcard[]> {
        const now = this.getCurrentTimestamp();
        const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND (state = 'new' OR due_date <= ?) ORDER BY due_date`;
        const results = (await this.querySql(sql, [deckId, now])) as (
            | string
            | number
            | null
        )[][];
        return results.map((row: (string | number | null)[]) =>
            this.rowToFlashcard(row)
        );
    }

    async getNewCardsForReview(deckId: string): Promise<Flashcard[]> {
        const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND state = 'new' ORDER BY created LIMIT 100`;
        const results = (await this.querySql(sql, [deckId])) as (
            | string
            | number
            | null
        )[][];
        return results.map((row: (string | number | null)[]) =>
            this.rowToFlashcard(row)
        );
    }

    async getReviewCardsForReview(deckId: string): Promise<Flashcard[]> {
        const now = this.getCurrentTimestamp();
        const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND state = 'review' AND due_date <= ? ORDER BY due_date LIMIT 100`;
        const results = (await this.querySql(sql, [deckId, now])) as (
            | string
            | number
            | null
        )[][];
        return results.map((row: (string | number | null)[]) =>
            this.rowToFlashcard(row)
        );
    }

    async updateFlashcard(
        flashcardId: string,
        updates: Partial<Flashcard>
    ): Promise<void> {
        const updateFields: string[] = [];
        const params: (string | number | null)[] = [];

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
                params.push(updates[key as keyof Flashcard] ?? null);
            }
        });

        updateFields.push("modified = ?");
        params.push(this.getCurrentTimestamp());
        params.push(flashcardId);

        const sql = `UPDATE flashcards SET ${updateFields.join(
            ", "
        )} WHERE id = ?`;
        await this.executeSql(sql, params);
    }

    async updateFlashcardDeckIds(
        oldDeckId: string,
        newDeckId: string
    ): Promise<void> {
        const sql = `UPDATE flashcards SET deck_id = ? WHERE deck_id = ?`;
        await this.executeSql(sql, [newDeckId, oldDeckId]);
    }

    async migrateFlashcardIdentity(
        oldId: string,
        newCard: Omit<Flashcard, "created" | "modified">
    ): Promise<void> {
        const now = this.getCurrentTimestamp();

        // Update flashcard ID and content
        await this.executeSql(
            `UPDATE flashcards
             SET id = ?, front = ?, back = ?, content_hash = ?, modified = ?
             WHERE id = ?`,
            [
                newCard.id,
                newCard.front,
                newCard.back,
                newCard.contentHash,
                now,
                oldId,
            ]
        );

        // Migrate review_logs to new ID (critical since FK removed)
        await this.executeSql(
            `UPDATE review_logs SET flashcard_id = ? WHERE flashcard_id = ?`,
            [newCard.id, oldId]
        );
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
        flashcards: Array<Omit<Flashcard, "created" | "modified">>
    ): Promise<void> {
        if (flashcards.length === 0) return;

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
    }

    async batchUpdateFlashcards(
        updates: Array<{ id: string; updates: Partial<Flashcard> }>
    ): Promise<void> {
        if (updates.length === 0) return;

        for (const update of updates) {
            await this.updateFlashcard(update.id, update.updates);
        }
    }

    async batchDeleteFlashcards(flashcardIds: string[]): Promise<void> {
        if (flashcardIds.length === 0) return;

        const placeholders = flashcardIds.map(() => "?").join(",");
        const sql = `DELETE FROM flashcards WHERE id IN (${placeholders})`;
        await this.executeSql(sql, flashcardIds);
    }

    // COUNT OPERATIONS
    async countNewCards(deckId: string): Promise<number> {
        const sql =
            "SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ? AND state = 'new'";
        const results = await this.querySql<CountResult>(sql, [deckId], {
            asObject: true,
        });
        return results[0]?.count || 0;
    }

    async countDueCards(deckId: string): Promise<number> {
        const now = this.getCurrentTimestamp();
        const sql = `SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ? AND state = 'review' AND due_date <= ?`;
        const results = await this.querySql<CountResult>(sql, [deckId, now], {
            asObject: true,
        });
        return results[0]?.count || 0;
    }

    async countTotalCards(deckId: string): Promise<number> {
        const sql =
            "SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ?";
        const results = await this.querySql<CountResult>(sql, [deckId], {
            asObject: true,
        });
        return results[0]?.count || 0;
    }

    // FORECAST OPERATIONS (optimized SQL)
    async getScheduledDueByDay(
        deckId: string,
        startDate: string,
        endDate: string
    ): Promise<{ day: string; count: number }[]> {
        const results = await this.querySql<DateCountRow>(
            SQL_QUERIES.GET_SCHEDULED_DUE_BY_DAY,
            [deckId, startDate, endDate],
            { asObject: true }
        );
        return results.map((row) => ({
            day: row.date,
            count: row.count,
        }));
    }

    async getScheduledDueByDayMulti(
        deckIds: string[],
        startDate: string,
        endDate: string
    ): Promise<{ day: string; count: number }[]> {
        if (deckIds.length === 0) return [];

        // Generate dynamic IN clause
        const placeholders = deckIds.map(() => "?").join(",");
        const sql = `
      SELECT substr(due_date,1,10) AS day, COUNT(*) AS c
      FROM flashcards
      WHERE deck_id IN (${placeholders}) AND state='review'
        AND due_date >= ? AND due_date < ?
      GROUP BY day
      ORDER BY day
    `;

        const results = await this.querySql(
            sql,
            [...deckIds, startDate, endDate],
            {
                asObject: true,
            }
        );
        return results.map((row: { day: string; c: number }) => ({
            day: row.day,
            count: row.c || 0,
        }));
    }

    async getCurrentBacklog(
        deckId: string,
        currentDate: string
    ): Promise<number> {
        const results = await this.querySql<BacklogRow>(
            SQL_QUERIES.GET_CURRENT_BACKLOG,
            [deckId, currentDate],
            { asObject: true }
        );
        return results[0]?.n || 0;
    }

    async getCurrentBacklogMulti(
        deckIds: string[],
        currentDate: string
    ): Promise<number> {
        if (deckIds.length === 0) return 0;

        // Generate dynamic IN clause
        const placeholders = deckIds.map(() => "?").join(",");
        const sql = `
      SELECT COUNT(*) as n
      FROM flashcards
      WHERE deck_id IN (${placeholders}) AND state='review' AND due_date < ?
    `;

        const results = await this.querySql<BacklogRow>(
            sql,
            [...deckIds, currentDate],
            {
                asObject: true,
            }
        );
        return results[0]?.n || 0;
    }

    async getDeckReviewCountRange(
        deckId: string,
        startDate: string,
        endDate: string
    ): Promise<number> {
        const results = await this.querySql<BacklogRow>(
            SQL_QUERIES.GET_DECK_REVIEW_COUNT_RANGE,
            [deckId, startDate, endDate],
            { asObject: true }
        );
        return results[0]?.n || 0;
    }

    async countNewCardsToday(deckId: string): Promise<number> {
        const sql = `SELECT COUNT(DISTINCT r.flashcard_id) as count
                 FROM review_logs r
                 JOIN flashcards f ON r.flashcard_id = f.id
                 WHERE f.deck_id = ?
                   AND r.reviewed_at >= datetime('now', 'start of day')
                   AND r.reviewed_at < datetime('now', 'start of day', '+1 day')
                   AND r.old_state = 'new'`;
        const results = await this.querySql<CountResult>(sql, [deckId], {
            asObject: true,
        });
        return results[0]?.count || 0;
    }

    async countReviewCardsToday(deckId: string): Promise<number> {
        const sql = `SELECT COUNT(DISTINCT r.flashcard_id) as count
                 FROM review_logs r
                 JOIN flashcards f ON r.flashcard_id = f.id
                 WHERE f.deck_id = ?
                   AND r.reviewed_at >= datetime('now', 'start of day')
                   AND r.reviewed_at < datetime('now', 'start of day', '+1 day')
                   AND r.old_state = 'review'`;
        const results = await this.querySql<CountResult>(sql, [deckId], {
            asObject: true,
        });
        return results[0]?.count || 0;
    }

    // REVIEW LOG OPERATIONS
    async createReviewLog(log: Omit<ReviewLog, "id">): Promise<void> {
        const logId = `log_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
        await this.insertReviewLog({ ...log, id: logId });
    }

    async insertReviewLog(reviewLog: ReviewLog): Promise<void> {
        // Build dynamic SQL to only include defined values
        this.debugLog("Inserting review log: ", reviewLog);
        const columns: string[] = [];
        const placeholders: string[] = [];
        const params: SqlJsValue[] = [];

        // Required fields
        const requiredFields: [string, SqlJsValue][] = [
            ["id", reviewLog.id],
            ["flashcard_id", reviewLog.flashcardId],
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

        // Optional fields - only include if defined and not null/undefined
        const optionalFields: [string, SqlJsValue][] = [
            ["last_reviewed_at", reviewLog.lastReviewedAt || null],
            ["session_id", reviewLog.sessionId || null],
            ["shown_at", reviewLog.shownAt || null],
            ["time_elapsed_ms", reviewLog.timeElapsedMs || null],
            ["note_model_id", reviewLog.noteModelId || null],
            ["card_template_id", reviewLog.cardTemplateId || null],
            ["content_hash", reviewLog.contentHash || null],
            ["client", reviewLog.client || null],
        ];

        // Add all required fields
        for (const [column, value] of requiredFields) {
            if (value === undefined) {
                this.debugLog(
                    `Required field '${column}' is undefined in review log. Full log:`,
                    reviewLog
                );
                throw new Error(
                    `Required field '${column}' is undefined in review log`
                );
            }
            columns.push(column);
            placeholders.push("?");
            params.push(value);
        }

        // Add optional fields only if they have values
        for (const [column, value] of optionalFields) {
            if (value !== null && value !== undefined) {
                columns.push(column);
                placeholders.push("?");
                params.push(value);
            }
        }

        const sql = `INSERT INTO review_logs (${columns.join(
            ", "
        )}) VALUES (${placeholders.join(", ")})`;
        await this.querySql(sql, params as (string | number | null)[]);
    }

    async getLatestReviewLogForFlashcard(
        flashcardId: string
    ): Promise<ReviewLog | null> {
        const sql = `SELECT * FROM review_logs WHERE flashcard_id = ? ORDER BY reviewed_at DESC LIMIT 1`;
        const results = await this.querySql<ReviewLogRow>(sql, [flashcardId], {
            asObject: true,
        });

        if (results.length === 0) return null;

        const row = results[0];
        return {
            id: row.id,
            flashcardId: row.flashcard_id,
            sessionId: row.session_id || undefined,
            lastReviewedAt: row.last_reviewed_at,
            reviewedAt: row.reviewed_at,
            rating: row.rating as 1 | 2 | 3 | 4,
            ratingLabel: this.getRatingLabel(row.rating),
            timeElapsedMs: row.time_elapsed_ms,
            oldState: row.old_state as "new" | "review",
            oldRepetitions: row.old_repetitions,
            oldLapses: row.old_lapses,
            oldStability: row.old_stability,
            oldDifficulty: row.old_difficulty,
            newState: row.new_state as "new" | "review",
            newRepetitions: row.new_repetitions,
            newLapses: row.new_lapses,
            newStability: row.new_stability,
            newDifficulty: row.new_difficulty,
            oldIntervalMinutes: row.old_interval_minutes,
            newIntervalMinutes: row.new_interval_minutes,
            oldDueAt: row.old_due_at,
            newDueAt: row.new_due_at,
            elapsedDays: row.elapsed_days,
            retrievability: row.retrievability,
            requestRetention: row.request_retention,
            profile: row.profile as "INTENSIVE" | "STANDARD",
            maximumIntervalDays: row.maximum_interval_days,
            minMinutes: row.min_minutes,
            fsrsWeightsVersion: row.fsrs_weights_version,
            schedulerVersion: row.scheduler_version,
        };
    }

    async getAllReviewLogs(): Promise<ReviewLog[]> {
        const sql = `SELECT * FROM review_logs ORDER BY reviewed_at DESC`;
        const results = await this.querySql<ReviewLogRow>(sql, [], {
            asObject: true,
        });

        return results.map((row) => ({
            id: row.id,
            flashcardId: row.flashcard_id,
            sessionId: row.session_id || undefined,
            lastReviewedAt: row.last_reviewed_at,
            reviewedAt: row.reviewed_at,
            rating: row.rating as 1 | 2 | 3 | 4,
            ratingLabel: this.getRatingLabel(row.rating),
            timeElapsedMs: row.time_elapsed_ms,
            oldState: row.old_state as "new" | "review",
            oldRepetitions: row.old_repetitions,
            oldLapses: row.old_lapses,
            oldStability: row.old_stability,
            oldDifficulty: row.old_difficulty,
            newState: row.new_state as "new" | "review",
            newRepetitions: row.new_repetitions,
            newLapses: row.new_lapses,
            newStability: row.new_stability,
            newDifficulty: row.new_difficulty,
            oldIntervalMinutes: row.old_interval_minutes,
            newIntervalMinutes: row.new_interval_minutes,
            oldDueAt: row.old_due_at,
            newDueAt: row.new_due_at,
            elapsedDays: row.elapsed_days,
            retrievability: row.retrievability,
            requestRetention: row.request_retention,
            profile: row.profile as "INTENSIVE" | "STANDARD",
            maximumIntervalDays: row.maximum_interval_days,
            minMinutes: row.min_minutes,
            fsrsWeightsVersion: row.fsrs_weights_version,
            schedulerVersion: row.scheduler_version,
        }));
    }

    async reviewLogExists(reviewLogId: string): Promise<boolean> {
        const sql = `SELECT 1 as found FROM review_logs WHERE id = ? LIMIT 1`;
        const results = await this.querySql(sql, [reviewLogId], {
            asObject: true,
        });
        return results.length > 0;
    }

    // OPTIMIZED REVIEW LOG QUERIES FOR STATISTICS
    async getReviewLogsByDeck(deckId: string): Promise<ReviewLog[]> {
        const sql = `
      SELECT rl.*
      FROM review_logs rl
      JOIN flashcards f ON rl.flashcard_id = f.id
      WHERE f.deck_id = ?
      ORDER BY rl.reviewed_at DESC
    `;
        const results = await this.querySql(sql, [deckId], { asObject: true });
        return this.mapRowsToReviewLogs(results as ReviewLogRow[]);
    }

    async getReviewLogsByDecks(deckIds: string[]): Promise<ReviewLog[]> {
        if (deckIds.length === 0) return [];

        const placeholders = deckIds.map(() => "?").join(",");
        const sql = `
      SELECT rl.*
      FROM review_logs rl
      JOIN flashcards f ON rl.flashcard_id = f.id
      WHERE f.deck_id IN (${placeholders})
      ORDER BY rl.reviewed_at DESC
    `;
        const results = await this.querySql(sql, deckIds, { asObject: true });
        return this.mapRowsToReviewLogs(results as ReviewLogRow[]);
    }

    private mapRowsToReviewLogs(results: ReviewLogRow[]): ReviewLog[] {
        return results.map((row) => ({
            id: row.id,
            flashcardId: row.flashcard_id,
            sessionId: row.session_id || undefined,
            lastReviewedAt: row.last_reviewed_at,
            reviewedAt: row.reviewed_at,
            rating: row.rating as 1 | 2 | 3 | 4,
            ratingLabel: this.getRatingLabel(row.rating),
            timeElapsedMs: row.time_elapsed_ms,
            oldState: row.old_state as "new" | "review",
            oldRepetitions: row.old_repetitions,
            oldLapses: row.old_lapses,
            oldStability: row.old_stability,
            oldDifficulty: row.old_difficulty,
            newState: row.new_state as "new" | "review",
            newRepetitions: row.new_repetitions,
            newLapses: row.new_lapses,
            newStability: row.new_stability,
            newDifficulty: row.new_difficulty,
            oldIntervalMinutes: row.old_interval_minutes,
            newIntervalMinutes: row.new_interval_minutes,
            oldDueAt: row.old_due_at,
            newDueAt: row.new_due_at,
            elapsedDays: row.elapsed_days,
            retrievability: row.retrievability,
            requestRetention: row.request_retention,
            profile: row.profile as "INTENSIVE" | "STANDARD",
            maximumIntervalDays: row.maximum_interval_days,
            minMinutes: row.min_minutes,
            fsrsWeightsVersion: row.fsrs_weights_version,
            schedulerVersion: row.scheduler_version,
        }));
    }

    // REVIEW SESSION OPERATIONS
    async createReviewSession(
        session: Omit<ReviewSession, "id">
    ): Promise<string> {
        const sessionId = `session_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
        await this.insertReviewSession({ ...session, id: sessionId });
        return sessionId;
    }

    async getReviewSessionById(
        sessionId: string
    ): Promise<ReviewSession | null> {
        const sql = `SELECT * FROM review_sessions WHERE id = ?`;
        const results = (await this.querySql(sql, [sessionId])) as (
            | string
            | number
            | null
        )[][];
        return results.length > 0 ? this.rowToReviewSession(results[0]) : null;
    }

    async getActiveReviewSession(
        deckId: string
    ): Promise<ReviewSession | null> {
        const sql = `SELECT * FROM review_sessions WHERE deck_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`;
        const results = (await this.querySql(sql, [deckId])) as (
            | string
            | number
            | null
        )[][];
        return results.length > 0 ? this.rowToReviewSession(results[0]) : null;
    }

    async getAllReviewSessions(): Promise<ReviewSession[]> {
        const sql = `SELECT * FROM review_sessions ORDER BY started_at DESC`;
        const results = (await this.querySql(sql, [])) as (
            | string
            | number
            | null
        )[][];
        return results.map((row: (string | number | null)[]) =>
            this.rowToReviewSession(row)
        );
    }

    async updateReviewSessionDoneUnique(
        sessionId: string,
        doneUnique: number
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
            session.endedAt ?? null,
            session.goalTotal,
            session.doneUnique,
        ]);
    }

    async reviewSessionExists(sessionId: string): Promise<boolean> {
        const sql = `SELECT 1 as found FROM review_sessions WHERE id = ? LIMIT 1`;
        const results = await this.querySql(sql, [sessionId], {
            asObject: true,
        });
        return results.length > 0;
    }

    async isCardReviewedInSession(
        sessionId: string,
        flashcardId: string
    ): Promise<boolean> {
        const sql = `SELECT 1 as found FROM review_logs WHERE session_id = ? AND flashcard_id = ? LIMIT 1`;
        const results = await this.querySql(sql, [sessionId, flashcardId], {
            asObject: true,
        });
        return results.length > 0;
    }

    async getDailyReviewCounts(
        deckId: string
    ): Promise<{ newCount: number; reviewCount: number }> {
        const newCount = await this.countNewCardsToday(deckId);
        const reviewCount = await this.countReviewCardsToday(deckId);

        return { newCount, reviewCount };
    }

    async getOverallStatistics(timeframe = "12months"): Promise<Statistics> {
        try {
            // Calculate timeframe dates
            const now = new Date();
            const daysAgo =
                timeframe === "12months"
                    ? 365
                    : timeframe === "3months"
                    ? 90
                    : 30;
            const startDate = new Date(
                now.getTime() - daysAgo * 24 * 60 * 60 * 1000
            ).toISOString();
            const endDate = now.toISOString();

            this.debugLog(
                `[Statistics Debug] Querying stats for timeframe: ${timeframe} (${daysAgo} days)`
            );
            this.debugLog(
                `[Statistics Debug] Date range: ${startDate} to ${endDate}`
            );

            // Basic health check - count total records
            const totalReviewLogsResults = await this.querySql<CountResult>(
                "SELECT COUNT(*) as count FROM review_logs WHERE reviewed_at >= ? AND reviewed_at <= ?",
                [startDate, endDate],
                { asObject: true }
            );
            const totalFlashcardsResults = await this.querySql<CountResult>(
                "SELECT COUNT(*) as count FROM flashcards",
                [],
                { asObject: true }
            );
            const totalReviewLogsCount = totalReviewLogsResults[0]?.count || 0;
            const totalFlashcardsCount = totalFlashcardsResults[0]?.count || 0;
            this.debugLog(
                `[Statistics Debug] Found ${totalReviewLogsCount} review logs, ${totalFlashcardsCount} flashcards`
            );

            // Get daily stats
            const dailyStatsResults = await this.querySql<DailyStatsRow>(
                SQL_QUERIES.GET_DAILY_STATS,
                [startDate, endDate],
                { asObject: true }
            );
            const dailyStats = dailyStatsResults.map((row) => ({
                date: row.date,
                reviews: row.reviews || 0,
                timeSpent: row.total_time_seconds || 0,
                newCards: row.new_cards || 0,
                learningCards: row.learning_cards || 0,
                reviewCards: row.review_cards || 0,
                correctRate: row.correct_rate || 0,
            }));
            this.debugLog(
                `[Statistics Debug] Daily stats found: ${dailyStatsResults.length} days`
            );

            // Get card stats (no date filter - shows current card states)
            const cardStatsResults = await this.querySql<CardStatsRow>(
                SQL_QUERIES.GET_CARD_STATS,
                [],
                { asObject: true }
            );
            const cardStats = { new: 0, review: 0, mature: 0, total: 0 };
            cardStatsResults.forEach((row) => {
                if (row.card_type === "new") cardStats.new = row.count || 0;
                else if (row.card_type === "review")
                    cardStats.review = row.count || 0;
                else if (row.card_type === "mature")
                    cardStats.mature = row.count || 0;
            });
            cardStats.total =
                cardStats.new + cardStats.review + cardStats.mature;
            this.debugLog(`[Statistics Debug] Card stats:`, cardStats);

            // Get answer button stats
            const answerButtonResults =
                await this.querySql<AnswerButtonStatsRow>(
                    SQL_QUERIES.GET_ANSWER_BUTTON_STATS,
                    [startDate, endDate],
                    { asObject: true }
                );
            const answerButtons = { again: 0, hard: 0, good: 0, easy: 0 };
            answerButtonResults.forEach((row) => {
                if (row.rating_label === "again")
                    answerButtons.again = row.count || 0;
                else if (row.rating_label === "hard")
                    answerButtons.hard = row.count || 0;
                else if (row.rating_label === "good")
                    answerButtons.good = row.count || 0;
                else if (row.rating_label === "easy")
                    answerButtons.easy = row.count || 0;
            });
            this.debugLog(`[Statistics Debug] Answer buttons:`, answerButtons);

            // Calculate retention rate
            const totalReviews =
                answerButtons.again +
                answerButtons.hard +
                answerButtons.good +
                answerButtons.easy;
            const correctReviews =
                answerButtons.hard + answerButtons.good + answerButtons.easy;
            const retentionRate =
                totalReviews > 0 ? (correctReviews / totalReviews) * 100 : 0;

            // Get interval distribution
            const intervalResults =
                await this.querySql<IntervalDistributionRow>(
                    SQL_QUERIES.GET_INTERVAL_DISTRIBUTION,
                    [],
                    { asObject: true }
                );
            const intervals = intervalResults.map((row) => ({
                interval: row.interval_range || "",
                count: row.count || 0,
            }));

            // Get pace stats
            const paceResults = await this.querySql<PaceStatsRow>(
                SQL_QUERIES.GET_PACE_STATS,
                [startDate, endDate],
                { asObject: true }
            );
            const averagePace = paceResults[0]?.avg_pace || 0;
            const totalReviewTime = paceResults[0]?.total_time || 0;

            // Calculate review stats
            const totalReviewsCountResult = await this.querySql<CountResult>(
                "SELECT COUNT(*) as count FROM review_logs",
                [],
                { asObject: true }
            );
            const totalReviewsCount = totalReviewsCountResult[0]?.count || 0;
            const reviewStats = {
                totalReviews: totalReviewsCount,
                totalTimeMs: totalReviewTime * 1000, // Convert seconds to milliseconds
            };

            // Generate forecast (next 30 days) with proper due card handling
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);
            const forecast30Days = new Date(
                now.getTime() + 30 * 24 * 60 * 60 * 1000
            );
            const forecastEndDate = forecast30Days.toISOString();

            this.debugLog(
                `[Statistics Debug] Forecast query range: ${todayStart.toISOString()} to ${forecastEndDate}`
            );

            // Get overdue cards (due before today)
            const overdueResults = await this.querySql<OverdueRow>(
                `SELECT COUNT(*) as overdue_count
         FROM flashcards
         WHERE due_date < ? AND state != 'new'`,
                [todayStart.toISOString()],
                { asObject: true }
            );
            const overdueCount = overdueResults[0]?.overdue_count || 0;
            this.debugLog(`[Statistics Debug] Overdue cards: ${overdueCount}`);

            // Get forecast for today and future days
            const forecastResults = await this.querySql<ForecastRow>(
                `SELECT DATE(due_date) as date, COUNT(*) as due_count
         FROM flashcards
         WHERE due_date >= ? AND due_date <= ?
         GROUP BY DATE(due_date)
         ORDER BY DATE(due_date)`,
                [todayStart.toISOString(), forecastEndDate],
                { asObject: true }
            );

            const forecast = forecastResults.map((row) => ({
                date: row.date,
                dueCount: row.due_count || 0,
            }));

            // Add overdue cards to today's count if there are any
            const todayStr = todayStart.toISOString().split("T")[0];
            const todayForecast = forecast.find((day) => day.date === todayStr);
            if (todayForecast && overdueCount > 0) {
                todayForecast.dueCount = todayForecast.dueCount + overdueCount;
            } else if (overdueCount > 0 && !todayForecast) {
                // If no cards naturally due today but there are overdue cards, create today entry
                forecast.unshift({
                    date: todayStr,
                    dueCount: overdueCount,
                });
            }

            this.debugLog(
                `[Statistics Debug] Final forecast length: ${forecast.length}`
            );

            const result = {
                dailyStats: dailyStats.map((stat) => ({
                    date: stat.date,
                    reviews: stat.reviews,
                    timeSpent: stat.timeSpent,
                    newCards: stat.newCards,
                    learningCards: stat.learningCards,
                    reviewCards: stat.reviewCards,
                    correctRate: stat.correctRate,
                })),
                cardStats,
                reviewStats,
                answerButtons,
                retentionRate,
                intervals: intervals.map((interval) => ({
                    interval: interval.interval,
                    count: interval.count,
                })),
                forecast: forecast.map((f) => ({
                    date: f.date,
                    dueCount: f.dueCount,
                    count: f.dueCount, // Alias for backwards compatibility
                })),
                averagePace,
                totalReviewTime,
            };

            this.debugLog(`[Statistics Debug] Final statistics result:`, {
                dailyStatsCount: dailyStats.length,
                cardStats,
                retentionRate,
                intervalsCount: intervals.length,
                forecastCount: forecast.length,
                averagePace,
                totalReviewTime,
            });

            return result;
        } catch (error) {
            console.error("Failed to get overall statistics:", error);
            // Return empty stats on error
            return {
                dailyStats: [],
                cardStats: { new: 0, review: 0, mature: 0, total: 0 },
                reviewStats: { totalReviews: 0, totalTimeMs: 0 },
                answerButtons: { again: 0, hard: 0, good: 0, easy: 0 },
                retentionRate: 0,
                intervals: [],
                forecast: [],
                averagePace: 0,
                totalReviewTime: 0,
            };
        }
    }

    // UTILITY OPERATIONS
    async purgeDatabase(): Promise<void> {
        await this.executeSql("DELETE FROM review_logs");
        await this.executeSql("DELETE FROM review_sessions");
        await this.executeSql("DELETE FROM flashcards");
        await this.executeSql("DELETE FROM decks");
    }

    async query(
        sql: string,
        params: SqlJsValue[] = [],
        config?: QueryConfig
    ): Promise<Record<string, SqlJsValue>[] | SqlJsValue[][]> {
        return (await this.querySql(
            sql,
            params as (string | number | null)[],
            config
        )) as Record<string, SqlJsValue>[] | SqlJsValue[][];
    }

    // BACKUP OPERATIONS - Concrete implementations using abstract db methods
    async createBackupDatabase(backupPath: string): Promise<void> {
        try {
            // Export current database to buffer
            const data = await this.exportDatabaseToBuffer();

            // Write the SQLite database file (convert Uint8Array to ArrayBuffer)
            await this.adapter.writeBinary(
                backupPath,
                data.buffer.slice(0) as ArrayBuffer
            );

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
            const backupDb = await this.createBackupDatabaseInstance(
                backupData
            );

            // Get all data from backup database
            const reviewLogs = await this.queryBackupDatabase(
                backupDb,
                "SELECT * FROM review_logs"
            );
            const reviewSessions = await this.queryBackupDatabase(
                backupDb,
                "SELECT * FROM review_sessions"
            );

            // Insert data into current database, avoiding duplicates
            if (reviewSessions.length > 0) {
                for (const session of reviewSessions) {
                    const sessionId = session[0]; // Assuming id is first column

                    // Check if session already exists
                    const existsResult = await this.querySql(
                        "SELECT 1 as found FROM review_sessions WHERE id = ?",
                        [sessionId],
                        { asObject: true }
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
                            `INSERT INTO review_sessions (${columns.join(
                                ", "
                            )}) VALUES (${placeholders})`,
                            session
                        );
                    }
                }
            }

            if (reviewLogs.length > 0) {
                for (const log of reviewLogs) {
                    const logId = log[0]; // Assuming id is first column

                    // Check if log already exists
                    const existsResult = await this.querySql(
                        "SELECT 1 as found FROM review_logs WHERE id = ?",
                        [logId],
                        { asObject: true }
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
                            `INSERT INTO review_logs (${columns.join(
                                ", "
                            )}) VALUES (${placeholders})`,
                            log
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
    abstract createBackupDatabaseInstance(
        backupData: Uint8Array
    ): Promise<string | object>;
    abstract queryBackupDatabase(
        backupDb: string | object,
        sql: string
    ): Promise<SqlJsValue[][]>;
    abstract closeBackupDatabaseInstance(
        backupDb: string | object
    ): Promise<void>;

    // Abstract querySql methods - implemented by concrete classes
    abstract querySql<T>(
        sql: string,
        params: SqlJsValue[],
        config: { asObject: true }
    ): Promise<T[]>;
    abstract querySql(
        sql: string,
        params?: SqlJsValue[],
        config?: { asObject?: false }
    ): Promise<SqlRow[]>;
    abstract querySql<T = SqlRecord>(
        sql: string,
        params?: SqlJsValue[],
        config?: QueryConfig
    ): Promise<T[] | SqlJsValue[][]>;

    abstract syncWithDisk(): Promise<void>;
}
