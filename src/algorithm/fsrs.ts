import { Flashcard, FlashcardState } from "../database/types";

export type Difficulty = "again" | "hard" | "good" | "easy";

export interface FSRSParameters {
  w: number[]; // 17 weights for the algorithm
  requestRetention: number; // target retention rate
  maximumInterval: number; // maximum interval in days
}

export interface FSRSCard {
  stability: number;
  difficulty: number;
  elapsedDays: number;
  reps: number;
  lapses: number;
  state: FSRSState;
  lastReview: Date;
}

export type FSRSState = "New" | "Review";

export interface SchedulingCard {
  dueDate: string;
  interval: number; // in minutes
  easeFactor: number;
  repetitions: number;
  stability: number;
  difficulty: number;
  state: FlashcardState;
}

export interface SchedulingInfo {
  again: SchedulingCard;
  hard: SchedulingCard;
  good: SchedulingCard;
  easy: SchedulingCard;
}

export class FSRS {
  private params: FSRSParameters;

  constructor(params?: Partial<FSRSParameters>) {
    // Default FSRS-4.5 parameters optimized for general use
    this.params = {
      w: [
        0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616,
        0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466,
      ],
      requestRetention: 0.9,
      maximumInterval: 36500, // 100 years
      ...params,
    };
  }

  /**
   * Update FSRS parameters
   */
  updateParameters(params: Partial<FSRSParameters>) {
    this.params = { ...this.params, ...params };
  }

  /**
   * Calculate the next scheduling info for a flashcard based on review difficulty
   */
  getSchedulingInfo(card: Flashcard): SchedulingInfo {
    const fsrsCard = this.flashcardToFSRS(card);
    const now = new Date();

    return {
      again: this.calculateScheduleForRating(fsrsCard, 1, now),
      hard: this.calculateScheduleForRating(fsrsCard, 2, now),
      good: this.calculateScheduleForRating(fsrsCard, 3, now),
      easy: this.calculateScheduleForRating(fsrsCard, 4, now),
    };
  }

  /**
   * Update a flashcard based on the selected difficulty
   */
  updateCard(card: Flashcard, difficulty: Difficulty): Flashcard {
    const rating = this.difficultyToRating(difficulty);
    const fsrsCard = this.flashcardToFSRS(card);
    const now = new Date();
    const schedule = this.calculateScheduleForRating(fsrsCard, rating, now);

    // Calculate lapses based on the updated FSRS card
    const updatedFsrsCard = this.calculateUpdatedFsrsCard(
      fsrsCard,
      rating,
      now,
    );

    return {
      ...card,
      state: schedule.state,
      dueDate: schedule.dueDate,
      interval: schedule.interval,
      easeFactor: schedule.difficulty, // Store FSRS difficulty in easeFactor field for compatibility
      repetitions: schedule.repetitions,
      stability: schedule.stability,
      lapses: updatedFsrsCard.lapses,
      lastReviewed: now.toISOString(),
      modified: now.toISOString(),
    };
  }

  private calculateUpdatedFsrsCard(
    card: FSRSCard,
    rating: number,
    now: Date,
  ): FSRSCard {
    if (card.state === "New" || card.stability === 0 || card.difficulty === 0) {
      // Initialization
      return {
        ...card,
        stability: this.initStability(rating),
        difficulty: this.initDifficulty(rating),
        reps: 1,
        lapses: rating === 1 ? 1 : 0,
        lastReview: now,
        state: "Review",
        elapsedDays: 0,
      };
    } else {
      // Subsequent reviews
      const newCard = { ...card };
      newCard.elapsedDays = this.getElapsedDays(card.lastReview, now);
      newCard.reps += 1;

      if (rating === 1) {
        newCard.lapses += 1;
      }

      const retrievability = this.forgettingCurve(
        newCard.elapsedDays,
        newCard.stability,
      );

      newCard.difficulty = this.nextDifficulty(newCard.difficulty, rating);
      newCard.stability = this.nextStability(
        newCard.difficulty,
        newCard.stability,
        retrievability,
        rating,
      );
      newCard.lastReview = now;
      newCard.state = "Review";

      return newCard;
    }
  }

