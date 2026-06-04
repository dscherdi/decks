jest.unmock("sql.js");

import type { App, TFile } from "obsidian";
import { FlashcardWriter } from "../../services/FlashcardWriter";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { generateDeckId } from "@decks/core";
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
        hint: "",
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

// -- Spatial card edits --------------------------------------------------------
// Cards created from a canvas edge between two text nodes. Editing spans the
// from-node, the to-node, and the edge label simultaneously.

interface SpatialCardFields {
  front?: string;
  back?: string;
  hint?: string;
  edgeId?: string | null;
  sourceNodeId?: string | null;
  sourceFile?: string;
}

function spatialCard(overrides: SpatialCardFields = {}): Flashcard {
  // `??` treats null as defaulting; use explicit `in` checks so callers can
  // pass `edgeId: null` to simulate a card that's missing its edge id.
  const edgeId = "edgeId" in overrides ? overrides.edgeId : "edge-1";
  const sourceNodeId = "sourceNodeId" in overrides ? overrides.sourceNodeId : "from-node";
  return {
    id: "spatial-test-card",
    deckId: "deck",
    front: overrides.front ?? "From front",
    back: overrides.back ?? "To back",
    type: "spatial",
    sourceFile: overrides.sourceFile ?? "/Canvases/spatial.canvas",
    contentHash: "h",
    breadcrumb: "",
    notes: "",
    tags: [],
    hint: overrides.hint ?? "edge-label",
    clozeText: null,
    clozeOrder: null,
    sourceNodeId,
    edgeId,
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
  };
}

function spatialCanvas(
  fromText: string,
  toText: string,
  edgeLabel: string | null,
  extras: { unrelatedNode?: { id: string; text: string }; unrelatedEdge?: { id: string; fromNode: string; toNode: string; label?: string } } = {},
): string {
  const nodes: Array<Record<string, unknown>> = [
    { id: "from-node", type: "text", text: fromText, x: 0, y: 0, width: 200, height: 100 },
    { id: "to-node", type: "text", text: toText, x: 300, y: 0, width: 200, height: 100, color: "4" },
  ];
  if (extras.unrelatedNode) {
    nodes.push({
      id: extras.unrelatedNode.id,
      type: "text",
      text: extras.unrelatedNode.text,
      x: 0,
      y: 400,
      width: 200,
      height: 100,
    });
  }
  const edges: Array<Record<string, unknown>> = [
    {
      id: "edge-1",
      fromNode: "from-node",
      toNode: "to-node",
      ...(edgeLabel === null ? {} : { label: edgeLabel }),
    },
  ];
  if (extras.unrelatedEdge) {
    edges.push({ ...extras.unrelatedEdge });
  }
  return JSON.stringify({ nodes, edges });
}

