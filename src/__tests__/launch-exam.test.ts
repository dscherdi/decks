import { Notice, type App } from "obsidian";
import {
  DEFAULT_DECK_PROFILE,
  DEFAULT_EXAM_SETTINGS,
  I18n,
  type DeckProfile,
  type ExamSettings,
  type Flashcard,
  type FileDeck,
} from "@decks/core";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import { DEFAULT_SETTINGS } from "@/settings";
import { ExamSetupModal } from "../components/exam/ExamSetupModal";
import { launchExamForSelection } from "../components/exam/launchExam";

jest.mock("obsidian", () => ({
  ...jest.requireActual("../__mocks__/obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../components/exam/ExamSetupModal", () => ({
  ExamSetupModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

const NOW = "2026-10-21T00:00:00.000Z";
const LONG = "Die Natrium-Kalium-Pumpe fällt aus, weil ATP fehlt. ".repeat(4);

let counter = 0;
function card(type: Flashcard["type"], back: string): Flashcard {
  counter++;
  return {
    id: `card_${counter}`,
    deckId: "deck_exam",
    front: `Teilaufgabe ${counter}`,
    back,
    type,
    sourceFile: "Abitur.md",
    contentHash: "hash",
    breadcrumb: "",
    notes: "",
    tags: [],
    hint: "",
    clozeText: null,
    clozeOrder: null,
    state: "new",
    dueDate: NOW,
    interval: 0,
    repetitions: 0,
    difficulty: 5,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
    suspendedAt: null,
    buriedUntil: null,
    created: NOW,
    modified: NOW,
  };
}

function profileWith(exam: ExamSettings): DeckProfile {
  return { ...DEFAULT_DECK_PROFILE, id: "profile_exam", examSettings: exam, created: NOW, modified: NOW };
}

const selection: FileDeck = {
  type: "file",
  id: "deck_exam",
  name: "Abitur",
  filepath: "Abitur.md",
  tag: "#decks/exams/abitur",
  lastReviewed: null,
  profileId: "profile_exam",
  created: NOW,
  modified: NOW,
  profile: profileWith(DEFAULT_EXAM_SETTINGS),
};

const db: Pick<IDatabaseService, "getExamEnabledDeckIds"> = {
  getExamEnabledDeckIds: () => Promise.resolve(["deck_exam"]),
};
const ctx = {
  app: {} as App,
  db: db as IDatabaseService,
  settings: { ...DEFAULT_SETTINGS, ui: { ...DEFAULT_SETTINGS.ui, enableNotices: true } },
};

type SetupArgs = ConstructorParameters<typeof ExamSetupModal>;

async function launch(cards: Flashcard[], typedGrading: ExamSettings["typedGrading"]) {
  const openSession = jest.fn();
  const profile = profileWith({ ...DEFAULT_EXAM_SETTINGS, typedGrading });
  await launchExamForSelection(ctx, selection, profile, () => Promise.resolve(cards), openSession);
  const calls = jest.mocked(ExamSetupModal).mock.calls;
  const setup: SetupArgs | undefined = calls[calls.length - 1];
  return { setup, openSession };
}

beforeEach(() => {
  jest.mocked(ExamSetupModal).mockClear();
  jest.mocked(Notice).mockClear();
});

describe("starting an exam whose typed answers are too long to check", () => {
  it("opens the setup self-graded and says why", async () => {
    const { setup } = await launch([card("header-paragraph", LONG), card("header-paragraph", LONG)], "exact");
    expect(Notice).not.toHaveBeenCalled();
    expect(setup).toBeDefined();
    const [, , eligible, skipped, initial, , , note] = setup!;
    expect(eligible).toBe(2);
    expect(skipped).toBe(0);
    expect(initial.typedGrading).toBe("self");
    expect(note).toBe(I18n.t.exam.needsSelfGrading);
  });

  it("starts the self-graded attempt it offered", async () => {
    const { setup, openSession } = await launch([card("header-paragraph", LONG)], "tolerant");
    const [, , , , initial, onStart] = setup!;
    onStart(initial);
    expect(openSession).toHaveBeenCalledTimes(1);
  });

  it("explains instead of starting when switched back to text matching", async () => {
    const { setup, openSession } = await launch([card("header-paragraph", LONG)], "exact");
    const [, , , , initial, onStart] = setup!;
    onStart({ ...initial, typedGrading: "exact" });
    expect(openSession).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith(I18n.t.exam.needsSelfGrading);
  });

  it("keeps the profile's grading and adds no note when something is gradable", async () => {
    const { setup } = await launch([card("header-paragraph", LONG), card("header-paragraph", "Argon")], "exact");
    const [, , eligible, skipped, initial, , , note] = setup!;
    expect([eligible, skipped]).toEqual([1, 1]);
    expect(initial.typedGrading).toBe("exact");
    expect(note).toBeNull();
  });

  it("still reports an empty selection when no grading can ask anything", async () => {
    const { setup } = await launch([card("image-occlusion", "")], "exact");
    expect(setup).toBeUndefined();
    expect(Notice).toHaveBeenCalledWith(I18n.t.exam.noQuestions);
  });
});
