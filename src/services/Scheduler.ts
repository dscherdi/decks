import { Flashcard, FlashcardState, Deck, ReviewLog } from "../database/types";
import { DatabaseService } from "../database/DatabaseService";
import {
  FSRS,
  type Difficulty,
  type SchedulingInfo,
  type SchedulingCard,
} from "../algorithm/fsrs";
import {
  getWeightsForProfile,
  getMinMinutesForProfile,
  getMaxIntervalDaysForProfile,
  FSRSProfile,
} from "../algorithm/fsrs-weights";

export interface SchedulerOptions {
  allowNew?: boolean;
  headerLevel?: number;
}

export interface SchedulingPreview {
  again: SchedulingCard;
  hard: SchedulingCard;
  good: SchedulingCard;
  easy: SchedulingCard;
}

/**
 * Unified scheduler that consolidates all card selection and scheduling logic.
 * Handles deterministic card selection, FSRS-based interval calculation,
 * and atomic state updates with review logging.
 */
export class Scheduler {
  private db: DatabaseService;
  private fsrs: FSRS;

  constructor(db: DatabaseService) {
    this.db = db;
    this.fsrs = new FSRS();
  }

  /**
   * Get the next due card for review
   */
  async getNext(
    now: Date,
    deckId: string,
    options: SchedulerOptions = {},
  ): Promise<Flashcard | null> {
    const { allowNew = true, headerLevel } = options;

    // First check for due cards
    const dueCard = await this.getNextDueCard(now, deckId, headerLevel);
    if (dueCard) {
      return dueCard;
    }

    // If no due cards and new cards allowed, get next new card
    if (allowNew && (await this.hasNewCardQuota(deckId))) {
      return await this.getNextNewCard(deckId, headerLevel);
    }

    return null;
  }

  /**
   * Preview scheduling outcomes for all four ratings without mutations
   */
  async preview(
    cardId: string,
    now: Date = new Date(),
  ): Promise<SchedulingPreview | null> {
    const card = await this.db.getFlashcardById(cardId);
    if (!card) return null;

    const deck = await this.db.getDeckById(card.deckId);
    if (!deck) return null;

    this.updateFSRSForDeck(deck);

    const ratings: Difficulty[] = ["again", "hard", "good", "easy"];
    const preview: Partial<SchedulingPreview> = {};

    for (const rating of ratings) {
      const updatedCard = this.fsrs.updateCard(card, rating);
      preview[rating] = {
        dueDate: updatedCard.dueDate,
        interval: updatedCard.interval,
        repetitions: updatedCard.repetitions,
        stability: updatedCard.stability,
        difficulty: updatedCard.difficulty,
        state: updatedCard.state,
      };
    }

    return preview as SchedulingPreview;
  }

