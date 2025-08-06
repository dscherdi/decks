export type ReviewOrder = "due-date" | "random";

export interface DeckConfig {
  newCardsLimit: number; // Max new cards per day
  reviewCardsLimit: number; // Max review cards per day
  enableNewCardsLimit: boolean; // Whether to enforce new cards limit
  enableReviewCardsLimit: boolean; // Whether to enforce review cards limit
  reviewOrder: ReviewOrder; // Order for review cards: oldest due first or random
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

export type FlashcardState = "new" | "learning" | "review";

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
  easeFactor: number; // Used to store FSRS difficulty
  stability: number; // FSRS stability value
  lapses: number; // Number of times card was forgotten
  lastReviewed: string | null; // Last review date
  created: string;
  modified: string;
}

export interface ReviewLog {
  id: string;
  flashcardId: string;
  reviewedAt: string;
  difficulty: "again" | "hard" | "good" | "easy";
  oldInterval: number;
  newInterval: number;
  oldEaseFactor: number;
  newEaseFactor: number;
  timeElapsed: number; // Time in milliseconds from card display to difficulty selection
  // Essential state that cannot be calculated
  newState: "new" | "learning" | "review";
  newRepetitions: number;
  newLapses: number;
  newStability: number;
}

export interface DeckStats {
  deckId: string;
  newCount: number;
  learningCount: number;
  dueCount: number;
  totalCount: number;
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
  learning: number;
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
};
