jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import type { Deck, DeckProfile } from "../../database/types";

/**
 * End-to-end sync tests for canvas decks. The Synchronizer branches on file
 * extension; passing `.canvas` as `deckFilepath` routes through the canvas
 * extractor and stamps every card with its source node id.
 */
describe("Canvas sync integration", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createCanvasDeck(
    name: string,
  ): Promise<{ deck: Deck; profile: DeckProfile }> {
    const profile = await db.getDefaultProfile();
    const filepath = `/canvases/${name}.canvas`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name,
      filepath,
      tag: "#decks/canvas",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    return { deck, profile };
  }

  function canvasJson(
    nodes: Array<{ id: string; text: string }>,
  ): string {
    return JSON.stringify({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: "text",
        text: n.text,
        x: 0,
        y: 0,
        width: 200,
        height: 100,
      })),
      edges: [],
    });
  }

  it("creates one flashcard per parsed card across canvas nodes", async () => {
    const { deck, profile } = await createCanvasDeck("a");
    const content = canvasJson([
      { id: "n1", text: "## Q1\nA1" },
      { id: "n2", text: "## Q2\nA2" },
      { id: "n3", text: "## Q3\nA3" },
    ]);

    const result = await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });

    expect(result.success).toBe(true);
    expect(result.parsedCount).toBe(3);

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(3);
    const byNode = new Map(cards.map((c) => [c.sourceNodeId, c]));
    expect(byNode.get("n1")?.front).toBe("Q1");
    expect(byNode.get("n2")?.front).toBe("Q2");
    expect(byNode.get("n3")?.front).toBe("Q3");
  });

  it("distinguishes cards with identical fronts across different nodes", async () => {
    const { deck, profile } = await createCanvasDeck("b");
    const content = canvasJson([
      { id: "node-a", text: "## Same Q\nAnswer A" },
      { id: "node-b", text: "## Same Q\nAnswer B" },
    ]);

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(2);
    const ids = new Set(cards.map((c) => c.id));
    expect(ids.size).toBe(2);
    expect(new Set(cards.map((c) => c.sourceNodeId))).toEqual(
      new Set(["node-a", "node-b"]),
    );
  });

  it("updates a card in place when only its back content changes", async () => {
    const { deck, profile } = await createCanvasDeck("c");

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson([{ id: "n1", text: "## Q\nFirst answer" }]),
    });

    const before = await db.getFlashcardsByDeck(deck.id);
    expect(before).toHaveLength(1);
    const beforeId = before[0].id;

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson([{ id: "n1", text: "## Q\nSecond answer" }]),
    });

    const after = await db.getFlashcardsByDeck(deck.id);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(beforeId); // same card identity
    expect(after[0].back).toBe("Second answer");
  });

  it("removes cards whose source node is deleted", async () => {
    const { deck, profile } = await createCanvasDeck("d");
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson([
        { id: "n1", text: "## Keep\nstays" },
        { id: "n2", text: "## Remove\ngoes away" },
      ]),
    });
    expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(2);

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson([{ id: "n1", text: "## Keep\nstays" }]),
    });

    const remaining = await db.getFlashcardsByDeck(deck.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].front).toBe("Keep");
    expect(remaining[0].sourceNodeId).toBe("n1");
  });

  it("parses table cards from a canvas text node", async () => {
    const { deck, profile } = await createCanvasDeck("e");
    const tableText =
      "## Capitals\n\n| Country | Capital |\n| --- | --- |\n| France | Paris |\n| Spain | Madrid |\n";

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson([{ id: "tbl", text: tableText }]),
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.type === "table")).toBe(true);
    expect(cards.every((c) => c.sourceNodeId === "tbl")).toBe(true);
    expect(cards.map((c) => c.front).sort()).toEqual(["France", "Spain"]);
  });

  it("non-canvas files (.md) still route through the markdown parser", async () => {
    const profile = await db.getDefaultProfile();
    const filepath = "/notes/md-deck.md";
    const deck: Deck = {
      id: generateDeckId(filepath),
      name: "md-deck",
      filepath,
      tag: "#decks/test",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);

    const content = "## Markdown question\nMarkdown answer";
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });
    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].sourceNodeId).toBeNull();
  });
});
