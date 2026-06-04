import {
  FlashcardComposer,
  buildCanvasNodes,
  buildHeaderParagraphContent,
  buildTableContent,
  headingHashes,
} from "../services/FlashcardComposer";
import { FlashcardParser } from "@decks/core";
import { CanvasFlashcardExtractor } from "../services/CanvasFlashcardExtractor";
import type { GeneratedCard } from "@decks/core";

jest.mock("obsidian", () => jest.requireActual("../__mocks__/obsidian"));

const card = (front: string, back: string, notes = ""): GeneratedCard => ({
  front,
  back,
  notes,
});

class TFileLike {
  constructor(
    public path: string,
    public basename: string,
  ) {}
}
function mockApp(path: string, basename: string, content: string) {
  let stored = content;
  const file = new TFileLike(path, basename);
  const { TFile } = jest.requireActual("../__mocks__/obsidian");
  Object.setPrototypeOf(file, TFile.prototype);
  return {
    app: {
      vault: {
        getAbstractFileByPath: (p: string) => (p === path ? file : null),
        process: async (_f: unknown, fn: (c: string) => string) => {
          stored = fn(stored);
          return stored;
        },
      },
    } as never,
    current: () => stored,
  };
}

describe("headingHashes", () => {
  it("maps level to # chars and falls back to # for 0/out-of-range", () => {
    expect(headingHashes(2)).toBe("##");
    expect(headingHashes(3)).toBe("###");
    expect(headingHashes(0)).toBe("#");
    expect(headingHashes(9)).toBe("#");
  });
});

describe("header-paragraph builder roundtrips through the parser", () => {
  it("re-parses to the same front/back at the profile header level", () => {
    const cards = [card("What is X?", "X is a thing."), card("Define Y", "Y is Y.")];
    const content = buildHeaderParagraphContent(cards, 2);
    const parsed = FlashcardParser.parseFlashcardsFromContent(content, 2);
    expect(parsed.map((p) => ({ front: p.front, back: p.back }))).toEqual([
      { front: "What is X?", back: "X is a thing." },
      { front: "Define Y", back: "Y is Y." },
    ]);
  });
});

describe("table builder", () => {
  it("emits a 3-column table when any card has notes and roundtrips", () => {
    const cards = [card("Q1", "A1", "note1"), card("Q2", "A2")];
    const content = buildTableContent(cards, 2, "Vocab");
    expect(content).toContain("| Front | Back | Notes |");
    const parsed = FlashcardParser.parseFlashcardsFromContent(content, 2);
    expect(parsed.map((p) => ({ front: p.front, back: p.back, notes: p.notes }))).toEqual(
      [
        { front: "Q1", back: "A1", notes: "note1" },
        { front: "Q2", back: "A2", notes: "" },
      ],
    );
  });

  it("emits a 2-column table when no card has notes", () => {
    const content = buildTableContent([card("Q", "A")], 2, "T");
    expect(content).toContain("| Front | Back |");
    expect(content).not.toContain("Notes");
  });

  it("escapes pipes and newlines in cells", () => {
    const content = buildTableContent([card("a|b", "c\nd")], 2, "T");
    expect(content).toContain("a\\|b");
    expect(content).toContain("c<br>d");
  });
});

describe("canvas builder", () => {
  it("creates one text node per card laid out in a grid, roundtripping", () => {
    const cards = [card("Q1", "A1"), card("Q2", "A2"), card("Q3", "A3"), card("Q4", "A4")];
    const nodes = buildCanvasNodes(cards, 2, { makeId: (i) => `n${i}` });
    expect(nodes).toHaveLength(4);
    expect(nodes[0]).toMatchObject({ id: "n0", type: "text", x: 0, y: 0 });
    // 4th node wraps to row 2 (COLS = 3).
    expect(nodes[3].y).toBeGreaterThan(0);

    const canvasJson = JSON.stringify({ nodes, edges: [] });
    const parsed = CanvasFlashcardExtractor.extract(canvasJson, 2);
    expect(parsed.map((p) => ({ front: p.front, back: p.back }))).toEqual(
      cards.map((c) => ({ front: c.front, back: c.back })),
    );
  });
});

describe("header-paragraph notes round-trip via the --- delimiter", () => {
  it("writes notes after a --- and the parser recovers them", () => {
    const cards = [
      card("Q1", "A1", "note one"),
      card("Q2", "A2"), // no notes
    ];
    const content = buildHeaderParagraphContent(cards, 2);
    expect(content).toContain("---");
    const parsed = FlashcardParser.parseFlashcardsFromContent(content, 2);
    expect(parsed.map((p) => ({ front: p.front, back: p.back, notes: p.notes }))).toEqual([
      { front: "Q1", back: "A1", notes: "note one" },
      { front: "Q2", back: "A2", notes: "" },
    ]);
  });

  it("round-trips notes through a canvas text node", () => {
    const nodes = buildCanvasNodes([card("Q", "A", "canvas note")], 2, {
      makeId: (i) => `n${i}`,
    });
    const parsed = CanvasFlashcardExtractor.extract(
      JSON.stringify({ nodes, edges: [] }),
      2,
    );
    expect(parsed[0]).toMatchObject({ front: "Q", back: "A", notes: "canvas note" });
  });
});

describe("FlashcardComposer.saveGenerated append", () => {
  it("appends a header-paragraph block to an existing markdown deck", async () => {
    const { app, current } = mockApp(
      "Decks/Bio.md",
      "Bio",
      "---\ntags:\n  - decks\n---\n\n## Existing?\nold\n",
    );
    const composer = new FlashcardComposer(app);
    const res = await composer.saveGenerated([card("New?", "fresh")], {
      kind: "append",
      format: "header-paragraph",
      filePath: "Decks/Bio.md",
      level: 2,
    });
    expect(res.filePath).toBe("Decks/Bio.md");
    expect(current()).toContain("## Existing?");
    expect(current()).toContain("## New?\n\nfresh");
  });

  it("appends new text nodes below existing nodes in a canvas deck", async () => {
    const existing = JSON.stringify({
      nodes: [{ id: "a", type: "text", text: "# Intro", x: 0, y: 0, width: 400, height: 200 }],
      edges: [],
    });
    const { app, current } = mockApp("Canvas/Deck.canvas", "Deck", existing);
    const composer = new FlashcardComposer(app);
    await composer.saveGenerated([card("Q", "A")], {
      kind: "append",
      format: "canvas",
      filePath: "Canvas/Deck.canvas",
      level: 2,
    });
    const parsed = JSON.parse(current());
    expect(parsed.nodes).toHaveLength(2);
    // New node placed below the existing one (y >= 200 + gap).
    expect(parsed.nodes[1].y).toBeGreaterThanOrEqual(260);
    expect(parsed.nodes[1].text).toContain("## Q");
  });
});
