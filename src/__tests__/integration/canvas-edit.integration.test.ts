jest.unmock("sql.js");

import type { App, TFile } from "obsidian";
import { FlashcardWriter } from "../../services/FlashcardWriter";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { generateDeckId } from "../../utils/hash";
import type { Deck, DeckProfile, Flashcard } from "../../database/types";

/**
 * End-to-end test: edit a canvas card via FlashcardWriter, verify the .canvas
 * JSON is rewritten in place with the new markdown content while unrelated
 * nodes and node fields are preserved.
 */

class TestTFile {
  path: string;
  name: string;
  extension: string;
  basename: string;
  stat: { mtime: number; ctime: number };

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() || "";
    const parts = this.name.split(".");
    this.extension = parts.length > 1 ? parts.pop()! : "";
    this.basename = parts.join(".");
    const now = Date.now();
    this.stat = { mtime: now, ctime: now };
  }
}

function bridgeTFile(file: TestTFile): TFile {
  // Force `instanceof TFile` to pass inside FlashcardWriter by reusing the
  // mock TFile constructor as the prototype.
  const { TFile: MockTFile } = jest.requireActual("../../__mocks__/obsidian");
  Object.setPrototypeOf(file, MockTFile.prototype);
  return file as unknown as TFile;
}

function makeApp(filePath: string, initialContent: string): {
  app: App;
  read: () => string;
} {
  let content = initialContent;
  const tfile = bridgeTFile(new TestTFile(filePath));
  return {
    app: {
      vault: {
        getAbstractFileByPath: (p: string) => (p === filePath ? tfile : null),
        process: async (
          _file: TFile,
          fn: (data: string) => string,
        ) => {
          content = fn(content);
          return content;
        },
      },
    } as unknown as App,
    read: () => content,
  };
}

function canvasJson(
  nodes: Array<Record<string, unknown> & { id: string; text: string }>,
): string {
  return JSON.stringify({
    nodes: nodes.map((n) => ({
      type: "text",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      ...n,
    })),
    edges: [],
  });
}

describe("Canvas edit integration", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("rewrites the target text node and preserves other nodes / fields", async () => {
    const filepath = "/Canvases/edit-test.canvas";
    const initial = canvasJson([
      {
        id: "target",
        text: "## Old front\nOld answer",
        x: 100,
        y: 200,
        color: "4",
      },
      {
        id: "other",
        text: "## Unrelated\nKeep me",
        x: 500,
        y: 600,
      },
    ]);
    const { app, read } = makeApp(filepath, initial);

    // Sync first to populate the DB so we have an authentic Flashcard row.
    const profile = await db.getDefaultProfile();
    const deck: Deck = {
      id: generateDeckId(filepath),
      name: "edit-test",
      filepath,
      tag: "#decks/canvas",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: filepath,
      deckConfig: profile as DeckProfile,
      fileContent: initial,
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    const targetCard = cards.find((c) => c.sourceNodeId === "target")!;
    expect(targetCard).toBeDefined();
    expect(targetCard.front).toBe("Old front");

    // Edit the card front + body via FlashcardWriter.
    const writer = new FlashcardWriter(app);
    const result = await writer.editFlashcard(
      targetCard as Flashcard,
      {
        type: "header-paragraph",
        front: "New front",
        back: "New answer",
      },
    );
    expect(result.ok).toBe(true);

    const after = JSON.parse(read());
    expect(Array.isArray(after.nodes)).toBe(true);
    expect(after.nodes).toHaveLength(2);

    const target = after.nodes.find((n: { id: string }) => n.id === "target");
    const other = after.nodes.find((n: { id: string }) => n.id === "other");
    expect(target.text).toContain("## New front");
    expect(target.text).toContain("New answer");
    // Position / color preserved on the edited node.
    expect(target.x).toBe(100);
    expect(target.y).toBe(200);
    expect(target.color).toBe("4");
    // Sibling node fully untouched.
    expect(other.text).toBe("## Unrelated\nKeep me");
    expect(other.x).toBe(500);
    expect(other.y).toBe(600);
  });

  it("fails with card_not_found when the source node was deleted from the canvas", async () => {
    const filepath = "/Canvases/missing-node.canvas";
    const initial = canvasJson([{ id: "n1", text: "## Q\nA" }]);
    const { app } = makeApp(filepath, initial);

    const writer = new FlashcardWriter(app);
    const result = await writer.editFlashcard(
      {
        id: "fake",
        deckId: "deck",
        front: "Q",
        back: "A",
        type: "header-paragraph",
        sourceFile: filepath,
        contentHash: "h",
        breadcrumb: "",
        notes: "",
        tags: [],
        clozeText: null,
        clozeOrder: null,
        sourceNodeId: "does-not-exist",
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
      },
      { type: "header-paragraph", front: "X", back: "Y" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("card_not_found");
    }
  });
});
