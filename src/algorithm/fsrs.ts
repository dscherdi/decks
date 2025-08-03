import { Flashcard } from "../database/types";

export type Difficulty = "again" | "hard" | "good" | "easy";

export interface FSRSParameters {
  w: number[]; // weights for the algorithm
  requestRetention: number; // target retention rate
  maximumInterval: number; // maximum interval in days
  easyBonus: number; // bonus for easy cards
  hardInterval: number; // interval modifier for hard cards
}

export interface SchedulingInfo {
  again: SchedulingCard;
  hard: SchedulingCard;
  good: SchedulingCard;
  easy: SchedulingCard;
}

export interface SchedulingCard {
  dueDate: string;
  interval: number; // in minutes
  easeFactor: number;
  repetitions: number;
}

export class FSRS {
  private params: FSRSParameters;

  constructor(params?: Partial<FSRSParameters>) {
    // Default FSRS-4.5 parameters
    this.params = {
      w: [
        0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18,
        0.05, 0.34, 1.26, 0.29, 2.61,
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
    const now = new Date();

    // Calculate scheduling for each difficulty option
    return {
      again: this.calculateSchedule(card, "again", now),
      hard: this.calculateSchedule(card, "hard", now),
      good: this.calculateSchedule(card, "good", now),
      easy: this.calculateSchedule(card, "easy", now),
    };
  }

  /**
   * Update a flashcard based on the selected difficulty
   */
  updateCard(card: Flashcard, difficulty: Difficulty): Flashcard {
    const now = new Date();
    const schedule = this.calculateSchedule(card, difficulty, now);

    return {
      ...card,
      dueDate: schedule.dueDate,
      interval: schedule.interval,
      easeFactor: schedule.easeFactor,
      repetitions: schedule.repetitions,
      modified: now.toISOString(),
    };
  }

  private calculateSchedule(
    card: Flashcard,
    difficulty: Difficulty,
    now: Date,
  ): SchedulingCard {
    let interval: number;
    let easeFactor = card.easeFactor;
    let repetitions = card.repetitions;

    // First review (new card)
    if (card.repetitions === 0) {
      switch (difficulty) {
        case "again":
          interval = 1; // 1 minute
          repetitions = 0;
          break;
        case "hard":
          interval = 5; // 5 minutes
          repetitions = 1;
          break;
        case "good":
          interval = 10; // 10 minutes
          repetitions = 1;
          break;
        case "easy":
          interval = 4 * 1440; // 4 days
          repetitions = 1;
          easeFactor = this.initialStability(4);
          break;
      }
    } else if (card.interval < 1440) {
      // Learning phase (interval less than 1 day)
      switch (difficulty) {
        case "again":
          interval = 1; // 1 minute
          repetitions = 0;
          easeFactor = Math.max(1.3, easeFactor - 0.2);
          break;
        case "hard":
          interval = Math.max(1, card.interval * 1.2);
          repetitions += 1;
          easeFactor = Math.max(1.3, easeFactor - 0.15);
          break;
        case "good":
          interval = card.interval * 2.5;
          repetitions += 1;
          break;
        case "easy":
          interval = card.interval * 3.5;
          repetitions += 1;
          easeFactor = Math.min(2.5, easeFactor + 0.15);
          break;
      }
    } else {
      // Review phase (interval >= 1 day)
      const daysSinceLastReview = this.getDaysSince(card.dueDate);
      const retrievability = this.calculateRetrievability(
        card.interval / 1440,
        daysSinceLastReview,
      );

      switch (difficulty) {
        case "again":
          interval = 1440; // 1 day
          repetitions = 1;
          easeFactor = Math.max(1.3, easeFactor - 0.2);
          break;
        case "hard":
          interval =
            this.nextInterval(
              card.interval / 1440,
              easeFactor,
              retrievability,
              2,
            ) * 1440;
          repetitions += 1;
          easeFactor = Math.max(1.3, easeFactor - 0.15);
          break;
        case "good":
          interval =
            this.nextInterval(
              card.interval / 1440,
              easeFactor,
              retrievability,
              3,
            ) * 1440;
          repetitions += 1;
          break;
        case "easy":
          interval =
            this.nextInterval(
              card.interval / 1440,
              easeFactor,
              retrievability,
              4,
            ) *
            1440 *
            this.params.easyBonus;
          repetitions += 1;
          easeFactor = Math.min(2.5, easeFactor + 0.15);
          break;
      }
    }

    // Cap interval at maximum
    interval = Math.min(interval, this.params.maximumInterval * 1440);

    // Calculate due date
    const dueDate = new Date(now.getTime() + interval * 60 * 1000);

    return {
      dueDate: dueDate.toISOString(),
      interval: Math.round(interval),
      easeFactor: Number(easeFactor.toFixed(2)),
      repetitions,
    };
  }

  private initialStability(rating: number): number {
    return Math.max(0.1, this.params.w[rating - 1]);
  }

  private calculateRetrievability(interval: number, elapsed: number): number {
    return Math.pow(1 + elapsed / (9 * interval), -1);
  }

  private nextInterval(
    currentInterval: number,
    easeFactor: number,
    retrievability: number,
    rating: number,
  ): number {
    const desiredRetention = this.params.requestRetention;
    const stabilityIncrease = Math.exp(this.params.w[8] * (rating - 3));
    const difficultyDecay = this.params.w[9] * (rating - 3);

    const newStability = currentInterval * retrievability * stabilityIncrease;
    const newDifficulty = Math.max(
      0,
      Math.min(10, easeFactor + difficultyDecay),
    );

    const interval =
      (newStability * Math.log(desiredRetention)) / Math.log(0.9);

    return Math.max(1, Math.round(interval));
  }

  private getDaysSince(dateString: string): number {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return diffMs / (1000 * 60 * 60 * 24);
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
