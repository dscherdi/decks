import { FlashcardParser } from "./FlashcardParser";
import type { Flashcard, FlashcardType, DeckProfile } from "../database/types";
import type { SqlJsValue } from "../database/sql-types";
import type { Database } from "sql.js";
import { generateFlashcardId, generateContentHash, generateReverseFlashcardId, generateClozeFlashcardId } from "../utils/hash";
import { levenshteinSimilarity } from "../utils/string";

export interface FlashcardUpdates {
  front: string;
  back: string;
  notes: string;
  type: string;
  contentHash: string;
  breadcrumb: string;
  clozeText: string | null;
  clozeOrder: number | null;
}

export interface BatchOperation {
  type: "create" | "update" | "delete" | "migrate";
  flashcardId?: string;
  flashcard?: Omit<Flashcard, "created" | "modified">;
  updates?: FlashcardUpdates;
  oldId?: string;
  newId?: string;
}

export interface SyncResult {
  success: boolean;
  parsedCount: number;
  operationsCount: number;
  duplicatesSkipped: number;
}

export interface SyncData {
  deckId: string;
  deckName: string;
  deckFilepath: string;
  deckConfig: DeckProfile;
  fileContent: string;
  fileTitle?: string;
  reverseCards?: boolean;
  clozeEnabled?: boolean;
}

/**
 * FlashcardSynchronizer - Handles flashcard synchronization logic
 * Uses raw SQL.js Database for direct operations in worker context
 */
export class FlashcardSynchronizer {
  constructor(private db: Database) {}

  /**
   * Execute batch database operations using raw SQL
   */
  executeBatchOperations(operations: BatchOperation[]): void {
    for (const op of operations) {
      if (op.type === "migrate" && op.oldId && op.flashcard) {
        // Safety check: if target ID already exists (hash collision), just delete the old card
        const card = op.flashcard;
        const checkStmt = this.db.prepare("SELECT id FROM flashcards WHERE id = ?");
        checkStmt.bind([card.id]);
        const targetExists = checkStmt.step();
        checkStmt.free();
        if (targetExists) {
          const deleteStmt = this.db.prepare("DELETE FROM flashcards WHERE id = ?");
          deleteStmt.run([op.oldId]);
          deleteStmt.free();
          continue;
        }

        // Migrate flashcard identity: update flashcard ID and content
        const updateStmt = this.db.prepare(`
                    UPDATE flashcards
                    SET id = ?, front = ?, back = ?, content_hash = ?, breadcrumb = ?, notes = ?,
                        type = ?, cloze_text = ?, cloze_order = ?, modified = datetime('now')
                    WHERE id = ?
                `);
        updateStmt.run([
          card.id,
          card.front,
          card.back,
          card.contentHash,
          card.breadcrumb || "",
          card.notes || "",
          card.type,
          card.clozeText ?? null,
          card.clozeOrder ?? null,
          op.oldId,
        ]);
        updateStmt.free();

        // Migrate review_logs to new ID (critical since FK removed)
        const reviewLogStmt = this.db.prepare(
          "UPDATE review_logs SET flashcard_id = ? WHERE flashcard_id = ?"
        );
        reviewLogStmt.run([card.id, op.oldId]);
        reviewLogStmt.free();
      } else if (op.type === "delete" && op.flashcardId) {
        const stmt = this.db.prepare("DELETE FROM flashcards WHERE id = ?");
        stmt.run([op.flashcardId]);
        stmt.free();
      } else if (op.type === "create" && op.flashcard) {
        const card = op.flashcard;
        const stmt = this.db.prepare(`
                    INSERT OR IGNORE INTO flashcards (
                        id, deck_id, front, back, type, source_file, content_hash, breadcrumb, notes,
                        cloze_text, cloze_order,
                        state, due_date, interval, repetitions, difficulty, stability,
                        lapses, last_reviewed, created, modified
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                `);
        stmt.run([
          card.id,
          card.deckId,
          card.front,
          card.back,
          card.type,
          card.sourceFile,
          card.contentHash,
          card.breadcrumb || "",
          card.notes || "",
          card.clozeText,
          card.clozeOrder,
          card.state,
          card.dueDate,
          card.interval,
          card.repetitions,
          card.difficulty,
          card.stability,
          card.lapses,
          card.lastReviewed,
        ]);
        stmt.free();
      } else if (op.type === "update" && op.flashcardId && op.updates) {
        const stmt = this.db.prepare(`
                    UPDATE flashcards
                    SET front = ?, back = ?, type = ?, content_hash = ?, breadcrumb = ?, notes = ?,
                        cloze_text = ?, cloze_order = ?, modified = datetime('now')
                    WHERE id = ?
                `);
        stmt.run([
          op.updates.front,
          op.updates.back,
          op.updates.type,
          op.updates.contentHash,
          op.updates.breadcrumb || "",
          op.updates.notes || "",
          op.updates.clozeText,
          op.updates.clozeOrder,
          op.flashcardId,
        ]);
        stmt.free();
      }
    }
  }

