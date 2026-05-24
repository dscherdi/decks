jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import type { Deck, DeckProfile } from "../../database/types";

/**
 * End-to-end sync tests for canvas spatial cards. Edges between two text
 * nodes become flashcards whose front is the from-node, back is the to-node,
 * and hint is the edge label. The card id is derived deterministically from
 * the edge id so re-syncs are no-ops and review history survives edits.
 */
describe("Canvas spatial sync integration", () => {
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

  it("creates a spatial card from a single edge with hint = edge label", async () => {
    const { deck, profile } = await createCanvasDeck("single");
    const content = canvasJson(
      [
        { id: "A", text: "Capital of France?" },
        { id: "B", text: "Paris" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "city" }],
    );

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      type: "spatial",
      front: "Capital of France?",
      back: "Paris",
      hint: "city",
      edgeId: "e1",
      sourceNodeId: "A",
    });
  });

  it("re-syncing the same content is a no-op (no churn)", async () => {
    const { deck, profile } = await createCanvasDeck("noop");
    const content = canvasJson(
      [
        { id: "A", text: "A" },
        { id: "B", text: "B" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "lbl" }],
    );

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });
    const before = (await db.getFlashcardsByDeck(deck.id))
      .map((c) => c.id)
      .sort();

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });
    const after = (await db.getFlashcardsByDeck(deck.id)).map((c) => c.id).sort();

    expect(after).toEqual(before);
  });

  it("changing the edge label updates the hint without changing the card id", async () => {
    const { deck, profile } = await createCanvasDeck("relabel");
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
        ],
        [{ id: "e1", fromNode: "A", toNode: "B", label: "first hint" }],
      ),
    });
    const before = await db.getFlashcardsByDeck(deck.id);
    expect(before[0].hint).toBe("first hint");
    const cardId = before[0].id;

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
        ],
        [{ id: "e1", fromNode: "A", toNode: "B", label: "second hint" }],
      ),
    });

    const after = await db.getFlashcardsByDeck(deck.id);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(cardId);
    expect(after[0].hint).toBe("second hint");
  });

  it("removes the card when its edge is deleted", async () => {
    const { deck, profile } = await createCanvasDeck("delete");
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
        ],
        [{ id: "e1", fromNode: "A", toNode: "B", label: "x" }],
      ),
    });
    expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(1);

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
        ],
        // edges array is empty -> the previously-connected nodes are now
        // standalone, but plain "A"/"B" text has no ## heading so the
        // standalone parser produces nothing either.
        [],
      ),
    });

    expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(0);
  });

  it("adding a new edge creates a new card", async () => {
    const { deck, profile } = await createCanvasDeck("growth");
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: canvasJson(
        [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
        ],
        [{ id: "e1", fromNode: "A", toNode: "B", label: "first" }],
      ),
    });
    expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(1);

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
          { id: "e1", fromNode: "A", toNode: "B", label: "first" },
          { id: "e2", fromNode: "A", toNode: "C", label: "second" },
        ],
      ),
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.edgeId))).toEqual(new Set(["e1", "e2"]));
  });

  it("ignores edges that touch non-text nodes", async () => {
    const { deck, profile } = await createCanvasDeck("ignore-nontext");
    // We have to write the JSON manually since canvasJson() only emits text nodes.
    const content = JSON.stringify({
      nodes: [
        { id: "T", type: "text", text: "Hello", x: 0, y: 0, width: 100, height: 50 },
        { id: "F", type: "file", file: "x.md", x: 0, y: 0, width: 100, height: 50 },
      ],
      edges: [{ id: "e1", fromNode: "T", toNode: "F", label: "see" }],
    });

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });

    expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(0);
  });

  it("strips #tags from the front and stores them on the card", async () => {
    const { deck, profile } = await createCanvasDeck("tags");
    const content = canvasJson(
      [
        { id: "A", text: "What is FSRS? #algo #spaced-repetition" },
        { id: "B", text: "Free Spaced Repetition Scheduler" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "expands" }],
    );

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("What is FSRS?");
    expect(cards[0].tags.sort()).toEqual(["algo", "spaced-repetition"]);
  });
});
