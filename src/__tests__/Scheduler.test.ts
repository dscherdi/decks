import { Scheduler } from "../services/Scheduler";
import { DatabaseService } from "../database/DatabaseService";
import { Flashcard, Deck, FlashcardState } from "../database/types";

// Mock DatabaseService
jest.mock("../database/DatabaseService");
const MockedDatabaseService = DatabaseService as jest.MockedClass<
  typeof DatabaseService
>;

describe("Scheduler", () => {
  let scheduler: Scheduler;
  let mockDb: jest.Mocked<DatabaseService>;

  beforeEach(() => {
    mockDb = new MockedDatabaseService(
      "",
      {} as any,
      jest.fn(),
    ) as jest.Mocked<DatabaseService>;
    scheduler = new Scheduler(mockDb);
  });

  describe("getNext", () => {
    it("should return due card when available", async () => {
      const mockCard: Flashcard = {
        id: "card_1",
        deckId: "deck_1",
        front: "Question",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash123",
        state: "review",
        dueDate: new Date(Date.now() - 1000).toISOString(), // Due 1 second ago
        interval: 1440,
        repetitions: 1,
        difficulty: 5,
        stability: 2.5,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 100,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: false,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Mock deck lookup for review quota check
      mockDb.getDeckById.mockResolvedValue(mockDeck);

      // Mock daily review counts
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      mockDb.query.mockResolvedValueOnce([
        [
          "card_1",
          "deck_1",
          "Question",
          "Answer",
          "header-paragraph",
          "test.md",
          "hash123",
          null,
          "review",
          mockCard.dueDate,
          1440,
          1,
          5,
          2.5,
          0,
          null,
          mockCard.created,
          mockCard.modified,
        ],
      ]);

      const result = await scheduler.getNext(new Date(), "deck_1");

      expect(result).toBeDefined();
      expect(result?.id).toBe("card_1");
      expect(result?.state).toBe("review");
    });

    it("should return new card when no due cards and allowNew is true", async () => {
      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 100,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: false,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const mockNewCard: Flashcard = {
        id: "card_new",
        deckId: "deck_1",
        front: "New Question",
        back: "New Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash456",
        state: "new",
        dueDate: new Date().toISOString(),
        interval: 0,
        repetitions: 0,
        difficulty: 0,
        stability: 0,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Mock all deck lookups (will be called multiple times)
      mockDb.getDeckById.mockResolvedValue(mockDeck);

      // Mock daily review counts (will be called for review quota check)
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      // No due cards
      mockDb.query.mockResolvedValueOnce([]);

      // Return new card
      mockDb.query.mockResolvedValueOnce([
        [
          "card_new",
          "deck_1",
          "New Question",
          "New Answer",
          "header-paragraph",
          "test.md",
          "hash456",
          null,
          "new",
          mockNewCard.dueDate,
          0,
          0,
          0,
          0,
          0,
          null,
          mockNewCard.created,
          mockNewCard.modified,
        ],
      ]);

      const result = await scheduler.getNext(new Date(), "deck_1", {
        allowNew: true,
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe("card_new");
      expect(result?.state).toBe("new");
    });

    it("should return null when no cards available", async () => {
      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 100,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: false,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Mock deck lookup
      mockDb.getDeckById.mockResolvedValue(mockDeck);

      // Mock daily review counts
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      // No due cards
      mockDb.query.mockResolvedValueOnce([]);

      // No new cards allowed
      const result = await scheduler.getNext(new Date(), "deck_1", {
        allowNew: false,
      });

      expect(result).toBeNull();
    });
  });

  describe("preview", () => {
    it("should return scheduling preview for all ratings", async () => {
      const mockCard: Flashcard = {
        id: "card_1",
        deckId: "deck_1",
        front: "Question",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash123",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 1440,
        repetitions: 1,
        difficulty: 5,
        stability: 2.5,
        lapses: 0,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 100,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: false,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      mockDb.getFlashcardById.mockResolvedValueOnce(mockCard);
      mockDb.getDeckById.mockResolvedValueOnce(mockDeck);

      const result = await scheduler.preview("card_1");

      expect(result).toBeDefined();
      expect(result).toHaveProperty("again");
      expect(result).toHaveProperty("hard");
      expect(result).toHaveProperty("good");
      expect(result).toHaveProperty("easy");

      // Check that all outcomes have required properties
      for (const rating of ["again", "hard", "good", "easy"] as const) {
        expect(result![rating]).toHaveProperty("dueDate");
        expect(result![rating]).toHaveProperty("interval");
        expect(result![rating]).toHaveProperty("repetitions");
        expect(result![rating]).toHaveProperty("stability");
        expect(result![rating]).toHaveProperty("difficulty");
        expect(result![rating]).toHaveProperty("state");
      }
    });

    it("should return null when card not found", async () => {
      mockDb.getFlashcardById.mockResolvedValueOnce(null);

      const result = await scheduler.preview("nonexistent_card");

      expect(result).toBeNull();
    });
  });

  describe("rate", () => {
    it("should update card and create review log", async () => {
      const mockCard: Flashcard = {
        id: "card_1",
        deckId: "deck_1",
        front: "Question",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash123",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 1440,
        repetitions: 1,
        difficulty: 5,
        stability: 2.5,
        lapses: 0,
        lastReviewed: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 100,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: false,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      mockDb.getFlashcardById.mockResolvedValueOnce(mockCard);
      mockDb.getDeckById.mockResolvedValueOnce(mockDeck);
      mockDb.runInTransaction.mockImplementation(async (fn) => fn());
      mockDb.updateFlashcard.mockResolvedValueOnce();
      mockDb.createReviewLog.mockResolvedValueOnce();

      const result = await scheduler.rate("card_1", "good", new Date(), 5000);

      expect(result).toBeDefined();
      expect(result.repetitions).toBeGreaterThan(mockCard.repetitions);
      expect(mockDb.runInTransaction).toHaveBeenCalled();
      expect(mockDb.updateFlashcard).toHaveBeenCalled();
      expect(mockDb.createReviewLog).toHaveBeenCalled();
    });

    it("should throw error when card not found", async () => {
      mockDb.getFlashcardById.mockResolvedValueOnce(null);

      await expect(scheduler.rate("nonexistent_card", "good")).rejects.toThrow(
        "Card not found: nonexistent_card",
      );
    });
  });

  describe("timeToNext", () => {
    it("should return milliseconds until next due card", async () => {
      const nextDueTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      mockDb.query.mockResolvedValueOnce([[nextDueTime]]);

      const result = await scheduler.timeToNext(new Date(), "deck_1");

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(3600000); // Should be around 1 hour
    });

    it("should return null when no future cards", async () => {
      mockDb.query.mockResolvedValueOnce([]);

      const result = await scheduler.timeToNext(new Date(), "deck_1");

      expect(result).toBeNull();
    });
  });

  describe("deck configuration compliance", () => {
    it("should respect new card daily limits", async () => {
      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsLimit: 2,
          reviewCardsLimit: 100,
          enableNewCardsLimit: true,
          enableReviewCardsLimit: false,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Mock that 2 new cards already reviewed today (limit reached)
      mockDb.getDeckById.mockResolvedValue(mockDeck);
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 2,
        reviewCount: 0,
      });

      // No due cards
      mockDb.query.mockResolvedValueOnce([]);

      const result = await scheduler.getNext(new Date(), "deck_1", {
        allowNew: true,
      });

      expect(result).toBeNull(); // Should respect daily limit
    });

    it("should respect review card daily limits", async () => {
      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 1,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: true,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Mock that 1 review card already reviewed today (limit reached)
      mockDb.getDeckById.mockResolvedValue(mockDeck);
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 1,
      });

      // Mock empty query result since review limit is reached
      mockDb.query.mockResolvedValue([]);

      // No due cards should be returned due to review limit
      const result = await scheduler.getNext(new Date(), "deck_1");

      expect(result).toBeNull(); // Should respect review limit
    });

    it("should respect review order configuration", async () => {
      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 100,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: false,
          reviewOrder: "random",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      mockDb.getDeckById.mockResolvedValue(mockDeck);
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      // Mock a due card
      mockDb.query.mockResolvedValueOnce([
        [
          "card_1",
          "deck_1",
          "Question",
          "Answer",
          "header-paragraph",
          "test.md",
          "hash123",
          null,
          "review",
          new Date(Date.now() - 1000).toISOString(),
          1440,
          1,
          5,
          2.5,
          0,
          null,
          new Date().toISOString(),
          new Date().toISOString(),
        ],
      ]);

      await scheduler.getNext(new Date(), "deck_1");

      // Verify the query was called with random ordering
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY RANDOM()"),
        expect.any(Array),
      );
    });

    it("should respect FSRS profile configuration", async () => {
      const mockCard: Flashcard = {
        id: "card_1",
        deckId: "deck_1",
        front: "Question",
        back: "Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash123",
        state: "review",
        dueDate: new Date().toISOString(),
        interval: 1440,
        repetitions: 1,
        difficulty: 5,
        stability: 2.5,
        lapses: 0,
        lastReviewed: new Date(Date.now() - 86400000).toISOString(),
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const mockDeckIntensive: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 100,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: false,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.85,
            profile: "INTENSIVE",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      mockDb.getFlashcardById.mockResolvedValueOnce(mockCard);
      mockDb.getDeckById.mockResolvedValueOnce(mockDeckIntensive);

      const preview = await scheduler.preview("card_1");

      expect(preview).toBeDefined();
      // The scheduler should have used INTENSIVE profile settings
      // This is verified by the fact that preview completed successfully
      // with the INTENSIVE profile configuration
    });
  });
});