  /**
   * Rate a card and update its state atomically
   */
  async rate(
    cardId: string,
    rating: Difficulty,
    now: Date = new Date(),
    timeElapsed?: number,
  ): Promise<Flashcard> {
    const card = await this.db.getFlashcardById(cardId);
    if (!card) {
      throw new Error(`Card not found: ${cardId}`);
    }

    const deck = await this.db.getDeckById(card.deckId);
    if (!deck) {
      throw new Error(`Deck not found: ${card.deckId}`);
    }

    this.updateFSRSForDeck(deck);

    // Calculate new card state
    const oldCard = { ...card };
    const updatedCard = this.fsrs.updateCard(card, rating);

    // Calculate review metrics
    const elapsedDays = this.getElapsedDays(card, now);
    const retrievability = this.calculateRetrievability(card, elapsedDays);

    // Create review log entry
    const reviewLog: Omit<ReviewLog, "id"> = {
      flashcardId: card.id,
      lastReviewedAt: oldCard.lastReviewed || oldCard.dueDate,
      reviewedAt: now.toISOString(),
      rating: this.ratingToNumber(rating) as 1 | 2 | 3 | 4,
      ratingLabel: rating,
      timeElapsedMs: timeElapsed || 0,

      // Pre-state
      oldState: oldCard.state,
      oldRepetitions: oldCard.repetitions || 0,
      oldLapses: oldCard.lapses || 0,
      oldStability: oldCard.stability || 0,
      oldDifficulty: oldCard.difficulty || 0,

      // Post-state
      newState: updatedCard.state,
      newRepetitions: updatedCard.repetitions,
      newLapses: updatedCard.lapses,
      newStability: updatedCard.stability,
      newDifficulty: updatedCard.difficulty,

      // Intervals & due times
      oldIntervalMinutes: oldCard.interval,
      newIntervalMinutes: updatedCard.interval,
      oldDueAt: oldCard.dueDate,
      newDueAt: updatedCard.dueDate,

      // Derived values
      elapsedDays,
      retrievability,

      // Configuration context
      requestRetention: deck.config.fsrs.requestRetention,
      profile: deck.config.fsrs.profile,
      maximumIntervalDays: getMaxIntervalDaysForProfile(
        deck.config.fsrs.profile,
      ),
      minMinutes: getMinMinutesForProfile(deck.config.fsrs.profile),
      fsrsWeightsVersion: this.getWeightsHash(deck.config.fsrs.profile),
      schedulerVersion: "1.0",

      // Content context
      contentHash: card.contentHash,
    };

    // Atomic update: card state + review log
    await this.db.runInTransaction(async () => {
      await this.db.updateFlashcard(updatedCard.id, {
        state: updatedCard.state,
        dueDate: updatedCard.dueDate,
        interval: updatedCard.interval,
        repetitions: updatedCard.repetitions,
        difficulty: updatedCard.difficulty,
        stability: updatedCard.stability,
        lapses: updatedCard.lapses,
        lastReviewed: updatedCard.lastReviewed,
      });

      await this.db.createReviewLog(reviewLog);
    });

    return updatedCard;
  }

