import { DEFAULT_FSRS_PARAMETERS } from "../algorithm/fsrs-weights";

export type ReviewOrder = "due-date" | "random";

export interface DeckProfile {
  id: string;
  name: string;

  hasNewCardsLimitEnabled: boolean;
  newCardsPerDay: number;
  hasReviewCardsLimitEnabled: boolean;
  reviewCardsPerDay: number;

  headerLevel: number;

  reviewOrder: ReviewOrder;

  fsrs: {
    requestRetention: number;
    profile: "INTENSIVE" | "STANDARD";
  };

  isDefault: boolean;
  created: string;
  modified: string;
}

export const DEFAULT_PROFILE_ID = 'profile_default';

export const DEFAULT_DECK_PROFILE: Omit<DeckProfile, 'id' | 'created' | 'modified'> = {
  name: 'DEFAULT',
  hasNewCardsLimitEnabled: false,
  newCardsPerDay: 20,
  hasReviewCardsLimitEnabled: false,
  reviewCardsPerDay: 100,
  headerLevel: 2,
  reviewOrder: "due-date",
  fsrs: {
    requestRetention: DEFAULT_FSRS_PARAMETERS.requestRetention,
    profile: "STANDARD",
  },
  isDefault: true,
};

export interface ProfileTagMapping {
  id: string;
  profileId: string;
  tag: string;
  created: string;
}

export interface Deck {
  id: string;
  name: string;
  filepath: string;
  tag: string;
  lastReviewed: string | null;
  profileId: string;
  created: string;
  modified: string;
}

export interface DeckWithProfile extends Deck {
  profile: DeckProfile;
}

export function deckWithProfile(deck: Deck, profile: DeckProfile): DeckWithProfile {
  return {
    ...deck,
    profile,
  };
}

export interface DeckGroup {
  type: 'group';
  tag: string;
  name: string;
  deckIds: string[];
  profile: DeckProfile;
  lastReviewed: string | null;
  created: string;
  modified: string;
}

export interface FileDeck extends DeckWithProfile {
  type: 'file';
}

export type DeckOrGroup = FileDeck | DeckGroup;

export function isDeckGroup(item: DeckOrGroup): item is DeckGroup {
  return item.type === 'group';
}

export function isFileDeck(item: DeckOrGroup): item is FileDeck {
  return item.type === 'file';
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
  breadcrumb: string; // Header hierarchy context (e.g., "Chapter 1 > Section 2")

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
  matureCount: number;
}

export interface AnkiExportConfig {
  noteType: string;
  tags: string[];
  ankiDeckName: string;
  separator: string;
}

export interface DatabaseSchema {
  decks: Deck;
  deckprofiles: DeckProfile;
  profile_tag_mappings: ProfileTagMapping;
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
  total: number;
}

export interface ReviewStats {
  totalReviews: number;
  totalTimeMs: number;
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
  count: number; // Alias for dueCount for backwards compatibility
}

export interface Statistics {
  dailyStats: DailyStats[];
  cardStats: CardStats;
  reviewStats: ReviewStats;
  answerButtons: AnswerButtons;
  retentionRate: number;
  intervals: IntervalData[];
  forecast: ForecastData[];
  averagePace: number; // Average seconds per card
  totalReviewTime: number; // Total time spent reviewing in seconds
}

export interface SimulatedCardState {
  id: string;
  deckId: string;
  state: "new" | "review";
  stability: number;
  difficulty: number;
  dueDate: number; // milliseconds - when card becomes due
  lastReviewedDate: number; // milliseconds - when card was last reviewed (for elapsed time calculation)
  repetitions: number;
  lapses: number;
}

/**
 * Result of maturity progression simulation with equilibrium detection
 */
export interface MaturityProgressionResult {
  dailySnapshots: Array<{
    date: string;
    newCards: number;
    learningCards: number;
    matureCards: number;
  }>;
  maintenanceLevel: number | null; // Percentage (0-100) of total cards in perpetual learning phase
  equilibriumDetectedAt: number | null; // Day index when equilibrium was first detected
  totalCards: number; // Total card count for context
  empiricalLapseRate: number; // Actual lapse rate from button distribution (0-1)
  theoreticalMaintenanceLevel: number | null; // Calculated from lapse rate for validation
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
  flashcard: Flashcard
): "new" | "review" | "mature" {
  if (flashcard.state === "new") {
    return "new";
  }
  return isCardMature(flashcard) ? "mature" : "review";
}
