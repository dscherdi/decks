import { MainDatabaseService } from "../../database/MainDatabaseService";
import { CustomDeckService } from "../../services/CustomDeckService";
import { Scheduler } from "../../services/Scheduler";
import type { Deck, Flashcard, FilterDefinition, CustomDeckGroup } from "../../database/types";
import {
  setupTestDatabase,
  teardownTestDatabase,
  DatabaseTestUtils,
} from "./database-test-utils";

describe("Custom Decks Integration Tests", () => {
  let db: MainDatabaseService;
  let customDeckService: CustomDeckService;
  beforeEach(async () => {
    db = await setupTestDatabase();
    customDeckService = new CustomDeckService(db);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createDeckWithCards(
    tag: string,
    cardCount: number,
    overrides: Partial<Deck> = {}
  ): Promise<{ deck: Deck; flashcards: Flashcard[] }> {
    const deck = DatabaseTestUtils.createTestDeck({
      name: `Deck ${tag}`,
      filepath: `/${tag}.md`,
      tag,
      ...overrides,
    });
    await db.createDeck(deck);

    const flashcards: Flashcard[] = [];
    for (let i = 0; i < cardCount; i++) {
      const card = DatabaseTestUtils.createTestFlashcard(deck.id, {
        front: `${tag} Q${i + 1}`,
        back: `${tag} A${i + 1}`,
      });
      await db.createFlashcard(card);
      flashcards.push(card);
    }

    return { deck, flashcards };
  }

  describe("Custom Deck CRUD", () => {
    it("should create a custom deck", async () => {
      const deck = await customDeckService.createCustomDeck("My Study Deck");

      expect(deck).toBeDefined();
      expect(deck.name).toBe("My Study Deck");
      expect(deck.id).toMatch(/^cdeck_/);
      expect(deck.deckType).toBe("manual");
      expect(deck.filterDefinition).toBeNull();
      expect(deck.lastReviewed).toBeNull();
    });

    it("should prevent duplicate custom deck names", async () => {
      await customDeckService.createCustomDeck("Unique Deck");

      await expect(
        customDeckService.createCustomDeck("Unique Deck")
      ).rejects.toThrow('A custom deck named "Unique Deck" already exists');
    });

    it("should get all custom decks", async () => {
      await customDeckService.createCustomDeck("Deck A");
      await customDeckService.createCustomDeck("Deck B");
      await customDeckService.createCustomDeck("Deck C");

      const decks = await customDeckService.getAllCustomDecks();
      expect(decks).toHaveLength(3);
      const names = decks.map((d) => d.name).sort();
      expect(names).toEqual(["Deck A", "Deck B", "Deck C"]);
    });

    it("should delete a custom deck", async () => {
      const deck = await customDeckService.createCustomDeck("To Delete");
      await customDeckService.deleteCustomDeck(deck.id);

      const decks = await customDeckService.getAllCustomDecks();
      expect(decks).toHaveLength(0);
    });

    it("should rename a custom deck", async () => {
      const deck = await customDeckService.createCustomDeck("Old Name");
      await customDeckService.renameCustomDeck(deck.id, "New Name");

      const updated = await db.getCustomDeckById(deck.id);
      expect(updated!.name).toBe("New Name");
    });

    it("should prevent renaming to an existing name", async () => {
      await customDeckService.createCustomDeck("Existing");
      const deck = await customDeckService.createCustomDeck("Other");

      await expect(
        customDeckService.renameCustomDeck(deck.id, "Existing")
      ).rejects.toThrow('A custom deck named "Existing" already exists');
    });
  });

  describe("Card Membership", () => {
    it("should add flashcards to a custom deck", async () => {
      const { flashcards } = await createDeckWithCards("math", 3);
      const customDeck = await customDeckService.createCustomDeck("Math Review");

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      const cards = await db.getFlashcardsForCustomDeck(customDeck.id);
      expect(cards).toHaveLength(3);
    });

    it("should add cards from multiple source decks", async () => {
      const { flashcards: mathCards } = await createDeckWithCards("math", 2);
      const { flashcards: scienceCards } = await createDeckWithCards("science", 3);
      const customDeck = await customDeckService.createCustomDeck("Mixed");

      await customDeckService.addFlashcards(customDeck.id, [
        mathCards[0].id,
        scienceCards[0].id,
        scienceCards[1].id,
      ]);

      const cards = await db.getFlashcardsForCustomDeck(customDeck.id);
      expect(cards).toHaveLength(3);
    });

    it("should remove flashcards from a custom deck", async () => {
      const { flashcards } = await createDeckWithCards("bio", 4);
      const customDeck = await customDeckService.createCustomDeck("Bio Review");

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      await customDeckService.removeFlashcards(customDeck.id, [
        flashcards[0].id,
        flashcards[1].id,
      ]);

      const remaining = await db.getFlashcardsForCustomDeck(customDeck.id);
      expect(remaining).toHaveLength(2);
      expect(remaining.map((c) => c.id)).not.toContain(flashcards[0].id);
      expect(remaining.map((c) => c.id)).not.toContain(flashcards[1].id);
    });

    it("should handle adding duplicate cards gracefully", async () => {
      const { flashcards } = await createDeckWithCards("test", 2);
      const customDeck = await customDeckService.createCustomDeck("Test");

      await customDeckService.addFlashcards(customDeck.id, [flashcards[0].id]);
      await customDeckService.addFlashcards(customDeck.id, [flashcards[0].id]);

      const cards = await db.getFlashcardsForCustomDeck(customDeck.id);
      expect(cards).toHaveLength(1);
    });

    it("should cascade delete memberships when custom deck is deleted", async () => {
      const { flashcards } = await createDeckWithCards("cascade", 3);
      const customDeck = await customDeckService.createCustomDeck("Cascade Test");

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      await customDeckService.deleteCustomDeck(customDeck.id);

      // Flashcards should still exist in their source deck
      const allCards = await db.getAllFlashcards();
      expect(allCards).toHaveLength(3);
    });

    it("should get flashcard IDs for a custom deck", async () => {
      const { flashcards } = await createDeckWithCards("ids", 3);
      const customDeck = await customDeckService.createCustomDeck("IDs Test");

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      const ids = await db.getFlashcardIdsForCustomDeck(customDeck.id);
      expect(ids).toHaveLength(3);
      for (const card of flashcards) {
        expect(ids).toContain(card.id);
      }
    });
  });

  describe("Custom Deck Stats", () => {
    it("should count new cards in a custom deck", async () => {
      const { flashcards } = await createDeckWithCards("stats", 5);
      const customDeck = await customDeckService.createCustomDeck("Stats Test");

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      const stats = await customDeckService.getCustomDeckStats(customDeck.id);
      expect(stats.newCount).toBe(5);
      expect(stats.totalCount).toBe(5);
    });

    it("should count due cards in a custom deck", async () => {
      const { flashcards } = await createDeckWithCards("due", 3);
      const customDeck = await customDeckService.createCustomDeck("Due Test");

      // Make some cards "review" state with past due dates
      for (let i = 0; i < 2; i++) {
        await db.updateFlashcard(flashcards[i].id, {
          state: "review",
          dueDate: new Date(Date.now() - 86400000).toISOString(),
        });
      }

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      const stats = await customDeckService.getCustomDeckStats(customDeck.id);
      expect(stats.dueCount).toBe(2);
      expect(stats.newCount).toBe(1);
      expect(stats.totalCount).toBe(3);
    });

    it("should return zero stats for empty custom deck", async () => {
      const customDeck = await customDeckService.createCustomDeck("Empty");

      const stats = await customDeckService.getCustomDeckStats(customDeck.id);
      expect(stats.newCount).toBe(0);
      expect(stats.dueCount).toBe(0);
      expect(stats.totalCount).toBe(0);
    });

    it("should get all custom deck stats", async () => {
      const { flashcards: cards1 } = await createDeckWithCards("a", 3);
      const { flashcards: cards2 } = await createDeckWithCards("b", 5);

      const deck1 = await customDeckService.createCustomDeck("Deck A");
      const deck2 = await customDeckService.createCustomDeck("Deck B");

      await customDeckService.addFlashcards(
        deck1.id,
        cards1.map((f) => f.id)
      );
      await customDeckService.addFlashcards(
        deck2.id,
        cards2.map((f) => f.id)
      );

      const allStats = await customDeckService.getAllCustomDeckStats();
      expect(allStats.size).toBe(2);
      expect(allStats.get(deck1.id)!.totalCount).toBe(3);
      expect(allStats.get(deck2.id)!.totalCount).toBe(5);
    });
  });

  describe("Custom Deck Groups", () => {
    it("should build CustomDeckGroup objects", async () => {
      const { flashcards } = await createDeckWithCards("group", 4);
      const customDeck = await customDeckService.createCustomDeck("Group Test");

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      const groups = await customDeckService.getAllCustomDeckGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].type).toBe("custom");
      expect(groups[0].name).toBe("Group Test");
      expect(groups[0].flashcardIds).toHaveLength(4);
      expect(groups[0].lastReviewed).toBeNull();
    });

    it("should return empty array when no custom decks exist", async () => {
      const groups = await customDeckService.getAllCustomDeckGroups();
      expect(groups).toHaveLength(0);
    });
  });

  describe("Reset Custom Deck Progress", () => {
    it("should reset all flashcards in a custom deck to new state", async () => {
      const { flashcards } = await createDeckWithCards("reset", 3);
      const customDeck = await customDeckService.createCustomDeck("Reset Test");

      // Make cards reviewed
      for (const card of flashcards) {
        await db.updateFlashcard(card.id, {
          state: "review",
          stability: 5.0,
          difficulty: 6.0,
          interval: 1440,
          repetitions: 3,
          lapses: 1,
          lastReviewed: new Date().toISOString(),
        });
      }

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      await db.resetCustomDeckProgress(customDeck.id);

      const cards = await db.getFlashcardsForCustomDeck(customDeck.id);
      for (const card of cards) {
        expect(card.state).toBe("new");
        expect(card.stability).toBe(0);
        expect(card.difficulty).toBe(5.0);
        expect(card.interval).toBe(0);
        expect(card.repetitions).toBe(0);
        expect(card.lapses).toBe(0);
        expect(card.lastReviewed).toBeNull();
      }
    });

    it("should delete review logs for cards in the custom deck", async () => {
      const { deck, flashcards } = await createDeckWithCards("resetlogs", 2);
      const customDeck = await customDeckService.createCustomDeck("Reset Logs");

      // Create review logs
      for (const card of flashcards) {
        const log = DatabaseTestUtils.createTestReviewLog(card.id);
        await db.createReviewLog(log);
      }

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      // Verify logs exist before reset
      const logsBefore = await db.getReviewLogsByDeck(deck.id);
      expect(logsBefore.length).toBeGreaterThan(0);

      await db.resetCustomDeckProgress(customDeck.id);

      // Verify logs are deleted after reset
      const logsAfter = await db.getReviewLogsByDeck(deck.id);
      expect(logsAfter).toHaveLength(0);
    });

    it("should not affect cards outside the custom deck", async () => {
      const { flashcards: inDeck } = await createDeckWithCards("in", 2);
      const { flashcards: outDeck } = await createDeckWithCards("out", 2);
      const customDeck = await customDeckService.createCustomDeck("Partial Reset");

      // Review all cards
      for (const card of [...inDeck, ...outDeck]) {
        await db.updateFlashcard(card.id, {
          state: "review",
          stability: 5.0,
          repetitions: 3,
        });
      }

      // Only add inDeck cards to custom deck
      await customDeckService.addFlashcards(
        customDeck.id,
        inDeck.map((f) => f.id)
      );

      await db.resetCustomDeckProgress(customDeck.id);

      // Cards in custom deck should be reset
      for (const card of inDeck) {
        const updated = await db.getFlashcardById(card.id);
        expect(updated!.state).toBe("new");
      }

      // Cards outside custom deck should be untouched
      for (const card of outDeck) {
        const updated = await db.getFlashcardById(card.id);
        expect(updated!.state).toBe("review");
        expect(updated!.stability).toBe(5.0);
      }
    });
  });

  describe("Card Deletion Cascade", () => {
    it("should remove membership when source flashcard is deleted", async () => {
      const { flashcards } = await createDeckWithCards("cascade-card", 3);
      const customDeck = await customDeckService.createCustomDeck("Cascade Card");

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      // Delete a flashcard from the source deck
      await db.deleteFlashcard(flashcards[0].id);

      const remaining = await db.getFlashcardsForCustomDeck(customDeck.id);
      expect(remaining).toHaveLength(2);
      expect(remaining.map((c) => c.id)).not.toContain(flashcards[0].id);
    });
  });

  describe("Custom Deck Review Card Selection", () => {
    it("should get due cards for a custom deck", async () => {
      const { flashcards } = await createDeckWithCards("review-sel", 5);
      const customDeck = await customDeckService.createCustomDeck("Review Select");

      // Make 2 cards due
      for (let i = 0; i < 2; i++) {
        await db.updateFlashcard(flashcards[i].id, {
          state: "review",
          dueDate: new Date(Date.now() - 86400000).toISOString(),
        });
      }

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      const dueCards = await db.getDueCardsForCustomDeck(customDeck.id);
      expect(dueCards).toHaveLength(2);
    });

    it("should get new cards for a custom deck", async () => {
      const { flashcards } = await createDeckWithCards("new-sel", 5);
      const customDeck = await customDeckService.createCustomDeck("New Select");

      // Make 3 cards reviewed (not new)
      for (let i = 0; i < 3; i++) {
        await db.updateFlashcard(flashcards[i].id, {
          state: "review",
          dueDate: new Date(Date.now() + 86400000).toISOString(),
        });
      }

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      const newCards = await db.getNewCardsForCustomDeck(customDeck.id);
      expect(newCards).toHaveLength(2);
    });
  });

  describe("Filter Decks", () => {
    it("should create a filter deck", async () => {
      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "is_new", value: "" }],
      };
      const deck = await customDeckService.createFilterDeck("New Cards Filter", filterDef);

      expect(deck.deckType).toBe("filter");
      expect(deck.filterDefinition).toBe(JSON.stringify(filterDef));
    });

    it("should dynamically match cards via filter", async () => {
      await createDeckWithCards("filter-test", 5);

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "is_new", value: "" }],
      };
      const filterDeck = await customDeckService.createFilterDeck("All New", filterDef);

      const cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(5);
    });

    it("should update filter results when cards change state", async () => {
      const { flashcards } = await createDeckWithCards("filter-dynamic", 4);

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "is_new", value: "" }],
      };
      const filterDeck = await customDeckService.createFilterDeck("Dynamic New", filterDef);

      // Initially all 4 are new
      let cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(4);

      // Move 2 cards to review state
      for (let i = 0; i < 2; i++) {
        await db.updateFlashcard(flashcards[i].id, { state: "review" });
      }

      // Now only 2 match
      cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(2);
    });

    it("should count stats dynamically for filter decks", async () => {
      const { flashcards } = await createDeckWithCards("filter-stats", 5);

      // Make 2 cards due
      for (let i = 0; i < 2; i++) {
        await db.updateFlashcard(flashcards[i].id, {
          state: "review",
          dueDate: new Date(Date.now() - 86400000).toISOString(),
        });
      }

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [], // match all cards
      };
      const filterDeck = await customDeckService.createFilterDeck("All Cards", filterDef);

      const stats = await customDeckService.getCustomDeckStats(filterDeck.id);
      expect(stats.totalCount).toBe(5);
      expect(stats.dueCount).toBe(2);
      expect(stats.newCount).toBe(3);
    });

    it("should filter by source file", async () => {
      const { flashcards: bioCards } = await createDeckWithCards("bio", 3);
      await createDeckWithCards("math", 2);

      // Update bio cards to have a distinctive source file
      for (const card of bioCards) {
        await db.updateFlashcard(card.id, { sourceFile: "/biology/chapter1.md" });
      }

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "sourceFile", operator: "contains", value: "biology" }],
      };
      const filterDeck = await customDeckService.createFilterDeck("Bio Only", filterDef);

      const cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(3);
      for (const card of cards) {
        expect(card.sourceFile).toContain("biology");
      }
    });

    it("should filter by deck tag via join", async () => {
      await createDeckWithCards("#flashcards/bio", 3);
      await createDeckWithCards("#flashcards/math", 2);

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "deckTag", operator: "contains", value: "bio" }],
      };
      const filterDeck = await customDeckService.createFilterDeck("Bio Tag", filterDef);

      const cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(3);
    });

    it("should get due cards for a filter deck", async () => {
      const { flashcards } = await createDeckWithCards("filter-due", 5);

      for (let i = 0; i < 3; i++) {
        await db.updateFlashcard(flashcards[i].id, {
          state: "review",
          dueDate: new Date(Date.now() - 86400000).toISOString(),
        });
      }

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [], // match all
      };
      const filterDeck = await customDeckService.createFilterDeck("Due Filter", filterDef);

      const dueCards = await db.getDueCardsForCustomDeck(filterDeck.id);
      expect(dueCards).toHaveLength(3);
    });

    it("should get new cards for a filter deck", async () => {
      const { flashcards } = await createDeckWithCards("filter-new", 5);

      for (let i = 0; i < 2; i++) {
        await db.updateFlashcard(flashcards[i].id, { state: "review" });
      }

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [], // match all
      };
      const filterDeck = await customDeckService.createFilterDeck("New Filter", filterDef);

      const newCards = await db.getNewCardsForCustomDeck(filterDeck.id);
      expect(newCards).toHaveLength(3);
    });

    it("should update filter definition", async () => {
      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "is_new", value: "" }],
      };
      const deck = await customDeckService.createFilterDeck("Updatable", filterDef);

      const newFilterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "difficulty", operator: "greater_than", value: "7" }],
      };
      await customDeckService.updateFilter(deck.id, newFilterDef);

      const updated = await db.getCustomDeckById(deck.id);
      expect(updated!.filterDefinition).toBe(JSON.stringify(newFilterDef));
    });

    it("should prevent adding cards to a filter deck", async () => {
      const { flashcards } = await createDeckWithCards("guard", 2);
      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [],
      };
      const filterDeck = await customDeckService.createFilterDeck("Guarded", filterDef);

      await expect(
        customDeckService.addFlashcards(filterDeck.id, [flashcards[0].id])
      ).rejects.toThrow("Cannot manually add cards to a filter deck");
    });

    it("should prevent removing cards from a filter deck", async () => {
      const { flashcards } = await createDeckWithCards("guard-rm", 2);
      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [],
      };
      const filterDeck = await customDeckService.createFilterDeck("Guarded Rm", filterDef);

      await expect(
        customDeckService.removeFlashcards(filterDeck.id, [flashcards[0].id])
      ).rejects.toThrow("Cannot manually remove cards from a filter deck");
    });

    it("should preview filter count", async () => {
      await createDeckWithCards("preview", 5);

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "is_new", value: "" }],
      };

      const count = await customDeckService.previewFilter(filterDef);
      expect(count).toBe(5);
    });

    it("should auto-include new cards added to vault", async () => {
      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "is_new", value: "" }],
      };
      const filterDeck = await customDeckService.createFilterDeck("Auto Include", filterDef);

      // Initially no cards
      let cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(0);

      // Add cards — they are new by default so they match the filter
      await createDeckWithCards("auto-test", 3);

      // Now cards appear automatically
      cards = await db.getFlashcardsForCustomDeck(filterDeck.id);
      expect(cards).toHaveLength(3);
    });

    it("should include deckType in custom deck groups", async () => {
      await customDeckService.createCustomDeck("Manual Deck");
      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [],
      };
      await customDeckService.createFilterDeck("Filter Deck", filterDef);

      const groups = await customDeckService.getAllCustomDeckGroups();
      expect(groups).toHaveLength(2);

      const manual = groups.find(g => g.name === "Manual Deck")!;
      const filter = groups.find(g => g.name === "Filter Deck")!;
      expect(manual.deckType).toBe("manual");
      expect(filter.deckType).toBe("filter");
      expect(filter.filterDefinition).toBe(JSON.stringify(filterDef));
    });

    it("should correctly count due and new cards with OR logic filter", async () => {
      const { flashcards } = await createDeckWithCards("or-filter", 6);

      // Make 2 cards due (state=review, past due date)
      for (let i = 0; i < 2; i++) {
        await db.updateFlashcard(flashcards[i].id, {
          state: "review",
          dueDate: new Date(Date.now() - 86400000).toISOString(),
        });
      }
      // Make 1 card review but not yet due (future due date)
      await db.updateFlashcard(flashcards[2].id, {
        state: "review",
        dueDate: new Date(Date.now() + 86400000 * 10).toISOString(),
      });
      // Remaining 3 cards are new

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "OR",
        rules: [
          { field: "state", operator: "is_due", value: "" },
          { field: "state", operator: "is_new", value: "" },
        ],
      };
      const filterDeck = await customDeckService.createFilterDeck("Due OR New", filterDef);

      const dueCards = await db.getDueCardsForCustomDeck(filterDeck.id);
      expect(dueCards).toHaveLength(2);

      const newCards = await db.getNewCardsForCustomDeck(filterDeck.id);
      expect(newCards).toHaveLength(3);

      const dueCount = await db.countDueCardsCustomDeck(filterDeck.id);
      expect(dueCount).toBe(2);

      const newCount = await db.countNewCardsCustomDeck(filterDeck.id);
      expect(newCount).toBe(3);

      const totalCount = await db.countTotalCardsCustomDeck(filterDeck.id);
      expect(totalCount).toBe(5);
    });
  });

  describe("Custom Deck Review Session Progress", () => {
    let scheduler: Scheduler;

    beforeEach(() => {
      const mockSettings = {
        review: { nextDayStartsAt: 4, showProgress: true, enableKeyboardShortcuts: true, sessionDuration: 25 },
        backup: { enableAutoBackup: false, maxBackups: 3 },
        debug: { enableLogging: false, performanceLogs: false },
      } as unknown as ConstructorParameters<typeof Scheduler>[1];
      const mockBackupService = {
        createBackup: jest.fn(),
      } as unknown as ConstructorParameters<typeof Scheduler>[2];
      scheduler = new Scheduler(db, mockSettings, mockBackupService);
    });

    it("should track session progress for manual custom decks", async () => {
      const { flashcards } = await createDeckWithCards("session-manual", 4);
      const customDeck = await customDeckService.createCustomDeck("Session Manual");

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      const groups = await customDeckService.getAllCustomDeckGroups();
      const group = groups.find(g => g.name === "Session Manual") as CustomDeckGroup;

      const session = await scheduler.startReviewSessionForCustomDeck(group);
      scheduler.setCurrentSession(session.sessionId);

      // Verify initial session state
      let progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress).not.toBeNull();
      expect(progress!.doneUnique).toBe(0);
      expect(progress!.goalTotal).toBe(4);

      // Rate first card
      await scheduler.rate(flashcards[0].id, "good");

      progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress!.doneUnique).toBe(1);
      expect(progress!.progress).toBeGreaterThan(0);

      // Rate second card
      await scheduler.rate(flashcards[1].id, "easy");

      progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress!.doneUnique).toBe(2);
    });

    it("should track session progress for filter decks", async () => {
      const { flashcards } = await createDeckWithCards("session-filter", 5);

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "is_new", value: "" }],
      };
      await customDeckService.createFilterDeck("Session Filter", filterDef);

      const groups = await customDeckService.getAllCustomDeckGroups();
      const group = groups.find(g => g.name === "Session Filter") as CustomDeckGroup;

      const session = await scheduler.startReviewSessionForCustomDeck(group);
      scheduler.setCurrentSession(session.sessionId);

      let progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress!.doneUnique).toBe(0);
      expect(progress!.goalTotal).toBe(5);

      // Rate a card
      await scheduler.rate(flashcards[0].id, "good");

      progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress!.doneUnique).toBe(1);
      expect(progress!.progress).toBeGreaterThan(0);
    });

    it("should track session progress for filter decks with OR logic", async () => {
      const { flashcards } = await createDeckWithCards("session-or", 6);

      // Make 2 cards due
      for (let i = 0; i < 2; i++) {
        await db.updateFlashcard(flashcards[i].id, {
          state: "review",
          dueDate: new Date(Date.now() - 86400000).toISOString(),
        });
      }
      // Remaining 4 are new

      const filterDef: FilterDefinition = {
        version: 1,
        logic: "OR",
        rules: [
          { field: "state", operator: "is_due", value: "" },
          { field: "state", operator: "is_new", value: "" },
        ],
      };
      await customDeckService.createFilterDeck("Session OR", filterDef);

      const groups = await customDeckService.getAllCustomDeckGroups();
      const group = groups.find(g => g.name === "Session OR") as CustomDeckGroup;

      const session = await scheduler.startReviewSessionForCustomDeck(group);
      scheduler.setCurrentSession(session.sessionId);

      let progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress!.doneUnique).toBe(0);
      // goalTotal = 2 due + 4 new = 6
      expect(progress!.goalTotal).toBe(6);

      // Rate a due card
      await scheduler.rate(flashcards[0].id, "good");

      progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress!.doneUnique).toBe(1);

      // Rate a new card
      await scheduler.rate(flashcards[3].id, "good");

      progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress!.doneUnique).toBe(2);
      expect(progress!.progress).toBeCloseTo((2 / 6) * 100, 1);
    });

    it("should not double-count when same card is reviewed twice in session", async () => {
      const { flashcards } = await createDeckWithCards("session-dedup", 3);
      const customDeck = await customDeckService.createCustomDeck("Session Dedup");

      await customDeckService.addFlashcards(
        customDeck.id,
        flashcards.map((f) => f.id)
      );

      const groups = await customDeckService.getAllCustomDeckGroups();
      const group = groups.find(g => g.name === "Session Dedup") as CustomDeckGroup;

      const session = await scheduler.startReviewSessionForCustomDeck(group);
      scheduler.setCurrentSession(session.sessionId);

      // Rate same card twice
      await scheduler.rate(flashcards[0].id, "again");
      await scheduler.rate(flashcards[0].id, "good");

      const progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress!.doneUnique).toBe(1);
    });
  });
});
