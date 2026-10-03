import { FlashcardWriter } from "../services/FlashcardWriter";
import { FlashcardParser, generateReverseFlashcardId, I18n } from "@decks/core";
import type { Flashcard } from "../database/types";

interface MockApp {
  vault: {
    getAbstractFileByPath: (path: string) => { path: string } | null;
    process: (
      file: { path: string },
      fn: (content: string) => string,
    ) => Promise<string>;
  };
}

class TFileLike {
  constructor(public path: string) {}
}
// Bridge the writer's runtime `instanceof TFile` to our test class.
jest.mock("obsidian", () => {
  const actual = jest.requireActual("../__mocks__/obsidian");
  return actual;
});

function mockApp(path: string, content: string): {
  app: MockApp;
  currentContent: () => string;
} {
  let stored = content;
  const file = new TFileLike(path);
  const { TFile } = jest.requireActual("../__mocks__/obsidian");
  // Make our file an instance of the mocked TFile.
  Object.setPrototypeOf(file, TFile.prototype);
  return {
    app: {
      vault: {
        getAbstractFileByPath: (p: string) => (p === path ? file : null),
        process: async (
          _file: { path: string },
          fn: (c: string) => string,
        ) => {
          stored = fn(stored);
          return stored;
        },
      },
    },
    currentContent: () => stored,
  };
}

function makeCard(partial: Partial<Flashcard>): Flashcard {
  return {
    id: "card_1",
    deckId: "deck_1",
    front: "",
    back: "",
    type: "header-paragraph",
    sourceFile: "test.md",
    contentHash: "hash",
    breadcrumb: "",
    notes: "",
    tags: [],
    clozeText: null,
    clozeOrder: null,
    sourceNodeId: null,
    state: "new",
    dueDate: new Date().toISOString(),
    interval: 0,
    repetitions: 0,
    difficulty: 5,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    ...partial,
  };
}

