jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import type { Deck, DeckProfile, FilterDefinition } from "../../database/types";

describe("Flashcard tags integration", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createTestDeck(name: string): Promise<{ deck: Deck; profile: DeckProfile }> {
    const profile = await db.getDefaultProfile();
    const filepath = `/test/${name}.md`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name,
      filepath,
      tag: "decks/test",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    return { deck, profile };
  }

  describe("storage and retrieval", () => {
    it("persists tags from header-paragraph cards", async () => {
      const { deck, profile } = await createTestDeck("tags-hp");

      const content = `## Math basics #math #school

The answer is 4.
`;
      const result = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
      });
      expect(result.success).toBe(true);

      const cards = await db.getFlashcardsByDeck(deck.id);
      expect(cards).toHaveLength(1);
      expect(cards[0].tags.sort()).toEqual(["math", "school"]);
      expect(cards[0].front).toBe("Math basics");
    });

    it("inherits tags from header to all table rows under it", async () => {
      const { deck, profile } = await createTestDeck("tags-table");

      const content = `## Topic #important #review

| Front | Back |
|-------|------|
| Q1 | A1 |
| Q2 | A2 |
`;
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
      });

      const cards = await db.getFlashcardsByDeck(deck.id);
      expect(cards).toHaveLength(2);
      for (const card of cards) {
        expect(card.tags.sort()).toEqual(["important", "review"]);
      }
    });
  });

  describe("update detection", () => {
    it("updates tags when a tag is added to a header without changing FSRS state", async () => {
      const { deck, profile } = await createTestDeck("tags-add");

      // Initial sync without tags
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: `## My card\n\nAnswer\n`,
      });
      let cards = await db.getFlashcardsByDeck(deck.id);
      expect(cards[0].tags).toEqual([]);
      const cardId = cards[0].id;

      // Simulate prior reviews by mutating FSRS state directly
      await db.updateFlashcard(cardId, {
        interval: 1440,
        difficulty: 7.5,
        stability: 12.3,
        repetitions: 3,
      });

      // Re-sync with a tag added
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: `## My card #math\n\nAnswer\n`,
      });

      cards = await db.getFlashcardsByDeck(deck.id);
      expect(cards).toHaveLength(1);
      expect(cards[0].id).toBe(cardId);
      expect(cards[0].tags).toEqual(["math"]);
      // FSRS state must be preserved
      expect(cards[0].interval).toBe(1440);
      expect(cards[0].difficulty).toBeCloseTo(7.5);
      expect(cards[0].stability).toBeCloseTo(12.3);
      expect(cards[0].repetitions).toBe(3);
    });

    it("updates tags when a tag is removed from a header", async () => {
      const { deck, profile } = await createTestDeck("tags-remove");

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: `## My card #old\n\nAnswer\n`,
      });
      let cards = await db.getFlashcardsByDeck(deck.id);
      expect(cards[0].tags).toEqual(["old"]);

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: `## My card\n\nAnswer\n`,
      });
      cards = await db.getFlashcardsByDeck(deck.id);
      expect(cards[0].tags).toEqual([]);
    });

    it("does not trigger rename detection when only tags change", async () => {
      const { deck, profile } = await createTestDeck("tags-no-rename");

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: `## H1 #a\n\nAnswer\n`,
      });
      const beforeCards = await db.getFlashcardsByDeck(deck.id);
      const originalId = beforeCards[0].id;

      const result = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: `## H1 #b\n\nAnswer\n`,
      });
      expect(result.success).toBe(true);
      const afterCards = await db.getFlashcardsByDeck(deck.id);
      expect(afterCards).toHaveLength(1);
      // ID stays the same since front text is unchanged (tags are stripped from front)
      expect(afterCards[0].id).toBe(originalId);
      expect(afterCards[0].tags).toEqual(["b"]);
    });
  });

  describe("reverse card inheritance", () => {
    it("creates reverse cards with the same tags as their original", async () => {
      const { deck, profile } = await createTestDeck("tags-reverse");

      const content = `## Vocab #languages

| English | Spanish |
|---------|---------|
| Hello | Hola |
`;
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        reverseCards: true,
      });

      const cards = await db.getFlashcardsByDeck(deck.id);
      expect(cards).toHaveLength(2);
      const original = cards.find((c) => c.id.startsWith("card_"));
      const reverse = cards.find((c) => c.id.startsWith("rcard_"));
      expect(original?.tags).toEqual(["languages"]);
      expect(reverse?.tags).toEqual(["languages"]);
    });
  });

  describe("filtering by tags", () => {
    async function syncWithTags(name: string, content: string): Promise<Deck> {
      const { deck, profile } = await createTestDeck(name);
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
      });
      return deck;
    }

    it("filters cards by tag using contains operator", async () => {
      await syncWithTags(
        "filter-1",
        `## Card1 #math\n\nA1\n\n## Card2 #science\n\nA2\n`
      );

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "tags", operator: "contains", value: "math" }],
      };
      const customDeckId = await db.createCustomDeck("math-filter", "filter", JSON.stringify(filterDef));

      const matched = await db.getFlashcardsForCustomDeck(customDeckId);
      expect(matched).toHaveLength(1);
      expect(matched[0].front).toBe("Card1");
    });

    it("does not match prefix overlap (math vs mathematics)", async () => {
      await syncWithTags(
        "filter-2",
        `## Card1 #math\n\nA1\n\n## Card2 #mathematics\n\nA2\n`
      );

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "tags", operator: "contains", value: "math" }],
      };
      const customDeckId = await db.createCustomDeck("exact-math", "filter", JSON.stringify(filterDef));

      const matched = await db.getFlashcardsForCustomDeck(customDeckId);
      expect(matched).toHaveLength(1);
      expect(matched[0].front).toBe("Card1");
    });

    it("returns all distinct flashcard tags via getAllFlashcardTags", async () => {
      await syncWithTags(
        "filter-3",
        `## Card1 #math #science\n\nA1\n\n## Card2 #math\n\nA2\n`
      );

      const tags = await db.getAllFlashcardTags();
      expect(tags.sort()).toEqual(["math", "science"]);
    });
  });
});
