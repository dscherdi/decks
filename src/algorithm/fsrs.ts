import { Flashcard, FlashcardState } from "../database/types";
import {
  FSRSProfile,
  getWeightsForProfile,
  getMinMinutesForProfile,
  getMaxIntervalDaysForProfile,
  validateFSRSWeights,
  validateProfile,
  validateRequestRetention,
} from "./fsrs-weights";

export type RatingLabel = "again" | "hard" | "good" | "easy";

export interface FSRSParameters {
  requestRetention: number; // target retention rate (0,1)
  profile: FSRSProfile; // "INTENSIVE" | "STANDARD"
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

// Constants for exact calculations
const MILLISECONDS_PER_DAY = 86400000;
const MINUTES_PER_DAY = 1440;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_MINUTE = 60000;

/**
 * Helper function for UI-only formatting - never use in calculations
 */
export function roundForDisplay(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

export class FSRS {
  private params: FSRSParameters;

  constructor(params?: Partial<FSRSParameters>) {
    this.params = {
      requestRetention: 0.9,
      profile: "STANDARD",
      ...params,
    };
    this.validateParameters();
  }

  /**
   * Update FSRS parameters
   */
  updateParameters(params: Partial<FSRSParameters>) {
    this.params = { ...this.params, ...params };
    this.validateParameters();
  }

  /**
   * Get current profile weights (hardcoded, not user-editable)
   */
  private getWeights(): number[] {
    return getWeightsForProfile(this.params.profile);
  }

  /**
   * Get minimum minutes for current profile (hardcoded)
   */
  private getMinMinutes(): number {
    return getMinMinutesForProfile(this.params.profile);
  }

  /**
   * Get maximum interval days for current profile (hardcoded)
   */
  private getMaxIntervalDays(): number {
    return getMaxIntervalDaysForProfile(this.params.profile);
  }

  /**
   * Validate FSRS parameters
   */
  private validateParameters() {
    if (!validateProfile(this.params.profile)) {
      throw new Error(
        `Invalid profile: ${this.params.profile}, must be "INTENSIVE" or "STANDARD"`,
      );
    }
    if (!validateRequestRetention(this.params.requestRetention)) {
      throw new Error(
        `requestRetention must be in range (0.5, 0.995), got ${this.params.requestRetention}`,
      );
    }

    // Validate hardcoded weights for current profile
    const weights = this.getWeights();
    if (!validateFSRSWeights(weights)) {
      throw new Error(
        `Invalid hardcoded weights for profile ${this.params.profile}`,
      );
    }
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
  updateCard(card: Flashcard, difficulty: RatingLabel): Flashcard {
    const rating = this.difficultyToRating(difficulty);
    const fsrsCard = this.flashcardToFSRS(card);
    const now = new Date();

    // Calculate FSRS update once and reuse
    const updatedFsrsCard = this.calculateUpdatedFsrsCard(
      fsrsCard,
      rating,
      now,
    );
    const intervalMinutes = this.nextIntervalMinutes(updatedFsrsCard.stability);
    const schedule = this.createSchedulingCard(
      intervalMinutes,
      updatedFsrsCard,
      now,
    );

    return {
      ...card,
      state: schedule.state,
      dueDate: schedule.dueDate,
      interval: schedule.interval,
      difficulty: schedule.difficulty, // Store FSRS difficulty with full precision
      repetitions: schedule.repetitions,
      stability: schedule.stability, // Store stability with full precision
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

      // Validate current stability before using it
      if (!isFinite(newCard.stability) || newCard.stability <= 0) {
        newCard.stability = this.initStability(3); // Default to "good" rating stability
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

      // Final validation of calculated stability
      if (!isFinite(newCard.stability) || newCard.stability <= 0) {
        newCard.stability = this.initStability(rating);
      }

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

    // Validate updated card stability
    if (!isFinite(updatedCard.stability) || updatedCard.stability <= 0) {
      updatedCard.stability = this.initStability(rating);
    }

    const intervalMinutes = this.nextIntervalMinutes(updatedCard.stability);

    return this.createSchedulingCard(intervalMinutes, updatedCard, now);
  }

  private createSchedulingCard(
    intervalMinutes: number,
    card: FSRSCard,
    now: Date,
  ): SchedulingCard {
    if (!isFinite(now.getTime())) {
      throw new Error("Invalid date provided to createSchedulingCard");
    }

    // Use exact millisecond calculation for maximum precision
    const intervalMilliseconds = intervalMinutes * MILLISECONDS_PER_MINUTE;
    const dueDate = new Date(now.getTime() + intervalMilliseconds);

    // Validate the resulting date
    if (!isFinite(dueDate.getTime())) {
      throw new Error(
        `Invalid due date calculated: intervalMinutes=${intervalMinutes}, now=${now.toISOString()}`,
      );
    }

    return {
      dueDate: dueDate.toISOString(),
      interval: intervalMinutes, // Store full precision interval
      repetitions: card.reps,
      stability: card.stability, // Store full precision stability
      difficulty: card.difficulty, // Store full precision difficulty
      state: this.fsrsStateToFlashcardState(card.state),
    };
  }

  private initStability(rating: number): number {
    const weights = this.getWeights();
    const stability = weights[rating - 1];
    const result = isFinite(stability) ? stability : 0.01; // Allow very small stabilities for sub-day intervals
    return result;
  }

  private initDifficulty(rating: number): number {
    const weights = this.getWeights();
    const w4 = weights[4];
    const w5 = weights[5];
    const ratingDiff = rating - 3;
    const difficulty = w4 - w5 * ratingDiff;

    const validDifficulty = isFinite(difficulty) ? difficulty : 5.0;

    // Apply clamping only after all calculations
    if (validDifficulty < 1) return 1;
    if (validDifficulty > 10) return 10;
    return validDifficulty;
  }

  /**
   * Forgetting curve function with maximum precision
   */
  public forgettingCurve(elapsedDays: number, stability: number): number {
    if (!isFinite(elapsedDays) || !isFinite(stability) || stability <= 0) {
      return 0;
    }

    // Store intermediate calculations to avoid precision loss
    const stabilityFactor = 9 * stability;
    const elapsedToStabilityRatio = elapsedDays / stabilityFactor;
    const baseTerm = 1 + elapsedToStabilityRatio;

    if (!isFinite(baseTerm) || baseTerm <= 0) {
      return 0;
    }

    // Calculate power term with full precision
    const powerTerm = Math.pow(baseTerm, -1);

    return isFinite(powerTerm) ? powerTerm : 0;
  }

  /**
   * Calculate retrievability for a flashcard at review time
   * @param card - The flashcard being reviewed
   * @param reviewedAt - When the review is happening
   * @returns Retrievability value (0-1)
   */
  public getRetrievability(
    card: Flashcard,
    reviewedAt: Date = new Date(),
  ): number {
    if (!card.lastReviewed || card.stability <= 0) {
      return 0.9; // Default for new cards or invalid stability
    }

    const reviewedAtTime = reviewedAt.getTime();
    const lastReviewedTime = new Date(card.lastReviewed).getTime();
    const elapsedMilliseconds = reviewedAtTime - lastReviewedTime;

    // Convert to days with maximum precision
    const elapsedDays = Math.max(0, elapsedMilliseconds / MILLISECONDS_PER_DAY);

    return this.forgettingCurve(elapsedDays, card.stability);
  }

  /**
   * Calculate next difficulty with maximum precision
   */
  private nextDifficulty(difficulty: number, rating: number): number {
    if (!isFinite(difficulty) || !isFinite(rating)) {
      return 5.0;
    }

    const weights = this.getWeights();
    const w6 = weights[6];
    const ratingDiff = rating - 3;
    const difficultyChange = w6 * ratingDiff;
    const nextD = difficulty - difficultyChange;

    const w4 = weights[4];
    const revertedD = this.meanReversion(w4, nextD);

    // Apply clamping only after all calculations
    if (revertedD < 1) return 1;
    if (revertedD > 10) return 10;
    return revertedD;
  }

  /**
   * Mean reversion calculation with maximum precision
   */
  private meanReversion(init: number, current: number): number {
    if (!isFinite(init) || !isFinite(current)) {
      return init;
    }

    const weights = this.getWeights();
    const w7 = weights[7];
    const initWeight = w7 * init;
    const currentWeight = (1 - w7) * current;

    return initWeight + currentWeight;
  }

  /**
   * Calculate next stability with maximum precision
   */
  private nextStability(
    difficulty: number,
    stability: number,
    retrievability: number,
    rating: number,
  ): number {
    // Validate inputs
    if (
      !isFinite(difficulty) ||
      !isFinite(stability) ||
      !isFinite(retrievability)
    ) {
      return Math.max(stability, 0.01);
    }

    // Extract weights with validation
    const weights = this.getWeights();
    const w8 = isFinite(weights[8]) ? weights[8] : 0;
    const w9 = isFinite(weights[9]) ? weights[9] : 0.1;
    const w10 = isFinite(weights[10]) ? weights[10] : 0;
    const w15 = isFinite(weights[15]) ? weights[15] : 1;
    const w16 = isFinite(weights[16]) ? weights[16] : 1;

    // Calculate penalty/bonus factors
    const hardPenalty = rating === 2 ? w15 : 1;
    const easyBonus = rating === 4 ? w16 : 1;

    // Store intermediate calculations to avoid precision loss
    const expW8 = Math.exp(w8);
    const difficultyTerm = 11 - difficulty;
    const stabilityPowerTerm = stability > 0 ? Math.pow(stability, -w9) : 1;
    const retrievabilityTerm = 1 - retrievability;
    const retrievabilityProduct = retrievabilityTerm * w10;
    const expRetrievabilityTerm = Math.exp(retrievabilityProduct) - 1;

    // Validate each intermediate result
    if (
      !isFinite(expW8) ||
      !isFinite(difficultyTerm) ||
      !isFinite(stabilityPowerTerm) ||
      !isFinite(expRetrievabilityTerm)
    ) {
      return Math.max(stability, 0.01);
    }

    // Calculate growth factor with full precision
    const growthFactor =
      expW8 * difficultyTerm * stabilityPowerTerm * expRetrievabilityTerm;
    const totalGrowthFactor = growthFactor * hardPenalty * easyBonus;
    const newStabilityFactor = 1 + totalGrowthFactor;
    const result = stability * newStabilityFactor;

    // Validate result and ensure it's positive
    return isFinite(result) && result > 0 ? result : Math.max(stability, 0.1);
  }

  /**
   * Calculate next interval in minutes with maximum precision
   */
  private nextIntervalMinutes(stability: number): number {
    const minInterval = this.getMinMinutes();

    // Validate stability
    if (!isFinite(stability) || stability <= 0) {
      console.warn(`Invalid stability: ${stability}, using minMinutes`);
      return minInterval;
    }

    // Validate parameters
    if (
      !isFinite(this.params.requestRetention) ||
      this.params.requestRetention <= 0 ||
      this.params.requestRetention >= 1
    ) {
      console.warn(
        `Invalid requestRetention: ${this.params.requestRetention}, using minMinutes`,
      );
      return minInterval;
    }

    // Calculate with maximum precision using exact constants
    const retentionLog = Math.log(this.params.requestRetention);
    const baseLog = Math.log(0.9);
    const k = retentionLog / baseLog; // positive for 0<requestRetention<1

    // Calculate interval using exact day-to-minute conversion
    const intervalDays = stability * k;
    const intervalMinutes = intervalDays * MINUTES_PER_DAY;

    // Validate calculation result
    if (!isFinite(intervalMinutes)) {
      console.warn(
        `Invalid minutes calculation: stability=${stability}, k=${k}, using minMinutes`,
      );
      return minInterval;
    }

    // Apply bounds with exact conversion
    const maxInterval = this.getMaxIntervalDays() * MINUTES_PER_DAY;

    let result = intervalMinutes;
    if (result < minInterval) result = minInterval;
    if (result > maxInterval) result = maxInterval;

    // Final validation to ensure result is finite
    if (!isFinite(result)) {
      console.warn(`Invalid final result: ${result}, using minMinutes`);
      return minInterval;
    }

    return result;
  }

  /**
   * Calculate elapsed days with maximum precision
   */
  private getElapsedDays(lastReview: Date, now: Date): number {
    const nowTime = now.getTime();
    const lastReviewTime = lastReview.getTime();
    const elapsedMilliseconds = nowTime - lastReviewTime;
    const elapsedDays = elapsedMilliseconds / MILLISECONDS_PER_DAY;

    return Math.max(0, elapsedDays);
  }

  private flashcardToFSRS(card: Flashcard): FSRSCard {
    const lastReview = card.lastReviewed
      ? new Date(card.lastReviewed)
      : new Date();

    const difficulty = card.difficulty || 5.0; // Use difficulty field

    return {
      stability: card.stability || 0,
      difficulty: difficulty || 0,
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

  private difficultyToRating(difficulty: RatingLabel): number {
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
   * Get display text for intervals - UI formatting only
   */
  static getIntervalDisplay(minutes: number): string {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    } else if (minutes < MINUTES_PER_DAY) {
      const hours = Math.round(minutes / 60);
      return `${hours}h`;
    } else {
      const days = Math.round(minutes / MINUTES_PER_DAY);
      if (days < 30) {
        return `${days}d`;
      } else if (days < 365) {
        const months = Math.round(days / 30);
        return `${months}mo`;
      } else {
        const years = days / 365;
        return `${roundForDisplay(years, 1)}y`;
      }
    }
  }
}
