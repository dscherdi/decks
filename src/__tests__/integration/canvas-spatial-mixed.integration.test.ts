jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "@decks/core";
import type { Deck, DeckProfile } from "../../database/types";

/**
 * A canvas can mix connected (spatial) and standalone (rule-parsed) text
 * nodes. Confirm both sets are produced and that deleting all edges flips
 * the formerly-connected nodes into standalone mode.
 */
describe("Canvas spatial mixed integration", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function makeDeck(): Promise<{ deck: Deck; profile: DeckProfile }> {
    const profile = await db.getDefaultProfile();
    const filepath = `/canvases/mixed.canvas`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name: "mixed",
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

  type Edge = { id: string; fromNode: string; toNode: string; label?: string };
  function canvasJson(
    nodes: Array<{ id: string; text: string }>,
    edges: Edge[] = [],
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
      edges,
    });
  }

  it("produces both spatial and standalone-parsed cards from a mixed canvas", async () => {
    const { deck, profile } = await makeDeck();
    const standaloneText = "## Standalone Q1\nAns 1\n\n## Standalone Q2\nAns 2";
    const content = canvasJson(
      [
        { id: "Q", text: "Spatial Front" },
        { id: "A", text: "Spatial Back" },
        { id: "alone", text: standaloneText },
      ],
      [{ id: "e1", fromNode: "Q", toNode: "A", label: "lbl" }],
    );

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(3);

    const spatial = cards.filter((c) => c.type === "spatial");
    expect(spatial).toHaveLength(1);
    expect(spatial[0].front).toBe("Spatial Front");
    expect(spatial[0].hint).toBe("lbl");

    const hp = cards.filter((c) => c.type === "header-paragraph");
    expect(hp).toHaveLength(2);
    expect(new Set(hp.map((c) => c.front))).toEqual(
      new Set(["Standalone Q1", "Standalone Q2"]),
    );
    expect(hp.every((c) => c.sourceNodeId === "alone")).toBe(true);
  });

  it("removing the edge flips formerly-connected nodes into standalone mode", async () => {
    const { deck, profile } = await makeDeck();
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "Q", text: "## Q-front\nbody" },
          { id: "A", text: "## A-front\nback body" },
        ],
        [{ id: "e1", fromNode: "Q", toNode: "A", label: "x" }],
      ),
    });
    const before = await db.getFlashcardsByDeck(deck.id);
    expect(before).toHaveLength(1);
    expect(before[0].type).toBe("spatial");

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "Q", text: "## Q-front\nbody" },
          { id: "A", text: "## A-front\nback body" },
        ],
        [],
      ),
    });

    const after = await db.getFlashcardsByDeck(deck.id);
    expect(after).toHaveLength(2);
    expect(after.every((c) => c.type === "header-paragraph")).toBe(true);
    expect(new Set(after.map((c) => c.front))).toEqual(
      new Set(["Q-front", "A-front"]),
    );
  });
});
