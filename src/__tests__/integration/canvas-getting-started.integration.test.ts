jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "@decks/core";
import { getTestDeckCanvasContent } from "../../assets/TestDeckCanvasTemplate";
import type { Deck } from "../../database/types";

/**
 * Round-trip the shipped canvas getting-started template through the same
 * sync pipeline the production code uses. Pins:
 *   - Template produces a canvas the parser actually accepts.
 *   - Card counts per type match what users will see (2 + 2 + 3 = 7).
 *   - Every card carries the right sourceNodeId.
 */
describe("Canvas getting-started integration", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("the shipped template parses cleanly and yields 2 header-paragraph + 2 table + 3 cloze + 2 spatial cards", async () => {
    const profile = await db.getDefaultProfile();
    const filepath = "/Canvas decks/Decks — Canvas getting started.canvas";
    const deck: Deck = {
      id: generateDeckId(filepath),
      name: "Decks — Canvas getting started",
      filepath,
      tag: "#decks/canvas",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);

    const content = getTestDeckCanvasContent("#decks/canvas");

    const result = await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: filepath,
      deckConfig: profile,
      fileContent: content,
      clozeEnabled: true,
    });

    expect(result.success).toBe(true);

    const cards = await db.getFlashcardsByDeck(deck.id);

    // 2 header-paragraph + 2 table + 3 cloze + 2 spatial = 9 cards total.
    expect(cards).toHaveLength(9);

    const counts: Record<string, number> = {};
    for (const c of cards) {
      counts[c.type] = (counts[c.type] ?? 0) + 1;
    }
    expect(counts["header-paragraph"]).toBe(2);
    expect(counts["table"]).toBe(2);
    expect(counts["cloze"]).toBe(3);
    expect(counts["spatial"]).toBe(2);

    // Each standalone card is tied to its source node.
    const nodeIds = new Set(cards.map((c) => c.sourceNodeId));
    expect(nodeIds.has("header-paragraph")).toBe(true);
    expect(nodeIds.has("table")).toBe(true);
    expect(nodeIds.has("cloze")).toBe(true);
    // Spatial cards point at the from-node of each edge.
    expect(nodeIds.has("spatial-photosynthesis")).toBe(true);
    // Intro node has no cards (level-1 heading, no level-2 inside).
    expect(nodeIds.has("intro")).toBe(false);

    // Both spatial cards share the same from-node, distinct edges & hints.
    const spatialCards = cards.filter((c) => c.type === "spatial");
    expect(new Set(spatialCards.map((c) => c.edgeId))).toEqual(
      new Set(["edge-spatial-needs", "edge-spatial-produces"]),
    );
    expect(spatialCards.every((c) => (c.hint ?? "").length > 0)).toBe(true);
  });

  it("re-syncing the same content is a no-op on counts", async () => {
    const profile = await db.getDefaultProfile();
    const filepath = "/Canvas decks/Decks — Canvas getting started.canvas";
    const deck: Deck = {
      id: generateDeckId(filepath),
      name: "Decks — Canvas getting started",
      filepath,
      tag: "#decks/canvas",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    const content = getTestDeckCanvasContent("#decks/canvas");

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: filepath,
      deckConfig: profile,
      fileContent: content,
      clozeEnabled: true,
    });
    const before = (await db.getFlashcardsByDeck(deck.id)).map((c) => c.id).sort();

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: filepath,
      deckConfig: profile,
      fileContent: content,
      clozeEnabled: true,
    });
    const after = (await db.getFlashcardsByDeck(deck.id)).map((c) => c.id).sort();

    expect(after).toEqual(before);
  });
});
