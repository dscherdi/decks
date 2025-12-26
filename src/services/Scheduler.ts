import type {
  Flashcard,
  FlashcardState,
  Deck,
  ReviewLog,
} from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { FSRS, type RatingLabel, type SchedulingCard } from "../algorithm/fsrs";
import {
  getMinMinutesForProfile,
  getMaxIntervalDaysForProfile,
  type FSRSProfile,
} from "../algorithm/fsrs-weights";
import { yieldToUI } from "../utils/ui";
import type { Logger } from "../utils/logging";
import type { DecksSettings } from "../settings";
import { BackupService } from "./BackupService";

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

export interface NewSession {
  sessionId: string;
  deckFilePath: string;
}

/**
 * Unified scheduler that consolidates all card selection and scheduling logic.
 * Handles deterministic card selection, FSRS-based interval calculation,
 * and atomic state updates with review logging.
 */
export class Scheduler {
  private db: IDatabaseService;
  private fsrs: FSRS;
  private currentSessionId: string | null = null;
  private logger?: Logger;
  private backupService: BackupService;
  private settings: DecksSettings;

  constructor(
    db: IDatabaseService,
    settings: DecksSettings,
    backupService: BackupService,
    logger?: Logger
  ) {
    this.db = db;
    this.fsrs = new FSRS();
    this.logger = logger;
    this.backupService = backupService;
    this.settings = settings;
  }

  private debugLog(message: string, data?: unknown): void {
    this.logger?.debug(message, data);
  }

  /**
   * Start a new review session for a deck
   */
  async startReviewSession(
    deckId: string,
    now: Date = new Date(),
    sessionDurationMinutes?: number
  ): Promise<NewSession> {
    this.debugLog(`Starting review session for deck: ${deckId}`);
    const deck = await this.db.getDeckById(deckId);
    if (!deck) {
      this.debugLog(`Error: Deck not found: ${deckId}`);
      throw new Error(`Deck not found: ${deckId}`);
    }
    this.debugLog(`Found deck: ${deck.name} (${deck.id})`);

    // Calculate goal total more accurately
    const dailyCounts = await this.db.getDailyReviewCounts(deckId);
    // Include cards due within session duration for session goal calculation
    // This ensures cards that become due during the review session count towards the goal
    const dueCardCount = await this.getDueCardCount(
      now,
      deckId,
      sessionDurationMinutes
    );
    const newCardCount = await this.getNewCardCount(deckId);

    let goalTotal = 0;

    // Add due review cards (applying daily limits if configured)
    if (deck.config.hasReviewCardsLimitEnabled) {
      const remainingReviewQuota = Math.max(
        0,
        deck.config.reviewCardsPerDay - dailyCounts.reviewCount
      );
      goalTotal += Math.min(dueCardCount, remainingReviewQuota);
    } else {
      // unlimited
      goalTotal += dueCardCount;
    }

    // Add new cards (applying daily limits if configured)
    if (deck.config.hasNewCardsLimitEnabled) {
      const remainingNewQuota = Math.max(
        0,
        deck.config.newCardsPerDay - dailyCounts.newCount
      );
      goalTotal += Math.min(newCardCount, remainingNewQuota);
    } else {
      // unlimited
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

    this.debugLog(
      `Review session created: ${sessionId}, goal: ${finalGoalTotal}`
    );
    return {
      sessionId: sessionId,
      deckFilePath: deck?.filepath,
    };
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
  async endReviewSession(sessionId: string): Promise<void> {
    await this.db.endReviewSession(sessionId);

    // Save db
    await this.save();
    // Trigger backup after session ends (if enabled in settings)
    if (this.settings.backup.enableAutoBackup) {
      try {
        await this.backupService.createBackup(this.db);
      } catch (error) {
        this.debugLog("Failed to create backup after session end:", error);
      }
    }
  }

  /**
   * Start a fresh review session for a deck (ends any existing session)
   */
  async startFreshSession(
    deckId: string,
    now: Date = new Date(),
    sessionDurationMinutes?: number
  ): Promise<NewSession> {
    // End any existing active session first
    const activeSession = await this.db.getActiveReviewSession(deckId);
    if (activeSession) {
      await this.db.endReviewSession(activeSession.id);
    }

    // Start a new session
    const newSession = await this.startReviewSession(
      deckId,
      now,
      sessionDurationMinutes
    );
    this.currentSessionId = newSession.sessionId;

    return newSession;
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
    options: { allowNew?: boolean } = {}
  ): Promise<Flashcard | null> {
    this.debugLog(
      `Getting next card for deck: ${deckId}, allowNew: ${options.allowNew}`
    );

    const { allowNew = true } = options;

    // First check for due cards with quota
    if (await this.hasReviewCardQuota(deckId)) {
      this.debugLog(`Checking for due cards for deck: ${deckId}`);
      const dueCard = await this.getNextDueCard(now, deckId);
      if (dueCard) {
        this.debugLog(`Found due card: ${dueCard.id}`);
        return dueCard;
      }
      this.debugLog(`No due cards found for deck: ${deckId}`);
    } else {
      this.debugLog(`Review card quota exhausted for deck: ${deckId}`);
    }

    // If no due cards and new cards allowed, get next new card
    // Then check for new cards with quota
    if (allowNew && (await this.hasNewCardQuota(deckId))) {
      this.debugLog(`Checking for new cards for deck: ${deckId}`);
      const newCard = await this.getNextNewCard(deckId);
      if (newCard) {
        this.debugLog(`Found new card: ${newCard.id}`);
      } else {
        this.debugLog(`No new cards found for deck: ${deckId}`);
      }
      return newCard;
    } else if (!allowNew) {
      this.debugLog(`New cards not allowed for this request`);
    } else {
      this.debugLog(`New card quota exhausted for deck: ${deckId}`);
    }

    this.debugLog(`No cards available for deck: ${deckId}`);
    return null;
  }

  /**
   * Preview scheduling outcomes for all four ratings without mutations
   */
  async preview(cardId: string): Promise<SchedulingPreview | null> {
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
    timeElapsed?: number,
    shownAt?: Date
  ): Promise<Flashcard> {
    const now = new Date();
    this.debugLog(`Rating card ${cardId} with rating: ${rating}`);
    const card = await this.db.getFlashcardById(cardId);
    if (!card) {
      this.debugLog(`Error: Card not found: ${cardId}`);
      throw new Error(`Card not found: ${cardId}`);
    }

    const deck = await this.db.getDeckById(card.deckId);
    if (!deck) {
      this.debugLog(`Error: Deck not found: ${card.deckId}`);
      throw new Error(`Deck not found: ${card.deckId}`);
    }

    this.debugLog(
      `Found card: ${card.front.substring(0, 50)}... in deck: ${deck.name}`
    );
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
        card.id
      ));

      // Update session progress if first review
      if (isFirstReviewInSession) {
        const session = await this.db.getReviewSessionById(
          this.currentSessionId
        );
        if (session) {
          const newDoneUnique = session.doneUnique + 1;
          await this.db.updateReviewSessionDoneUnique(
            this.currentSessionId,
            newDoneUnique
          );
        }
      }
    }