  private calculateScheduleForRating(
    card: FSRSCard,
    rating: number,
    now: Date,
  ): SchedulingCard {
    const updatedCard = this.calculateUpdatedFsrsCard(card, rating, now);
    const intervalDays = this.nextInterval(updatedCard.stability);
    const intervalMinutes = Math.round(intervalDays * 1440);

    return this.createSchedulingCard(intervalMinutes, updatedCard, now);
  }

  private createSchedulingCard(
    intervalMinutes: number,
    card: FSRSCard,
    now: Date,
  ): SchedulingCard {
    const dueDate = new Date(now.getTime() + intervalMinutes * 60 * 1000);

    return {
      dueDate: dueDate.toISOString(),
      interval: intervalMinutes,
      easeFactor: Number(card.difficulty.toFixed(2)),
      repetitions: card.reps,
      stability: Number(card.stability.toFixed(2)),
      difficulty: Number(card.difficulty.toFixed(2)),
      state: this.fsrsStateToFlashcardState(card.state),
    };
  }

  private initStability(rating: number): number {
    return Math.max(this.params.w[rating - 1], 0.1);
  }

  private initDifficulty(rating: number): number {
    return Math.min(
      Math.max(this.params.w[4] - this.params.w[5] * (rating - 3), 1),
      10,
    );
  }

  private forgettingCurve(elapsedDays: number, stability: number): number {
    return Math.pow(1 + elapsedDays / (9 * stability), -1);
  }

  private nextDifficulty(difficulty: number, rating: number): number {
    const nextD = difficulty - this.params.w[6] * (rating - 3);
    return Math.min(
      Math.max(this.meanReversion(this.params.w[4], nextD), 1),
      10,
    );
  }

  private meanReversion(init: number, current: number): number {
    return this.params.w[7] * init + (1 - this.params.w[7]) * current;
  }

  private nextStability(
    difficulty: number,
    stability: number,
    retrievability: number,
    rating: number,
  ): number {
    const hardPenalty = rating === 2 ? this.params.w[15] : 1;
    const easyBonus = rating === 4 ? this.params.w[16] : 1;

    return (
      stability *
      (1 +
        Math.exp(this.params.w[8]) *
          (11 - difficulty) *
          Math.pow(stability, -this.params.w[9]) *
          (Math.exp((1 - retrievability) * this.params.w[10]) - 1) *
          hardPenalty *
          easyBonus)
    );
  }

  private nextInterval(stability: number): number {
    const interval =
      stability * (Math.log(this.params.requestRetention) / Math.log(0.9));
    return Math.min(
      Math.max(Math.round(interval), 1),
      this.params.maximumInterval,
    );
  }

  private getElapsedDays(lastReview: Date, now: Date): number {
    return Math.max(
      0,
      (now.getTime() - lastReview.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  private flashcardToFSRS(card: Flashcard): FSRSCard {
    const lastReview = card.lastReviewed
      ? new Date(card.lastReviewed)
      : new Date();

    return {
      stability: card.stability || 0,
      difficulty: card.easeFactor || 0, // Use easeFactor as difficulty storage for backward compatibility
      elapsedDays: 0, // Will be calculated in scheduling
      reps: card.repetitions,
      lapses: card.lapses || 0,
      state: this.flashcardStateToFSRSState(card.state),
      lastReview,
    };
  }

  private flashcardStateToFSRSState(state: FlashcardState): FSRSState {
    // Map all non-new states to Review for pure FSRS
    return state === "new" ? "New" : "Review";
  }

  private fsrsStateToFlashcardState(state: FSRSState): FlashcardState {
    // Map FSRS states to flashcard states (only new and review for pure FSRS)
    return state === "New" ? "new" : "review";
  }

  private difficultyToRating(difficulty: Difficulty): number {
    switch (difficulty) {
      case "again":
        return 1;
      case "hard":
        return 2;
      case "good":
        return 3;
      case "easy":
        return 4;
      default:
        return 3;
    }
  }

  /**
   * Get display text for intervals
   */
  static getIntervalDisplay(minutes: number): string {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    } else if (minutes < 1440) {
      return `${Math.round(minutes / 60)}h`;
    } else {
      const days = Math.round(minutes / 1440);
      if (days < 30) {
        return `${days}d`;
      } else if (days < 365) {
        return `${Math.round(days / 30)}mo`;
      } else {
        return `${(days / 365).toFixed(1)}y`;
      }
    }
  }
}
