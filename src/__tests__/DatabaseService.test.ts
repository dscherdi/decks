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

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock database
    mockDb = {
      prepare: jest.fn(),
      run: jest.fn(),
      export: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      close: jest.fn(),
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

    // Create service
    dbService = new DatabaseService("test.db");
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

      const dbService2 = new DatabaseService("existing.db");
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
        const deck = {
          id: "deck_123",
          name: "Test Deck",
          tag: "#flashcards/test",
          lastReviewed: null,
        };

        const result = await dbService.createDeck(deck);

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("INSERT INTO decks"),
        );
        expect(mockStatement.run).toHaveBeenCalledWith([
          deck.id,
          deck.name,
          deck.tag,
          deck.lastReviewed,
          expect.any(String), // created
          expect.any(String), // modified
        ]);
        expect(result).toMatchObject(deck);
        expect(result.created).toBeDefined();
        expect(result.modified).toBeDefined();
      });
    });

    describe("getDeckByTag", () => {
      it("should retrieve deck by tag", async () => {
        mockStatement.step.mockReturnValue(true);
        mockStatement.get.mockReturnValue([
          "deck_123",
          "Test Deck",
          "#flashcards/test",
          null,
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
          tag: "#flashcards/test",
          lastReviewed: null,
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

    describe("getDeckByName", () => {
      it("should retrieve deck by name", async () => {
        mockStatement.step.mockReturnValue(true);
        mockStatement.get.mockReturnValue([
          "deck_123",
          "Test Deck",
          "#flashcards/test",
          null,
          "2024-01-01",
          "2024-01-01",
        ]);

        const result = await dbService.getDeckByName("Test Deck");

        expect(mockDb.prepare).toHaveBeenCalledWith(
          "SELECT * FROM decks WHERE name = ?",
        );
        expect(mockStatement.bind).toHaveBeenCalledWith(["Test Deck"]);
        expect(result).toEqual({
          id: "deck_123",
          name: "Test Deck",
          tag: "#flashcards/test",
          lastReviewed: null,
          created: "2024-01-01",
          modified: "2024-01-01",
        });
      });

      it("should return null if deck not found", async () => {
        mockStatement.step.mockReturnValue(false);

        const result = await dbService.getDeckByName("Nonexistent Deck");

        expect(result).toBeNull();
      });
    });

    describe("getDeckById", () => {
      it("should retrieve deck by id", async () => {
        mockStatement.step.mockReturnValue(true);
        mockStatement.get.mockReturnValue([
          "deck_123",
          "Test Deck",
          "#flashcards/test",
          null,
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
          tag: "#flashcards/test",
          lastReviewed: null,
          created: "2024-01-01",
          modified: "2024-01-01",
        });
      });

      it("should return null if deck not found", async () => {
        mockStatement.step.mockReturnValue(false);

        const result = await dbService.getDeckById("nonexistent");

        expect(result).toBeNull();
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
            "#flashcards/math",
            null,
            "2024-01-01",
            "2024-01-01",
          ])
          .mockReturnValueOnce([
            "deck_2",
            "Science",
            "#flashcards/science",
            "2024-01-02",
            "2024-01-01",
            "2024-01-02",
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
          lineNumber: 5,
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
          flashcard.lineNumber,
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

      // Verify correct queries were made
      const prepareCalls = mockDb.prepare.mock.calls;
      expect(prepareCalls[0][0]).toContain("state = 'new' AND due_date <= ?"); // new cards
      expect(prepareCalls[1][0]).toContain(
        "state = 'learning' AND due_date <= ?",
      ); // learning
      expect(prepareCalls[2][0]).toContain(
        "state = 'review' AND due_date <= ?",
      ); // due
      expect(prepareCalls[3][0]).toContain(
        "COUNT(*) FROM flashcards WHERE deck_id = ?",
      ); // total
    });

    describe("getReviewableFlashcards", () => {
      it("should query for reviewable cards with correct order", async () => {
        const deckId = "deck_123";

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

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("CASE"),
        );

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining("state = 'new' THEN 1"),
        );

        // Verify bind was called with deck ID and current timestamp
        expect(mockStatement.bind).toHaveBeenCalledWith([
          deckId,
          expect.any(String), // Current timestamp
        ]);
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
});
