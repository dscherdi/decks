import { FlashcardWriter } from "../services/FlashcardWriter";
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
});
