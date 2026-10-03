import { noteCardOf } from "@decks/core";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type { Flashcard } from "../../database/types";

export interface CardSource {
  page: number;
  path: string;
}

export interface ReviewRepairHooks {
  resolve: (card: Flashcard) => Promise<CardSource | null>;
  read: (source: CardSource) => void;
  fix: (card: Flashcard, source: CardSource) => void;
}

/**
 * The review component's repair prop, built in one place. Two hosts mount that
 * component, and a hand-copied prop list falls behind silently.
 */
export function reviewRepairProps(hooks?: ReviewRepairHooks) {
  return { repair: hooks ?? null };
}

/** The page a card's text came from; a reverse card shares its note card's page. */
export async function resolveCardSource(
  db: Pick<IDatabaseService, "getAiCardOrigins" | "getFlashcardById" | "getFlashcardsByDeck">,
  card: Flashcard,
): Promise<CardSource | null> {
  const note = await noteCardOf(db, card);
  if (!note) return null;
  const origin = (await db.getAiCardOrigins([note.id])).get(note.id);
  if (!origin?.page || !origin.sourceRef) return null;
  return { page: origin.page, path: origin.sourceRef };
}

/** The cards a repair rewrites: a reverse card is repaired as its note's card, each card once. */
export async function repairTargets(
  db: Pick<IDatabaseService, "getFlashcardById" | "getFlashcardsByDeck">,
  cards: readonly Flashcard[],
): Promise<Flashcard[]> {
  const targets: Flashcard[] = [];
  for (const card of cards) {
    const target = (await noteCardOf(db, card)) ?? card;
    if (!targets.some((t) => t.id === target.id)) targets.push(target);
  }
  return targets;
}
