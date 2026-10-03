import type { App, TFile } from "obsidian";
import { DEFAULT_EXAM_SETTINGS, ExamAttempt, type Flashcard } from "@decks/core";
import { persistExamAttempt } from "../components/exam/ExamModalWrapper";
import type { IDatabaseService } from "../database/DatabaseFactory";

const PATH = "Biology.md";

function card(): Flashcard {
  const now = new Date().toISOString();
  return {
    id: "card_q1",
    deckId: "deck_1",
    front: "Powerhouse of the cell?",
    back: "Mitochondria",
    type: "header-paragraph",
    sourceFile: PATH,
    contentHash: "hash",
    breadcrumb: "",
    notes: "",
    tags: [],
    hint: "",
    clozeText: null,
    clozeOrder: null,
    sourceNodeId: null,
    anchor: null,
    state: "new",
    dueDate: now,
    interval: 0,
    repetitions: 0,
    difficulty: 5,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
    created: now,
    modified: now,
  };
}

describe("persistExamAttempt", () => {
  it("stamps an answered card in its note", async () => {
    const { TFile: MockTFile } = jest.requireActual("../__mocks__/obsidian");
    const file: TFile = Object.assign(new MockTFile(PATH), { stat: { mtime: 1, ctime: 1 } });
    let note = "## Powerhouse of the cell?\n\nMitochondria\n";
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => (path === PATH ? file : null),
        cachedRead: async () => note,
        process: async (_file: TFile, edit: (content: string) => string) => (note = edit(note)),
      },
    } as unknown as App;
    const db = {
      completeExamSession: jest.fn(async () => undefined),
      getExamSessionsForDeckKey: jest.fn(async () => []),
      getAnchorBinding: async () => null,
      insertAnchorBindings: async () => undefined,
      setFlashcardAnchor: async () => undefined,
      getFlashcardById: async () => null,
      getDeckWithProfile: async () => ({ id: "deck_1", profile: { headerLevel: 2 } }),
      getDeckLastSyncedMtime: async () => 0,
      setDeckLastSyncedMtime: async () => undefined,
    } as unknown as IDatabaseService;

    const attempt = new ExamAttempt({
      questions: [
        {
          card: card(),
          kind: "typed",
          stem: "Powerhouse of the cell?",
          options: null,
          displayOrder: null,
          expectedAnswer: "Mitochondria",
          isCloze: false,
          clozeContext: null,
        },
      ],
      settings: DEFAULT_EXAM_SETTINGS,
      deckKey: "deck_1",
      deckKind: "file",
    });
    attempt.setAnswer(0, { kind: "typed", text: "Mitochondria", selfVerdict: true });

    await persistExamAttempt(app, db, attempt, attempt.finish());

    expect(note).toMatch(/^## Powerhouse of the cell\?\n\nMitochondria\n\n?%%dk:h:[a-z0-9]+%%/);
  });
});
