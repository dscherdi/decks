// What the concept ledger reads back for a source: exam misses and crammed
// cards feed the coverage states, and a session remembers where it saved.

import type { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import { DEFAULT_PROFILE_ID } from "../../database/types";
import type { Flashcard } from "../../database/types";
import {
  encodeAnchorValue,
  generateFlashcardId,
  generateReverseFlashcardId,
  generatedCardId,
  type AiStagedCard,
} from "@decks/core";

// The shared factory, so the app's parity run exercises its own database service.
let db: MainDatabaseService;
beforeEach(async () => {
  db = await setupTestDatabase();
});
afterEach(async () => {
  await teardownTestDatabase();
});

const CARD = { front: "What does the median ignore?", back: "Extreme values", notes: "" };

async function seedSavedCard(db: MainDatabaseService, codes: AiStagedCard["rubricCodes"]): Promise<{ sessionId: string; flashcardId: string }> {
  const flashcardId = generatedCardId(CARD);
  await db.createDeck({
    id: "deck_stats",
    name: "Stats",
    filepath: "Stats cards.md",
    tag: "#decks",
    lastReviewed: null,
    profileId: DEFAULT_PROFILE_ID,
  });
  await db.createFlashcard({
    id: flashcardId,
    deckId: "deck_stats",
    front: CARD.front,
    back: CARD.back,
    type: "header-paragraph",
    sourceFile: "Stats cards.md",
    contentHash: "h",
    breadcrumb: "",
    notes: "",
    tags: [],
    clozeText: null,
    clozeOrder: null,
    state: "new",
    dueDate: "2030-01-01T00:00:00Z",
    interval: 0,
    repetitions: 0,
    difficulty: 5,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
  } as Omit<Flashcard, "created" | "modified">);
  const sessionId = await db.createAiSession({
    sourceKind: "pdf",
    sourceRef: "Stats.pdf",
    sourceHash: "h1",
    selectedIds: [],
    deckId: null,
    profileId: null,
    model: null,
    spendCents: 0,
    turns: [],
    archived: false,
  });
  await db.createAiStagedCards([
    {
      id: `${sessionId}:r1`,
      sessionId,
      ...CARD,
      cardType: "basic",
      options: null,
      correct: null,
      explanation: null,
      valid: null,
      sourcePage: 4,
      sectionIdx: null,
      conceptId: null,
      status: "saved",
      rubricVerdict: codes.length > 0 ? "flagged" : "pass",
      rubricCodes: codes,
      fixProposal: null,
      parentId: null,
      origin: "generate",
      dedupHash: flashcardId,
    },
  ]);
  return { sessionId, flashcardId };
}

async function missInExam(db: MainDatabaseService, flashcardId: string, ordinal = 1): Promise<void> {
  await db.executeSql(
    `INSERT INTO exam_answers
       (id, session_id, flashcard_id, ordinal, question_type, grading_method,
        prompt, correct_answer, given_answer, is_correct, time_ms, created)
     VALUES (?, 'ex1', ?, ?, 'typed', 'exact', 'q', 'a', 'b', 0, NULL, '2030-01-02T00:00:00Z')`,
    [`ex1:${ordinal}`, flashcardId, ordinal]
  );
}

describe("AI workbench ledger cards", () => {
  it("counts a saved card's exam misses", async () => {
    const { sessionId, flashcardId } = await seedSavedCard(db, []);
    expect((await db.getAiCardsForSource("h1"))[0].examMisses).toBe(0);
    await missInExam(db, flashcardId);
    const [card] = await db.getAiCardsForSource("h1");
    expect(card.examMisses).toBe(1);
    expect(card.flashcardId).toBe(flashcardId);
    expect(card.id).toBe(`${sessionId}:r1`);
  });

  it("marks a card the critique found carrying several facts", async () => {
    await seedSavedCard(db, ["enumeration"]);
    expect((await db.getAiCardsForSource("h1"))[0].crammed).toBe(true);
  });

  it("leaves a card with no such code unmarked", async () => {
    await seedSavedCard(db, []);
    expect((await db.getAiCardsForSource("h1"))[0].crammed).toBe(false);
  });

  it("keeps the remembered deck when a later write carries none", async () => {
    const { sessionId } = await seedSavedCard(db, []);
    await db.updateAiSession(sessionId, { deckId: "deck_stats", profileId: DEFAULT_PROFILE_ID });
    await db.updateAiSession(sessionId, { deckId: undefined, selectedIds: ["ch-2"] });
    const session = await db.getAiSession(sessionId);
    expect(session?.deckId).toBe("deck_stats");
    expect(session?.profileId).toBe(DEFAULT_PROFILE_ID);
    expect(session?.selectedIds).toEqual(["ch-2"]);
  });
});

describe("a reverse card in the ledger", () => {
  const MEDIAN = CARD;
  // A mirrored pair: Mirror B's note card reads exactly like Mirror A's reverse card.
  const MIRROR_A = { front: "Mirror A", back: "Mirror B", notes: "" };
  const MIRROR_B = { front: "Mirror B", back: "Mirror A", notes: "" };

  async function seedReverseNote(
    fileContent = [MEDIAN, MIRROR_A, MIRROR_B].map((c) => `## ${c.front}\n\n${c.back}\n`).join("\n"),
    staged: Array<typeof MEDIAN & { dedupHash?: string }> = [MEDIAN, MIRROR_A, MIRROR_B],
  ): Promise<void> {
    const profile = await db.getDefaultProfile();
    await db.createDeck({ id: "deck_rev", name: "Rev", filepath: "Rev.md", tag: "#decks", lastReviewed: null, profileId: profile.id });
    await db.syncFlashcardsForDeck({
      deckId: "deck_rev",
      deckName: "Rev",
      deckFilepath: "Rev.md",
      deckConfig: profile,
      fileContent,
      reverseCards: true,
    });
    const sessionId = await db.createAiSession({
      sourceKind: "pdf",
      sourceRef: "Stats.pdf",
      sourceHash: "h1",
      selectedIds: [],
      deckId: null,
      profileId: null,
      model: null,
      spendCents: 0,
      turns: [],
      archived: false,
    });
    await db.createAiStagedCards(
      staged.map(({ dedupHash, ...card }, i) => ({
        id: `${sessionId}:r${i + 1}`,
        sessionId,
        ...card,
        cardType: "basic" as const,
        options: null,
        correct: null,
        explanation: null,
        valid: null,
        sourcePage: 4,
        sectionIdx: null,
        conceptId: null,
        status: "saved" as const,
        rubricVerdict: "pass" as const,
        rubricCodes: [],
        fixProposal: null,
        parentId: null,
        origin: "generate" as const,
        dedupHash: dedupHash ?? generatedCardId(card),
      }))
    );
  }

  const lapses = (id: string, count: number) =>
    db.executeSql("UPDATE flashcards SET lapses = ? WHERE id = ?", [count, id]);

  it("counts the reverse card's lapses and wrong answers on its note card", async () => {
    await seedReverseNote();
    await lapses(generatedCardId(MEDIAN), 1);
    await lapses(generateReverseFlashcardId(MEDIAN.front), 2);
    await missInExam(db, generateReverseFlashcardId(MEDIAN.front));

    const rows = await db.getAiCardsForSource("h1");
    expect(rows).toHaveLength(3);
    const median = rows.find((r) => r.front === MEDIAN.front);
    expect(median).toMatchObject({ lapses: 3, examMisses: 1, flashcardId: generatedCardId(MEDIAN) });
  });

  it("does not hand one note's record to the note that mirrors it", async () => {
    await seedReverseNote();
    // Mirror B's note card reads exactly like Mirror A's reverse card, but is not one.
    await lapses(generatedCardId(MIRROR_B), 5);
    await missInExam(db, generatedCardId(MIRROR_B));

    const rows = await db.getAiCardsForSource("h1");
    expect(rows.find((r) => r.front === MIRROR_A.front)).toMatchObject({ lapses: 0, examMisses: 0 });
    expect(rows.find((r) => r.front === MIRROR_B.front)).toMatchObject({ lapses: 5, examMisses: 1 });
  });

  it("pairs a pasted copy's reverse card with the copy, not with the note whose token it copied", async () => {
    // The note kept its token's ids after its heading was edited; a pasted copy falls back to content ids.
    const ids = [generateFlashcardId("Earlier Q"), generateReverseFlashcardId("Earlier Q")];
    const token = `%%dk:h:${encodeAnchorValue("b", ids)}%%`;
    const block = `## Q\n\nA\n${token}\n`;
    const note = { front: "Q", back: "A", notes: "" };
    await seedReverseNote(`${block}\n${block}`, [{ ...note, dedupHash: ids[0] }]);
    await lapses(ids[1], 2);
    await lapses(generateReverseFlashcardId("Q"), 4);
    await missInExam(db, generateReverseFlashcardId("Q"));

    const [row] = await db.getAiCardsForSource("h1");
    expect(row).toMatchObject({ flashcardId: ids[0], lapses: 2, examMisses: 0 });
  });
});

describe("AI workbench triage from the hub", () => {
  it("a card kept over its flag leaves the queue and keeps the reason it was flagged", async () => {
    const { sessionId } = await seedSavedCard(db, []);
    await db.createAiStagedCards([
      {
        id: `${sessionId}:r2`,
        sessionId,
        front: "Name the three measures of spread.",
        back: "Range, IQR, SD",
        notes: "",
        cardType: "basic",
        options: null,
        correct: null,
        explanation: null,
        valid: null,
        sourcePage: 6,
        sectionIdx: null,
        conceptId: null,
        status: "kept",
        rubricVerdict: "flagged",
        rubricCodes: ["enumeration"],
        fixProposal: null,
        parentId: null,
        origin: "generate",
        dedupHash: null,
      },
    ]);
    expect((await db.getFlaggedAiStagedCards()).map((c) => c.id)).toEqual([`${sessionId}:r2`]);
    expect((await db.getAiSessionCounts())[sessionId].flagged).toBe(1);

    await db.updateAiStagedCard(`${sessionId}:r2`, { rubricVerdict: "pass" });

    expect(await db.getFlaggedAiStagedCards()).toEqual([]);
    const counts = (await db.getAiSessionCounts())[sessionId];
    expect(counts.flagged).toBe(0);
    expect([counts.firstPage, counts.lastPage]).toEqual([4, 6]);
    const card = (await db.getAiStagedCards(sessionId)).find((c) => c.id === `${sessionId}:r2`);
    expect(card?.rubricCodes).toEqual(["enumeration"]);
    expect(card?.status).toBe("kept");
  });
});
