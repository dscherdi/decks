import { MainDatabaseService } from "../../database/MainDatabaseService";
import { CustomDeckService } from "@decks/core";
import { computeCardHealth } from "@decks/core";
import type { Deck, Flashcard, FilterDefinition } from "../../database/types";
import {
  setupTestDatabase,
  teardownTestDatabase,
  DatabaseTestUtils,
} from "./database-test-utils";

describe("Card health integration", () => {
  let db: MainDatabaseService;
  let customDeckService: CustomDeckService;

  beforeEach(async () => {
    db = await setupTestDatabase();
    customDeckService = new CustomDeckService(db);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createDeck(): Promise<Deck> {
    const deck = DatabaseTestUtils.createTestDeck({
      name: "Health test deck",
      filepath: "/health.md",
      tag: "health",
    });
    await db.createDeck(deck);
    return deck;
  }

  async function createCard(
    deckId: string,
    overrides: Partial<Flashcard>
  ): Promise<Flashcard> {
    const card = DatabaseTestUtils.createTestFlashcard(deckId, {
      front: `Q ${Math.random()}`,
      back: "default back",
      ...overrides,
    });
    await db.createFlashcard(card);
    return card;
  }

  describe("computeCardHealth on real DB rows", () => {
    it("flags leech when lapses meet threshold", async () => {
      const deck = await createDeck();
      const leechCard = await createCard(deck.id, { lapses: 8 });
      const healthyCard = await createCard(deck.id, { lapses: 2 });

      const fromDb = await db.getFlashcardById(leechCard.id);
      const healthyFromDb = await db.getFlashcardById(healthyCard.id);

      const thresholds = { leechThreshold: 8, denseCardCharThreshold: 500 };
      expect(computeCardHealth(fromDb!, thresholds).isLeech).toBe(true);
      expect(computeCardHealth(healthyFromDb!, thresholds).isLeech).toBe(false);
    });

    it("flags dense when back text is long", async () => {
      const deck = await createDeck();
      const longBack = "a".repeat(600);
      const denseCard = await createCard(deck.id, { back: longBack });
      const shortCard = await createCard(deck.id, { back: "short" });

      const dense = await db.getFlashcardById(denseCard.id);
      const short = await db.getFlashcardById(shortCard.id);

      const thresholds = { leechThreshold: 8, denseCardCharThreshold: 500 };
      expect(computeCardHealth(dense!, thresholds).isDense).toBe(true);
      expect(computeCardHealth(short!, thresholds).isDense).toBe(false);
    });
  });

  describe("Filter deck queries by health", () => {
    it("returns leech cards for isLeech=true filter", async () => {
      const deck = await createDeck();
      const leechCard = await createCard(deck.id, {
        front: "leech",
        lapses: 10,
      });
      await createCard(deck.id, { front: "healthy", lapses: 1 });

      db.setFilterCompileOptions({
        leechThreshold: 8,
        denseCardCharThreshold: 500,
      });
      customDeckService.setFilterCompileOptions({
        leechThreshold: 8,
        denseCardCharThreshold: 500,
      });

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "isLeech", operator: "equals", value: "true" }],
      };

      const count = await customDeckService.previewFilter(filterDef);
      expect(count).toBe(1);

      const filterDeck = await customDeckService.createFilterDeck(
        "Leech only",
        filterDef
      );
      const cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(1);
      expect(cards[0].id).toBe(leechCard.id);
    });

    it("returns dense cards for isDense=true filter", async () => {
      const deck = await createDeck();
      const denseCard = await createCard(deck.id, {
        front: "dense",
        back: "x".repeat(800),
      });
      await createCard(deck.id, { front: "short", back: "tiny" });

      db.setFilterCompileOptions({
        leechThreshold: 8,
        denseCardCharThreshold: 500,
      });
      customDeckService.setFilterCompileOptions({
        leechThreshold: 8,
        denseCardCharThreshold: 500,
      });

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "isDense", operator: "equals", value: "true" }],
      };

      const count = await customDeckService.previewFilter(filterDef);
      expect(count).toBe(1);

      const filterDeck = await customDeckService.createFilterDeck(
        "Dense only",
        filterDef
      );
      const cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(1);
      expect(cards[0].id).toBe(denseCard.id);
    });

    it("respects custom thresholds when filtering", async () => {
      const deck = await createDeck();
      await createCard(deck.id, { front: "lap3", lapses: 3 });
      await createCard(deck.id, { front: "lap1", lapses: 1 });

      db.setFilterCompileOptions({
        leechThreshold: 3,
        denseCardCharThreshold: 500,
      });
      customDeckService.setFilterCompileOptions({
        leechThreshold: 3,
        denseCardCharThreshold: 500,
      });

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "isLeech", operator: "equals", value: "true" }],
      };

      const count = await customDeckService.previewFilter(filterDef);
      expect(count).toBe(1);
    });

    it("combines isLeech + isDense with AND logic", async () => {
      const deck = await createDeck();
      const both = await createCard(deck.id, {
        front: "both",
        lapses: 10,
        back: "x".repeat(800),
      });
      await createCard(deck.id, {
        front: "leechOnly",
        lapses: 10,
        back: "tiny",
      });
      await createCard(deck.id, {
        front: "denseOnly",
        lapses: 0,
        back: "x".repeat(800),
      });

      db.setFilterCompileOptions({
        leechThreshold: 8,
        denseCardCharThreshold: 500,
      });
      customDeckService.setFilterCompileOptions({
        leechThreshold: 8,
        denseCardCharThreshold: 500,
      });

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [
          { field: "isLeech", operator: "equals", value: "true" },
          { field: "isDense", operator: "equals", value: "true" },
        ],
      };

      const count = await customDeckService.previewFilter(filterDef);
      expect(count).toBe(1);

      const filterDeck = await customDeckService.createFilterDeck(
        "Leech and dense",
        filterDef
      );
      const cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(1);
      expect(cards[0].id).toBe(both.id);
    });
  });
});
