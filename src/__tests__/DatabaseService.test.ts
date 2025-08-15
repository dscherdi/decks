import { DatabaseService } from "../database/DatabaseService";
import { Deck, Flashcard, DeckStats } from "../database/types";
import initSqlJs from "sql.js";
import { DataAdapter } from "obsidian";

// Mock sql.js
jest.mock("sql.js");

// Mock types
interface MockDataAdapter extends Partial<DataAdapter> {
  exists: jest.Mock;
  mkdir: jest.Mock;
  readBinary: jest.Mock;
  writeBinary: jest.Mock;
}

interface MockGlobal {
  window: {
    app: {
      vault: {
        adapter: MockDataAdapter;
      };
    };
  };
}

// Mock window.app.vault.adapter
const mockAdapter: MockDataAdapter = {
  exists: jest.fn(),
  mkdir: jest.fn(),
  readBinary: jest.fn(),
  writeBinary: jest.fn(),
};

(global as unknown as MockGlobal).window = {
  app: {
    vault: {
      adapter: mockAdapter,
    },
  },
};

describe("DatabaseService", () => {
  let dbService: DatabaseService;
  let mockDb: any;
  let mockStatement: any;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock statement
    mockStatement = {
      bind: jest.fn(),
      step: jest.fn(),
      get: jest.fn(),
      free: jest.fn(),
      run: jest.fn(),
    };

    // Setup mock database
    mockDb = {
      prepare: jest.fn(),
      run: jest.fn(),
      export: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      close: jest.fn(),
      exec: jest.fn(),
    };

    // Mock initSqlJs
    (initSqlJs as jest.MockedFunction<typeof initSqlJs>).mockResolvedValue({
      Database: jest.fn().mockImplementation(() => mockDb),
      Statement: jest.fn(),
    } as any);

    // Mock adapter methods
    mockAdapter.exists.mockResolvedValue(false);
    mockAdapter.mkdir.mockResolvedValue(undefined);
    mockAdapter.readBinary.mockResolvedValue(null);
    mockAdapter.writeBinary.mockResolvedValue(undefined);

    // Mock PRAGMA table_info for migration
    const mockPragmaStatement = {
      step: jest.fn().mockReturnValue(false), // Return false to indicate no columns (new schema)
      get: jest.fn(),
      free: jest.fn(),
      bind: jest.fn(),
      run: jest.fn(),
    };

    // Mock sqlite_master query for table existence checks
    const mockTableExistsStatement = {
      step: jest.fn().mockReturnValue(false), // Return false to indicate no tables exist
      get: jest.fn(),
      free: jest.fn(),
      bind: jest.fn(),
      run: jest.fn(),
    };

    // Setup database prepare to return different mocks based on query
    mockDb.prepare.mockImplementation((sql: string) => {
      if (sql.includes("PRAGMA table_info")) {
        // Return statement that indicates new schema (no columns returned)
        return mockPragmaStatement;
      }
      if (sql.includes("sqlite_master")) {
        // Return statement for table existence checks
        return mockTableExistsStatement;
      }
      return mockStatement;
    });

    // Create service
    dbService = new DatabaseService(
      "test.db",
      mockAdapter as DataAdapter,
      () => {},
    ); // Empty debugLog for tests
    await dbService.initialize();
  });

  afterEach(async () => {
    await dbService.close();
  });

  describe("initialization", () => {
    it("should initialize database and create tables", async () => {
      expect(initSqlJs).toHaveBeenCalled();
      expect(mockDb.run).toHaveBeenCalled();

      // Check if migration SQL was executed (now includes transaction wrapper)
      const createTableCalls = mockDb.run.mock.calls;
      const allSql = createTableCalls.map((call) => call[0]).join(" ");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS decks");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS flashcards");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS review_logs");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS review_sessions");
    });

    it("should load existing database if file exists", async () => {
      // Reset and setup for existing database
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.readBinary.mockResolvedValue(new ArrayBuffer(8));

      const dbService2 = new DatabaseService(
        "existing.db",
        mockAdapter as DataAdapter,
        () => {},
      ); // Empty debugLog for tests
      await dbService2.initialize();

      expect(mockAdapter.readBinary).toHaveBeenCalledWith("existing.db");
    });
  });

  describe("deck operations", () => {
    let mockStatement: any;

    beforeEach(() => {
      mockStatement = {
        bind: jest.fn(),
        step: jest.fn(),
        get: jest.fn(),
        free: jest.fn(),
        run: jest.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);
    });

    describe("createDeck", () => {
      it("should create a new deck", async () => {
        const deck: Omit<Deck, "created" | "modified"> = {
          id: "deck_123",
          name: "Test Deck",
          filepath: "test.md",
          tag: "#flashcards/test",
          lastReviewed: null,
          config: {
            newCardsPerDay: 0,
            reviewCardsPerDay: 0,
            reviewOrder: "due-date",
            headerLevel: 2,
            fsrs: {
              requestRetention: 0.9,
              profile: "STANDARD",
            },
          },
        };

        const result = await dbService.createDeck(deck);

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("INSERT OR REPLACE INTO decks"),
        );
        expect(mockStatement.run).toHaveBeenCalledWith([
          deck.id,
          deck.name,
          deck.filepath,
          deck.tag,
          deck.lastReviewed,
          expect.any(String), // config JSON
          expect.any(String), // created timestamp
          expect.any(String), // modified timestamp
        ]);
        expect(result).toEqual({
          ...deck,
          created: expect.any(String),
          modified: expect.any(String),
        });
      });
    });

    describe("getDeckByTag", () => {
      it("should retrieve deck by tag", async () => {
        mockStatement.step.mockReturnValue(true);
        mockStatement.get.mockReturnValue([
          "deck_123",
          "Test Deck",
          "test.md",
          "#flashcards/test",
          null,
          '{"newCardsPerDay":20,"reviewCardsPerDay":100,"headerLevel":2,"reviewOrder":"due-date","fsrs":{"requestRetention":0.9,"profile":"STANDARD"}}',
          "2024-01-01",
          "2024-01-01",
        ]);

        const result = await dbService.getDeckByTag("#flashcards/test");

        expect(mockDb.prepare).toHaveBeenCalledWith(
          "SELECT * FROM decks WHERE tag = ?",
        );
        expect(mockStatement.bind).toHaveBeenCalledWith(["#flashcards/test"]);
        expect(result).toEqual({
          id: "deck_123",
          name: "Test Deck",
          filepath: "test.md",
          tag: "#flashcards/test",
          lastReviewed: null,
          config: {
            newCardsPerDay: 20,
            reviewCardsPerDay: 100,
            headerLevel: 2,
            reviewOrder: "due-date",
            fsrs: {
              requestRetention: 0.9,
              profile: "STANDARD",
            },
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });
      });

      it("should return null if deck not found", async () => {
        mockStatement.step.mockReturnValue(false);

        const result = await dbService.getDeckByTag("#flashcards/notfound");

        expect(result).toBeNull();
      });
    });

    describe("getDeckByFilepath", () => {
      it("should retrieve deck by filepath", async () => {
        mockStatement.step.mockReturnValue(true);
        mockStatement.get.mockReturnValue([
          "deck_123",
          "Test Deck",
          "test.md",
          "#flashcards/test",
          null,
          '{"newCardsPerDay":20,"reviewCardsPerDay":100,"headerLevel":2,"reviewOrder":"due-date","fsrs":{"requestRetention":0.9,"profile":"STANDARD"}}',
          "2024-01-01",
          "2024-01-01",
        ]);

        const result = await dbService.getDeckByFilepath("test.md");

        expect(mockDb.prepare).toHaveBeenCalledWith(
          "SELECT * FROM decks WHERE filepath = ?",
        );
        expect(mockStatement.bind).toHaveBeenCalledWith(["test.md"]);
        expect(result).toEqual({
          id: "deck_123",
          name: "Test Deck",
          filepath: "test.md",
          tag: "#flashcards/test",
          lastReviewed: null,
          config: {
            newCardsPerDay: 20,
            reviewCardsPerDay: 100,
            headerLevel: 2,
            reviewOrder: "due-date",
            fsrs: {
              requestRetention: 0.9,
              profile: "STANDARD",
            },
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });
      });

      it("should return null if deck not found", async () => {
        mockStatement.step.mockReturnValue(false);

        const result = await dbService.getDeckByFilepath("nonexistent.md");

        expect(result).toBeNull();
      });
    });

    describe("getDeckById", () => {
      it("should retrieve deck by id", async () => {
        mockStatement.step.mockReturnValue(true);
        mockStatement.get.mockReturnValue([
          "deck_123",
          "Test Deck",
          "test.md",
          "#flashcards/test",
          null,
          '{"newCardsPerDay":20,"reviewCardsPerDay":100,"headerLevel":2,"reviewOrder":"due-date","fsrs":{"requestRetention":0.9,"profile":"STANDARD"}}',
          "2024-01-01",
          "2024-01-01",
        ]);

        const result = await dbService.getDeckById("deck_123");

        expect(mockDb.prepare).toHaveBeenCalledWith(
          "SELECT * FROM decks WHERE id = ?",
        );
        expect(mockStatement.bind).toHaveBeenCalledWith(["deck_123"]);
        expect(result).toEqual({
          id: "deck_123",
          name: "Test Deck",
          filepath: "test.md",
          tag: "#flashcards/test",
          lastReviewed: null,
          config: {
            newCardsPerDay: 20,
            reviewCardsPerDay: 100,
            headerLevel: 2,
            reviewOrder: "due-date",
            fsrs: {
              requestRetention: 0.9,
              profile: "STANDARD",
            },
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });
      });

      it("should return null if deck not found", async () => {
        mockStatement.step.mockReturnValue(false);

        const result = await dbService.getDeckById("nonexistent_id");

        expect(result).toBeNull();
      });
    });

    describe("deleteDeckByFilepath", () => {
      it("should delete deck by filepath", async () => {
        // Mock getDeckByFilepath to return a deck
        mockStatement.step.mockReturnValueOnce(true);
        mockStatement.get.mockReturnValueOnce([
          "deck_123",
          "Test Deck",
          "test.md",
          "#flashcards/test",
          null,
          '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date","headerLevel":2,"fsrs":{"requestRetention":0.9,"profile":"STANDARD"}}',
          "2024-01-01",
          "2024-01-01",
        ]);

        await dbService.deleteDeckByFilepath("test.md");

        // Should call getDeckByFilepath first, then delete flashcards, then delete deck
        expect(mockDb.prepare).toHaveBeenCalledWith(
          "SELECT * FROM decks WHERE filepath = ?",
        );
        // Flashcards are no longer cascade deleted to preserve progress
        expect(mockDb.prepare).not.toHaveBeenCalledWith(
          "DELETE FROM flashcards WHERE deck_id = ?",
        );
        expect(mockDb.prepare).toHaveBeenCalledWith(
          "DELETE FROM decks WHERE filepath = ?",
        );
      });
    });

    describe("updateDeck", () => {
      it("should update deck fields", async () => {
        await dbService.updateDeck("deck_123", {
          name: "Updated Name",
          tag: "#flashcards/updated",
        });

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("UPDATE decks"),
        );
        expect(mockStatement.run).toHaveBeenCalledWith([
          "Updated Name",
          "#flashcards/updated",
          expect.any(String), // modified timestamp
          "deck_123",
        ]);
      });
    });

    describe("getAllDecks", () => {
      it("should retrieve all decks", async () => {
        mockStatement.step
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false);

        mockStatement.get
          .mockReturnValueOnce([
            "deck_1",
            "Math",
            "math.md",
            "#flashcards/math",
            null,
            '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date","headerLevel":2}',
            "2024-01-01",
            "2024-01-01",
          ])
          .mockReturnValueOnce([
            "deck_2",
            "Science",
            "science.md",
            "#flashcards/science",
            null,
            '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date","headerLevel":2}',
            "2024-01-01",
            "2024-01-01",
          ]);

        const result = await dbService.getAllDecks();

        expect(mockDb.prepare).toHaveBeenCalledWith(
          "SELECT * FROM decks ORDER BY name",
        );
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("Math");
        expect(result[1].name).toBe("Science");
      });
    });
  });

  describe("flashcard operations", () => {
    let mockStatement: any;

    beforeEach(() => {
      mockStatement = {
        bind: jest.fn(),
        step: jest.fn(),
        get: jest.fn(),
        free: jest.fn(),
        run: jest.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);
    });

    describe("createFlashcard", () => {
      it("should create a new flashcard with INSERT OR REPLACE", async () => {
        const flashcard: Omit<Flashcard, "created" | "modified"> = {
          id: "card_abc123",
          deckId: "deck_123",
          front: "What is 2+2?",
          back: "The answer is 4",
          type: "header-paragraph" as const,
          sourceFile: "math.md",
          contentHash: "abc123",
          state: "new" as const,
          dueDate: new Date().toISOString(),
          interval: 0,
          repetitions: 0,
          stability: 2.5,
          difficulty: 5.0,
          lapses: 0,
          lastReviewed: null,
        };

        const result = await dbService.createFlashcard(flashcard);

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("INSERT OR REPLACE INTO flashcards"),
        );
        expect(mockStatement.run).toHaveBeenCalledWith([
          flashcard.id,
          flashcard.deckId,
          flashcard.front,
          flashcard.back,
          flashcard.type,
          flashcard.sourceFile,
          flashcard.contentHash,

          flashcard.state,
          flashcard.dueDate,
          flashcard.interval,
          flashcard.repetitions,
          flashcard.difficulty,
          flashcard.stability,
          flashcard.lapses,
          flashcard.lastReviewed,
          expect.any(String), // created
          expect.any(String), // modified
        ]);
        expect(result).toMatchObject(flashcard);
      });
    });

    describe("getDueFlashcards", () => {
      it("should retrieve due flashcards for a deck", async () => {
        mockStatement.step.mockReturnValueOnce(true).mockReturnValueOnce(false);

        mockStatement.get.mockReturnValueOnce([
          "card_1",
          "deck_123",
          "Question",
          "Answer",
          "header-paragraph",
          "test.md",
          5,
          "2024-01-01T00:00:00Z",
          1440,
          3,
          2.5,
          "2024-01-01",
          "2024-01-01",
        ]);

        const result = await dbService.getDueFlashcards("deck_123");

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("WHERE deck_id = ? AND due_date <= ?"),
        );
        expect(result).toHaveLength(1);
        expect(result[0].front).toBe("Question");
      });
    });

    describe("deleteFlashcardsByFile", () => {
      it("should delete all flashcards from a file", async () => {
        await dbService.deleteFlashcardsByFile("test.md");

        expect(mockDb.prepare).toHaveBeenCalledWith(
          "DELETE FROM flashcards WHERE source_file = ?",
        );
        expect(mockStatement.run).toHaveBeenCalledWith(["test.md"]);
      });
    });
  });

  describe("getDeckStats", () => {
    let mockStatement: any;

    beforeEach(() => {
      mockStatement = {
        bind: jest.fn(),
        step: jest.fn().mockReturnValue(true),
        get: jest.fn(),
        free: jest.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);
    });

    it("should calculate deck statistics correctly", async () => {
      // Mock getDeckById to return a deck with limits disabled
      const mockGetDeckById = jest
        .spyOn(dbService, "getDeckById")
        .mockResolvedValue({
          id: "deck_123",
          name: "Test Deck",
          filepath: "test.md",
          tag: "#test",
          lastReviewed: null,
          config: {
            newCardsPerDay: 0,
            reviewCardsPerDay: 0,
            reviewOrder: "due-date",
            headerLevel: 2,
            fsrs: {
              requestRetention: 0.9,
              profile: "STANDARD",
            },
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });

      // Mock getDailyReviewCounts to return empty counts
      const mockGetDailyReviewCounts = jest
        .spyOn(dbService, "getDailyReviewCounts")
        .mockResolvedValue({ newCount: 0, reviewCount: 0 });

      // Mock counts for different queries (no learning count in pure FSRS)
      mockStatement.get
        .mockReturnValueOnce([5]) // new count
        .mockReturnValueOnce([3]) // due count
        .mockReturnValueOnce([8]); // total count

      const stats = await dbService.getDeckStats("deck_123");

      expect(stats).toEqual({
        deckId: "deck_123",
        newCount: 5,
        dueCount: 3,
        totalCount: 8,
      });

      // Clean up mocks
      mockGetDeckById.mockRestore();
      mockGetDailyReviewCounts.mockRestore();
    });

    it("should calculate deck statistics with daily limits enabled", async () => {
      // Mock getDeckById to return a deck with limits enabled
      const mockGetDeckById = jest
        .spyOn(dbService, "getDeckById")
        .mockResolvedValue({
          id: "deck_123",
          name: "Test Deck",
          filepath: "test.md",
          tag: "#test",
          lastReviewed: null,
          config: {
            newCardsPerDay: 20,
            reviewCardsPerDay: 100,
            reviewOrder: "due-date",
            headerLevel: 2,
            fsrs: {
              requestRetention: 0.9,
              profile: "STANDARD",
            },
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });

      // Mock getDailyReviewCounts to return some already reviewed cards
      const mockGetDailyReviewCounts = jest
        .spyOn(dbService, "getDailyReviewCounts")
        .mockResolvedValue({ newCount: 3, reviewCount: 5 });

      // Mock counts for different queries (no learning count in pure FSRS)
      mockStatement.get
        .mockReturnValueOnce([15]) // total new cards available
        .mockReturnValueOnce([25]) // total review cards available
        .mockReturnValueOnce([40]); // total count

      const stats = await dbService.getDeckStats("deck_123");

      expect(stats).toEqual({
        deckId: "deck_123",
        newCount: 15, // No limits applied in this test
        dueCount: 25, // No limits applied in this test
        totalCount: 40,
      });

      // Clean up mocks
      mockGetDeckById.mockRestore();
      mockGetDailyReviewCounts.mockRestore();
    });

    it("should handle zero daily limits without NaN", async () => {
      // Mock getDeckById to return a deck with zero limits
      const mockGetDeckById = jest
        .spyOn(dbService, "getDeckById")
        .mockResolvedValue({
          id: "deck_123",
          name: "Test Deck",
          filepath: "test.md",
          tag: "#test",
          lastReviewed: null,
          config: {
            newCardsPerDay: 0,
            reviewCardsPerDay: 0,
            reviewOrder: "due-date",
            headerLevel: 2,
            fsrs: {
              requestRetention: 0.9,
              profile: "STANDARD",
            },
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });

      // Mock getDailyReviewCounts to return zero counts
      const mockGetDailyReviewCounts = jest
        .spyOn(dbService, "getDailyReviewCounts")
        .mockResolvedValue({ newCount: 0, reviewCount: 0 });

      // Mock counts for different queries (no learning count in pure FSRS)
      mockStatement.get
        .mockReturnValueOnce([10]) // total new cards available
        .mockReturnValueOnce([20]) // total review cards available
        .mockReturnValueOnce([30]); // total count

      const stats = await dbService.getDeckStats("deck_123");

      expect(stats).toEqual({
        deckId: "deck_123",
        newCount: 10, // No limits applied in this test
        dueCount: 20, // No limits applied in this test
        totalCount: 30,
      });

      // Verify no NaN values
      expect(Number.isNaN(stats.newCount)).toBe(false);
      expect(Number.isNaN(stats.dueCount)).toBe(false);
      expect(Number.isNaN(stats.totalCount)).toBe(false);

      // Clean up mocks
      mockGetDeckById.mockRestore();
      mockGetDailyReviewCounts.mockRestore();
    });

    it("should handle limits set below already reviewed count", async () => {
      // Mock getDeckById to return a deck with limits below already reviewed count
      const mockGetDeckById = jest
        .spyOn(dbService, "getDeckById")
        .mockResolvedValue({
          id: "deck_123",
          name: "Test Deck",
          filepath: "test.md",
          tag: "#test",
          lastReviewed: null,
          config: {
            newCardsPerDay: 5, // Limit set to 5
            reviewCardsPerDay: 3, // Limit set to 3
            reviewOrder: "due-date",
            headerLevel: 2,
            fsrs: {
              requestRetention: 0.9,
              profile: "STANDARD",
            },
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });

      // Mock getDailyReviewCounts to return counts above the limits
      const mockGetDailyReviewCounts = jest
        .spyOn(dbService, "getDailyReviewCounts")
        .mockResolvedValue({ newCount: 6, reviewCount: 4 }); // Already reviewed more than limits

      // Mock counts for different queries (no learning count in pure FSRS)
      mockStatement.get
        .mockReturnValueOnce([10]) // total new cards available
        .mockReturnValueOnce([8]) // total review cards available
        .mockReturnValueOnce([18]); // total count

      const stats = await dbService.getDeckStats("deck_123");

      expect(stats).toEqual({
        deckId: "deck_123",
        newCount: 0, // Should be 0 because 6 > 5 (limit exceeded)
        dueCount: 0, // Should be 0 because 4 > 3 (limit exceeded)
        totalCount: 18,
      });

      // Test getReviewableFlashcards with the same scenario
      // Reset mocks for queries (no learning cards in pure FSRS)
      mockStatement.step
        .mockReset()
        .mockReturnValueOnce(false) // no learning cards
        .mockReturnValueOnce(false) // no new cards (limit exceeded)
        .mockReturnValueOnce(false); // no review cards (limit exceeded)

      // No learning cards in pure FSRS - remove mock data

      const flashcards = await dbService.getReviewableFlashcards("deck_123");

      // Should return no cards since new and review limits are exceeded and no learning cards exist
      expect(flashcards).toHaveLength(0); // No cards when limits exceeded

      // Clean up mocks
      mockGetDeckById.mockRestore();
      mockGetDailyReviewCounts.mockRestore();
    });

    describe("getReviewableFlashcards", () => {
      it("should query for reviewable cards with correct order", async () => {
        const deckId = "deck_123";

        // Mock getDeckById to return a deck with config
        const mockGetDeckById = jest
          .spyOn(dbService, "getDeckById")
          .mockResolvedValue({
            id: "deck_123",
            name: "Test Deck",
            filepath: "test.md",
            tag: "#test",
            lastReviewed: null,
            config: {
              newCardsPerDay: 5,
              reviewCardsPerDay: 3,
              reviewOrder: "due-date",
              headerLevel: 2,
              fsrs: {
                requestRetention: 0.9,
                profile: "STANDARD",
              },
            },
            created: "2024-01-01",
            modified: "2024-01-01",
          });

        // Mock the statement to return some test data
        mockStatement.step.mockReturnValue(false); // No results

        await dbService.getReviewableFlashcards(deckId);

        // Verify the correct SQL query was prepared
        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("WHERE deck_id = ? AND due_date <= ?"),
        );

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("ORDER BY"),
        );

        // Should call three separate queries for learning, new, and review cards
        // No learning state queries in pure FSRS
        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("state = 'new'"),
        );
        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("state = 'review'"),
        );

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("state = 'new'"),
        );

        // Verify bind was called with deck ID and current timestamp
        expect(mockStatement.bind).toHaveBeenCalledWith([
          deckId,
          expect.any(String), // Current timestamp
        ]);
      });
    });

    describe("getDailyReviewCounts", () => {
      it("should count new and review cards reviewed today", async () => {
        const deckId = "deck_123";

        // Mock review logs data for today
        mockStatement.step
          .mockReturnValueOnce(true) // New cards count
          .mockReturnValueOnce(true); // Review cards count

        mockStatement.get
          .mockReturnValueOnce([5]) // 5 new cards reviewed today
          .mockReturnValueOnce([12]); // 12 review cards reviewed today

        const result = await dbService.getDailyReviewCounts(deckId);

        expect(result).toEqual({
          newCount: 5,
          reviewCount: 12,
        });

        // Should prepare queries for both new and review cards
        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("old_interval_minutes = 0"),
        );
        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("old_interval_minutes > 0"),
        );
      });
    });

    describe("review order", () => {
      it("should call required dependencies for card retrieval", async () => {
        const deckId = "deck_123";

        // Mock getDeckById to return a valid deck
        const mockGetDeckById = jest
          .spyOn(dbService, "getDeckById")
          .mockResolvedValue({
            id: "deck_123",
            name: "Test Deck",
            filepath: "test.md",
            tag: "#test",
            lastReviewed: null,
            config: {
              newCardsPerDay: 0, // unlimited
              reviewCardsPerDay: 0, // unlimited
              reviewOrder: "due-date",
              headerLevel: 2,
              fsrs: {
                requestRetention: 0.9,
                profile: "STANDARD",
              },
            },
            created: "2024-01-01",
            modified: "2024-01-01",
          });

        // Mock getDailyReviewCounts
        const mockGetDailyReviewCounts = jest
          .spyOn(dbService, "getDailyReviewCounts")
          .mockResolvedValue({ newCount: 0, reviewCount: 0 });

        // Mock database prepare to return empty results (no cards)
        mockStatement.step.mockReturnValue(false);

        try {
          const result = await dbService.getReviewableFlashcards(deckId);

          // Should return an array (empty in this case due to mocked empty database)
          expect(Array.isArray(result)).toBe(true);

          // Verify the method called its dependencies correctly
          expect(mockGetDeckById).toHaveBeenCalledWith(deckId);
          expect(mockGetDailyReviewCounts).toHaveBeenCalledWith(deckId);
        } finally {
          // Clean up mocks
          mockGetDeckById.mockRestore();
          mockGetDailyReviewCounts.mockRestore();
        }
      });
    });
  });

  describe("database persistence", () => {
    it("should save database to file", async () => {
      await dbService.save();

      expect(mockAdapter.writeBinary).toHaveBeenCalledWith(
        "test.db",
        expect.any(Buffer),
      );
    });

    it("should create directory if it doesnt exist", async () => {
      mockAdapter.exists.mockResolvedValue(false);

      await dbService.save();

      expect(mockAdapter.exists).toHaveBeenCalled();
      expect(mockAdapter.mkdir).toHaveBeenCalled();
    });
  });

  describe("close", () => {
    it("should close database connection", async () => {
      await dbService.close();

      expect(mockDb.close).toHaveBeenCalled();
    });
  });

  describe("getLatestReviewLogForFlashcard", () => {
    it("should return latest review log for flashcard", async () => {
      const reviewedAt = "2024-01-15T10:00:00.000Z";
      const intervalMinutes = 1440; // 24 hours

      // Mock database query result - full ReviewLog row
      mockStatement.step.mockReturnValue(true);
      mockStatement.get.mockReturnValue([
        "log_id", // id
        "test_card_id", // flashcard_id
        "2024-01-14T10:00:00.000Z", // last_reviewed_at
        "2024-01-15T09:00:00.000Z", // shown_at
        "2024-01-15T10:00:00.000Z", // reviewed_at
        3, // rating
        "good", // rating_label
        5000, // time_elapsed_ms
        "new", // old_state
        2, // old_repetitions
        0, // old_lapses
        2.0, // old_stability
        5.0, // old_difficulty
        "review", // new_state
        3, // new_repetitions
        0, // new_lapses
        2.5, // new_stability
        2.5, // new_difficulty
        720, // old_interval_minutes
        1440, // new_interval_minutes
        "2024-01-14T10:00:00.000Z", // old_due_at
        "2024-01-16T10:00:00.000Z", // new_due_at
        1.0, // elapsed_days
        0.9, // retrievability
        0.9, // request_retention
        "STANDARD", // profile
        36500, // maximum_interval_days
        1440, // min_minutes
        "STANDARD-v1.0", // fsrs_weights_version
        "1.0", // scheduler_version
        null, // note_model_id
        null, // card_template_id
        null, // content_hash
        "desktop", // client
      ]);

      const result =
        await dbService.getLatestReviewLogForFlashcard("test_card_id");

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT"),
      );
      expect(mockStatement.bind).toHaveBeenCalledWith(["test_card_id"]);

      expect(result).toEqual({
        id: "log_id",
        flashcardId: "test_card_id",
        lastReviewedAt: "2024-01-14T10:00:00.000Z",
        shownAt: "2024-01-15T09:00:00.000Z",
        reviewedAt: "2024-01-15T10:00:00.000Z",
        rating: 3,
        ratingLabel: "good",
        timeElapsedMs: 5000,
        oldState: "new",
        oldRepetitions: 2,
        oldLapses: 0,
        oldStability: 2,
        oldDifficulty: 5,
        newState: "review",
        newRepetitions: 3,
        newLapses: 0,
        newStability: 2.5,
        newDifficulty: 2.5,
        oldIntervalMinutes: 720,
        newIntervalMinutes: 1440,
        oldDueAt: "2024-01-14T10:00:00.000Z",
        newDueAt: "2024-01-16T10:00:00.000Z",
        elapsedDays: 1,
        retrievability: 0.9,
        requestRetention: 0.9,
        profile: "STANDARD",
        maximumIntervalDays: 36500,
        minMinutes: 1440,
        fsrsWeightsVersion: "STANDARD-v1.0",
        schedulerVersion: "1.0",
        noteModelId: null,
        cardTemplateId: null,
        contentHash: null,
        client: "desktop",
      });
    });

    it("should return null when no review logs exist", async () => {
      mockStatement.step.mockReturnValue(false);

      const result =
        await dbService.getLatestReviewLogForFlashcard("nonexistent_card");

      expect(result).toBeNull();
    });

    it("should use stored stability from review logs when restoring progress", async () => {
      const reviewedAt = "2024-01-15T10:00:00.000Z";
      const intervalMinutes = 1440; // 24 hours
      const repetitions = 5;
      const lapses = 1;
      const difficulty = 2.3;
      const expectedStability = 15.2;

      // Mock database query result - full ReviewLog row (25 columns)
      mockStatement.step.mockReturnValue(true);
      mockStatement.get.mockReturnValue([
        "log_id", // id
        "test_card_id", // flashcard_id
        "2024-01-14T10:00:00.000Z", // last_reviewed_at
        "2024-01-15T09:00:00.000Z", // shown_at
        reviewedAt, // reviewed_at
        3, // rating
        "good", // rating_label
        5000, // time_elapsed_ms
        "review", // old_state
        4, // old_repetitions
        lapses, // old_lapses
        12.0, // old_stability
        2.5, // old_difficulty
        "review", // new_state
        repetitions, // new_repetitions
        lapses, // new_lapses
        expectedStability, // new_stability
        difficulty, // new_difficulty
        720, // old_interval_minutes
        intervalMinutes, // new_interval_minutes
        "2024-01-14T10:00:00.000Z", // old_due_at
        "2024-01-16T10:00:00.000Z", // new_due_at
        1.0, // elapsed_days
        0.9, // retrievability
        0.9, // request_retention
        "STANDARD", // profile
        36500, // maximum_interval_days
        1440, // min_minutes
        "STANDARD-v1.0", // fsrs_weights_version
        "1.0", // scheduler_version
        null, // note_model_id
        null, // card_template_id
        null, // content_hash
        "desktop", // client
      ]);

      const result =
        await dbService.getLatestReviewLogForFlashcard("test_card_id");

      // Verify result contains stored stability
      expect(result?.newStability).toBe(expectedStability);
      expect(result?.newState).toBe("review");
      expect(result?.newRepetitions).toBe(repetitions);
      expect(result?.newLapses).toBe(lapses);
      expect(result?.newDifficulty).toBe(difficulty);
    });
  });
});
