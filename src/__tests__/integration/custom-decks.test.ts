import { MainDatabaseService } from "../../database/MainDatabaseService";
import { CustomDeckService } from "../../services/CustomDeckService";
import type { Deck, Flashcard } from "../../database/types";
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
});
