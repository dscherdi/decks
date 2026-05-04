import { FSRS, type RatingLabel } from "../src/algorithm/fsrs";
import type { Flashcard } from "../src/database/types";
import type { ReviewRecord, UserData } from "./loadDataset";

const RATING_LABELS: readonly RatingLabel[] = [
  "again",
  "hard",
  "good",
  "easy",
] as const;

export interface PredictionRecord {
  p: number;
  y: 0 | 1;
  elapsedDays: number;
  reviewCount: number;
  lapses: number;
}

export interface ReplayOptions {
  includeSameDay: boolean;
}

const EPOCH_MS = Date.UTC(2020, 0, 1, 12, 0, 0);

function dayOffsetToDate(dayOffset: number): Date {
  return new Date(EPOCH_MS + dayOffset * 86400000);
}

function makeNewFlashcard(): Flashcard {
  return {
    id: "",
    deckId: "",
    front: "",
    back: "",
    type: "header-paragraph",
    sourceFile: "",
    contentHash: "",
    breadcrumb: "",
    notes: "",
    tags: [],
    clozeText: null,
    clozeOrder: null,
    state: "new",
    dueDate: "",
    interval: 0,
    repetitions: 0,
    difficulty: 0,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
    created: "",
    modified: "",
  };
}

function groupByCard(reviews: ReviewRecord[]): Map<string, ReviewRecord[]> {
  const out = new Map<string, ReviewRecord[]>();
  for (const r of reviews) {
    let arr = out.get(r.cardId);
    if (!arr) {
      arr = [];
      out.set(r.cardId, arr);
    }
    arr.push(r);
  }
  return out;
}

export function replayUser(
  user: UserData,
  fsrs: FSRS,
  options: ReplayOptions
): PredictionRecord[] {
  const byCard = groupByCard(user.reviews);
  const predictions: PredictionRecord[] = [];

  for (const reviews of byCard.values()) {
    reviews.sort((a, b) => a.dayOffset - b.dayOffset);
    let card = makeNewFlashcard();

    for (let i = 0; i < reviews.length; i++) {
      const r = reviews[i];
      const now = dayOffsetToDate(r.dayOffset);

      if (i > 0) {
        const elapsed = Math.max(0, r.elapsedDays);
        const p = fsrs.forgettingCurve(elapsed, card.stability);
        const y: 0 | 1 = r.rating === 1 ? 0 : 1;
        const sameDay = elapsed === 0;
        if (!sameDay || options.includeSameDay) {
          predictions.push({
            p,
            y,
            elapsedDays: elapsed,
            reviewCount: i + 1,
            lapses: card.lapses,
          });
        }
      }

      card = fsrs.updateCard(card, RATING_LABELS[r.rating - 1], now);
    }
  }

  return predictions;
}