  /**
   * Sync flashcards for a deck
   */
  syncFlashcardsForDeck(
    data: SyncData,
    progressCallback?: (progress: number, message?: string) => void
  ): SyncResult {
    try {
      // Parse flashcards from content
      progressCallback?.(10, "Parsing flashcards from file content...");
      const parsedCards = FlashcardParser.parseFlashcardsFromContent(
        data.fileContent,
        data.deckConfig.headerLevel,
        data.fileTitle,
        data.clozeEnabled
      );

      // Expand with reverse cards if enabled (cloze cards are excluded)
      const expandedCards = [...parsedCards];
      if (data.reverseCards) {
        for (const card of parsedCards) {
          if (card.back && card.type !== "cloze" && card.type !== "image-occlusion") {
            expandedCards.push({
              front: card.back,
              back: card.front,
              notes: card.notes,
              type: card.type,
              breadcrumb: card.breadcrumb,
              isReverse: true,
            });
          }
        }
      }

      // Get existing flashcards
      progressCallback?.(20, "Loading existing flashcards...");
      const existingFlashcards: Flashcard[] = [];
      const stmt = this.db.prepare(
        "SELECT * FROM flashcards WHERE deck_id = ?"
      );
      stmt.bind([data.deckId]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, SqlJsValue>;
        existingFlashcards.push({
          id: row.id as string,
          deckId: row.deck_id as string,
          front: row.front as string,
          back: row.back as string,
          type: row.type as FlashcardType,
          sourceFile: row.source_file as string,
          contentHash: row.content_hash as string,
          breadcrumb: (row.breadcrumb as string) || "",
          notes: (row.notes as string) || "",
          clozeText: (row.cloze_text as string) ?? null,
          clozeOrder: (row.cloze_order as number) ?? null,
          state: row.state as "new" | "review",
          dueDate: row.due_date as string,
          interval: row.interval as number,
          repetitions: row.repetitions as number,
          difficulty: row.difficulty as number,
          stability: row.stability as number,
          lapses: row.lapses as number,
          lastReviewed: row.last_reviewed as string | null,
          created: row.created as string,
          modified: row.modified as string,
        });
      }
      stmt.free();

      // Convert to map
      const existingById = new Map<string, Flashcard>();
      existingFlashcards.forEach((flashcard) => {
        existingById.set(flashcard.id, flashcard);
      });

      const processedIds = new Set<string>();
      const batchOperations: BatchOperation[] = [];
      let duplicatesSkipped = 0;

      // Build lists for smart rename detection
      interface ParsedCardData {
        parsed: {
          front: string;
          back: string;
          notes: string;
          type: FlashcardType;
          breadcrumb: string;
          isReverse?: boolean;
          clozeText?: string;
          clozeOrder?: number;
        };
        flashcardId: string;
        contentHash: string;
      }
      const cardsToCreate: ParsedCardData[] = [];
      const reverseCardsToCreate: ParsedCardData[] = [];
      const cardsToDelete: Flashcard[] = [];

      // Process parsed cards - first pass: identify creates and updates
      progressCallback?.(30, "Processing flashcards...");
      for (
        let cardIndex = 0;
        cardIndex < Math.min(expandedCards.length, 50000);
        cardIndex++
      ) {
        const parsed = expandedCards[cardIndex];

        // Update progress periodically
        if (cardIndex % 100 === 0) {
          const cardProgress =
            30 + (cardIndex / Math.min(expandedCards.length, 50000)) * 30;
          progressCallback?.(
            cardProgress,
            `Processing card ${cardIndex + 1}/${Math.min(
              expandedCards.length,
              50000
            )}...`
          );
        }

        // ID generation varies by card type
        const isClozeType = parsed.type === "cloze" || parsed.type === "image-occlusion";
        const flashcardId = isClozeType
          ? generateClozeFlashcardId(parsed.front, parsed.clozeText!, parsed.clozeOrder!, data.deckId)
          : parsed.isReverse
            ? generateReverseFlashcardId(parsed.back, data.deckId)
            : generateFlashcardId(parsed.front, data.deckId);
        const contentHash = isClozeType
          ? generateContentHash(parsed.back + "::" + parsed.clozeText)
          : generateContentHash(parsed.back);
        const existingCard = existingById.get(flashcardId);

        if (processedIds.has(flashcardId)) {
          duplicatesSkipped++;
          continue;
        }
        processedIds.add(flashcardId);

        if (existingCard) {
          // Update if content, breadcrumb, notes, front, or type changed.
          if (
            existingCard.contentHash !== contentHash ||
            existingCard.breadcrumb !== parsed.breadcrumb ||
            existingCard.notes !== (parsed.notes || "") ||
            existingCard.front !== parsed.front ||
            existingCard.type !== parsed.type
          ) {
            batchOperations.push({
              type: "update",
              flashcardId: existingCard.id,
              updates: {
                front: parsed.front,
                back: parsed.back,
                notes: parsed.notes || "",
                type: parsed.type,
                contentHash: contentHash,
                breadcrumb: parsed.breadcrumb,
                clozeText: parsed.clozeText ?? null,
                clozeOrder: parsed.clozeOrder ?? null,
              },
            });
          }
        } else {
          // Card doesn't exist — route to the appropriate create list
          if (parsed.isReverse) {
            reverseCardsToCreate.push({ parsed, flashcardId, contentHash });
          } else {
            cardsToCreate.push({ parsed, flashcardId, contentHash });
          }
        }
      }

      // Identify cards to delete
      progressCallback?.(60, "Identifying orphaned flashcards...");
      existingById.forEach((existingCard, flashcardId) => {
        if (!processedIds.has(flashcardId)) {
          cardsToDelete.push(existingCard);
        }
      });

      // Smart Rename Detection
      progressCallback?.(65, "Detecting renamed flashcards...");
      const matchedCreates = new Set<number>();
      const matchedDeletes = new Set<number>();

      for (let createIdx = 0; createIdx < cardsToCreate.length; createIdx++) {
        const newCardData = cardsToCreate[createIdx];

        for (let deleteIdx = 0; deleteIdx < cardsToDelete.length; deleteIdx++) {
          const oldCard = cardsToDelete[deleteIdx];

          // Skip already matched cards
          if (matchedCreates.has(createIdx) || matchedDeletes.has(deleteIdx)) {
            continue;
          }

          // Strong match: same back content (exact match)
          const strongMatch = newCardData.parsed.back === oldCard.back;

          // Fuzzy match: >80% similarity in front text
          const fuzzyMatch =
            levenshteinSimilarity(newCardData.parsed.front, oldCard.front) > 80;

          if (strongMatch || fuzzyMatch) {
            // Create migration operation
            batchOperations.push({
              type: "migrate",
              oldId: oldCard.id,
              flashcard: {
                id: newCardData.flashcardId,
                deckId: data.deckId,
                front: newCardData.parsed.front,
                back: newCardData.parsed.back,
                notes: newCardData.parsed.notes || "",
                type: newCardData.parsed.type,
                sourceFile: data.deckFilepath,
                contentHash: newCardData.contentHash,
                breadcrumb: newCardData.parsed.breadcrumb,
                clozeText: newCardData.parsed.clozeText ?? null,
                clozeOrder: newCardData.parsed.clozeOrder ?? null,
                state: oldCard.state,
                dueDate: oldCard.dueDate,
                interval: oldCard.interval,
                repetitions: oldCard.repetitions,
                difficulty: oldCard.difficulty,
                stability: oldCard.stability,
                lapses: oldCard.lapses,
                lastReviewed: oldCard.lastReviewed,
              },
            });

            matchedCreates.add(createIdx);
            matchedDeletes.add(deleteIdx);
            break; // Found a match, move to next create
          }
        }
      }

      // Process remaining creates (not matched)
      progressCallback?.(70, "Creating new flashcards...");
      for (let createIdx = 0; createIdx < cardsToCreate.length; createIdx++) {
        if (matchedCreates.has(createIdx)) continue;

        const newCardData = cardsToCreate[createIdx];

        // Check for review history
        const reviewLogStmt = this.db.prepare(`
                    SELECT new_state, new_interval_minutes, new_repetitions, new_difficulty,
                           new_stability, new_lapses, reviewed_at
                    FROM review_logs
                    WHERE flashcard_id = ?
                    ORDER BY reviewed_at DESC
                    LIMIT 1
                `);
        reviewLogStmt.bind([newCardData.flashcardId]);
        const reviewLogRow = reviewLogStmt.step() ? reviewLogStmt.get() : null;
        reviewLogStmt.free();

        // Create new flashcard
        const flashcard: Omit<Flashcard, "created" | "modified"> = {
          id: newCardData.flashcardId,
          deckId: data.deckId,
          front: newCardData.parsed.front,
          back: newCardData.parsed.back,
          notes: newCardData.parsed.notes || "",
          type: newCardData.parsed.type,
          sourceFile: data.deckFilepath,
          contentHash: newCardData.contentHash,
          breadcrumb: newCardData.parsed.breadcrumb,
          clozeText: newCardData.parsed.clozeText ?? null,
          clozeOrder: newCardData.parsed.clozeOrder ?? null,
          state: reviewLogRow ? (reviewLogRow[0] as "new" | "review") : "new",
          dueDate:
            reviewLogRow && reviewLogRow[6] && reviewLogRow[1]
              ? new Date(
                  new Date(reviewLogRow[6] as string).getTime() +
                    (reviewLogRow[1] as number) * 60 * 1000
                ).toISOString()
              : new Date().toISOString(),
          interval: reviewLogRow ? (reviewLogRow[1] as number) : 0,
          repetitions: reviewLogRow ? (reviewLogRow[2] as number) : 0,
          difficulty: reviewLogRow ? (reviewLogRow[3] as number) : 5.0,
          stability: reviewLogRow ? (reviewLogRow[4] as number) : 2.5,
          lapses: reviewLogRow ? (reviewLogRow[5] as number) : 0,
          lastReviewed: reviewLogRow ? (reviewLogRow[6] as string) : null,
        };

        batchOperations.push({
          type: "create",
          flashcard: flashcard,
        });
      }

      // Process reverse cards (never participate in rename detection)
      for (const newCardData of reverseCardsToCreate) {
        const reviewLogStmt = this.db.prepare(`
                    SELECT new_state, new_interval_minutes, new_repetitions, new_difficulty,
                           new_stability, new_lapses, reviewed_at
                    FROM review_logs
                    WHERE flashcard_id = ?
                    ORDER BY reviewed_at DESC
                    LIMIT 1
                `);
        reviewLogStmt.bind([newCardData.flashcardId]);
        const reviewLogRow = reviewLogStmt.step() ? reviewLogStmt.get() : null;
        reviewLogStmt.free();

        const flashcard: Omit<Flashcard, "created" | "modified"> = {
          id: newCardData.flashcardId,
          deckId: data.deckId,
          front: newCardData.parsed.front,
          back: newCardData.parsed.back,
          notes: newCardData.parsed.notes || "",
          type: newCardData.parsed.type,
          sourceFile: data.deckFilepath,
          contentHash: newCardData.contentHash,
          breadcrumb: newCardData.parsed.breadcrumb,
          clozeText: null,
          clozeOrder: null,
          state: reviewLogRow ? (reviewLogRow[0] as "new" | "review") : "new",
          dueDate:
            reviewLogRow && reviewLogRow[6] && reviewLogRow[1]
              ? new Date(
                  new Date(reviewLogRow[6] as string).getTime() +
                    (reviewLogRow[1] as number) * 60 * 1000
                ).toISOString()
              : new Date().toISOString(),
          interval: reviewLogRow ? (reviewLogRow[1] as number) : 0,
          repetitions: reviewLogRow ? (reviewLogRow[2] as number) : 0,
          difficulty: reviewLogRow ? (reviewLogRow[3] as number) : 5.0,
          stability: reviewLogRow ? (reviewLogRow[4] as number) : 2.5,
          lapses: reviewLogRow ? (reviewLogRow[5] as number) : 0,
          lastReviewed: reviewLogRow ? (reviewLogRow[6] as string) : null,
        };

        batchOperations.push({
          type: "create",
          flashcard: flashcard,
        });
      }

      // Process remaining deletes (not matched)
      progressCallback?.(75, "Cleaning up orphaned flashcards...");
      for (let deleteIdx = 0; deleteIdx < cardsToDelete.length; deleteIdx++) {
        if (matchedDeletes.has(deleteIdx)) continue;

        batchOperations.push({
          type: "delete",
          flashcardId: cardsToDelete[deleteIdx].id,
        });
      }

      // Execute batch operations
      if (batchOperations.length > 0) {
        progressCallback?.(
          85,
          `Executing ${batchOperations.length} database operations...`
        );
        this.executeBatchOperations(batchOperations);
      }

      // Update deck timestamp
      progressCallback?.(95, "Finalizing deck update...");
      const updateDeckStmt = this.db.prepare(
        "UPDATE decks SET modified = datetime('now') WHERE id = ?"
      );
      updateDeckStmt.run([data.deckId]);
      updateDeckStmt.free();

      progressCallback?.(100, "Sync completed successfully!");
      return {
        success: true,
        parsedCount: parsedCards.length,
        operationsCount: batchOperations.length,
        duplicatesSkipped,
      };
    } catch (error) {
      throw new Error(`Sync failed: ${(error as Error).message}`);
    }
  }
}