describe("Canvas spatial edit integration", () => {
  it("edits the front: rewrites only the from-node text", async () => {
    const filepath = "/Canvases/spatial-front.canvas";
    const initial = spatialCanvas("From front", "To back", "edge-label", {
      unrelatedNode: { id: "alone", text: "## standalone\nbody" },
    });
    const { app, read } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(spatialCard({ sourceFile: filepath }), {
      type: "spatial",
      front: "New front",
      back: "To back",
      hint: "edge-label",
    });
    expect(result.ok).toBe(true);

    const after = JSON.parse(read());
    const fromNode = after.nodes.find((n: { id: string }) => n.id === "from-node");
    const toNode = after.nodes.find((n: { id: string }) => n.id === "to-node");
    const alone = after.nodes.find((n: { id: string }) => n.id === "alone");
    const edge = after.edges.find((e: { id: string }) => e.id === "edge-1");
    expect(fromNode.text).toBe("New front");
    expect(toNode.text).toBe("To back");
    expect(toNode.color).toBe("4"); // unrelated metadata preserved
    expect(alone.text).toBe("## standalone\nbody");
    expect(edge.label).toBe("edge-label");
  });

  it("edits the back: rewrites only the to-node text", async () => {
    const filepath = "/Canvases/spatial-back.canvas";
    const initial = spatialCanvas("From front", "To back", "edge-label");
    const { app, read } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(spatialCard({ sourceFile: filepath }), {
      type: "spatial",
      front: "From front",
      back: "Updated back text",
      hint: "edge-label",
    });
    expect(result.ok).toBe(true);

    const after = JSON.parse(read());
    expect(after.nodes.find((n: { id: string }) => n.id === "from-node").text).toBe("From front");
    expect(after.nodes.find((n: { id: string }) => n.id === "to-node").text).toBe("Updated back text");
    expect(after.edges.find((e: { id: string }) => e.id === "edge-1").label).toBe("edge-label");
  });

  it("edits the hint: rewrites only the edge label", async () => {
    const filepath = "/Canvases/spatial-hint.canvas";
    const initial = spatialCanvas("From front", "To back", "edge-label");
    const { app, read } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(spatialCard({ sourceFile: filepath }), {
      type: "spatial",
      front: "From front",
      back: "To back",
      hint: "new hint",
    });
    expect(result.ok).toBe(true);

    const after = JSON.parse(read());
    expect(after.nodes.find((n: { id: string }) => n.id === "from-node").text).toBe("From front");
    expect(after.nodes.find((n: { id: string }) => n.id === "to-node").text).toBe("To back");
    expect(after.edges.find((e: { id: string }) => e.id === "edge-1").label).toBe("new hint");
  });

  it("edits front, back, and hint in a single call", async () => {
    const filepath = "/Canvases/spatial-all.canvas";
    const initial = spatialCanvas("From front", "To back", "edge-label");
    const { app, read } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(spatialCard({ sourceFile: filepath }), {
      type: "spatial",
      front: "New front",
      back: "New back",
      hint: "new hint",
    });
    expect(result.ok).toBe(true);

    const after = JSON.parse(read());
    expect(after.nodes.find((n: { id: string }) => n.id === "from-node").text).toBe("New front");
    expect(after.nodes.find((n: { id: string }) => n.id === "to-node").text).toBe("New back");
    expect(after.edges.find((e: { id: string }) => e.id === "edge-1").label).toBe("new hint");
  });

  it("preserves trailing #tags on the from-node when the front is edited", async () => {
    const filepath = "/Canvases/spatial-tags.canvas";
    const initial = spatialCanvas("What is FSRS? #algo #spaced-repetition", "Free Spaced Repetition Scheduler", "expands");
    const { app, read } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(
      spatialCard({
        sourceFile: filepath,
        front: "What is FSRS?",
        back: "Free Spaced Repetition Scheduler",
        hint: "expands",
      }),
      {
        type: "spatial",
        front: "What is FSRS now?",
        back: "Free Spaced Repetition Scheduler",
        hint: "expands",
      },
    );
    expect(result.ok).toBe(true);

    const after = JSON.parse(read());
    expect(after.nodes.find((n: { id: string }) => n.id === "from-node").text).toBe(
      "What is FSRS now? #algo #spaced-repetition",
    );
  });

  it("file_changed: from-node was modified externally", async () => {
    const filepath = "/Canvases/spatial-stale-from.canvas";
    const initial = spatialCanvas("Drifted front", "To back", "edge-label");
    const { app } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(
      spatialCard({ sourceFile: filepath, front: "From front" }),
      { type: "spatial", front: "Anything", back: "To back", hint: "edge-label" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("file_changed");
  });

  it("file_changed: to-node was modified externally", async () => {
    const filepath = "/Canvases/spatial-stale-to.canvas";
    const initial = spatialCanvas("From front", "Drifted back", "edge-label");
    const { app } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(
      spatialCard({ sourceFile: filepath, back: "To back" }),
      { type: "spatial", front: "From front", back: "Anything", hint: "edge-label" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("file_changed");
  });

  it("file_changed: edge label was changed externally", async () => {
    const filepath = "/Canvases/spatial-stale-label.canvas";
    const initial = spatialCanvas("From front", "To back", "drifted-label");
    const { app } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(
      spatialCard({ sourceFile: filepath, hint: "edge-label" }),
      { type: "spatial", front: "From front", back: "To back", hint: "new" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("file_changed");
  });

  it("card_not_found: edgeId is missing on the card", async () => {
    const filepath = "/Canvases/spatial-no-edge-id.canvas";
    const initial = spatialCanvas("From front", "To back", "edge-label");
    const { app } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(
      spatialCard({ sourceFile: filepath, edgeId: null }),
      { type: "spatial", front: "x", back: "y", hint: "z" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("card_not_found");
  });

  it("card_not_found: edge no longer exists in the canvas", async () => {
    const filepath = "/Canvases/spatial-edge-gone.canvas";
    // Canvas has no edges; the card claims edge-1.
    const initial = JSON.stringify({
      nodes: [
        { id: "from-node", type: "text", text: "From front", x: 0, y: 0, width: 200, height: 100 },
        { id: "to-node", type: "text", text: "To back", x: 300, y: 0, width: 200, height: 100 },
      ],
      edges: [],
    });
    const { app } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(
      spatialCard({ sourceFile: filepath }),
      { type: "spatial", front: "x", back: "y", hint: "z" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("card_not_found");
  });

  it("invalid_edit: empty front", async () => {
    const filepath = "/Canvases/spatial-empty-front.canvas";
    const initial = spatialCanvas("From front", "To back", "edge-label");
    const { app } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(
      spatialCard({ sourceFile: filepath }),
      { type: "spatial", front: "   ", back: "To back", hint: "edge-label" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("invalid_edit");
  });

  it("invalid_edit: empty back", async () => {
    const filepath = "/Canvases/spatial-empty-back.canvas";
    const initial = spatialCanvas("From front", "To back", "edge-label");
    const { app } = makeApp(filepath, initial);
    const writer = new FlashcardWriter(app);

    const result = await writer.editFlashcard(
      spatialCard({ sourceFile: filepath }),
      { type: "spatial", front: "From front", back: "", hint: "edge-label" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("invalid_edit");
  });
});
