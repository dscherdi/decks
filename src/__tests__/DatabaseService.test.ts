import { MainDatabaseService } from "../database/MainDatabaseService";
import { Deck, Flashcard } from "../database/types";

// Mock sql.js to avoid memory issues
jest.mock("sql.js", () => ({
  __esModule: true,
  default: jest.fn(() =>
    Promise.resolve({
      Database: jest.fn().mockImplementation(() => ({
        prepare: jest.fn().mockReturnValue({
          bind: jest.fn(),
          step: jest.fn().mockReturnValue(false),
          get: jest.fn().mockReturnValue([]),
          free: jest.fn(),
          run: jest.fn(),
        }),
        run: jest.fn(),
        export: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
        close: jest.fn(),
        exec: jest.fn(),
      })),
    }),
  ),
}));

// Mock adapter
const mockAdapter = {
  exists: jest.fn().mockResolvedValue(false),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readBinary: jest.fn().mockResolvedValue(null),
  writeBinary: jest.fn().mockResolvedValue(undefined),
} as any;

describe("DatabaseService", () => {
  let dbService: MainDatabaseService;
  let mockDb: any;
  let mockStatement: any;
  const debugLog = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock statement
    mockStatement = {
      bind: jest.fn(),
      step: jest.fn().mockReturnValue(false),
      get: jest.fn().mockReturnValue([]),
      free: jest.fn(),
      run: jest.fn(),
    };

    // Setup mock database
    mockDb = {
      prepare: jest.fn().mockReturnValue(mockStatement),
      run: jest.fn(),
      export: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      close: jest.fn(),
      exec: jest.fn(),
    };

    // Create service
    dbService = new MainDatabaseService("test.db", mockAdapter, debugLog);

    // Mock the db instance to avoid initialization issues
    (dbService as any).db = mockDb;
    (dbService as any).SQL = { Database: jest.fn() };

    // Spy on executeSql method
    jest.spyOn(dbService, "executeSql").mockResolvedValue(undefined);
  });

  describe("initialization", () => {
    it("should create database service instance", () => {
      expect(dbService).toBeDefined();
    });

    it("should throw error when database not initialized", async () => {
      const uninitializedService = new MainDatabaseService(
        "test.db",
        mockAdapter,
        debugLog,
      );

      // Don't set the internal db property - leave it null
      await expect(uninitializedService.executeSql("SELECT 1")).rejects.toThrow(
        "Database not initialized",
      );
      await expect(uninitializedService.querySql("SELECT 1")).rejects.toThrow(
        "Database not initialized",
      );
    });
  });

  describe("deck operations", () => {
    describe("createDeck", () => {
      it("should create a new deck", async () => {
        const deck: Omit<Deck, "created" | "modified"> = {
          id: "deck_123",
          name: "Test Deck",
          filepath: "test.md",
          tag: "#flashcards/test",
          lastReviewed: null,
          config: {
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
          },
        };

        await dbService.createDeck(deck);

        expect(dbService.executeSql).toHaveBeenCalledWith(
          expect.stringContaining("INSERT INTO decks"),
          expect.any(Array),
        );
      });
    });

    describe("getAllDecks", () => {
      it("should retrieve all decks", async () => {
        mockStatement.step.mockReturnValueOnce(true).mockReturnValueOnce(false);

        mockStatement.get.mockReturnValueOnce([
          "deck_1",
          "Test Deck",
          "test.md",
          "#flashcards/test",
          null,
          '{"newCardsPerDay":20,"reviewCardsPerDay":100,"headerLevel":2,"reviewOrder":"due-date","fsrs":{"requestRetention":0.9,"profile":"STANDARD"}}',
          "2024-01-01",
          "2024-01-01",
        ]);

        const decks = await dbService.getAllDecks();

        expect(decks).toHaveLength(1);
        expect(decks[0].name).toBe("Test Deck");
        expect(mockDb.prepare).toHaveBeenCalled();
      });

      it("should handle malformed JSON config", async () => {
        mockStatement.step.mockReturnValueOnce(true).mockReturnValueOnce(false);
        mockStatement.get.mockReturnValueOnce([
          "deck_1",
          "Test Deck",
          "test.md",
          "#flashcards/test",
          null,
          "invalid json{",
          "2024-01-01",
          "2024-01-01",
        ]);

        const decks = await dbService.getAllDecks();

        expect(decks).toHaveLength(1);
        expect(decks[0].config).toBeDefined();
        expect(debugLog).toHaveBeenCalledWith(
          "Failed to parse deck config, using defaults:",
          expect.any(Error),
        );
      });
    });

    describe("updateDeck", () => {
      it("should update deck properties", async () => {
        const updates = {
          name: "Updated Deck Name",
          config: {
            hasNewCardsLimitEnabled: false,
            newCardsPerDay: 50,
            hasReviewCardsLimitEnabled: false,
            reviewCardsPerDay: 200,
            headerLevel: 2,
            reviewOrder: "random" as const,
            fsrs: {
              requestRetention: 0.8,
              profile: "INTENSIVE" as const,
            },
          },
        };

        await dbService.updateDeck("deck_1", updates);

        expect(dbService.executeSql).toHaveBeenCalledWith(
          expect.stringContaining("UPDATE decks"),
          expect.any(Array),
        );
      });
    });

    describe("deleteDeck", () => {
      it("should delete deck and associated flashcards", async () => {
        await dbService.deleteDeck("deck_1");

        expect(dbService.executeSql).toHaveBeenCalledWith(
          expect.stringContaining("DELETE FROM decks"),
          expect.any(Array),
        );
      });
    });
  });

  describe("flashcard operations", () => {
    describe("createFlashcard", () => {
      it("should create a new flashcard with INSERT OR REPLACE", async () => {
        const flashcard: Omit<Flashcard, "created" | "modified" | "id"> = {
          deckId: "deck_123",
          front: "What is 2+2?",
          back: "The answer is 4",
          type: "header-paragraph",
          sourceFile: "math.md",
          contentHash: "abc123",
          state: "new",
          dueDate: "2024-01-01T00:00:00.000Z",
          interval: 1440,
          repetitions: 0,
          difficulty: 0,
          stability: 0,
          lapses: 0,
          lastReviewed: null,
        };

        await dbService.createFlashcard(flashcard);

        expect(dbService.executeSql).toHaveBeenCalledWith(
          expect.stringContaining("INSERT INTO flashcards"),
          expect.any(Array),
        );
      });
    });

    describe("batchUpdateFlashcards", () => {
      it("should update multiple flashcards", async () => {
        const updates = [
          {
            id: "card_1",
            updates: {
              state: "review" as const,
              difficulty: 2.5,
            },
          },
        ];

        await dbService.batchUpdateFlashcards(updates);

        expect(dbService.executeSql).toHaveBeenCalled();
      });

      it("should handle empty updates array", async () => {
        await dbService.batchUpdateFlashcards([]);
        expect(dbService.executeSql).not.toHaveBeenCalled();
      });
    });

    describe("batchDeleteFlashcards", () => {
      it("should delete multiple flashcards", async () => {
        const flashcardIds = ["card_1", "card_2"];

        await dbService.batchDeleteFlashcards(flashcardIds);

        expect(dbService.executeSql).toHaveBeenCalledWith(
          expect.stringContaining("DELETE FROM flashcards"),
          expect.any(Array),
        );
      });

      it("should handle empty ID array", async () => {
        await dbService.batchDeleteFlashcards([]);
        expect(dbService.executeSql).not.toHaveBeenCalled();
      });
    });
  });

  describe("study statistics", () => {
    describe("getStudyStats", () => {
      it("should return study statistics from review logs", async () => {
        // Mock querySql to return the expected values directly
        jest
          .spyOn(dbService, "querySql")
          .mockResolvedValueOnce([{ total: 362492520 }]) // Mock for total time in ms
          .mockResolvedValueOnce([{ total: 62685600 }]); // Mock for past month time in ms

        const stats = await dbService.getStudyStats();

        expect(stats.totalHours).toBeCloseTo(100.69, 2);
        expect(stats.pastMonthHours).toBeCloseTo(17.41, 2);

        expect(dbService.querySql).toHaveBeenCalledTimes(2);
        expect(dbService.querySql).toHaveBeenCalledWith(
          "SELECT SUM(time_elapsed_ms) as total FROM review_logs",
          [],
          { asObject: true },
        );
        expect(dbService.querySql).toHaveBeenCalledWith(
          "SELECT SUM(time_elapsed_ms) as total FROM review_logs WHERE reviewed_at >= date('now', '-30 days')",
          [],
          { asObject: true },
        );
      });

      it("should handle null values gracefully", async () => {
        // Mock querySql to return null/undefined values
        jest
          .spyOn(dbService, "querySql")
          .mockResolvedValueOnce([{ total: null }]) // Mock for total time in ms (null)
          .mockResolvedValueOnce([{ total: null }]); // Mock for past month time in ms (null)

        const stats = await dbService.getStudyStats();

        expect(stats).toEqual({
          totalHours: 0,
          pastMonthHours: 0,
        });
      });

      it("should throw error when database not initialized", async () => {
        const uninitializedService = new MainDatabaseService(
          "test.db",
          mockAdapter,
          debugLog,
        );

        await expect(uninitializedService.getStudyStats()).rejects.toThrow(
          "Database not initialized",
        );
      });
    });
  });

  describe("database persistence", () => {
    it("should save database to file", async () => {
      await dbService.save();

      expect(mockDb.export).toHaveBeenCalled();
      expect(mockAdapter.writeBinary).toHaveBeenCalledWith(
        "test.db",
        expect.any(Uint8Array),
      );
    });

    it("should close database connection", async () => {
      await dbService.close();
      expect(mockDb.close).toHaveBeenCalled();
    });
  });
});
