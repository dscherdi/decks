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
