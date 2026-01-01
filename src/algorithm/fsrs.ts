import type { Flashcard, FlashcardState } from "../database/types";
import {
  type FSRSProfile,
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
  nextDayStartsAt?: number; // Hour (0-23) when study day rolls over (default 4)
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

export interface FutureDueData {
  date: string;
  dueCount: number;
}

// Constants for exact calculations
const MILLISECONDS_PER_DAY = 86400000;
const MINUTES_PER_DAY = 1440;

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
   * Debug logging method (no-op for now since FSRS doesn't have logger access)
   */
  private debugLog(_message: string, ..._args: unknown[]): void {
    // No-op for now - FSRS class doesn't have access to logger
    // Could be enhanced to accept logger in constructor if needed
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
  private validateParameters(): void {
    if (!validateProfile(this.params.profile)) {
      throw new Error(`Invalid profile: ${this.params.profile}`);
    }

    if (!validateRequestRetention(this.params.requestRetention)) {
      throw new Error(
        `requestRetention must be in range (0.5, 0.995), got ${this.params.requestRetention}`
      );
    }

    // Validate weights for the current profile
    const weights = this.getWeights();
    if (!validateFSRSWeights(weights)) {
      throw new Error(
        `Invalid FSRS weights for profile: ${this.params.profile}`
      );
    }
  }

  /**
   * Get scheduling info for all four ratings
   */
  getSchedulingInfo(card: Flashcard, now: Date = new Date()): SchedulingInfo {
    const fsrsCard = this.flashcardToFSRS(card);
    const nowTime = now;

    return {
      again: this.calculateScheduleForRating(fsrsCard, 1, nowTime),
      hard: this.calculateScheduleForRating(fsrsCard, 2, nowTime),
      good: this.calculateScheduleForRating(fsrsCard, 3, nowTime),
      easy: this.calculateScheduleForRating(fsrsCard, 4, nowTime),
    };
  }

  /**
   * Update card with a rating and return the updated card
   */
  updateCard(
    card: Flashcard,
    rating: RatingLabel,
    now: Date = new Date()
  ): Flashcard {
    const ratingNum = this.difficultyToRating(rating);
    const fsrsCard = this.flashcardToFSRS(card);
    const nowTime = now;

    const updatedFsrsCard = this.calculateUpdatedFsrsCard(
      fsrsCard,
      ratingNum,
      nowTime
    );

    let intervalMinutes: number;

    // For "Again" rating (1), always use minimum interval regardless of stability
    if (ratingNum === 1) {
      intervalMinutes = this.getMinMinutes();
    } else {
      intervalMinutes = this.nextIntervalMinutes(updatedFsrsCard.stability);
    }

    const schedule = this.createSchedulingCard(
      updatedFsrsCard,
      intervalMinutes,
      nowTime
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
      lastReviewed: nowTime.toISOString(),
      modified: nowTime.toISOString(),
    };
  }

  private calculateUpdatedFsrsCard(
    card: FSRSCard,
    rating: number,
    now: Date
  ): FSRSCard {
    if (card.state === "New") {
      // First review - transition to Review state
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
        // "Again" rating: Use Forgetting Stability formula (NOT w[0] reset)
        newCard.lapses += 1;

        // Validate current difficulty before using it
        if (!isFinite(newCard.difficulty) || newCard.difficulty <= 0) {
          newCard.difficulty = this.initDifficulty(3); // Default to "good" rating difficulty
        }

        // Calculate difficulty normally (this will increase it for "Again")
        newCard.difficulty = this.nextDifficulty(newCard.difficulty, rating);

        // Calculate retrievability for forgetting stability formula
        const retrievability = this.forgettingCurve(
          newCard.elapsedDays,
          newCard.stability
        );

        // Apply Forgetting Stability formula: S_new = w[11] * D^(-w[12]) * ((S + 1)^w[13] - 1) * e^(w[14] * (1 - R))
        newCard.stability = this.forgettingStability(
          newCard.difficulty,
          newCard.stability,
          retrievability
        );
      } else {
        // For other ratings, calculate normally

        // Validate current stability before using it
        if (!isFinite(newCard.stability) || newCard.stability <= 0) {
          newCard.stability = this.initStability(3); // Default to "good" rating stability
        }

        const retrievability = this.forgettingCurve(
          newCard.elapsedDays,
          newCard.stability
        );

        newCard.difficulty = this.nextDifficulty(newCard.difficulty, rating);
        newCard.stability = this.nextStability(
          newCard.difficulty,
          newCard.stability,
          retrievability,
          rating
        );

        // Final validation of calculated stability
        if (!isFinite(newCard.stability) || newCard.stability <= 0) {
          newCard.stability = this.initStability(rating);
        }
      }

      // Clamp difficulty to valid range
      newCard.difficulty = Math.max(1, Math.min(10, newCard.difficulty));

      // Ensure stability remains positive
      if (!isFinite(newCard.stability) || newCard.stability <= 0) {
        newCard.stability = 0.01;
      }

      newCard.lastReview = now;
      return newCard;
    }
  }

  private calculateScheduleForRating(
    card: FSRSCard,
    rating: number,
    now: Date
  ): SchedulingCard {
    const updatedCard = this.calculateUpdatedFsrsCard(card, rating, now);

    // Validate updated card stability
    if (!isFinite(updatedCard.stability) || updatedCard.stability <= 0) {
      updatedCard.stability = this.initStability(rating);
    }

    let intervalMinutes: number;

    // For "Again" rating (1), always use minimum interval regardless of stability
    if (rating === 1) {
      intervalMinutes = this.getMinMinutes();
    } else {
      intervalMinutes = this.nextIntervalMinutes(updatedCard.stability);
    }

    return this.createSchedulingCard(updatedCard, intervalMinutes, now);
  }

  private createSchedulingCard(
    card: FSRSCard,
    intervalMinutes: number,
    now: Date
  ): SchedulingCard {
    // Validate inputs
    if (!isFinite(intervalMinutes) || intervalMinutes <= 0) {
      intervalMinutes = this.getMinMinutes();
    }

    // Ensure minimum interval for STANDARD profile
    const minMinutes = this.getMinMinutes();
    if (intervalMinutes < minMinutes) {
      intervalMinutes = minMinutes;
    }

    // Calculate due date aligned to Study Day boundaries
    const nextDayStartsAt = this.params.nextDayStartsAt ?? 4;
    const intervalDays = Math.ceil(intervalMinutes / MINUTES_PER_DAY);
    const dueDate = this.getStudyDayStartAfterDays(now, intervalDays, nextDayStartsAt);

    return {
      dueDate: dueDate,
      interval: intervalMinutes,
      repetitions: card.reps,
      stability: card.stability,
      difficulty: card.difficulty,
      state: "review",
    };
  }

  /**
   * Calculates the start of the current Study Day in UTC
   */
  private getStudyDayStart(now: Date, nextDayStartsAt: number): string {
    const localMidnight = new Date(now);
    localMidnight.setHours(0, 0, 0, 0);

    const studyDayStart = new Date(localMidnight);
    studyDayStart.setHours(nextDayStartsAt, 0, 0, 0);

    // If current time is before the study day rollover, use previous day
    if (now < studyDayStart) {
      studyDayStart.setDate(studyDayStart.getDate() - 1);
    }

    return studyDayStart.toISOString();
  }

  /**
   * Calculates the start of a future Study Day (N days from now)
   */
  private getStudyDayStartAfterDays(
    now: Date,
    daysFromNow: number,
    nextDayStartsAt: number
  ): string {
    const currentStart = new Date(this.getStudyDayStart(now, nextDayStartsAt));
    currentStart.setDate(currentStart.getDate() + daysFromNow);
    return currentStart.toISOString();
  }

  private initStability(rating: number): number {
    const weights = this.getWeights();
    const stability = weights[rating - 1];
    const result = isFinite(stability) && stability > 0 ? stability : 0.01;
    return result;
  }

  private initDifficulty(rating: number): number {
    const weights = this.getWeights();
    const w4 = weights[4];
    const w5 = weights[5];
    const ratingDiff = rating - 3;
    const difficulty = w4 - w5 * ratingDiff;

    const validDifficulty = isFinite(difficulty) ? difficulty : 5.0;
    return Math.max(1, Math.min(10, validDifficulty));
  }

  /**
   * Forgetting Stability formula for lapse handling (FSRS 4.5)
   * S_new = w[11] * D^(-w[12]) * ((S + 1)^w[13] - 1) * e^(w[14] * (1 - R))
   */
  private forgettingStability(
    difficulty: number,
    stability: number,
    retrievability: number
  ): number {
    const weights = this.getWeights();
    const w11 = weights[11];
    const w12 = weights[12];
    const w13 = weights[13];
    const w14 = weights[14];

    // Validate inputs
    if (
      !isFinite(difficulty) ||
      !isFinite(stability) ||
      !isFinite(retrievability) ||
      stability <= 0
    ) {
      return this.initStability(1); // Fallback to w[0]
    }

    try {
      // S_new = w[11] * D^(-w[12]) * ((S + 1)^w[13] - 1) * e^(w[14] * (1 - R))
      const difficultyTerm = Math.pow(difficulty, -w12);
      const stabilityTerm = Math.pow(stability + 1, w13) - 1;
      const retrievabilityTerm = Math.exp(w14 * (1 - retrievability));

      const result = w11 * difficultyTerm * stabilityTerm * retrievabilityTerm;

      // Validate result
      if (!isFinite(result) || result <= 0) {
        return this.initStability(1); // Fallback to w[0]
      }

      return result;
    } catch {
      // Math error (overflow, etc.)
      return this.initStability(1); // Fallback to w[0]
    }
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

    // Apply power with validation
    const powerTerm = Math.pow(baseTerm, -1);

    return isFinite(powerTerm) ? Math.max(0, Math.min(1, powerTerm)) : 0;
  }

  /**
   * Get retrievability for a card at a specific review time
   */
  public getRetrievability(
    card: Flashcard,
    reviewedAt: Date = new Date()
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
    if (!isFinite(difficulty)) {
      return 5.0;
    }

    const weights = this.getWeights();
    const w6 = weights[6];
    const ratingDiff = rating - 3;
    const difficultyChange = -w6 * ratingDiff;
    const nextD = difficulty + difficultyChange;

    // Apply mean reversion
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
    rating: number
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
      this.debugLog(`Invalid stability: ${stability}, using minMinutes`);
      return minInterval;
    }

    // Validate parameters
    if (
      !isFinite(this.params.requestRetention) ||
      this.params.requestRetention <= 0 ||
      this.params.requestRetention >= 1
    ) {
      this.debugLog(
        `Invalid requestRetention: ${this.params.requestRetention}, using minMinutes`
      );
      return minInterval;
    }

    // Calculate interval using I = S * k formula
    const retentionLog = Math.log(this.params.requestRetention);
    const baseLog = Math.log(0.9);
    const k = retentionLog / baseLog;

    // Convert stability from days to minutes and apply k factor
    const intervalDays = stability * k;
    const intervalMinutes = intervalDays * MINUTES_PER_DAY;

    // Validate calculation
    if (!isFinite(intervalMinutes) || intervalMinutes <= 0) {
      this.debugLog(
        `Invalid interval calculation: ${intervalMinutes}, using minMinutes`
      );
      return minInterval;
    }

    // Apply maximum interval limit
    const maxInterval = this.getMaxIntervalDays() * MINUTES_PER_DAY;

    let result = Math.max(minInterval, intervalMinutes);
    result = Math.min(result, maxInterval);

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

    // Validate numeric values with fallbacks
    const difficulty = isFinite(card.difficulty) ? card.difficulty : 5.0;

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
    return state === "new" ? "New" : "Review";
  }

  private fsrsStateToFlashcardState(state: FSRSState): FlashcardState {
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
   * Get display-friendly interval text (static utility method)
   */
  static getIntervalDisplay(minutes: number): string {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    }

    const hours = minutes / 60;
    if (hours < 24) {
      return `${Math.round(hours)}h`;
    }

    const days = hours / 24;
    if (days < 30) {
      return `${Math.round(days)}d`;
    }

    const months = days / 30;
    if (months < 12) {
      return `${Math.round(months)}mo`;
    }

    const years = months / 12;
    return `${Math.round(years)}y`;
  }
}
