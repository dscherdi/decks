jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import type { Deck, DeckProfile } from "../../database/types";

/**
 * Spatial cards whose back contains ==cloze== markup. When the deck's cloze
 * setting is enabled, each cloze in the back produces a separate cloze card
 * (shared edge id, hint, tags). When disabled, the back stays literal.
 */
describe("Canvas spatial cloze integration", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function makeDeck(): Promise<{ deck: Deck; profile: DeckProfile }> {
    const profile = await db.getDefaultProfile();
    const filepath = `/canvases/spatial-cloze.canvas`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name: "cloze",
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

  it("expands a 2-cloze back into 2 cards with shared edgeId/hint", async () => {
    const { deck, profile } = await makeDeck();
    const content = canvasJson(
      [
        { id: "A", text: "Capitals" },
        {
          id: "B",
          text: "The capital is ==Paris== and the language is ==French==",
        },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "France facts" }],
    );

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
      clozeEnabled: true,
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.type === "cloze")).toBe(true);
    expect(cards.every((c) => c.edgeId === "e1")).toBe(true);
    expect(cards.every((c) => c.hint === "France facts")).toBe(true);
    expect(cards.map((c) => c.clozeText).sort()).toEqual(["French", "Paris"]);
    expect(cards.map((c) => c.clozeOrder).sort()).toEqual([0, 1]);
    // Both cards should have distinct ids derived from edge + cloze order.
    expect(new Set(cards.map((c) => c.id)).size).toBe(2);
  });

  it("keeps cloze markup literal in a single spatial card when cloze is disabled", async () => {
    const { deck, profile } = await makeDeck();
    const profileNoCloze: DeckProfile = {
      ...profile,
      clozeEnabled: false,
    };
    const content = canvasJson(
      [
        { id: "A", text: "Capitals" },
        { id: "B", text: "The capital is ==Paris==" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "lbl" }],
    );

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profileNoCloze,
      fileContent: content,
      clozeEnabled: false,
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("spatial");
    expect(cards[0].back).toBe("The capital is ==Paris==");
    expect(cards[0].hint).toBe("lbl");
  });
});
