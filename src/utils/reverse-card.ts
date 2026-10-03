import { isReverseCardId, type RefactorFieldSet, type RefactorResult } from "@decks/core";
import type { Flashcard } from "../database/types";

/** A reverse card: its note's card read backwards, front and back swapped. */
export function isReverseCard(card: Pick<Flashcard, "id">): boolean {
  return isReverseCardId(card.id);
}

/** The card as its note holds it: a reverse card turned back round, any other as it is. */
export function forwardCard<T extends Pick<Flashcard, "id" | "front" | "back">>(card: T): T {
  return isReverseCard(card) ? { ...card, front: card.back, back: card.front } : card;
}

/** The fronts of the questions a deck asks: a reverse card's front is its note's answer. */
export function questionFronts(cards: ReadonlyArray<Pick<Flashcard, "id" | "front">>): string[] {
  return cards.filter((c) => !isReverseCard(c)).map((c) => c.front);
}

/** A reverse card's fields: front and back trade labels, and the note's heading stays the front field. */
export function reverseFieldDefs<F extends { refKey: string; label: string; isFront?: boolean }>(
  fields: F[],
): F[] {
  const front = fields.find((f) => f.refKey === "front");
  const back = fields.find((f) => f.refKey === "back");
  if (!front || !back) return fields;
  return fields.map((f) => {
    if (f === front) return { ...f, label: back.label, isFront: back.isFront };
    if (f === back) return { ...f, label: front.label, isFront: front.isFront };
    return f;
  });
}

const swapKey = (key: string): string => (key === "front" ? "back" : key === "back" ? "front" : key);

// Only header and table cards have reverse cards; swapping twice gives the set back.
function noteFieldSet(set: RefactorFieldSet): RefactorFieldSet {
  return set.type === "header-paragraph" || set.type === "table"
    ? { ...set, front: set.back, back: set.front }
    : set;
}

/** A rewrite of a reverse card, run on its note's card the way the note holds it and turned back. */
export async function refactorAsNote(
  card: Pick<Flashcard, "id">,
  current: RefactorFieldSet,
  targetKeys: string[] | undefined,
  run: (current: RefactorFieldSet, targetKeys: string[] | undefined) => Promise<RefactorResult>,
): Promise<RefactorResult> {
  if (!isReverseCard(card)) return run(current, targetKeys);
  const result = await run(noteFieldSet(current), targetKeys?.map(swapKey));
  return {
    ...result,
    proposed: noteFieldSet(result.proposed),
    proposals: result.proposals.map((p) => ({ ...p, key: swapKey(p.key) })),
  };
}
