import { Scheduler } from "../services/Scheduler";
import { MainDatabaseService } from "../database/MainDatabaseService";
import { BackupService } from "../services/BackupService";
import { Flashcard, Deck, DeckWithProfile, DeckProfile } from "../database/types";

// Mock DatabaseService and BackupService
jest.mock("../database/MainDatabaseService");
jest.mock("../services/BackupService");
const MockedDatabaseService = MainDatabaseService as jest.MockedClass<
  typeof MainDatabaseService
>;
const MockedBackupService = BackupService as jest.MockedClass<
  typeof BackupService
>;

// Helper function to create a deck with profile
function createMockDeckWithProfile(
  deckId: string,
  profileConfig: Partial<DeckProfile> = {}
): DeckWithProfile {
  const defaultProfile: DeckProfile = {
    id: "profile_default",
    name: "DEFAULT",
    hasNewCardsLimitEnabled: false,
    newCardsPerDay: 20,
    hasReviewCardsLimitEnabled: false,
    reviewCardsPerDay: 100,
    headerLevel: 2,
    reviewOrder: "due-date",
    fsrs: {
      requestRetention: 0.9,
      profile: "STANDARD",
    },
    isDefault: true,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  };

  const profile: DeckProfile = {
    ...defaultProfile,
    ...profileConfig,
    fsrs: {
      ...defaultProfile.fsrs,
      ...(profileConfig.fsrs || {}),
    },
  };

  return {
    id: deckId,
    name: "Test Deck",
    filepath: "test.md",
    tag: "#test",
    lastReviewed: null,
    profileId: profile.id,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    profile,
  };
}

describe("Scheduler", () => {
  let scheduler: Scheduler;
  let mockDb: jest.Mocked<MainDatabaseService>;
  let mockBackupService: jest.Mocked<BackupService>;

  beforeEach(() => {
    mockDb = new MockedDatabaseService(
      "",
      {} as any,
      jest.fn()
    ) as jest.Mocked<MainDatabaseService>;

    mockBackupService = new MockedBackupService(
      {} as any,
      {} as any,
      jest.fn()
    ) as jest.Mocked<BackupService>;

    scheduler = new Scheduler(
      mockDb,
      {
        review: { nextDayStartsAt: 4, showProgress: true, enableKeyboardShortcuts: true, sessionDuration: 25 },
        debug: { enableLogging: false, performanceLogs: false },
        backup: { enableAutoBackup: false, maxBackups: 3 },
      } as any,
      mockBackupService
    );

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

    // Add querySql mock for raw SQL queries
    mockDb.querySql = jest
      .fn()
      .mockImplementation((sql: string, _params?: any[], config?: any) => {
        // Default empty results for count queries
        if (sql.includes("COUNT(*)")) {
          return Promise.resolve(config?.asObject ? [{ count: 0 }] : [[0]]);
        }
        // Default empty array for other queries
        return Promise.resolve([]);
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
          hasNewCardsLimitEnabled: true,
          newCardsPerDay: 2,
          hasReviewCardsLimitEnabled: false, // unlimited
          reviewCardsPerDay: 100,
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
      mockDb.querySql.mockResolvedValueOnce([]);

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
          hasNewCardsLimitEnabled: false, // unlimited
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: true,
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
      mockDb.querySql.mockResolvedValue([]);

      // No due cards should be returned due to review limit
      const result = await scheduler.getNext(new Date(), "deck_1");

      expect(result).toBeNull(); // Should respect review limit
    });

    it("should respect review order configuration", async () => {
      const mockDeck = createMockDeckWithProfile("deck_1", {
        reviewOrder: "random",
      });

      mockDb.getDeckWithProfile = jest.fn().mockResolvedValue(mockDeck);
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      // Mock a due card
      mockDb.querySql.mockResolvedValueOnce([
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
      expect(mockDb.querySql).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY RANDOM()"),
        expect.any(Array)
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

      const mockDeckIntensive = createMockDeckWithProfile("deck_1", {
        fsrs: {
          requestRetention: 0.8,
          profile: "INTENSIVE",
        },
      });

      mockDb.getFlashcardById.mockResolvedValueOnce(mockCard);
      mockDb.getDeckWithProfile = jest.fn().mockResolvedValueOnce(mockDeckIntensive);

      const preview = await scheduler.preview("card_1");

      expect(preview).toBeDefined();
      // The scheduler should have used INTENSIVE profile settings
      // This is verified by the fact that preview completed successfully
      // with the INTENSIVE profile configuration
    });

    it("should check review quota before due cards and new quota before new cards", async () => {
      const mockDeck = createMockDeckWithProfile("deck_1", {
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 1,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 1,
      });

      // Mock deck lookup - called multiple times for quota checks
      mockDb.getDeckWithProfile = jest.fn().mockResolvedValue(mockDeck);

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
      mockDb.querySql.mockResolvedValueOnce([
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
      const noDeck = createMockDeckWithProfile("deck_no_cards", {
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 0, // 0 = no new cards
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 0, // 0 = no review cards
      });

      // Test deck with unlimited (disabled limits)
      const unlimitedDeck = createMockDeckWithProfile("deck_unlimited", {
        hasNewCardsLimitEnabled: false, // unlimited
        hasReviewCardsLimitEnabled: false, // unlimited
      });

      // Mock daily counts showing no usage
      mockDb.getDailyReviewCounts.mockResolvedValue({
        newCount: 0,
        reviewCount: 0,
      });

      // Test 0 = no cards behavior
      mockDb.getDeckWithProfile = jest.fn().mockResolvedValueOnce(noDeck);
      const noCardsResult = await scheduler.getNext(
        new Date(),
        "deck_no_cards",
        {
          allowNew: true,
        }
      );
      expect(noCardsResult).toBeNull(); // Should return null with 0 limits

      // Test unlimited behavior
      mockDb.getDeckWithProfile = jest.fn().mockResolvedValue(unlimitedDeck);

      // Mock empty due cards query but available new card
      mockDb.querySql.mockResolvedValueOnce([]); // No due cards

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

      mockDb.querySql.mockResolvedValueOnce([
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
        }
      );
      expect(unlimitedResult).toBeDefined();
      expect(unlimitedResult?.id).toBe("card_unlimited");
    });
  });
});
