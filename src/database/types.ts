import { DEFAULT_FSRS_PARAMETERS } from "../algorithm/fsrs-weights";

export type ReviewOrder = "due-date" | "random";

export interface DeckConfig {
  // Daily limits
  hasNewCardsLimitEnabled: boolean; // false = unlimited new cards
  newCardsPerDay: number; // daily limit when hasNewCardsLimitEnabled is true
  hasReviewCardsLimitEnabled: boolean; // false = unlimited review cards
  reviewCardsPerDay: number; // daily limit when hasReviewCardsLimitEnabled is true

  // Content parsing
  headerLevel: number; // 1-6, which header level to parse for header-paragraph flashcards

  // Review behavior
  reviewOrder: ReviewOrder; // Order for review cards: oldest due first or random

  // FSRS algorithm settings
  fsrs: {
    requestRetention: number;
    profile: "INTENSIVE" | "STANDARD";
  };
}

export interface Deck {
  id: string;
  name: string;
  filepath: string;
  tag: string;
  lastReviewed: string | null;
  config: DeckConfig;
  created: string;
  modified: string;
}

export type FlashcardState = "new" | "review";

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  type: "header-paragraph" | "table";
  sourceFile: string;
  contentHash: string; // Hash of back content only (front is used for ID)

  state: FlashcardState;
  dueDate: string;
  interval: number; // in minutes
  repetitions: number;
  difficulty: number; // FSRS difficulty value (1-10)
  stability: number; // FSRS stability value
  lapses: number; // Number of times card was forgotten
  lastReviewed: string | null; // Last review date
  created: string;
  modified: string;
}

export interface ReviewSession {
  id: string;
  deckId: string;
  startedAt: string; // ISO datetime
  endedAt: string | null; // ISO datetime when user closes session, can be null
  goalTotal: number; // COUNT(dueAt <= now) at session start; if limits defined take Top LimitAmount
  doneUnique: number; // unique number of cards seen
}

export interface ReviewLog {
  id: string;
  flashcardId: string;
  sessionId?: string; // Reference to review session (no cascade delete)

  // Timestamps
  lastReviewedAt: string; // before this review
  shownAt?: string; // when card was shown (optional)
  reviewedAt: string; // when rating was recorded

  // Rating
  rating: 1 | 2 | 3 | 4; // Again=1, Hard=2, Good=3, Easy=4
  ratingLabel: "again" | "hard" | "good" | "easy";
  timeElapsedMs?: number; // if not deriving from shownAt

  // Pre-state (for exact reconstruction)
  oldState: "new" | "review";
  oldRepetitions: number;
  oldLapses: number;
  oldStability: number;
  oldDifficulty: number;

  // Post-state
  newState: "new" | "review"; // will be "review" in pure FSRS
  newRepetitions: number;
  newLapses: number;
  newStability: number;
  newDifficulty: number;

  // Intervals & due times (explicit units)
  oldIntervalMinutes: number;
  newIntervalMinutes: number;
  oldDueAt: string;
  newDueAt: string;

  // Derived at review time
  elapsedDays: number; // (reviewedAt - lastReviewedAt) / 86400000
  retrievability: number; // R

  // Config snapshot
  requestRetention: number;
  profile: "INTENSIVE" | "STANDARD";
  maximumIntervalDays: number;
  minMinutes: number;
  fsrsWeightsVersion: string; // or weightsHash
  schedulerVersion: string;

  // Optional content/context
  noteModelId?: string;
  cardTemplateId?: string;
  contentHash?: string;
  client?: "web" | "desktop" | "mobile";
}

export interface DeckStats {
  deckId: string;
  newCount: number;
  dueCount: number;
  totalCount: number;
}

export interface AnkiExportConfig {
  ankiDeckName: string;
  separator: string;
}

export interface DatabaseSchema {
  decks: Deck;
  flashcards: Flashcard;
  review_logs: ReviewLog;
  review_sessions: ReviewSession;
}

export interface DailyStats {
  date: string;
  reviews: number;
  timeSpent: number;
  newCards: number;
  learningCards: number;
  reviewCards: number;
  correctRate: number;
}

export interface CardStats {
  new: number;
  review: number;
  mature: number;
}

export interface AnswerButtons {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface IntervalData {
  interval: string;
  count: number;
}

export interface ForecastData {
  date: string;
  dueCount: number;
}

export interface Statistics {
  dailyStats: DailyStats[];
  cardStats: CardStats;
  answerButtons: AnswerButtons;
  retentionRate: number;
  intervals: IntervalData[];
  forecast: ForecastData[];
  averagePace: number; // Average seconds per card
  totalReviewTime: number; // Total time spent reviewing in seconds
}

export const DEFAULT_DECK_CONFIG: DeckConfig = {
  hasNewCardsLimitEnabled: false, // unlimited by default
  newCardsPerDay: 20, // default limit when enabled
  hasReviewCardsLimitEnabled: false, // unlimited by default
  reviewCardsPerDay: 100, // default limit when enabled
  headerLevel: 2, // Default to H2 headers
  reviewOrder: "due-date",
  fsrs: {
    requestRetention: DEFAULT_FSRS_PARAMETERS.requestRetention,
    profile: "STANDARD",
  },
};

// Utility functions for daily limits
export function hasNewCardsLimit(config: DeckConfig): boolean {
  return config.hasNewCardsLimitEnabled;
}

export function hasReviewCardsLimit(config: DeckConfig): boolean {
  return config.hasReviewCardsLimitEnabled;
}

/**
 * Determine if a flashcard is mature (interval > 21 days)
 * TODO 19: Mature cards are flashcards that have an interval over 21 days
 */
export function isCardMature(flashcard: Flashcard): boolean {
  const MATURE_THRESHOLD_MINUTES = 21 * 24 * 60; // 21 days in minutes = 30,240
  return (
    flashcard.state === "review" &&
    flashcard.interval > MATURE_THRESHOLD_MINUTES
  );
}

/**
 * Get the card maturity type for classification
 */
export function getCardMaturityType(
  flashcard: Flashcard,
): "new" | "review" | "mature" {
  if (flashcard.state === "new") {
    return "new";
  }
  return isCardMature(flashcard) ? "mature" : "review";
}
