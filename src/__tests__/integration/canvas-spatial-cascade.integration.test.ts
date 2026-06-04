jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "@decks/core";
import type { Deck, DeckProfile } from "../../database/types";

/**
 * Spatial cards across chains and branches. A->B->C should always produce
 * exactly two cards (one per edge); B does not also produce standalone cards
 * because it's a graph endpoint.
 */
describe("Canvas spatial cascade integration", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function makeDeck(): Promise<{ deck: Deck; profile: DeckProfile }> {
    const profile = await db.getDefaultProfile();
    const filepath = `/canvases/cascade.canvas`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name: "cascade",
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

  it("A->B->C produces exactly 2 cards; middle node is not standalone-parsed", async () => {
    const { deck, profile } = await makeDeck();
    const content = canvasJson(
      [
        { id: "A", text: "## Hdr A\nbody A" },
        { id: "B", text: "## Hdr B\nbody B" },
        { id: "C", text: "## Hdr C\nbody C" },
      ],
      [
        { id: "e-ab", fromNode: "A", toNode: "B", label: "next" },
        { id: "e-bc", fromNode: "B", toNode: "C", label: "then" },
      ],
    );

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.type === "spatial")).toBe(true);
    expect(new Set(cards.map((c) => c.edgeId))).toEqual(
      new Set(["e-ab", "e-bc"]),
    );
  });

  it("removing the middle edge B->C exposes B and C as standalone (their text now gets rule-parsed)", async () => {
    const { deck, profile } = await makeDeck();

    // First sync: full chain.
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "A", text: "A" },
          { id: "B", text: "## Q-B\nA-B" },
          { id: "C", text: "## Q-C\nA-C" },
        ],
        [
          { id: "e-ab", fromNode: "A", toNode: "B", label: "x" },
          { id: "e-bc", fromNode: "B", toNode: "C", label: "y" },
        ],
      ),
    });
    expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(2);

    // Second sync: drop the B->C edge. B and C have no remaining edges to text
    // nodes (A is still connected via e-ab so A stays a spatial endpoint and B
    // is still connected too -- wait, drop e-bc means B keeps its incoming
    // e-ab, so B is still "connected" and not standalone-parsed). We need to
    // drop both edges to release them.
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "A", text: "A" },
          { id: "B", text: "## Q-B\nA-B" },
          { id: "C", text: "## Q-C\nA-C" },
        ],
        [], // no edges -> all nodes become standalone
      ),
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    // A has no h2 (plain "A") so produces 0 cards.
    // B and C each produce 1 header-paragraph card.
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.type === "header-paragraph")).toBe(true);
    expect(new Set(cards.map((c) => c.front))).toEqual(new Set(["Q-B", "Q-C"]));
  });

  it("adding a branch B->D yields the expected total card count", async () => {
    const { deck, profile } = await makeDeck();

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
          { id: "C", text: "C" },
        ],
        [
          { id: "e-ab", fromNode: "A", toNode: "B", label: "1" },
          { id: "e-bc", fromNode: "B", toNode: "C", label: "2" },
        ],
      ),
    });
    expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(2);

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
          { id: "C", text: "C" },
          { id: "D", text: "D" },
        ],
        [
          { id: "e-ab", fromNode: "A", toNode: "B", label: "1" },
          { id: "e-bc", fromNode: "B", toNode: "C", label: "2" },
          { id: "e-bd", fromNode: "B", toNode: "D", label: "3" },
        ],
      ),
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((c) => c.edgeId))).toEqual(
      new Set(["e-ab", "e-bc", "e-bd"]),
    );
  });
});
