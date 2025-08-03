export interface Deck {
  id: string;
  name: string;
  tag: string;
  lastReviewed: string | null;
  created: string;
  modified: string;
}

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  type: 'header-paragraph' | 'table';
  sourceFile: string;
  lineNumber: number;
  dueDate: string;
  interval: number;
  repetitions: number;
  easeFactor: number;
  created: string;
  modified: string;
}

export interface ReviewLog {
  id: string;
  flashcardId: string;
  reviewedAt: string;
  difficulty: 'again' | 'hard' | 'good' | 'easy';
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
