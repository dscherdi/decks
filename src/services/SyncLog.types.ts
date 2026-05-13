// Sync log op types (v=1). Each device's `.deckssynclog` file holds JSONL
// entries with the shape { hlc, s, v, o, p }; this module defines `o` and `p`.
//
// Schema-evolution rule: add new op types under v=1 freely (older clients
// skip unknown `o` values with a warning). Bump `v` only on structural
// changes that older clients cannot safely parse.
//
// Why short keys: typical record is ~150 bytes (vs ~250 for verbose JSON),
// which materially affects how fast iCloud uploads small log files.

import type { HLCValue } from "./HLC";

export interface SyncLogEntryHeader {
  hlc: HLCValue;
  s: number;
  v: 1;
}

export type SyncOpV1 =
  | RateOp
  | RateUndoOp
  | SessionStartOp
  | SessionProgressOp
  | SessionEndOp
  | ProfileUpsertOp
  | ProfileDeleteOp
  | TagMappingUpsertOp
  | TagMappingDeleteOp
  | CustomDeckUpsertOp
  | CustomDeckDeleteOp
  | CustomDeckCardAddOp
  | CustomDeckCardRemoveOp;

export type SyncLogEntry = SyncLogEntryHeader & SyncOpV1;

// ---------- Reviews ---------------------------------------------------------

export interface RateOp {
  o: "rate";
  p: RateOpPayload;
}

/**
 * Reverts a previously-emitted `rate` op. The receiving device looks up the
 * referenced review_log row, copies oldState/oldDueAt/... back onto the
 * flashcard (only if the card's `modified` still matches the log's
 * `reviewedAt` — i.e., no newer change has touched the card in the meantime),
 * then deletes the log row.
 *
 * Emitted by Scheduler.undoLastReview when the original rate op has already
 * been flushed to disk. If the rate is still in the in-memory buffer, the
 * Scheduler drops it from the buffer instead — cleaner outcome since the op
 * never leaves the device.
 */
export interface RateUndoOp {
  o: "rate_undo";
  p: {
    // Points at the review_log row whose pre-state we'll roll the card
    // back to. The id is the same one the original `rate` op carried in
    // `p.log.id`, so receiving devices can correlate them.
    logId: string;
  };
}

export interface RateOpPayload {
  c: string; // card id
  st: number; // new stability
  d: number; // new difficulty
  due: string; // new due date (ISO)
  rep: number; // new repetitions
  lap: number; // new lapses
  state: "new" | "review";
  lastReviewed: string;
  interval: number;
  log: ReviewLogPayload;
}

export interface ReviewLogPayload {
  id: string;
  flashcardId: string;
  sessionId: string | null;
  lastReviewedAt: string;
  shownAt: string | null;
  reviewedAt: string;
  rating: number;
  ratingLabel: "again" | "hard" | "good" | "easy";
  timeElapsedMs: number | null;
  oldState: "new" | "review";
  oldRepetitions: number;
  oldLapses: number;
  oldStability: number;
  oldDifficulty: number;
  newState: "new" | "review";
  newRepetitions: number;
  newLapses: number;
  newStability: number;
  newDifficulty: number;
  oldIntervalMinutes: number;
  newIntervalMinutes: number;
  oldDueAt: string;
  newDueAt: string;
  elapsedDays: number;
  retrievability: number;
  requestRetention: number;
  profile: "STANDARD" | "INTENSIVE";
  maximumIntervalDays: number;
  minMinutes: number;
  fsrsWeightsVersion: string;
  schedulerVersion: string;
  noteModelId: string | null;
  cardTemplateId: string | null;
  contentHash: string | null;
  client: "web" | "desktop" | "mobile" | null;
}

// ---------- Sessions --------------------------------------------------------

export interface SessionStartOp {
  o: "session_start";
  p: {
    id: string;
    deckId: string;
    startedAt: string;
    goalTotal: number;
  };
}

export interface SessionProgressOp {
  o: "session_progress";
  p: {
    id: string;
    doneUnique: number;
  };
}

export interface SessionEndOp {
  o: "session_end";
  p: {
    id: string;
    endedAt: string;
  };
}

// ---------- Profiles --------------------------------------------------------

export interface ProfileUpsertOp {
  o: "profile_upsert";
  p: {
    id: string;
    name: string;
    hasNewCardsLimitEnabled: boolean;
    newCardsPerDay: number;
    hasReviewCardsLimitEnabled: boolean;
    reviewCardsPerDay: number;
    headerLevel: number;
    reviewOrder: "due-date" | "random";
    learningSteps: string;
    relearningSteps: string;
    fsrsRequestRetention: number;
    fsrsProfile: "STANDARD" | "INTENSIVE";
    fsrsUseTrained: boolean;
    clozeEnabled: boolean;
    clozeShowContext: "open" | "hidden";
    isDefault: boolean;
    created: string;
    modified: string;
  };
}

export interface ProfileDeleteOp {
  o: "profile_delete";
  p: {
    id: string;
    deletedAt: string;
  };
}

// ---------- Tag mappings ----------------------------------------------------

export interface TagMappingUpsertOp {
  o: "tag_mapping_upsert";
  p: {
    id: string;
    profileId: string;
    tag: string;
    created: string;
  };
}

export interface TagMappingDeleteOp {
  o: "tag_mapping_delete";
  p: {
    id: string;
    deletedAt: string;
  };
}

// ---------- Custom decks ----------------------------------------------------

export interface CustomDeckUpsertOp {
  o: "custom_deck_upsert";
  p: {
    id: string;
    name: string;
    deckType: string;
    filterDefinition: string | null;
    lastReviewed: string | null;
    created: string;
    modified: string;
  };
}

export interface CustomDeckDeleteOp {
  o: "custom_deck_delete";
  p: {
    id: string;
    deletedAt: string;
  };
}

export interface CustomDeckCardAddOp {
  o: "custom_deck_card_add";
  p: {
    customDeckId: string;
    flashcardId: string;
    created: string;
  };
}

export interface CustomDeckCardRemoveOp {
  o: "custom_deck_card_remove";
  p: {
    customDeckId: string;
    flashcardId: string;
    removedAt: string;
  };
}

// ---------- Type-guard for parsed-but-unvalidated entries -------------------

// All op type names recognized at v=1. Used by the parser to skip unknown
// op types from newer plugin versions with a warning.
export const KNOWN_OP_TYPES_V1: ReadonlySet<SyncOpV1["o"]> = new Set([
  "rate",
  "rate_undo",
  "session_start",
  "session_progress",
  "session_end",
  "profile_upsert",
  "profile_delete",
  "tag_mapping_upsert",
  "tag_mapping_delete",
  "custom_deck_upsert",
  "custom_deck_delete",
  "custom_deck_card_add",
  "custom_deck_card_remove",
]);
