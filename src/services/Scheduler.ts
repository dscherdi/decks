import {
  Flashcard,
  FlashcardState,
  Deck,
  ReviewLog,
  ReviewSession,
  hasNewCardsLimit,
  hasReviewCardsLimit,
} from "../database/types";
import { DatabaseService } from "../database/DatabaseService";
import {
  FSRS,
  type RatingLabel,
  type SchedulingInfo,
  type SchedulingCard,
} from "../algorithm/fsrs";
import {
  getWeightsForProfile,
  getMinMinutesForProfile,
  getMaxIntervalDaysForProfile,
  FSRSProfile,
} from "../algorithm/fsrs-weights";
import { yieldToUI } from "../utils/ui";

export interface SchedulerOptions {
  allowNew?: boolean;
}

export interface SchedulingPreview {
  again: SchedulingCard;
  hard: SchedulingCard;
  good: SchedulingCard;
  easy: SchedulingCard;
}

export interface SessionProgress {
  doneUnique: number;
  goalTotal: number;
  progress: number; // 0-100
}

/**
 * Unified scheduler that consolidates all card selection and scheduling logic.
 * Handles deterministic card selection, FSRS-based interval calculation,
 * and atomic state updates with review logging.
 */
export class Scheduler {
  private db: DatabaseService;
  private fsrs: FSRS;
  private currentSessionId: string | null = null;

  constructor(db: DatabaseService) {
    this.db = db;
    this.fsrs = new FSRS();
  }

