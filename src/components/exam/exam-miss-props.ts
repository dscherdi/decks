import { noteCardOf, type ExamJudge } from "@decks/core";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type { Flashcard } from "../../database/types";

export interface ExamMissHooks {
  onSessionFromMisses: (seed: { pages: number[]; sourceRef: string; sourceHash: string | null }) => void;
  onRepairCards: (cardIds: string[]) => void;
  /** Checks typed answers by meaning; resolves to null when that cannot run. */
  judge?: () => Promise<ExamJudge | null>;
}

export interface ExamMissOrigins {
  pages: Record<string, number | null>;
  cardsByPage: Record<number, number>;
  sourceRef: string;
  sourceHash: string | null;
}

/**
 * The props the results view needs to turn an attempt into work. Built here
 * rather than at each mount: two hosts render this component, and a
 * hand-copied prop list falls behind silently.
 */
export function examMissProps(
  db: Pick<
    IDatabaseService,
    "getAiCardOrigins" | "getAiCardsForSource" | "getFlashcardById" | "getFlashcardsByDeck"
  >,
  hooks?: ExamMissHooks,
) {
  return {
    missOrigins: async (cards: readonly Flashcard[]): Promise<ExamMissOrigins> => {
      // A reverse question cites its note card's page; pages stay keyed by the missed card.
      const noteIds = new Map<string, string>();
      for (const card of cards) {
        const note = await noteCardOf(db, card);
        if (note) noteIds.set(card.id, note.id);
      }
      const origins = await db.getAiCardOrigins([...new Set(noteIds.values())]);
      const pages: Record<string, number | null> = {};
      let sourceHash: string | null = null;
      let sourceRef = "";
      for (const card of cards) {
        const noteId = noteIds.get(card.id);
        const origin = noteId === undefined ? undefined : origins.get(noteId);
        if (!origin) continue;
        pages[card.id] = origin.page;
        if (!sourceHash && origin.sourceHash) {
          sourceHash = origin.sourceHash;
          sourceRef = origin.sourceRef;
        }
      }
      // Study cards over the whole source, not the missed questions: a page with
      // fourteen cards still missed wants repair; one with only questions wants cards.
      const cardsByPage: Record<number, number> = {};
      if (sourceHash) {
        for (const card of await db.getAiCardsForSource(sourceHash, undefined, true)) {
          if (card.page) cardsByPage[card.page] = (cardsByPage[card.page] ?? 0) + 1;
        }
      }
      return { pages, cardsByPage, sourceRef, sourceHash };
    },
    onSessionFromMisses: hooks?.onSessionFromMisses,
    onRepairCards: hooks?.onRepairCards,
    judge: hooks?.judge,
  };
}
