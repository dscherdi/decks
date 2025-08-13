import { DEFAULT_FSRS_PARAMETERS } from "../algorithm/fsrs-weights";

export type ReviewOrder = "due-date" | "random";

export interface DeckConfig {
  newCardsLimit: number; // Max new cards per day
  reviewCardsLimit: number; // Max review cards per day
  enableNewCardsLimit: boolean; // Whether to enforce new cards limit
  enableReviewCardsLimit: boolean; // Whether to enforce review cards limit
  reviewOrder: ReviewOrder; // Order for review cards: oldest due first or random
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
  headerLevel?: number; // Header level (1-6) for header-paragraph cards, null for table cards
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

export interface ReviewLog {
  id: string;
  flashcardId: string;

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
  newCardsLimit: 20,
  reviewCardsLimit: 100,
  enableNewCardsLimit: false,
  enableReviewCardsLimit: false,
  reviewOrder: "due-date",
  fsrs: {
    requestRetention: DEFAULT_FSRS_PARAMETERS.requestRetention,
    profile: "STANDARD",
  },
};
