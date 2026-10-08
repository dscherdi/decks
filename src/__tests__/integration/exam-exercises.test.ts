// Exam exercises against the real database: an exercise is one card whose
// questions are its checklists or its sub-headings, recorded per question.

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase, DatabaseTestUtils } from "./database-test-utils";
import { DEFAULT_EXAM_SETTINGS, ExamAttempt, buildExamPool, classifyExamBody, drawExamQuestions } from "@decks/core";

const NOTE = [
  "# Lesen",
  "Ein Übungstest; diese Einleitung gehört zu keiner Karte.",
  "",
  "## Der TV-Koch Stefan Berger",
  "Bei Stefan Berger gibt es Gerichte.",
  "",
  "Die Gäste …",
  "- [ ] finden immer einen Tisch.",
  "- [x] sollen reservieren.",
  "%%Steht im Text.%%",
  "",
  "Er möchte …",
  "- [x] ein Restaurant.",
  "- [ ] zwei.",
  "",
  "## Lesen Teil 2",
  "> [!passage] Apotheke am Markt",
  "> Samstag bis 13 Uhr geöffnet.",
  "",
  "### Wann schließt sie samstags?",
  "- [ ] 18.30",
  "- [x] 13 Uhr",
  "",
  "### Wie heißt die Apotheke?",
  "Apotheke am Markt",
  "",
  "#### Ergänze",
  "Samstags bis ==13== Uhr.",
].join("\n");

describe("exam exercises", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function syncExerciseDeck(): Promise<string> {
    const deck = DatabaseTestUtils.createTestDeck({ id: "deck_goethe", filepath: "goethe.md", tag: "#goethe" });
    await db.createDeck(deck);
    const profile = await db.getDefaultProfile();
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: { ...profile, headerLevel: 2, examEnabled: true },
      fileContent: NOTE,
      examEnabled: true,
    });
    return deck.id;
  }

  it("stores each exercise as one card, never taking in the title's text", async () => {
    const deckId = await syncExerciseDeck();
    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards.map((card) => [card.type, card.front])).toEqual([
      ["multiple-choice", "Der TV-Koch Stefan Berger"],
      ["multiple-choice", "Lesen Teil 2"],
    ]);
    expect(cards.some((card) => card.back.includes("Einleitung"))).toBe(false);
    const second = classifyExamBody(cards[1].back);
    expect(second.kind === "exercise" && second.items.map((item) => item.kind)).toEqual(["choice", "typed", "cloze"]);
  });

  it("asks and records each question of the exercises", async () => {
    const deckId = await syncExerciseDeck();
    const cards = await db.getFlashcardsByDeck(deckId);
    const settings = { ...DEFAULT_EXAM_SETTINGS, shuffleQuestions: false, shuffleOptions: false };
    const pool = buildExamPool(cards, new Map([[deckId, true]]), settings.typedGrading);
    expect(pool.eligible.map((q) => q.kind)).toEqual(["multiple-choice", "multiple-choice", "multiple-choice", "type-in", "type-in"]);
    const attempt = new ExamAttempt({
      questions: drawExamQuestions(pool.eligible, settings),
      settings,
      deckKey: deckId,
      deckKind: "file",
    });
    attempt.setAnswer(0, { kind: "options", selected: [1] });
    attempt.setAnswer(3, { kind: "typed", text: "Apotheke am Markt", selfVerdict: null });
    attempt.setAnswer(4, { kind: "typed", text: "13", selfVerdict: null });
    const result = attempt.finish();
    await db.completeExamSession(result.session, result.answers);

    const rows = await db.querySql<{ ordinal: number; flashcard_id: string; is_correct: number }>(
      "SELECT ordinal, flashcard_id, is_correct FROM exam_answers WHERE session_id = ? ORDER BY ordinal",
      [result.session.id],
      { asObject: true }
    );
    expect(rows.map((row) => row.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(rows.map((row) => row.flashcard_id)).size).toBe(2);
    expect(rows.map((row) => row.is_correct)).toEqual([1, 0, 0, 1, 1]);
  });
});