describe("FlashcardWriter", () => {
  describe("multiple-choice", () => {
    it("edits like a header card and carries the q token with its blank line", async () => {
      const source =
        "## Noble gas?\n- [ ] Oxygen\n- [x] Argon\n\n%%dk:q:ab12%%\n## Next\nother";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Noble gas?",
        back: "- [ ] Oxygen\n- [x] Argon",
        type: "multiple-choice",
      });
      const result = await writer.editFlashcard(card, {
        type: "multiple-choice",
        front: "Which is the noble gas?",
        back: "- [ ] Oxygen\n- [x] Argon\n- [ ] Chlorine",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toContain("## Which is the noble gas?");
      // Re-appended after the new body, blank-line separated.
      expect(currentContent()).toContain("- [ ] Chlorine\n\n%%dk:q:ab12%%");
      expect(currentContent().match(/%%dk:q:/g)).toHaveLength(1);
    });
  });

  describe("header-paragraph", () => {
    it("rewrites the header text and body", async () => {
      const source = "# Top\n## Question?\nold answer\n## Next\nother";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Question?",
        back: "old answer",
        type: "header-paragraph",
        breadcrumb: "Top",
      });
      const result = await writer.editFlashcard(card, {
        type: "header-paragraph",
        front: "Rephrased?",
        back: "new answer",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toBe(
        "# Top\n## Rephrased?\nnew answer\n## Next\nother",
      );
    });

    it("preserves trailing #tags on the header line", async () => {
      const source = "## Q? #review #important\nbody";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q?",
        back: "body",
        type: "header-paragraph",
        breadcrumb: "",
      });
      const result = await writer.editFlashcard(card, {
        type: "header-paragraph",
        front: "New Q?",
        back: "body",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toBe("## New Q? #review #important\nbody");
    });

    it("returns file_changed when the source body no longer matches", async () => {
      const { app } = mockApp("test.md", "## Q\ncurrent body");
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q",
        back: "stale body",
        type: "header-paragraph",
      });
      const result = await writer.editFlashcard(card, {
        type: "header-paragraph",
        front: "Q",
        back: "any",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("file_changed");
    });

    it("returns card_not_found when header doesn't exist", async () => {
      const { app } = mockApp("test.md", "## Other\nbody");
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Missing",
        back: "anything",
        type: "header-paragraph",
      });
      const result = await writer.editFlashcard(card, {
        type: "header-paragraph",
        front: "x",
        back: "y",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("card_not_found");
    });

    it("rejects an empty front", async () => {
      const { app } = mockApp("test.md", "## Q\nbody");
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({ front: "Q", back: "body", type: "header-paragraph" });
      const result = await writer.editFlashcard(card, {
        type: "header-paragraph",
        front: "",
        back: "y",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("invalid_edit");
    });
  });

  describe("table", () => {
    const tableSource =
      "## Vocab\n| Front | Back | Notes |\n|---|---|---|\n| Q1 | A1 | n1 |\n| Q2 | A2 | n2 |";

    it.each([
      ["front cell", { front: "  ", back: "A2" }, "frontEmpty"],
      ["back cell", { front: "Q2", back: "" }, "backEmpty"],
      ["back column of a template row", { front: "Q2", back: "A2", columns: ["Q2", " ", "n2"] }, "backEmpty"],
    ] as const)("refuses an edit that empties the %s, which would drop the row", async (_cell, sides, message) => {
      const { app, currentContent } = mockApp("test.md", tableSource);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q2",
        back: "A2",
        notes: "n2",
        type: "table",
        breadcrumb: "Vocab",
      });
      const result = await writer.editFlashcard(card, {
        type: "table",
        notes: "n2",
        ...sides,
        columns: "columns" in sides ? [...sides.columns] : undefined,
      });
      expect(result).toEqual({
        ok: false,
        failure: { code: "invalid_edit", message: I18n.t.cardEdit[message] },
      });
      expect(currentContent()).toBe(tableSource);
    });

    it("rewrites Front/Back/Notes on a 3-column row", async () => {
      const { app, currentContent } = mockApp("test.md", tableSource);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q2",
        back: "A2",
        notes: "n2",
        type: "table",
        breadcrumb: "Vocab",
      });
      const result = await writer.editFlashcard(card, {
        type: "table",
        front: "Q2 new",
        back: "A2 new",
        notes: "n2 new",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toContain("| Q2 new | A2 new | n2 new |");
      // Other rows unchanged
      expect(currentContent()).toContain("| Q1 | A1 | n1 |");
    });

    it("adds a Notes column when notes are set on a 2-column table", async () => {
      const source =
        "## Vocab\n| Front | Back |\n| --- | --- |\n| Q1 | A1 |\n| Q2 | A2 |";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q1",
        back: "A1",
        type: "table",
        breadcrumb: "Vocab",
      });
      const result = await writer.editFlashcard(card, {
        type: "table",
        front: "Q1",
        back: "A1",
        notes: "a note",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toBe(
        "## Vocab\n| Front | Back | Notes |\n| --- | --- | --- |\n| Q1 | A1 | a note |\n| Q2 | A2 |  |",
      );
    });

    it("escapes pipes/newlines in the note when adding a Notes column", async () => {
      const source = "## Vocab\n| Front | Back |\n| --- | --- |\n| Q1 | A1 |";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q1",
        back: "A1",
        type: "table",
        breadcrumb: "Vocab",
      });
      const result = await writer.editFlashcard(card, {
        type: "table",
        front: "Q1",
        back: "A1",
        notes: "x|y\nz",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toContain("| Q1 | A1 | x\\|y<br>z |");
    });

    it("escapes pipes as \\| in cell content", async () => {
      const { app, currentContent } = mockApp("test.md", tableSource);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q1",
        back: "A1",
        notes: "n1",
        type: "table",
        breadcrumb: "Vocab",
      });
      const result = await writer.editFlashcard(card, {
        type: "table",
        front: "a|b",
        back: "c|d",
        notes: "e|f",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toContain("| a\\|b | c\\|d | e\\|f |");
      // Other rows are not corrupted by the escape.
      expect(currentContent()).toContain("| Q2 | A2 | n2 |");
    });

    it("escapes newlines as <br> so the row stays single-line", async () => {
      const { app, currentContent } = mockApp("test.md", tableSource);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q1",
        back: "A1",
        notes: "n1",
        type: "table",
        breadcrumb: "Vocab",
      });
      const result = await writer.editFlashcard(card, {
        type: "table",
        front: "Q1",
        back: "line1\nline2",
        notes: "n1",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toContain("| Q1 | line1<br>line2 | n1 |");
      // Row is still on a single line — the table structure is intact.
      const rows = currentContent()
        .split("\n")
        .filter((l: string) => l.trim().startsWith("|"));
      expect(rows.length).toBe(4); // header, separator, row1, row2
    });
  });

  describe("cloze", () => {
    it("rewrites a header-hosted cloze sentence", async () => {
      const source = "## Pacific?\nThe ==Pacific== is the largest ocean.";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Pacific?",
        back: "The ==Pacific== is the largest ocean.",
        type: "cloze",
        clozeText: "Pacific",
        clozeOrder: 0,
      });
      const result = await writer.editFlashcard(card, {
        type: "cloze",
        front: "Pacific?",
        sentence: "The ==Pacific Ocean== is the biggest body of water.",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toBe(
        "## Pacific?\nThe ==Pacific Ocean== is the biggest body of water.",
      );
    });

    it("also rewrites the header (front) when edited", async () => {
      const source = "## Pacific?\nThe ==Pacific== is the largest ocean.";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Pacific?",
        back: "The ==Pacific== is the largest ocean.",
        type: "cloze",
        clozeText: "Pacific",
        clozeOrder: 0,
      });
      const result = await writer.editFlashcard(card, {
        type: "cloze",
        front: "Largest ocean?",
        sentence: "The ==Pacific== is the largest ocean.",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toBe(
        "## Largest ocean?\nThe ==Pacific== is the largest ocean.",
      );
    });

    it("rejects a sentence with no ==span==", async () => {
      const source = "## Pacific?\nThe ==Pacific== is the largest ocean.";
      const { app } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Pacific?",
        back: "The ==Pacific== is the largest ocean.",
        type: "cloze",
        clozeText: "Pacific",
        clozeOrder: 0,
      });
      const result = await writer.editFlashcard(card, {
        type: "cloze",
        front: "Pacific?",
        sentence: "No marks here",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("invalid_edit");
    });
  });

  describe("image-occlusion", () => {
    it("rewrites the Nth list item, preserving prefix and image", async () => {
      const source =
        "## Diagram\n![[brain.png]]\n1. ==Hippocampus==\n2. ==Amygdala==\n3. ==Thalamus==";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "![[brain.png]]",
        back: "1. ==Hippocampus==\n2. ==Amygdala==\n3. ==Thalamus==",
        type: "image-occlusion",
        breadcrumb: "Diagram",
        clozeText: "Amygdala",
        clozeOrder: 1,
      });
      const result = await writer.editFlashcard(card, {
        type: "image-occlusion",
        listItem: "==Lateral amygdala==",
      });
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toBe(
        "## Diagram\n![[brain.png]]\n1. ==Hippocampus==\n2. ==Lateral amygdala==\n3. ==Thalamus==",
      );
    });

    it("returns file_changed when the stored cloze text doesn't match the source", async () => {
      const source =
        "## Diagram\n![[brain.png]]\n1. ==Hippocampus==\n2. ==Amygdala==";
      const { app } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "![[brain.png]]",
        type: "image-occlusion",
        breadcrumb: "Diagram",
        clozeText: "Stale value",
        clozeOrder: 1,
      });
      const result = await writer.editFlashcard(card, {
        type: "image-occlusion",
        listItem: "anything",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("file_changed");
    });
  });

  describe("splitFlashcard", () => {
    it("splits a header-paragraph card into multiple blocks in place", async () => {
      const source = "# Top\n## Question?\nold answer\n## Next\nother";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Question?",
        back: "old answer",
        type: "header-paragraph",
        breadcrumb: "Top",
      });
      const result = await writer.splitFlashcard(card, [
        { type: "header-paragraph", front: "Q1", back: "a1" },
        { type: "header-paragraph", front: "Q2", back: "a2" },
      ]);
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toBe(
        "# Top\n## Q1\na1\n\n## Q2\na2\n## Next\nother",
      );
    });

    it("splits a table row into multiple rows under the same table", async () => {
      const source =
        "## Vocab\n| Front | Back | Notes |\n|---|---|---|\n| Q1 | A1 | n1 |\n| Q2 | A2 | n2 |";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q1",
        back: "A1",
        notes: "n1",
        type: "table",
        breadcrumb: "Vocab",
      });
      const result = await writer.splitFlashcard(card, [
        { type: "table", front: "Qa", back: "Aa", notes: "na" },
        { type: "table", front: "Qb", back: "Ab", notes: "nb" },
      ]);
      expect(result).toEqual({ ok: true });
      const content = currentContent();
      expect(content).toContain("| Qa | Aa | na |");
      expect(content).toContain("| Qb | Ab | nb |");
      // The original Q1 row is replaced; Q2 is untouched.
      expect(content).not.toContain("| Q1 | A1 | n1 |");
      expect(content).toContain("| Q2 | A2 | n2 |");
      // Still a single table (no extra blank lines splitting it).
      const rows = content
        .split("\n")
        .filter((l: string) => l.trim().startsWith("|"));
      expect(rows.length).toBe(5); // header, separator, Qa, Qb, Q2
    });

    it("splits a header-hosted cloze card into multiple blocks", async () => {
      const source = "## Topic\nThe ==a== and ==b== facts.";
      const { app, currentContent } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Topic",
        back: "The ==a== and ==b== facts.",
        type: "cloze",
        clozeText: "a",
        clozeOrder: 0,
      });
      const result = await writer.splitFlashcard(card, [
        { type: "cloze", front: "Topic A", sentence: "The ==a== fact." },
        { type: "cloze", front: "Topic B", sentence: "The ==b== fact." },
      ]);
      expect(result).toEqual({ ok: true });
      expect(currentContent()).toBe(
        "## Topic A\nThe ==a== fact.\n\n## Topic B\nThe ==b== fact.",
      );
    });

    it("returns file_changed when the source no longer matches", async () => {
      const { app } = mockApp("test.md", "## Q\ncurrent body");
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Q",
        back: "stale body",
        type: "header-paragraph",
      });
      const result = await writer.splitFlashcard(card, [
        { type: "header-paragraph", front: "Q1", back: "a1" },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("file_changed");
    });

    it("rejects an empty edit list", async () => {
      const { app } = mockApp("test.md", "## Q\nbody");
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({ front: "Q", back: "body", type: "header-paragraph" });
      const result = await writer.splitFlashcard(card, []);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("invalid_edit");
    });

    it("rejects a split card whose type differs from the source card", async () => {
      const { app } = mockApp("test.md", "## Q\nbody");
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({ front: "Q", back: "body", type: "header-paragraph" });
      const result = await writer.splitFlashcard(card, [
        { type: "table", front: "Q", back: "body", notes: "" },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("invalid_edit");
    });

    it("refuses to split unsupported (image-occlusion) card types", async () => {
      const source =
        "## Diagram\n![[brain.png]]\n1. ==Hippocampus==\n2. ==Amygdala==";
      const { app } = mockApp("test.md", source);
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "![[brain.png]]",
        type: "image-occlusion",
        breadcrumb: "Diagram",
        clozeText: "Amygdala",
        clozeOrder: 1,
      });
      const result = await writer.splitFlashcard(card, [
        { type: "image-occlusion", listItem: "==a==" },
        { type: "image-occlusion", listItem: "==b==" },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("invalid_edit");
    });
  });

  it("returns file_missing when path does not resolve", async () => {
    const writer = new FlashcardWriter({
      vault: {
        getAbstractFileByPath: () => null,
        process: async () => "",
      },
    } as never);
    const card = makeCard({ sourceFile: "gone.md", front: "x", back: "y" });
    const result = await writer.editFlashcard(card, {
      type: "header-paragraph",
      front: "x",
      back: "y",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("file_missing");
  });

  it("returns invalid_edit when edit type doesn't match card type", async () => {
    const { app } = mockApp("test.md", "## Q\nbody");
    const writer = new FlashcardWriter(app as never);
    const card = makeCard({ front: "Q", back: "body", type: "header-paragraph" });
    const result = await writer.editFlashcard(card, {
      type: "table",
      front: "Q",
      back: "body",
      notes: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("invalid_edit");
  });

  describe("anchor token preservation", () => {
    it("edits a stamped header card and keeps its own-line h token", async () => {
      const { app, currentContent } = mockApp(
        "test.md",
        "## Question\n\nOld body.\n%%dk:h:x7f2%%\n",
      );
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({ front: "Question", back: "Old body." });
      const result = await writer.editFlashcard(card, {
        type: "header-paragraph",
        front: "Question",
        back: "New body.",
      });

      expect(result.ok).toBe(true);
      expect(currentContent()).toContain("New body.\n%%dk:h:x7f2%%");
      expect((currentContent().match(/%%dk:h:/g) ?? []).length).toBe(1);
    });

    it("re-attaches cloze line tokens to unchanged lines", async () => {
      const { app, currentContent } = mockApp(
        "test.md",
        "## Facts\n\nThe ==sun== is a star. %%dk:c:aa11%%\nOld second line.\n",
      );
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "Facts",
        back: "The ==sun== is a star.\nOld second line.",
        type: "cloze",
        clozeText: "sun",
        clozeOrder: 0,
      });
      const result = await writer.editFlashcard(card, {
        type: "cloze",
        front: "Facts",
        sentence: "The ==sun== is a star.\nEdited second line.",
      });

      expect(result.ok).toBe(true);
      expect(currentContent()).toContain("The ==sun== is a star. %%dk:c:aa11%%");
      expect(currentContent()).toContain("Edited second line.");
    });

    it("edits a stamped table row and keeps its t token in the first cell", async () => {
      const { app, currentContent } = mockApp(
        "test.md",
        "## Vocab\n\n| Front | Back |\n|---|---|\n| chat %%dk:t:bb22%% | cat |\n",
      );
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "chat",
        back: "cat",
        type: "table",
        breadcrumb: "Vocab",
      });
      const result = await writer.editFlashcard(card, {
        type: "table",
        front: "chatte",
        back: "female cat",
        notes: "",
      });

      expect(result.ok).toBe(true);
      expect(currentContent()).toContain("| chatte %%dk:t:bb22%% | female cat |");
    });

    it("edits a stamped occlusion item and keeps its o token", async () => {
      const { app, currentContent } = mockApp(
        "test.md",
        "## Anatomy\n\n![[skeleton.png]]\n1. ==Femur== %%dk:o:cc33%%\n2. ==Tibia==\n",
      );
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({
        front: "![[skeleton.png]]",
        back: "1. ==Femur==\n2. ==Tibia==",
        type: "image-occlusion",
        breadcrumb: "Anatomy",
        clozeText: "Femur",
        clozeOrder: 0,
      });
      const result = await writer.editFlashcard(card, {
        type: "image-occlusion",
        listItem: "==Thigh bone==",
      });

      expect(result.ok).toBe(true);
      expect(currentContent()).toContain("1. ==Thigh bone== %%dk:o:cc33%%");
    });

    it("keeps the token only in the first group when splitting", async () => {
      const { app, currentContent } = mockApp(
        "test.md",
        "## Question\n\nBody text.\n%%dk:h:dd44%%\n",
      );
      const writer = new FlashcardWriter(app as never);
      const card = makeCard({ front: "Question", back: "Body text." });
      const result = await writer.splitFlashcard(card, [
        { type: "header-paragraph", front: "Question", back: "Part one." },
        { type: "header-paragraph", front: "Question 2", back: "Part two." },
      ]);

      expect(result.ok).toBe(true);
      expect((currentContent().match(/%%dk:h:/g) ?? []).length).toBe(1);
      expect(currentContent()).toContain("Part one.\n%%dk:h:dd44%%");
      expect(currentContent()).not.toContain("Part two.\n%%dk:h:dd44%%");
    });
  });
});

