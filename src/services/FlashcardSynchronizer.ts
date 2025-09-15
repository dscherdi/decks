import { FlashcardParser, ParsedFlashcard } from "./FlashcardParser";
import type { Database, Statement } from "sql.js";
import { Flashcard, DeckConfig } from "../database/types";

export interface FlashcardUpdates {
  front: string;
  back: string;
  type: string;
  contentHash: string;
}

export interface BatchOperation {
  type: "create" | "update" | "delete";
  flashcardId?: string;
  flashcard?: Omit<Flashcard, "created" | "modified">;
  updates?: FlashcardUpdates;
}

export interface SyncResult {
  success: boolean;
  parsedCount: number;
  operationsCount: number;
}

export interface SyncData {
  deckId: string;
  deckName: string;
  deckFilepath: string;
  deckConfig: DeckConfig;
  fileContent: string;
  force: boolean;
}

export interface DatabaseInterface {
  prepare(sql: string): Statement;
  exec(sql: string): void;
}

/**
 * FlashcardSynchronizer - Handles flashcard synchronization logic
 * Extracts and centralizes sync operations for reuse across different contexts
 */
export class FlashcardSynchronizer {
  constructor(private db: DatabaseInterface) {}

  /**
   * Generate unique flashcard ID using hash of front text only
   */
  generateFlashcardId(frontText: string): string {
    let hash = 0;
    for (let i = 0; i < frontText.length; i++) {
      const char = frontText.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `card_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Generate content hash for flashcard back content
   */
  generateContentHash(back: string): string {
    let hash = 0;
    for (let i = 0; i < back.length; i++) {
      const char = back.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Execute batch database operations
   */
  executeBatchOperations(operations: BatchOperation[]): void {
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
      stmt.run([op.flashcardId!]);
      stmt.free();
    }

    // Execute CREATE operations
    for (const op of createOps) {
      const flashcard = op.flashcard!;
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
        flashcard.lastReviewed || null,
      ]);
      stmt.free();
    }

    // Execute UPDATE operations
    for (const op of updateOps) {
      const updates = op.updates!;
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
        op.flashcardId!,
      ]);
      stmt.free();
    }
  }

  /**
   * Sync flashcards for a deck
   */
  syncFlashcardsForDeck(
    data: SyncData,
    progressCallback?: (progress: number, message?: string) => void,
  ): SyncResult {
    try {
      // Parse flashcards from content
      progressCallback?.(10, "Parsing flashcards from file content...");
      const parsedCards = FlashcardParser.parseFlashcardsFromContent(
        data.fileContent,
        data.deckConfig.headerLevel || 2,
      );

      // Get existing flashcards
      progressCallback?.(20, "Loading existing flashcards...");
      const existingFlashcardsStmt = this.db.prepare(
        "SELECT * FROM flashcards WHERE deck_id = ?",
      );
      const existingFlashcardsResult = [];
      existingFlashcardsStmt.bind([data.deckId]);
      while (existingFlashcardsStmt.step()) {
        existingFlashcardsResult.push(existingFlashcardsStmt.get());
      }
      existingFlashcardsStmt.free();

      // Convert to map
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
      progressCallback?.(30, "Processing flashcards...");
      for (
        let cardIndex = 0;
        cardIndex < Math.min(parsedCards.length, 50000);
        cardIndex++
      ) {
        const parsed = parsedCards[cardIndex];

        // Update progress periodically
        if (cardIndex % 100 === 0) {
          const cardProgress =
            30 + (cardIndex / Math.min(parsedCards.length, 50000)) * 40;
          progressCallback?.(
            cardProgress,
            `Processing card ${cardIndex + 1}/${Math.min(parsedCards.length, 50000)}...`,
          );
        }
        const flashcardId = this.generateFlashcardId(parsed.front);
        const contentHash = this.generateContentHash(parsed.back);
        const existingCard = existingById.get(flashcardId);

        if (processedIds.has(flashcardId)) continue;
        processedIds.add(flashcardId);

        if (existingCard) {
          // Update if content changed
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
          // Check for review history
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

          // Create new flashcard
          const flashcard: Omit<Flashcard, "created" | "modified"> = {
            id: flashcardId,
            deckId: data.deckId,
            front: parsed.front,
            back: parsed.back,
            type: parsed.type,
            sourceFile: data.deckFilepath,
            contentHash: contentHash,
            state: reviewLogRow ? (reviewLogRow[0] as "new" | "review") : "new",
            dueDate:
              reviewLogRow && reviewLogRow[6] && reviewLogRow[1]
                ? new Date(
                    new Date(reviewLogRow[6] as string).getTime() +
                      (reviewLogRow[1] as number) * 60 * 1000,
                  ).toISOString()
                : new Date().toISOString(),
            interval: reviewLogRow ? (reviewLogRow[1] as number) : 0,
            repetitions: reviewLogRow ? (reviewLogRow[2] as number) : 0,
            difficulty: reviewLogRow ? (reviewLogRow[3] as number) : 5.0,
            stability: reviewLogRow ? (reviewLogRow[4] as number) : 2.5,
            lapses: reviewLogRow ? (reviewLogRow[5] as number) : 0,
            lastReviewed: reviewLogRow ? (reviewLogRow[6] as string) : null,
          };

          batchOperations.push({ type: "create", flashcard: flashcard });
        }
      }

      // Delete orphaned flashcards
      progressCallback?.(75, "Cleaning up orphaned flashcards...");
      for (const [flashcardId, existingCard] of existingById) {
        if (!processedIds.has(flashcardId)) {
          batchOperations.push({
            type: "delete",
            flashcardId: existingCard.id,
          });
        }
      }

      // Execute batch operations
      if (batchOperations.length > 0) {
        progressCallback?.(
          85,
          `Executing ${batchOperations.length} database operations...`,
        );
        this.executeBatchOperations(batchOperations);
      }

      // Update deck timestamp
      progressCallback?.(95, "Finalizing deck update...");
      const updateDeckStmt = this.db.prepare(
        "UPDATE decks SET modified = datetime('now') WHERE id = ?",
      );
      updateDeckStmt.run([data.deckId]);
      updateDeckStmt.free();

      progressCallback?.(100, "Sync completed successfully!");
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
