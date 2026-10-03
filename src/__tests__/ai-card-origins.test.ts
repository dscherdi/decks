import { generateFlashcardId, generateReverseFlashcardId } from "@decks/core";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { Flashcard } from "../database/types";
import { repairTargets, resolveCardSource } from "../components/review/review-repair-props";
import { examMissProps } from "../components/exam/exam-miss-props";

const FORWARD = generateFlashcardId("Median");
const REVERSE = generateReverseFlashcardId("Median");
const ORIGIN = { page: 61, sourceHash: "h1", sourceRef: "Skripte/L1.pdf" };

function card(id: string, front: string, back: string): Flashcard {
  const now = new Date().toISOString();
  return {
    id,
    deckId: "deck_1",
    front,
    back,
    type: "header-paragraph",
    sourceFile: "Stats.md",
    contentHash: "hash",
    breadcrumb: "",
    notes: "",
    clozeText: null,
    clozeOrder: null,
    anchor: null,
    state: "review",
    dueDate: now,
    interval: 1440,
    repetitions: 3,
    difficulty: 5,
    stability: 2,
    lapses: 4,
    lastReviewed: now,
    created: now,
    modified: now,
  };
}

const forward = card(FORWARD, "Median", "The middle value");
const reverse = card(REVERSE, "The middle value", "Median");
const other = card(generateFlashcardId("Mode"), "Mode", "The most common value");

// The workbench keys a card's origin by the id of the card it wrote: the note's card.
function originsFor(known: string[]) {
  const asked: string[][] = [];
  const rows = [forward, reverse, other];
  const db: Pick<
    IDatabaseService,
    "getAiCardOrigins" | "getAiCardsForSource" | "getFlashcardById" | "getFlashcardsByDeck"
  > = {
    getAiCardOrigins: async (ids) => {
      asked.push([...ids]);
      return new Map(ids.filter((id) => known.includes(id)).map((id) => [id, ORIGIN]));
    },
    getAiCardsForSource: async () => [{ text: "Median", page: 61 }],
    getFlashcardById: async (id) => rows.find((c) => c.id === id) ?? null,
    getFlashcardsByDeck: async (deckId) => rows.filter((c) => c.deckId === deckId),
  };
  return { db, asked };
}

describe("where a reverse card's text came from", () => {
  it("is its note card's page", async () => {
    const { db, asked } = originsFor([FORWARD]);
    expect(await resolveCardSource(db, reverse)).toEqual({ page: 61, path: "Skripte/L1.pdf" });
    expect(asked).toEqual([[FORWARD]]);
  });

  it("is unchanged for a card that is not reversed, and nothing for an unknown card", async () => {
    const { db } = originsFor([FORWARD]);
    expect(await resolveCardSource(db, forward)).toEqual({ page: 61, path: "Skripte/L1.pdf" });
    expect(await resolveCardSource(db, other)).toBeNull();
  });
});

describe("the cards a repair rewrites", () => {
  it("repair a reverse card as its note's card, and that card once", async () => {
    const { db } = originsFor([]);
    expect((await repairTargets(db, [reverse])).map((c) => c.id)).toEqual([FORWARD]);
    expect((await repairTargets(db, [forward, reverse, other])).map((c) => c.id)).toEqual([
      FORWARD,
      other.id,
    ]);
  });

  it("keep a reverse card whose note card is gone", async () => {
    const { db } = originsFor([]);
    const orphan = card(generateReverseFlashcardId("Gone"), "Lost answer", "Gone");
    expect(await repairTargets(db, [orphan])).toEqual([orphan]);
  });
});

describe("the pages an exam's misses came from", () => {
  it("give a missed reverse question its note card's page", async () => {
    const { db, asked } = originsFor([FORWARD]);
    const origins = await examMissProps(db).missOrigins([reverse]);
    expect(origins).toEqual({
      pages: { [REVERSE]: 61 },
      cardsByPage: { 61: 1 },
      sourceRef: "Skripte/L1.pdf",
      sourceHash: "h1",
    });
    expect(asked).toEqual([[FORWARD]]);
  });

  it("look a note card up once when both its directions were missed", async () => {
    const { db, asked } = originsFor([FORWARD]);
    const origins = await examMissProps(db).missOrigins([forward, reverse, other]);
    expect(origins.pages).toEqual({ [FORWARD]: 61, [REVERSE]: 61 });
    expect(asked).toEqual([[FORWARD, other.id]]);
  });
});
