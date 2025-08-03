import { Flashcard, FlashcardState } from "../database/types";

export type Difficulty = "again" | "hard" | "good" | "easy";

export interface FSRSParameters {
  w: number[]; // 17 weights for the algorithm
  requestRetention: number; // target retention rate
  maximumInterval: number; // maximum interval in days
  easyBonus: number; // bonus for easy cards
  hardInterval: number; // interval modifier for hard cards
}

export interface FSRSCard {
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: FSRSState;
  lastReview: Date;
}

export type FSRSState = "New" | "Learning" | "Review" | "Relearning";

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
      easyBonus: 1.3,
      hardInterval: 1.2,
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

    return {
      ...card,
      state: schedule.state,
      dueDate: schedule.dueDate,
      interval: schedule.interval,
      easeFactor: schedule.difficulty, // Store FSRS difficulty in easeFactor field
      repetitions: schedule.repetitions,
      modified: now.toISOString(),
    };
  }

  private calculateScheduleForRating(
    card: FSRSCard,
    rating: number,
    now: Date,
  ): SchedulingCard {
    let newCard: FSRSCard;

    if (card.state === "New") {
      newCard = this.initDS(card);
      newCard.stability = this.initStability(rating);
      newCard.difficulty = this.initDifficulty(rating);
      newCard.elapsedDays = 0;
      newCard.scheduledDays = 0;
      newCard.reps = 1;
      newCard.lapses = rating === 1 ? 1 : 0;
      newCard.state = rating === 1 ? "Learning" : "Review";
    } else {
      newCard = { ...card };
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

      if (rating === 1) {
        newCard.state = "Relearning";
      } else {
        newCard.state = "Review";
      }
    }

    const interval = this.nextInterval(newCard.stability);
    newCard.scheduledDays = interval;
    newCard.lastReview = now;

    const dueDate = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);

    return {
      dueDate: dueDate.toISOString(),
      interval: Math.round(interval * 1440), // Convert days to minutes
      easeFactor: Number(newCard.difficulty.toFixed(2)),
      repetitions: newCard.reps,
      stability: Number(newCard.stability.toFixed(2)),
      difficulty: Number(newCard.difficulty.toFixed(2)),
      state: this.fsrsStateToFlashcardState(newCard.state),
    };
  }

  private initDS(card: FSRSCard): FSRSCard {
    return {
      ...card,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: "New",
      lastReview: new Date(),
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
    const lastReview = card.modified ? new Date(card.modified) : new Date();
    const elapsedDays = this.getElapsedDays(lastReview, new Date());

    return {
      stability: card.easeFactor || 2.5, // Use easeFactor as stability storage
      difficulty: card.easeFactor || 5.0, // Default difficulty
      elapsedDays,
      scheduledDays: card.interval / 1440, // Convert minutes to days
      reps: card.repetitions,
      lapses: 0, // We don't track lapses in current model
      state: this.flashcardStateToFSRSState(card.state),
      lastReview,
    };
  }

  private flashcardStateToFSRSState(state: FlashcardState): FSRSState {
    switch (state) {
      case "new":
        return "New";
      case "learning":
        return "Learning";
      case "review":
        return "Review";
      default:
        return "New";
    }
  }

  private fsrsStateToFlashcardState(state: FSRSState): FlashcardState {
    switch (state) {
      case "New":
        return "new";
      case "Learning":
      case "Relearning":
        return "learning";
      case "Review":
        return "review";
      default:
        return "new";
    }
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