  /**
   * Peek at the next N due cards without mutations
   */
  async peekDue(
    now: Date,
    deckId: string,
    limit: number = 10,
    headerLevel?: number,
  ): Promise<Flashcard[]> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) return [];

    let query = `
      SELECT * FROM flashcards
      WHERE deck_id = ? AND due_date <= ? AND state = 'review'
    `;
    const params = [deckId, now.toISOString()];

    if (headerLevel !== undefined) {
      query += " AND (type = 'table' OR header_level = ?)";
      params.push(headerLevel.toString());
    }

    // Apply review order from deck configuration
    if (deck.config.reviewOrder === "random") {
      query += " ORDER BY RANDOM() LIMIT ?";
    } else {
      // Default: due-date order (oldest due first)
      query += " ORDER BY due_date ASC, last_reviewed ASC LIMIT ?";
    }
    params.push(limit.toString());

    return await this.queryFlashcards(query, params);
  }

  /**
   * Get milliseconds until next card is due
   */
  async timeToNext(now: Date, deckId: string): Promise<number | null> {
    const query = `
      SELECT MIN(due_date) as next_due
      FROM flashcards
      WHERE deck_id = ? AND due_date > ?
      ORDER BY due_date ASC
      LIMIT 1
    `;

    const results = await this.queryRaw(query, [deckId, now.toISOString()]);
    const nextDue = results.length > 0 ? results[0][0] : null;

    if (!nextDue) {
      return null;
    }

    const nextDueDate = new Date(nextDue);
    return Math.max(0, nextDueDate.getTime() - now.getTime());
  }

  // Private helper methods

  private async getNextDueCard(
    now: Date,
    deckId: string,
    headerLevel?: number,
  ): Promise<Flashcard | null> {
    // Check review card daily limits first
    if (!(await this.hasReviewCardQuota(deckId))) {
      return null;
    }

    const deck = await this.db.getDeckById(deckId);
    if (!deck) return null;

    let query = `
      SELECT * FROM flashcards
      WHERE deck_id = ? AND due_date <= ? AND state = 'review'
    `;
    const params = [deckId, now.toISOString()];

    if (headerLevel !== undefined) {
      query += " AND (type = 'table' OR header_level = ?)";
      params.push(headerLevel.toString());
    }

    // Apply review order from deck configuration
    if (deck.config.reviewOrder === "random") {
      query += " ORDER BY RANDOM() LIMIT 1";
    } else {
      // Default: due-date order (oldest due first)
      query += " ORDER BY due_date ASC, last_reviewed ASC LIMIT 1";
    }

    const results = await this.queryFlashcards(query, params);
    return results.length > 0 ? results[0] : null;
  }

  private async getNextNewCard(
    deckId: string,
    headerLevel?: number,
  ): Promise<Flashcard | null> {
    let query = `
      SELECT * FROM flashcards
      WHERE deck_id = ? AND state = 'new'
    `;
    const params = [deckId];

    if (headerLevel !== undefined) {
      query += " AND (type = 'table' OR header_level = ?)";
      params.push(headerLevel.toString());
    }

    query += " ORDER BY due_date ASC LIMIT 1";

    const results = await this.queryFlashcards(query, params);
    return results.length > 0 ? results[0] : null;
  }

  private async hasNewCardQuota(deckId: string): Promise<boolean> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) return false;

    if (!deck.config.enableNewCardsLimit) return true;

    const dailyCounts = await this.db.getDailyReviewCounts(deckId);
    return dailyCounts.newCount < deck.config.newCardsLimit;
  }

  private async hasReviewCardQuota(deckId: string): Promise<boolean> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) return false;

    if (!deck.config.enableReviewCardsLimit) return true;

    const dailyCounts = await this.db.getDailyReviewCounts(deckId);
    return dailyCounts.reviewCount < deck.config.reviewCardsLimit;
  }

  private updateFSRSForDeck(deck: Deck): void {
    this.fsrs.updateParameters({
      requestRetention: deck.config.fsrs.requestRetention,
      profile: deck.config.fsrs.profile,
    });
  }

  private getElapsedDays(card: Flashcard, now: Date): number {
    if (!card.lastReviewed) return 0;

    const lastReview = new Date(card.lastReviewed);
    return Math.max(0, (now.getTime() - lastReview.getTime()) / 86400000);
  }

  private calculateRetrievability(
    card: Flashcard,
    elapsedDays: number,
  ): number {
    if (!card.stability || card.state === "new") return 1;

    // R = (1 + elapsedDays / (9 * stability))^(-1)
    return Math.pow(1 + elapsedDays / (9 * card.stability), -1);
  }

  private ratingToNumber(rating: Difficulty): number {
    const ratingMap: Record<Difficulty, number> = {
      again: 1,
      hard: 2,
      good: 3,
      easy: 4,
    };
    return ratingMap[rating];
  }

  private getWeightsHash(profile: FSRSProfile): string {
    return `${profile}-v1.0`;
  }

  /**
   * Helper method to query flashcards and convert rows to Flashcard objects
   */
  private async queryFlashcards(
    query: string,
    params: any[],
  ): Promise<Flashcard[]> {
    const results = await this.queryRaw(query, params);
    return results.map((row) => this.rowToFlashcard(row));
  }

  /**
   * Execute raw SQL query and return results
   */
  private async queryRaw(query: string, params: any[]): Promise<any[][]> {
    return await this.db.query(query, params);
  }

  /**
   * Convert database row to Flashcard object (same logic as DatabaseService)
   */
  private rowToFlashcard(row: any[]): Flashcard {
    return {
      id: row[0] as string,
      deckId: row[1] as string,
      front: row[2] as string,
      back: row[3] as string,
      type: row[4] as "header-paragraph" | "table",
      sourceFile: row[5] as string,
      contentHash: row[6] as string,
      headerLevel: row[7] as number | undefined,
      state: row[8] as FlashcardState,
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
}
