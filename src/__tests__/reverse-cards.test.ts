import type { App } from "obsidian";
import {
  cardFieldDefs,
  deckForChat,
  FlashcardParser,
  generateFlashcardId,
  generateReverseFlashcardId,
  I18n,
} from "@decks/core";
import type { Flashcard } from "../database/types";
import { navigateToFlashcardSource } from "../utils/flashcard-navigator";
import { extractSourceContext } from "../utils/source-context";
import { questionFronts, refactorAsNote, reverseFieldDefs } from "../utils/reverse-card";
import type { RefactorFieldSet, RefactorResult } from "@decks/core";

// The reverse of each card in the note, built the way the synchronizer builds them.
function reverseCards(content: string): Flashcard[] {
  return FlashcardParser.parseFlashcardsFromContent(content, 2, "Note", true, false).map(
    (c) =>
      ({
        id: generateReverseFlashcardId(c.front),
        deckId: "deck_1",
        sourceFile: "Note.md",
        type: c.type,
        front: c.back,
        back: c.front,
        notes: c.notes,
        breadcrumb: c.breadcrumb,
        clozeOrder: null,
        sourceNodeId: null,
      }) as Flashcard,
  );
}

function vaultWith(content: string): { app: App; openedAt: () => number | undefined } {
  const { TFile } = jest.requireActual("../__mocks__/obsidian");
  const file = new TFile("Note.md");
  const openFile = jest.fn(async (_file: unknown, _state?: { eState: { line: number } }) => undefined);
  const leaf = { openFile, view: null };
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (path === "Note.md" ? file : null),
      read: async () => content,
      cachedRead: async () => content,
    },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => leaf,
      setActiveLeaf: () => undefined,
    },
  } as unknown as App;
  return { app, openedAt: () => openFile.mock.calls[0]?.[1]?.eState.line };
}

describe("opening a reverse card in its note", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("opens at its note's card", async () => {
    const note = "## Intro\n\nSome text.\n\n## comer\n\nto eat\n";
    const card = reverseCards(note).find((c) => c.back === "comer")!;
    const { app, openedAt } = vaultWith(note);
    await navigateToFlashcardSource(app, card);
    expect(openedAt()).toBe(4);
  });

  it("opens at its note's card, not at a card whose front reads like it", async () => {
    const note = "## A\n\nB\n\n## B\n\nA\n";
    const [card] = reverseCards(note);
    const { app, openedAt } = vaultWith(note);
    await navigateToFlashcardSource(app, card);
    expect(openedAt()).toBe(0);
  });
});

describe("a reverse card's source context", () => {
  it("is the text around its note's card", async () => {
    const note = "## A\n\nB\n\n## B\n\nA\n";
    const [card] = reverseCards(note);
    const { app } = vaultWith(note);
    expect(await extractSourceContext(app, card, 0)).toBe("1: ## A\n2: \n3: B\n4: ");
  });
});

describe("a reverse card's fields", () => {
  it("swap labels, and the note's heading keeps the front field's single line", () => {
    const ef = I18n.t.modals.editFlashcard;
    expect(reverseFieldDefs(cardFieldDefs("header-paragraph"))).toEqual([
      { label: ef.fieldBody, refKey: "front", isFront: undefined },
      { label: ef.fieldHeader, refKey: "back", isFront: true },
    ]);
    expect(reverseFieldDefs(cardFieldDefs("table")).map((f) => f.label)).toEqual([
      ef.fieldBack,
      ef.fieldFront,
      ef.fieldNotes,
    ]);
  });
});

describe("the questions a deck asks", () => {
  it("leave out a reverse card's front, which is its note's answer", () => {
    const note = "## Hund\n\ndog\n\n## Katze\n\ncat\n";
    const forward = FlashcardParser.parseFlashcardsFromContent(note, 2, "Note", true, false).map(
      (c) => ({ id: generateFlashcardId(c.front), front: c.front }),
    );
    expect(questionFronts([...forward, ...reverseCards(note)])).toEqual(["Hund", "Katze"]);
  });

  it("keep later questions within the chat's cap", () => {
    const range = (from: number, to: number): number[] =>
      Array.from({ length: to - from }, (_, k) => from + k);
    const card = (i: number) => ({ id: generateFlashcardId(`Word ${i}`), front: `Word ${i}` });
    const reverse = (i: number) => ({ id: generateReverseFlashcardId(`Word ${i}`), front: `Meaning ${i}` });
    // Rows come back by creation: a note's cards, their reverses, then cards added later.
    const rows = [
      ...range(0, 100).map(card),
      ...range(0, 100).map(reverse),
      ...range(100, 130).map(card),
      ...range(100, 130).map(reverse),
    ];
    const listed = deckForChat(questionFronts(rows));
    expect(listed).toHaveLength(130);
    expect(listed).toContain("Word 129");
    expect(listed.some((front) => front.startsWith("Meaning"))).toBe(false);
  });
});

describe("an AI rewrite of a reverse card", () => {
  // The note holds "## comer / to eat"; its reverse card asks "to eat" and answers "comer".
  const reverse = { id: generateReverseFlashcardId("comer") };
  const asked: Array<{ current: RefactorFieldSet; targetKeys: string[] | undefined }> = [];
  const model = async (current: RefactorFieldSet, targetKeys: string[] | undefined): Promise<RefactorResult> => {
    asked.push({ current, targetKeys });
    return {
      proposed: { type: "header-paragraph", front: "comer (verb)", back: "to eat" },
      proposals: [{ key: "front", before: "comer", after: "comer (verb)" }],
    };
  };

  beforeEach(() => {
    asked.length = 0;
  });

  it("is asked of its note's card, the way round the note holds it", async () => {
    const result = await refactorAsNote(
      reverse,
      { type: "header-paragraph", front: "to eat", back: "comer" },
      ["back"],
      model,
    );
    expect(asked).toEqual([
      { current: { type: "header-paragraph", front: "comer", back: "to eat" }, targetKeys: ["front"] },
    ]);
    expect(result.proposed).toEqual({ type: "header-paragraph", front: "to eat", back: "comer (verb)" });
    expect(result.proposals).toEqual([{ key: "back", before: "comer", after: "comer (verb)" }]);
  });

  it("leaves any other card's rewrite as it is", async () => {
    const current: RefactorFieldSet = { type: "header-paragraph", front: "comer", back: "to eat" };
    const result = await refactorAsNote({ id: generateFlashcardId("comer") }, current, ["front"], model);
    expect(asked).toEqual([{ current, targetKeys: ["front"] }]);
    expect(result.proposals[0].key).toBe("front");
  });
});