    // Create review log entry
    const reviewLog: Omit<ReviewLog, "id"> = {
      flashcardId: card.id,
      sessionId: this.currentSessionId || undefined,
      lastReviewedAt: oldCard.lastReviewed || oldCard.dueDate,
      shownAt: shownAt
        ? shownAt.toISOString()
        : timeElapsed
          ? new Date(now.getTime() - timeElapsed).toISOString()
          : now.toISOString(),
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
        deck.config.fsrs.profile
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
    await yieldToUI();
    await this.db.save();
    await yieldToUI();
  }

  /**
   * Peek at the next N due cards without mutations
   */
  async peekDue(now: Date, deckId: string, limit = 10): Promise<Flashcard[]> {
    this.debugLog(`Peeking at due cards for deck: ${deckId}, limit: ${limit}`);
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

    const results = await this.db.querySql(query, params);
    const dueCards = results.map((row) => this.rowToFlashcard(row));
    this.debugLog(`Found ${dueCards.length} due cards for deck: ${deckId}`);
    return dueCards;
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

    const results = await this.db.querySql(query, [deckId, now.toISOString()]);
    const nextDue = results.length > 0 ? results[0][0] : null;

    if (!nextDue) {
      return null;
    }

    const nextDueDate = new Date(nextDue as string);
    return Math.max(0, nextDueDate.getTime() - now.getTime());
  }

  // Private helper methods

  private async getNextDueCard(
    now: Date,
    deckId: string
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

    const results = await this.db.querySql(query, params);
    const flashcards = results.map((row) => this.rowToFlashcard(row));
    return flashcards.length > 0 ? flashcards[0] : null;
  }

  private async getNextNewCard(deckId: string): Promise<Flashcard | null> {
    const query = `
      SELECT * FROM flashcards
      WHERE deck_id = ? AND state = 'new'
       ORDER BY due_date ASC LIMIT 1
    `;
    const params = [deckId];

    const results = await this.db.querySql(query, params);
    const flashcards = results.map((row) => this.rowToFlashcard(row));
    return flashcards.length > 0 ? flashcards[0] : null;
  }

  private async hasNewCardQuota(deckId: string): Promise<boolean> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) return false;

    if (!deck.config.hasNewCardsLimitEnabled) return true; // unlimited

    const dailyCounts = await this.db.getDailyReviewCounts(deckId);
    return dailyCounts.newCount < deck.config.newCardsPerDay;
  }

  private async hasReviewCardQuota(deckId: string): Promise<boolean> {
    const deck = await this.db.getDeckById(deckId);
    if (!deck) return false;

    if (!deck.config.hasReviewCardsLimitEnabled) return true; // unlimited

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
    elapsedDays: number
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

  private async getDueCardCount(
    now: Date,
    deckId: string,
    sessionDurationMinutes = 25
  ): Promise<number> {
    // Include cards due within the session duration for session goal calculation
    const sessionEndTime = new Date(
      now.getTime() + sessionDurationMinutes * 60 * 1000
    );
    const query = `
    SELECT COUNT(*) as count
    FROM flashcards
    WHERE deck_id = ? AND due_date <= ? AND state = 'review'
  `;
    const results = await this.db.querySql<{ count: number }>(
      query,
      [deckId, sessionEndTime.toISOString()],
      { asObject: true }
    );
    return results[0]?.count || 0;
  }

  private async getNewCardCount(deckId: string): Promise<number> {
    const query = `
    SELECT COUNT(*) as count
    FROM flashcards
    WHERE deck_id = ? AND state = 'new'
  `;
    const results = await this.db.querySql<{ count: number }>(query, [deckId], {
      asObject: true,
    });
    return results[0]?.count || 0;
  }

  /**
   * Convert database row to Flashcard object (same logic as DatabaseService)
   */
  private rowToFlashcard(row: unknown[]): Flashcard {
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