// Cards here come from the real parser: a hand-built card would hide how it
// splits a headed card's body into back and notes.
describe("FlashcardWriter on cards that carry notes", () => {
  const QUESTION = `# Note

## Which element is a noble gas?

- [ ] Oxygen
- [x] Argon
- [ ] Nitrogen

%%Group 18 elements have a full valence shell.%%

## Next question

Something else.
`;

  function parse(content: string, examEnabled = false): Flashcard[] {
    return FlashcardParser.parseFlashcardsFromContent(content, 2, "Note", true, examEnabled).map(
      (c) =>
        makeCard({
          front: c.front,
          back: c.back,
          notes: c.notes,
          type: c.type,
          breadcrumb: c.breadcrumb,
        }),
    );
  }

  async function edit(content: string, card: Flashcard, front: string, back: string) {
    const { app, currentContent } = mockApp("test.md", content);
    const writer = new FlashcardWriter(app as never);
    const type = card.type === "multiple-choice" ? "multiple-choice" : "header-paragraph";
    const result = await writer.editFlashcard(card, { type, front, back });
    return { result, content: currentContent() };
  }

  it("edits a question that carries an explanation", async () => {
    const [card] = parse(QUESTION, true);
    expect(card.type).toBe("multiple-choice");
    expect(card.notes).toBe("Group 18 elements have a full valence shell.");

    const { result, content } = await edit(QUESTION, card, "Which of these is a noble gas?", card.back);
    expect(result).toEqual({ ok: true });
    expect(content).toContain("## Which of these is a noble gas?");
    expect(content).toContain("- [ ] Nitrogen\n\n%%Group 18 elements have a full valence shell.%%");
    const [again] = parse(content, true);
    expect(again.type).toBe("multiple-choice");
    expect(again.notes).toBe(card.notes);
  });

  it("keeps a headed card's comment when its answer is rewritten", async () => {
    const note = "## What is FSRS?\n\nA scheduler.\n\n%%From the Decks docs.%%\n";
    const [card] = parse(note);
    const { result, content } = await edit(note, card, card.front, "A spaced-repetition scheduler.");
    expect(result).toEqual({ ok: true });
    expect(content).toContain("A spaced-repetition scheduler.\n\n%%From the Decks docs.%%");
  });

  it("keeps notes written after a divider", async () => {
    const note = "## What is a leech?\n\nA card that lapses too often.\n\n---\n\nSee the leech workbench.\n";
    const [card] = parse(note);
    expect(card.notes).toBe("See the leech workbench.");
    const { result, content } = await edit(note, card, card.front, "A card missed too often.");
    expect(result).toEqual({ ok: true });
    const [again] = parse(content);
    expect(again.back).toBe("A card missed too often.");
    expect(again.notes).toBe("See the leech workbench.");
  });

  it("still refuses an edit when the note really did change underneath", async () => {
    const [card] = parse(QUESTION, true);
    const changed = QUESTION.replace("- [ ] Oxygen", "- [ ] Helium");
    const { result, content } = await edit(changed, card, card.front, card.back);
    expect(result.ok).toBe(false);
    expect(content).toBe(changed);
  });

  it("still refuses when only the explanation changed underneath", async () => {
    const [card] = parse(QUESTION, true);
    const changed = QUESTION.replace("full valence shell", "complete outer shell");
    const { result } = await edit(changed, card, "New front", card.back);
    expect(result.ok).toBe(false);
  });

  it("edits a card with no notes and adds none", async () => {
    const note = "## Capital of France?\n\nParis.\n";
    const [card] = parse(note);
    const { result, content } = await edit(note, card, card.front, "Paris, on the Seine.");
    expect(result).toEqual({ ok: true });
    const [again] = parse(content);
    expect(again.back).toBe("Paris, on the Seine.");
    expect(again.notes).toBe("");
    expect(content).not.toContain("%%");
  });

  it("keeps the blank line under the heading", async () => {
    const note = "## Capital of France?\n\nParis.\n";
    const [card] = parse(note);
    const { content } = await edit(note, card, card.front, "Paris, on the Seine.");
    expect(content).toBe("## Capital of France?\n\nParis, on the Seine.\n");
  });

  it("gives the notes to the first card only when splitting", async () => {
    const note = "## Question\n\nBody text.\n\n%%A note.%%\n";
    const [card] = parse(note);
    const { app, currentContent } = mockApp("test.md", note);
    const writer = new FlashcardWriter(app as never);
    const result = await writer.splitFlashcard(card, [
      { type: "header-paragraph", front: "Question", back: "Part one." },
      { type: "header-paragraph", front: "Question 2", back: "Part two." },
    ]);
    expect(result).toEqual({ ok: true });
    expect(currentContent().match(/%%A note\.%%/g)).toHaveLength(1);
    expect(currentContent()).toContain("Part one.\n\n%%A note.%%");
  });
});

