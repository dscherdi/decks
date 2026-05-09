import type { Flashcard } from "@/database/types";

export interface CardHealthThresholds {
  leechThreshold: number;
  denseCardCharThreshold: number;
}

export interface CardHealth {
  isLeech: boolean;
  isDense: boolean;
}

export function computeCardHealth(
  card: Pick<Flashcard, "lapses" | "back">,
  thresholds: CardHealthThresholds
): CardHealth {
  return {
    isLeech: card.lapses >= thresholds.leechThreshold,
    isDense: (card.back?.length ?? 0) >= thresholds.denseCardCharThreshold,
  };
}

export function isCardLeech(
  card: Pick<Flashcard, "lapses">,
  leechThreshold: number
): boolean {
  return card.lapses >= leechThreshold;
}

export function isCardDense(
  card: Pick<Flashcard, "back">,
  denseCardCharThreshold: number
): boolean {
  return (card.back?.length ?? 0) >= denseCardCharThreshold;
}
