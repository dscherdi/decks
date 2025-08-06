import { DatabaseService } from "../database/DatabaseService";
import { Deck, Flashcard, DeckStats } from "../database/types";
import initSqlJs from "sql.js";

// Mock sql.js
jest.mock("sql.js");

// Mock window.app.vault.adapter
const mockAdapter = {
  exists: jest.fn(),
  mkdir: jest.fn(),
  readBinary: jest.fn(),
  writeBinary: jest.fn(),
};

(global as any).window = {
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
    (initSqlJs as jest.Mock).mockResolvedValue({
      Database: jest.fn().mockImplementation(() => mockDb),
    });

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
    dbService = new DatabaseService("test.db", mockAdapter, () => {}); // Empty debugLog for tests
    await dbService.initialize();
  });

  afterEach(async () => {
    await dbService.close();
  });

  describe("initialization", () => {
    it("should initialize database and create tables", async () => {
      expect(initSqlJs).toHaveBeenCalled();
      expect(mockDb.run).toHaveBeenCalled();

      // Check if CREATE TABLE statements were executed
      const createTableCalls = mockDb.run.mock.calls;
      expect(createTableCalls[0][0]).toContain(
        "CREATE TABLE IF NOT EXISTS decks",
      );
      expect(createTableCalls[0][0]).toContain(
        "CREATE TABLE IF NOT EXISTS flashcards",
      );
      expect(createTableCalls[0][0]).toContain(
        "CREATE TABLE IF NOT EXISTS review_logs",
      );
    });

    it("should load existing database if file exists", async () => {
      // Reset and setup for existing database
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.readBinary.mockResolvedValue(new ArrayBuffer(8));

      const dbService2 = new DatabaseService(
        "existing.db",
        mockAdapter,
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
            newCardsLimit: 20,
            reviewCardsLimit: 100,
            enableNewCardsLimit: false,
            enableReviewCardsLimit: false,
            reviewOrder: "due-date",
          },
        };

        const result = await dbService.createDeck(deck);

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("INSERT INTO decks"),
        );
        expect(mockStatement.run).toHaveBeenCalledWith([
          deck.id,
          deck.name,
          deck.filepath,
          deck.tag,
          deck.lastReviewed,
          expect.any(String), // config
          expect.any(String), // created
          expect.any(String), // modified
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
          '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date"}',
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
            newCardsLimit: 20,
            reviewCardsLimit: 100,
            enableNewCardsLimit: false,
            enableReviewCardsLimit: false,
            reviewOrder: "due-date",
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
          '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date"}',
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
            newCardsLimit: 20,
            reviewCardsLimit: 100,
            enableNewCardsLimit: false,
            enableReviewCardsLimit: false,
            reviewOrder: "due-date",
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
          '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date"}',
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
            newCardsLimit: 20,
            reviewCardsLimit: 100,
            enableNewCardsLimit: false,
            enableReviewCardsLimit: false,
            reviewOrder: "due-date",
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
          '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date"}',
          "2024-01-01",
          "2024-01-01",
        ]);

        await dbService.deleteDeckByFilepath("test.md");

        // Should call getDeckByFilepath first, then delete flashcards, then delete deck
        expect(mockDb.prepare).toHaveBeenCalledWith(
          "SELECT * FROM decks WHERE filepath = ?",
        );
        expect(mockDb.prepare).toHaveBeenCalledWith(
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
            '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date"}',
            "2024-01-01",
            "2024-01-01",
          ])
          .mockReturnValueOnce([
            "deck_2",
            "Science",
            "science.md",
            "#flashcards/science",
            null,
            '{"newCardsLimit":20,"reviewCardsLimit":100,"enableNewCardsLimit":false,"enableReviewCardsLimit":false,"reviewOrder":"due-date"}',
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
          easeFactor: 5.0,
          stability: 2.5,
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
          flashcard.easeFactor,
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
            newCardsLimit: 20,
            reviewCardsLimit: 100,
            enableNewCardsLimit: false,
            enableReviewCardsLimit: false,
            reviewOrder: "due-date",
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });

      // Mock getDailyReviewCounts to return empty counts
      const mockGetDailyReviewCounts = jest
        .spyOn(dbService, "getDailyReviewCounts")
        .mockResolvedValue({ newCount: 0, reviewCount: 0 });

      // Mock counts for different queries
      mockStatement.get
        .mockReturnValueOnce([5]) // new count
        .mockReturnValueOnce([3]) // learning count
        .mockReturnValueOnce([7]) // due count
        .mockReturnValueOnce([15]); // total count

      const stats = await dbService.getDeckStats("deck_123");

      expect(stats).toEqual({
        deckId: "deck_123",
        newCount: 5,
        learningCount: 3,
        dueCount: 7,
        totalCount: 15,
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
            newCardsLimit: 10,
            reviewCardsLimit: 20,
            enableNewCardsLimit: true,
            enableReviewCardsLimit: true,
            reviewOrder: "due-date",
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });

      // Mock getDailyReviewCounts to return some already reviewed cards
      const mockGetDailyReviewCounts = jest
        .spyOn(dbService, "getDailyReviewCounts")
        .mockResolvedValue({ newCount: 3, reviewCount: 5 });

      // Mock counts for different queries
      mockStatement.get
        .mockReturnValueOnce([15]) // total new cards available
        .mockReturnValueOnce([4]) // learning count (unchanged)
        .mockReturnValueOnce([25]) // total review cards available
        .mockReturnValueOnce([44]); // total count

      const stats = await dbService.getDeckStats("deck_123");

      expect(stats).toEqual({
        deckId: "deck_123",
        newCount: 7, // min(15, 10-3) = 7 remaining new cards
        learningCount: 4, // learning cards are unchanged
        dueCount: 15, // min(25, 20-5) = 15 remaining review cards
        totalCount: 44,
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
            newCardsLimit: 0,
            reviewCardsLimit: 0,
            enableNewCardsLimit: true,
            enableReviewCardsLimit: true,
            reviewOrder: "due-date",
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });

      // Mock getDailyReviewCounts to return zero counts
      const mockGetDailyReviewCounts = jest
        .spyOn(dbService, "getDailyReviewCounts")
        .mockResolvedValue({ newCount: 0, reviewCount: 0 });

      // Mock counts for different queries
      mockStatement.get
        .mockReturnValueOnce([10]) // total new cards available
        .mockReturnValueOnce([5]) // learning count
        .mockReturnValueOnce([20]) // total review cards available
        .mockReturnValueOnce([35]); // total count

      const stats = await dbService.getDeckStats("deck_123");

      expect(stats).toEqual({
        deckId: "deck_123",
        newCount: 0, // Should be 0 when limit is 0, not NaN
        learningCount: 5, // learning cards are unchanged
        dueCount: 0, // Should be 0 when limit is 0, not NaN
        totalCount: 35,
      });

      // Verify no NaN values
      expect(Number.isNaN(stats.newCount)).toBe(false);
      expect(Number.isNaN(stats.dueCount)).toBe(false);
      expect(Number.isNaN(stats.learningCount)).toBe(false);
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
            newCardsLimit: 5, // Limit set to 5
            reviewCardsLimit: 3, // Limit set to 3
            enableNewCardsLimit: true,
            enableReviewCardsLimit: true,
            reviewOrder: "due-date",
          },
          created: "2024-01-01",
          modified: "2024-01-01",
        });

      // Mock getDailyReviewCounts to return counts above the limits
      const mockGetDailyReviewCounts = jest
        .spyOn(dbService, "getDailyReviewCounts")
        .mockResolvedValue({ newCount: 6, reviewCount: 4 }); // Already reviewed more than limits

      // Mock counts for different queries
      mockStatement.get
        .mockReturnValueOnce([10]) // total new cards available
        .mockReturnValueOnce([2]) // learning count
        .mockReturnValueOnce([8]) // total review cards available
        .mockReturnValueOnce([20]); // total count

      const stats = await dbService.getDeckStats("deck_123");

      expect(stats).toEqual({
        deckId: "deck_123",
        newCount: 0, // Should be 0 because 6 > 5 (limit exceeded)
        learningCount: 2, // learning cards are unchanged
        dueCount: 0, // Should be 0 because 4 > 3 (limit exceeded)
        totalCount: 20,
      });

      // Test getReviewableFlashcards with the same scenario
      // Reset mocks for the learning cards query
      mockStatement.step
        .mockReset()
        .mockReturnValueOnce(true) // first learning card
        .mockReturnValueOnce(true) // second learning card
        .mockReturnValueOnce(false) // end learning query
        .mockReturnValueOnce(false) // no new cards (limit exceeded)
        .mockReturnValueOnce(false); // no review cards (limit exceeded)

      mockStatement.get
        .mockReset()
        .mockReturnValueOnce([
          "learning_1",
          "deck_123",
          "Learning Front 1",
          "Back",
          "header-paragraph",
          "test.md",
          1,
          "hash1",
          "learning",
          "2024-01-01T00:00:00.000Z",
          60,
          0,
          2.5,
          1.0,
          0,
          null,
          "2024-01-01",
          "2024-01-01",
        ])
        .mockReturnValueOnce([
          "learning_2",
          "deck_123",
          "Learning Front 2",
          "Back",
          "header-paragraph",
          "test.md",
          1,
          "hash2",
          "learning",
          "2024-01-02T00:00:00.000Z",
          60,
          0,
          2.5,
          1.0,
          0,
          null,
          "2024-01-01",
          "2024-01-01",
        ]);

      const flashcards = await dbService.getReviewableFlashcards("deck_123");

      // Should only return learning cards since new and review limits are exceeded
      expect(flashcards).toHaveLength(2); // Only learning cards
      expect(flashcards.every((card) => card.state === "learning")).toBe(true);

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
              newCardsLimit: 20,
              reviewCardsLimit: 100,
              enableNewCardsLimit: false,
              enableReviewCardsLimit: false,
              reviewOrder: "due-date",
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
        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("state = 'learning'"),
        );
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
          expect.stringContaining("old_interval = 0"),
        );
        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("old_interval > 0"),
        );
      });
    });

    describe("review order", () => {
      it("should sort cards in Anki order: learning, review, new", async () => {
        const deckId = "deck_123";

        // Mock getDeckById to return a deck with due-date order
        const mockGetDeckById = jest
          .spyOn(dbService, "getDeckById")
          .mockResolvedValue({
            id: "deck_123",
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
            },
            created: "2024-01-01",
            modified: "2024-01-01",
          });

        // Mock getDailyReviewCounts to return empty counts
        const mockGetDailyReviewCounts = jest
          .spyOn(dbService, "getDailyReviewCounts")
          .mockResolvedValue({ newCount: 0, reviewCount: 0 });

        // Mock the three separate queries: learning, new, review
        // Learning cards (2 cards)
        mockStatement.step
          .mockReturnValueOnce(true) // first learning card
          .mockReturnValueOnce(true) // second learning card
          .mockReturnValueOnce(false) // end learning query
          .mockReturnValueOnce(true) // first new card
          .mockReturnValueOnce(true) // second new card
          .mockReturnValueOnce(false) // end new query
          .mockReturnValueOnce(true) // first review card
          .mockReturnValueOnce(false); // end review query

        mockStatement.get
          .mockReturnValueOnce([
            "learning_1",
            deckId,
            "Learning Front 1",
            "Back",
            "header-paragraph",
            "test.md",
            1,
            "hash1",
            "learning",
            "2024-01-01T00:00:00.000Z",
            60,
            0,
            2.5,
            1.0,
            0,
            null,
            "2024-01-01",
            "2024-01-01",
          ])
          .mockReturnValueOnce([
            "learning_2",
            deckId,
            "Learning Front 2",
            "Back",
            "header-paragraph",
            "test.md",
            1,
            "hash2",
            "learning",
            "2024-01-02T00:00:00.000Z",
            60,
            0,
            2.5,
            1.0,
            0,
            null,
            "2024-01-01",
            "2024-01-01",
          ])
          .mockReturnValueOnce([
            "new_1",
            deckId,
            "New Front 1",
            "Back",
            "header-paragraph",
            "test.md",
            1,
            "hash3",
            "new",
            "2024-01-01T00:00:00.000Z",
            0,
            0,
            2.5,
            1.0,
            0,
            null,
            "2024-01-01",
            "2024-01-01",
          ])
          .mockReturnValueOnce([
            "new_2",
            deckId,
            "New Front 2",
            "Back",
            "header-paragraph",
            "test.md",
            1,
            "hash4",
            "new",
            "2024-01-03T00:00:00.000Z",
            0,
            0,
            2.5,
            1.0,
            0,
            null,
            "2024-01-01",
            "2024-01-01",
          ])
          .mockReturnValueOnce([
            "review_1",
            deckId,
            "Review Front 1",
            "Back",
            "header-paragraph",
            "test.md",
            1,
            "hash5",
            "review",
            "2024-01-02T00:00:00.000Z",
            1440,
            1,
            2.5,
            1.0,
            0,
            null,
            "2024-01-01",
            "2024-01-01",
          ]);

        const result = await dbService.getReviewableFlashcards(deckId);

        // Verify Anki order: learning first, then review, then new
        expect(result).toHaveLength(5);
        expect(result[0].state).toBe("learning");
        expect(result[1].state).toBe("learning");
        expect(result[2].state).toBe("review");
        expect(result[3].state).toBe("new");
        expect(result[4].state).toBe("new");

        // Verify within learning cards, earliest due date comes first
        expect(new Date(result[0].dueDate).getTime()).toBeLessThan(
          new Date(result[1].dueDate).getTime(),
        );

        // Verify within new cards, earliest due date comes first
        expect(new Date(result[3].dueDate).getTime()).toBeLessThan(
          new Date(result[4].dueDate).getTime(),
        );

        // Clean up mocks
        mockGetDeckById.mockRestore();
        mockGetDailyReviewCounts.mockRestore();
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
    it("should calculate due date from reviewedAt and newInterval", async () => {
      const reviewedAt = "2024-01-15T10:00:00.000Z";
      const intervalMinutes = 1440; // 24 hours
      const expectedDueDate = "2024-01-16T10:00:00.000Z"; // 24 hours later

      // Mock database query result
      mockStatement.step.mockReturnValue(true);
      mockStatement.get.mockReturnValue([
        "review", // new_state
        intervalMinutes, // new_interval
        2.5, // new_ease_factor
        3, // new_repetitions
        0, // new_lapses
        reviewedAt, // reviewed_at
      ]);

      const result =
        await dbService.getLatestReviewLogForFlashcard("test_card_id");

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT"),
      );
      expect(mockStatement.bind).toHaveBeenCalledWith(["test_card_id"]);

      expect(result).toEqual({
        state: "review",
        dueDate: expectedDueDate,
        interval: intervalMinutes,
        repetitions: 3,
        easeFactor: 2.5,
        stability: 2.5,
        lapses: 0,
        lastReviewed: reviewedAt,
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
      const easeFactor = 2.3;

      // Mock database query result
      mockStatement.step.mockReturnValue(true);
      mockStatement.get.mockReturnValue([
        "review", // new_state
        intervalMinutes, // new_interval
        easeFactor, // new_ease_factor
        repetitions, // new_repetitions
        lapses, // new_lapses
        reviewedAt, // reviewed_at
      ]);

      const expectedStability = 15.2;

      // Mock database query result with stability
      mockStatement.get.mockReturnValue([
        "review", // new_state
        intervalMinutes, // new_interval
        easeFactor, // new_ease_factor
        repetitions, // new_repetitions
        lapses, // new_lapses
        expectedStability, // new_stability
        reviewedAt, // reviewed_at
      ]);

      const result =
        await dbService.getLatestReviewLogForFlashcard("test_card_id");

      // Verify result contains stored stability
      expect(result?.stability).toBe(expectedStability);
      expect(result?.state).toBe("review");
      expect(result?.repetitions).toBe(repetitions);
      expect(result?.lapses).toBe(lapses);
      expect(result?.easeFactor).toBe(easeFactor);
    });
  });
});