describe("FlashcardWriter on reverse cards", () => {
  // Built the way the synchronizer builds them: the note's card with front and back swapped.
  function reverseCards(content: string): Flashcard[] {
    return FlashcardParser.parseFlashcardsFromContent(content, 2, "Note", true, false).map((c) =>
      makeCard({
        id: generateReverseFlashcardId(c.front),
        front: c.back,
        back: c.front,
        notes: c.notes,
        type: c.type,
        breadcrumb: c.breadcrumb,
      }),
    );
  }

  it("writes its front as the note's answer and its back as the heading", async () => {
    const note = "## comer\n\nto eat\n";
    const [card] = reverseCards(note);
    const { app, currentContent } = mockApp("test.md", note);
    const result = await new FlashcardWriter(app as never).editFlashcard(card, {
      type: "header-paragraph",
      front: "to eat (verb)",
      back: "comer (v.)",
    });
    expect(result).toEqual({ ok: true });
    expect(currentContent()).toBe("## comer (v.)\n\nto eat (verb)\n");
  });

  it("edits its own row of a mirrored pair, not the other card", async () => {
    const note = "## Words\n\n| Front | Back |\n| --- | --- |\n| Hund | dog |\n| dog | Hund |\n";
    // The first row's reverse reads dog → Hund, the same as the second row.
    const [card] = reverseCards(note);
    expect(card).toMatchObject({ type: "table", front: "dog", back: "Hund" });
    const { app, currentContent } = mockApp("test.md", note);
    const result = await new FlashcardWriter(app as never).editFlashcard(card, {
      type: "table",
      front: "the dog",
      back: "Hund",
      notes: "",
    });
    expect(result).toEqual({ ok: true });
    expect(currentContent()).toBe(
      "## Words\n\n| Front | Back |\n| --- | --- |\n| Hund | the dog |\n| dog | Hund |\n",
    );
  });

  it("edits its own block of a mirrored pair of headings", async () => {
    const note = "## Hund\n\ndog\n\n## dog\n\nHund\n";
    const [card] = reverseCards(note);
    const { app, currentContent } = mockApp("test.md", note);
    const result = await new FlashcardWriter(app as never).editFlashcard(card, {
      type: "header-paragraph",
      front: "the dog",
      back: "Hund",
    });
    expect(result).toEqual({ ok: true });
    expect(currentContent()).toBe("## Hund\n\nthe dog\n\n## dog\n\nHund\n");
  });

  it.each([
    ["first", { front: "dog", back: "" }, "frontEmpty"],
    ["second", { front: "", back: "Hund" }, "backEmpty"],
  ] as const)("refuses an edit that empties its row's %s cell", async (_cell, sides, message) => {
    const note = "## Words\n\n| Front | Back |\n| --- | --- |\n| Hund | dog |\n";
    const [card] = reverseCards(note);
    const { app, currentContent } = mockApp("test.md", note);
    const result = await new FlashcardWriter(app as never).editFlashcard(card, {
      type: "table",
      notes: "",
      ...sides,
    });
    expect(result).toEqual({
      ok: false,
      failure: { code: "invalid_edit", message: I18n.t.cardEdit[message] },
    });
    expect(currentContent()).toBe(note);
  });

  it("refuses an edit that empties its note's heading", async () => {
    const note = "## beber\n\nto drink\n";
    const [card] = reverseCards(note);
    const { app, currentContent } = mockApp("test.md", note);
    const result = await new FlashcardWriter(app as never).editFlashcard(card, {
      type: "header-paragraph",
      front: "to drink",
      back: " ",
    });
    expect(result).toMatchObject({ ok: false, failure: { code: "invalid_edit" } });
    expect(currentContent()).toBe(note);
  });

  it("is not split, even where its front reads as another card", async () => {
    const note = "## A\n\nB\n\n## B\n\nA\n";
    const [card] = reverseCards(note);
    const { app, currentContent } = mockApp("test.md", note);
    const result = await new FlashcardWriter(app as never).splitFlashcard(card, [
      { type: "header-paragraph", front: "x", back: "y" },
      { type: "header-paragraph", front: "z", back: "w" },
    ]);
    expect(result).toEqual({
      ok: false,
      failure: { code: "invalid_edit", message: I18n.t.cardEdit.splitUnsupported },
    });
    expect(currentContent()).toBe(note);
  });
});
