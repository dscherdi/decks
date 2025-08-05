export interface Deck {
  id: string;
  name: string;
  filepath: string;
  tag: string;
  lastReviewed: string | null;
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
  lineNumber: number;
  contentHash: string; // Hash of back content only (front is used for ID)
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