  /**
   * Start a new review session for a deck
   */
  async startReviewSession(
    deckId: string,
    now: Date = new Date(),
  ): Promise<string> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) {
      throw new Error(`Deck not found: ${deckId}`);
    }

    // Calculate goal total more accurately
    const dailyCounts = await this.db.getDailyReviewCounts(deckId);
    // Include cards due within next 15 minutes for session goal calculation
    // This ensures cards that become due during the review session count towards the goal
    const dueCardCount = await this.getDueCardCount(now, deckId);
    const newCardCount = await this.getNewCardCount(deckId);

    let goalTotal = 0;

    // Add due review cards (applying daily limits if configured)
    if (hasReviewCardsLimit(deck.config)) {
      if (deck.config.reviewCardsPerDay === 0) {
        // 0 = no review cards allowed
        goalTotal += 0;
      } else {
        const remainingReviewQuota = Math.max(
          0,
          deck.config.reviewCardsPerDay - dailyCounts.reviewCount,
        );
        goalTotal += Math.min(dueCardCount, remainingReviewQuota);
      }
    } else {
      // -1 = unlimited
      goalTotal += dueCardCount;
    }

    // Add new cards (applying daily limits if configured)
    if (hasNewCardsLimit(deck.config)) {
      if (deck.config.newCardsPerDay === 0) {
        // 0 = no new cards allowed
        goalTotal += 0;
      } else {
        const remainingNewQuota = Math.max(
          0,
          deck.config.newCardsPerDay - dailyCounts.newCount,
        );
        goalTotal += Math.min(newCardCount, remainingNewQuota);
      }
    } else {
      // -1 = unlimited
      goalTotal += newCardCount;
    }

    // Ensure at least 1 for progress calculation
    const finalGoalTotal = Math.max(1, goalTotal);

    const sessionId = await this.db.createReviewSession({
      deckId,
      startedAt: now.toISOString(),
      endedAt: null,
      goalTotal: finalGoalTotal,
      doneUnique: 0,
    });

    return sessionId;
  }

  /**
   * Get progress for a review session
   */
  async getSessionProgress(sessionId: string): Promise<SessionProgress | null> {
    const session = await this.db.getReviewSessionById(sessionId);
    if (!session) return null;

    const progress =
      session.goalTotal > 0
        ? Math.min(100, (session.doneUnique / session.goalTotal) * 100)
        : 0;

    return {
      doneUnique: session.doneUnique,
      goalTotal: session.goalTotal,
      progress,
    };
  }

  /**
   * End a review session
   */
  async endReviewSession(
    sessionId: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.db.endReviewSession(sessionId, now.toISOString());
  }

  /**
   * Start a fresh review session for a deck (ends any existing session)
   */
  async startFreshSession(
    deckId: string,
    now: Date = new Date(),
  ): Promise<string> {
    // End any existing active session first
    // TODO: End by taking the review time of last review log with session id of active session
    const activeSession = await this.db.getActiveReviewSession(deckId);
    if (activeSession) {
      await this.db.endReviewSession(activeSession.id, now.toISOString());
    }

    // Start a new session
    this.currentSessionId = await this.startReviewSession(deckId, now);
    return this.currentSessionId;
  }

  /**
   * Set the current active session for tracking
   */
  setCurrentSession(sessionId: string | null): void {
    this.currentSessionId = sessionId;
  }

  /**
   * Get the current active session
   */
  getCurrentSession(): string | null {
    return this.currentSessionId;
  }

  /**
   * Get the next due card for review
   */
  async getNext(
    now: Date,
    deckId: string,
    options: SchedulerOptions = {},
  ): Promise<Flashcard | null> {
    const { allowNew = true } = options;

    // First check for due cards with quota
    if (await this.hasReviewCardQuota(deckId)) {
      const dueCard = await this.getNextDueCard(now, deckId);
      if (dueCard) {
        return dueCard;
      }
    }

    // If no due cards and new cards allowed, get next new card
    if (allowNew && (await this.hasNewCardQuota(deckId))) {
      return await this.getNextNewCard(deckId);
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

    const ratings: RatingLabel[] = ["again", "hard", "good", "easy"];
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
   * Rate a card and update its state atomically with session tracking
   */
  async rate(
    cardId: string,
    rating: RatingLabel,
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

    // Check if this is the first time reviewing this card in the session
    let isFirstReviewInSession = false;
    if (this.currentSessionId) {
      isFirstReviewInSession = !(await this.db.isCardReviewedInSession(
        this.currentSessionId,
        card.id,
      ));

      // Update session progress if first review
      if (isFirstReviewInSession) {
        const session = await this.db.getReviewSessionById(
          this.currentSessionId,
        );
        if (session) {
          const newDoneUnique = session.doneUnique + 1;
          await this.db.updateReviewSessionDoneUnique(
            this.currentSessionId,
            newDoneUnique,
          );
        }
      }
    }

    // Create review log entry
    const reviewLog: Omit<ReviewLog, "id"> = {
      flashcardId: card.id,
      sessionId: this.currentSessionId || undefined,
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

    // Update card state and create review log (no save during review)
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

    await yieldToUI();

    await this.db.createReviewLog(reviewLog);

    return updatedCard;
  }

  /**
   * Save all pending changes to disk
   */
  async save(): Promise<void> {
    console.log("Scheduler: Saving database to disk");
    await this.db.save();
    console.log("Scheduler: Database save completed");
  }

  /**
   * Peek at the next N due cards without mutations
   */
  async peekDue(
    now: Date,
    deckId: string,
    limit: number = 10,
  ): Promise<Flashcard[]> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) return [];

    let query = `
      SELECT * FROM flashcards
      WHERE deck_id = ? AND due_date <= ? AND state = 'review'
    `;
    const params = [deckId, now.toISOString()];

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
  ): Promise<Flashcard | null> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) return null;

    let query = `
      SELECT * FROM flashcards
      WHERE deck_id = ? AND due_date <= ? AND state = 'review'
    `;
    const params = [deckId, now.toISOString()];

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

  private async getNextNewCard(deckId: string): Promise<Flashcard | null> {
    let query = `
      SELECT * FROM flashcards
      WHERE deck_id = ? AND state = 'new'
    `;
    const params = [deckId];

    query += " ORDER BY due_date ASC LIMIT 1";

    const results = await this.queryFlashcards(query, params);
    return results.length > 0 ? results[0] : null;
  }

  private async hasNewCardQuota(deckId: string): Promise<boolean> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) return false;

    if (!hasNewCardsLimit(deck.config)) return true; // -1 = unlimited

    if (deck.config.newCardsPerDay === 0) return false; // 0 = no cards

    const dailyCounts = await this.db.getDailyReviewCounts(deckId);
    return dailyCounts.newCount < deck.config.newCardsPerDay;
  }

  private async hasReviewCardQuota(deckId: string): Promise<boolean> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) return false;

    if (!hasReviewCardsLimit(deck.config)) return true; // -1 = unlimited

    if (deck.config.reviewCardsPerDay === 0) return false; // 0 = no cards

    const dailyCounts = await this.db.getDailyReviewCounts(deckId);
    return dailyCounts.reviewCount < deck.config.reviewCardsPerDay;
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

  private ratingToNumber(rating: RatingLabel): number {
    const ratingMap: Record<RatingLabel, number> = {
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

  private async getDueCardCount(now: Date, deckId: string): Promise<number> {
    // Include cards due within the next 15 minutes for session goal calculation
    const fifteenMinutesLater = new Date(now.getTime() + 15 * 60 * 1000);
    const query = `
    SELECT COUNT(*) as count
    FROM flashcards
    WHERE deck_id = ? AND due_date <= ? AND state = 'review'
  `;
    const results = await this.queryRaw(query, [
      deckId,
      fifteenMinutesLater.toISOString(),
    ]);
    return results.length > 0 ? (results[0][0] as number) : 0;
  }

  private async getNewCardCount(deckId: string): Promise<number> {
    const query = `
    SELECT COUNT(*) as count
    FROM flashcards
    WHERE deck_id = ? AND state = 'new'
  `;
    const results = await this.queryRaw(query, [deckId]);
    return results.length > 0 ? (results[0][0] as number) : 0;
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
      state: row[7] as FlashcardState,
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
}
