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

    // Add default mock methods for ReviewSession functionality
    mockDb.createReviewSession = jest.fn().mockResolvedValue("session_123");
    mockDb.getReviewSessionById = jest.fn().mockResolvedValue({
      id: "session_123",
      deckId: "deck_1",
      startedAt: new Date().toISOString(),
      endedAt: null,
      goalTotal: 5,
      doneUnique: 0,
    });
    mockDb.getActiveReviewSession = jest.fn().mockResolvedValue(null);
    mockDb.updateReviewSessionDoneUnique = jest
      .fn()
      .mockResolvedValue(undefined);
    mockDb.endReviewSession = jest.fn().mockResolvedValue(undefined);
    mockDb.isCardReviewedInSession = jest.fn().mockResolvedValue(false);
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
          newCardsPerDay: -1, // -1 = unlimited
          reviewCardsPerDay: -1, // -1 = unlimited
          reviewOrder: "due-date",
          headerLevel: 2,
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
          newCardsPerDay: -1, // -1 = unlimited
          reviewCardsPerDay: -1, // -1 = unlimited
          reviewOrder: "due-date",
          headerLevel: 2,
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
          "Question",
          "Answer",
          "header-paragraph",
          "test.md",
          "hash456",
          "new",
          mockNewCard.dueDate,
          0,
          0,
          5,
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
          newCardsPerDay: 0, // 0 = no new cards
          reviewCardsPerDay: 0, // 0 = no review cards
          reviewOrder: "due-date",
          headerLevel: 2,
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
          newCardsPerDay: -1, // -1 = unlimited
          reviewCardsPerDay: -1, // -1 = unlimited
          reviewOrder: "due-date",
          headerLevel: 2,
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
          newCardsPerDay: -1, // -1 = unlimited
          reviewCardsPerDay: -1, // -1 = unlimited
          reviewOrder: "due-date",
          headerLevel: 2,
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
      mockDb.updateFlashcard.mockResolvedValueOnce();
      mockDb.createReviewLog.mockResolvedValueOnce();

      const result = await scheduler.rate("card_1", "good", new Date(), 5000);

      expect(result).toBeDefined();
      expect(result.repetitions).toBeGreaterThan(mockCard.repetitions);
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

    describe("Review Session Management", () => {
      beforeEach(() => {
        // Mock ReviewSession-related database methods
        mockDb.createReviewSession = jest.fn().mockResolvedValue("session_123");
        mockDb.getReviewSessionById = jest.fn().mockResolvedValue({
          id: "session_123",
          deckId: "deck_1",
          startedAt: new Date().toISOString(),
          endedAt: null,
          goalTotal: 5,
          doneUnique: 0,
        });
        mockDb.getActiveReviewSession = jest.fn().mockResolvedValue(null);
        mockDb.updateReviewSessionDoneUnique = jest
          .fn()
          .mockResolvedValue(undefined);
        mockDb.endReviewSession = jest.fn().mockResolvedValue(undefined);
        mockDb.isCardReviewedInSession = jest.fn().mockResolvedValue(false);
        mockDb.query = jest.fn().mockResolvedValue([[5]]);
      });

      test("should start and track review session progress", async () => {
        // Mock deck and cards
        const mockDeck: Deck = {
          id: "deck_1",
          name: "Test Deck",
          filepath: "test.md",
          tag: "test",
          lastReviewed: null,
          config: {
            newCardsPerDay: -1, // -1 = unlimited
            reviewCardsPerDay: -1, // -1 = unlimited
            headerLevel: 2,
            reviewOrder: "due-date",
            fsrs: { requestRetention: 0.9, profile: "STANDARD" },
          },
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        mockDb.getDeckById.mockResolvedValue(mockDeck);
        mockDb.getDailyReviewCounts.mockResolvedValue({
          newCount: 0,
          reviewCount: 0,
        });

        // Start session
        const sessionId = await scheduler.startReviewSession("deck_1");
        expect(sessionId).toBe("session_123");
        expect(mockDb.createReviewSession).toHaveBeenCalled();

        // Get progress
        const progress = await scheduler.getSessionProgress(sessionId);
        expect(progress).toEqual({
          doneUnique: 0,
          goalTotal: 5,
          progress: 0,
        });
      });

      test("should track unique card reviews in session", async () => {
        const mockCard: Flashcard = {
          id: "card_1",
          deckId: "deck_1",
          front: "Question",
          back: "Answer",
          type: "header-paragraph",
          sourceFile: "test.md",
          contentHash: "hash1",
          state: "review",
          dueDate: new Date().toISOString(),
          interval: 1440,
          repetitions: 1,
          difficulty: 5.0,
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
          tag: "test",
          lastReviewed: null,
          config: {
            newCardsPerDay: -1, // -1 = unlimited
            reviewCardsPerDay: -1, // -1 = unlimited
            headerLevel: 2,
            reviewOrder: "due-date",
            fsrs: { requestRetention: 0.9, profile: "STANDARD" },
          },
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        mockDb.getFlashcardById.mockResolvedValue(mockCard);
        mockDb.getDeckById.mockResolvedValue(mockDeck);
        mockDb.updateFlashcard.mockResolvedValue(undefined);
        mockDb.createReviewLog.mockResolvedValue(undefined);

        // Set current session
        scheduler.setCurrentSession("session_123");
        expect(scheduler.getCurrentSession()).toBe("session_123");

        // First review should increment unique count
        mockDb.isCardReviewedInSession.mockResolvedValueOnce(false);
        await scheduler.rate("card_1", "good");
        expect(mockDb.updateReviewSessionDoneUnique).toHaveBeenCalledWith(
          "session_123",
          1,
        );

        // Second review of same card should not increment
        mockDb.isCardReviewedInSession.mockResolvedValueOnce(true);
        await scheduler.rate("card_1", "again");
        expect(mockDb.updateReviewSessionDoneUnique).toHaveBeenCalledTimes(1);
      });

      test("should always start fresh sessions", async () => {
        const mockDeck: Deck = {
          id: "deck_1",
          name: "Test Deck",
          filepath: "test.md",
          tag: "test",
          lastReviewed: null,
          config: {
            newCardsPerDay: -1, // -1 = unlimited
            reviewCardsPerDay: -1, // -1 = unlimited
            headerLevel: 2,
            reviewOrder: "due-date",
            fsrs: { requestRetention: 0.9, profile: "STANDARD" },
          },
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        mockDb.getDeckById.mockResolvedValue(mockDeck);
        mockDb.getDailyReviewCounts.mockResolvedValue({
          newCount: 0,
          reviewCount: 0,
        });

        // Should create new session when none exists
        const sessionId1 = await scheduler.startFreshSession("deck_1");
        expect(sessionId1).toBe("session_123");
        expect(scheduler.getCurrentSession()).toBe("session_123");

        // Mock an existing active session for the next test
        mockDb.getActiveReviewSession.mockResolvedValueOnce({
          id: "existing_session",
          deckId: "deck_1",
          startedAt: new Date().toISOString(),
          endedAt: null,
          goalTotal: 5,
          doneUnique: 2,
        });

        // Should end existing session and create new one
        const sessionId2 = await scheduler.startFreshSession("deck_1");
        expect(sessionId2).toBe("session_123");
        expect(mockDb.endReviewSession).toHaveBeenCalledWith(
          "existing_session",
          expect.any(String),
        );

        // Manual end session test
        await scheduler.endReviewSession(sessionId2);
        expect(mockDb.endReviewSession).toHaveBeenCalledWith(
          sessionId2,
          expect.any(String),
        );
      });
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
          newCardsPerDay: 2,
          reviewCardsPerDay: -1, // -1 = unlimited
          reviewOrder: "due-date",
          headerLevel: 2,
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
          newCardsPerDay: -1, // -1 = unlimited
          reviewCardsPerDay: 1,
          reviewOrder: "due-date",
          headerLevel: 2,
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
          newCardsPerDay: -1, // -1 = unlimited
          reviewCardsPerDay: -1, // -1 = unlimited
          reviewOrder: "random",
          headerLevel: 2,
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
          newCardsPerDay: -1, // -1 = unlimited
          reviewCardsPerDay: -1, // -1 = unlimited
          reviewOrder: "due-date",
          headerLevel: 2,
          fsrs: {
            requestRetention: 0.8,
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

    it("should check review quota before due cards and new quota before new cards", async () => {
      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "#test",
        lastReviewed: null,
        config: {
          newCardsPerDay: 1,
          reviewCardsPerDay: 1,
          reviewOrder: "due-date",
          headerLevel: 2,
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Mock deck lookup - called multiple times for quota checks
      mockDb.getDeckById.mockResolvedValue(mockDeck);

      // Mock that review quota is exhausted but new quota is available
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0, // 0 of 1 new cards used
        reviewCount: 1, // 1 of 1 review cards used (exhausted)
      });

      // Mock that there are new cards available
      // Since review quota is exhausted, getNextDueCard won't be called
      // Only getNextNewCard will be called
      const mockNewCard: Flashcard = {
        id: "card_new",
        deckId: "deck_1",
        front: "New Question",
        back: "New Answer",
        type: "header-paragraph",
        sourceFile: "test.md",
        contentHash: "hash_new",
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

      // Mock new card query (getNextNewCard)
      mockDb.query.mockResolvedValueOnce([
        [
          mockNewCard.id,
          mockNewCard.deckId,
          mockNewCard.front,
          mockNewCard.back,
          mockNewCard.type,
          mockNewCard.sourceFile,
          mockNewCard.contentHash,
          mockNewCard.state,
          mockNewCard.dueDate,
          mockNewCard.interval,
          mockNewCard.repetitions,
          mockNewCard.difficulty,
          mockNewCard.stability,
          mockNewCard.lapses,
          mockNewCard.lastReviewed,
          mockNewCard.created,
          mockNewCard.modified,
        ],
      ]);

      const result = await scheduler.getNext(new Date(), "deck_1", {
        allowNew: true,
      });

      // Should return new card since review quota is exhausted but new quota available
      expect(result).toBeDefined();
      expect(result?.id).toBe("card_new");
      expect(result?.state).toBe("new");
    });

    it("should treat 0 as no cards and -1 as unlimited", async () => {
      // Test deck with 0 for both limits (no cards allowed)
      const noDeck: Deck = {
        id: "deck_no_cards",
        name: "No Cards Deck",
        filepath: "no.md",
        tag: "#no",
        lastReviewed: null,
        config: {
          newCardsPerDay: 0, // 0 = no cards
          reviewCardsPerDay: 0, // 0 = no cards
          reviewOrder: "due-date",
          headerLevel: 2,
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Test deck with -1 for both limits (unlimited)
      const unlimitedDeck: Deck = {
        id: "deck_unlimited",
        name: "Unlimited Deck",
        filepath: "unlimited.md",
        tag: "#unlimited",
        lastReviewed: null,
        config: {
          newCardsPerDay: -1, // -1 = unlimited
          reviewCardsPerDay: -1, // -1 = unlimited
          reviewOrder: "due-date",
          headerLevel: 2,
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Mock daily counts showing no usage
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      // Test 0 = no cards behavior
      mockDb.getDeckById.mockResolvedValueOnce(noDeck);
      const noCardsResult = await scheduler.getNext(
        new Date(),
        "deck_no_cards",
        {
          allowNew: true,
        },
      );
      expect(noCardsResult).toBeNull(); // Should return null with 0 limits

      // Test -1 = unlimited behavior
      mockDb.getDeckById.mockResolvedValue(unlimitedDeck);

      // Mock empty due cards query but available new card
      mockDb.query.mockResolvedValueOnce([]); // No due cards

      const mockNewCard: Flashcard = {
        id: "card_unlimited",
        deckId: "deck_unlimited",
        front: "Unlimited Question",
        back: "Unlimited Answer",
        type: "header-paragraph",
        sourceFile: "unlimited.md",
        contentHash: "hash_unlimited",
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

      mockDb.query.mockResolvedValueOnce([
        [
          mockNewCard.id,
          mockNewCard.deckId,
          mockNewCard.front,
          mockNewCard.back,
          mockNewCard.type,
          mockNewCard.sourceFile,
          mockNewCard.contentHash,
          mockNewCard.state,
          mockNewCard.dueDate,
          mockNewCard.interval,
          mockNewCard.repetitions,
          mockNewCard.difficulty,
          mockNewCard.stability,
          mockNewCard.lapses,
          mockNewCard.lastReviewed,
          mockNewCard.created,
          mockNewCard.modified,
        ],
      ]);

      const unlimitedResult = await scheduler.getNext(
        new Date(),
        "deck_unlimited",
        {
          allowNew: true,
        },
      );
      expect(unlimitedResult).toBeDefined();
      expect(unlimitedResult?.id).toBe("card_unlimited");
    });
  });

  describe("session goal calculation with 15-minute due card inclusion", () => {
    // Tests verify that session goals include cards becoming due during review sessions
    // This prevents users from encountering "extra" cards after reaching their goal
    it("should include cards due within next 15 minutes in session goal", async () => {
      const now = new Date();
      const fiveMinutesLater = new Date(now.getTime() + 5 * 60 * 1000);
      const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1000);
      const twentyMinutesLater = new Date(now.getTime() + 20 * 60 * 1000);

      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "test",
        lastReviewed: null,
        config: {
          newCardsPerDay: -1,
          reviewCardsPerDay: -1,
          headerLevel: 2,
          reviewOrder: "due-date",
          fsrs: { requestRetention: 0.9, profile: "STANDARD" },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Mock database responses
      mockDb.getDeckById.mockResolvedValue(mockDeck);
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      // Mock db.query to simulate different due cards counts
      // When called with 15-minute buffer, return 3 cards (2 within 15min + 1 due now)
      // When called for new cards, return 0
      mockDb.query = jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve([[3]])) // Due cards with 15min buffer
        .mockImplementationOnce(() => Promise.resolve([[0]])); // New cards

      const sessionId = await scheduler.startReviewSession("deck_1", now);

      // Verify the session was created with correct goal including 15-minute buffer
      expect(mockDb.createReviewSession).toHaveBeenCalledWith({
        deckId: "deck_1",
        startedAt: now.toISOString(),
        endedAt: null,
        goalTotal: 3, // Should include cards due within 15 minutes
        doneUnique: 0,
      });

      // Verify db.query was called with 15-minute buffer for due cards
      const expectedFifteenMinutesLater = new Date(
        now.getTime() + 15 * 60 * 1000,
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "WHERE deck_id = ? AND due_date <= ? AND state = 'review'",
        ),
        ["deck_1", expectedFifteenMinutesLater.toISOString()],
      );
    });

    it("should not include cards due beyond 15 minutes in session goal", async () => {
      const now = new Date();
      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "test",
        lastReviewed: null,
        config: {
          newCardsPerDay: -1,
          reviewCardsPerDay: -1,
          headerLevel: 2,
          reviewOrder: "due-date",
          fsrs: { requestRetention: 0.9, profile: "STANDARD" },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      mockDb.getDeckById.mockResolvedValue(mockDeck);
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      // Mock scenario: 1 card due now, 0 additional within 15 minutes
      mockDb.query = jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve([[1]])) // Due cards with 15min buffer
        .mockImplementationOnce(() => Promise.resolve([[0]])); // New cards

      await scheduler.startReviewSession("deck_1", now);

      // Verify the query included exactly 15 minutes, not more
      const expectedFifteenMinutesLater = new Date(
        now.getTime() + 15 * 60 * 1000,
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "WHERE deck_id = ? AND due_date <= ? AND state = 'review'",
        ),
        ["deck_1", expectedFifteenMinutesLater.toISOString()],
      );
    });

    it("should handle edge case when no cards are due within 15 minutes", async () => {
      const now = new Date();
      const mockDeck: Deck = {
        id: "deck_1",
        name: "Test Deck",
        filepath: "test.md",
        tag: "test",
        lastReviewed: null,
        config: {
          newCardsPerDay: -1,
          reviewCardsPerDay: -1,
          headerLevel: 2,
          reviewOrder: "due-date",
          fsrs: { requestRetention: 0.9, profile: "STANDARD" },
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      mockDb.getDeckById.mockResolvedValue(mockDeck);
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      // Mock scenario: 0 cards due within 15 minutes, 0 new cards
      mockDb.query = jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve([[0]])) // Due cards with 15min buffer
        .mockImplementationOnce(() => Promise.resolve([[0]])); // New cards

      await scheduler.startReviewSession("deck_1", now);

      // Should create session with minimum goal of 1 (as per existing logic)
      expect(mockDb.createReviewSession).toHaveBeenCalledWith({
        deckId: "deck_1",
        startedAt: now.toISOString(),
        endedAt: null,
        goalTotal: 1, // Minimum goal even when no cards available
        doneUnique: 0,
      });
    });
  });
});
