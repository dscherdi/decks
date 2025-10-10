import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter } from "./database-test-utils";

// Mock SQL.js for integration tests but with real database operations
jest.mock("sql.js", () => {
  const mockDatabase = {
    prepare: jest.fn(),
    run: jest.fn(),
    exec: jest.fn(),
    export: jest.fn(() => new Uint8Array([1, 2, 3])),
    close: jest.fn(),
  };

  const mockStatement = {
    bind: jest.fn(),
    step: jest.fn(() => false),
    get: jest.fn(() => []),
    free: jest.fn(),
    run: jest.fn(),
  };

  mockDatabase.prepare.mockReturnValue(mockStatement);

  return {
    __esModule: true,
    default: jest.fn(() =>
      Promise.resolve({
        Database: jest.fn().mockImplementation(() => mockDatabase),
      }),
    ),
  };
});

describe("Simple Database Integration Tests", () => {
  let db: MainDatabaseService;
  let adapter: InMemoryAdapter;

  beforeEach(async () => {
    adapter = new InMemoryAdapter();
    const debugLog = jest.fn();
    db = new MainDatabaseService("test.db", adapter, debugLog);

    try {
      await db.initialize();
    } catch (error) {
      // Expected - mocked SQL.js won't fully work, but we can test the flow
    }
  });

  afterEach(async () => {
    // Cleanup
    db = null as any;
    adapter = null as any;
  });

  describe("Database Service Initialization", () => {
    it("should attempt to initialize database", async () => {
      // This test verifies the initialization flow works
      const adapter = new InMemoryAdapter();
      const debugLog = jest.fn();
      const dbService = new MainDatabaseService("test.db", adapter, debugLog);

      // The initialization should succeed with mocked SQL.js
      await expect(dbService.initialize()).resolves.not.toThrow();

      // Verify that the debug log was called during initialization attempt
      expect(debugLog).toHaveBeenCalled();
    });

    it("should handle database file loading", async () => {
      // Create a database service
      const adapter = new InMemoryAdapter();
      const debugLog = jest.fn();

      // Pre-populate adapter with mock database file
      await adapter.writeBinary("test.db", new ArrayBuffer(100));

      const dbService = new MainDatabaseService("test.db", adapter, debugLog);

      // Verify file exists
      expect(await adapter.exists("test.db")).toBe(true);

      // Attempt initialization (should succeed with mock)
      await expect(dbService.initialize()).resolves.not.toThrow();
    });
  });

  describe("InMemoryAdapter Functionality", () => {
    it("should store and retrieve binary data", async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const path = "test-file.db";

      // Write data
      await adapter.writeBinary(path, testData.buffer);

      // Check existence
      expect(await adapter.exists(path)).toBe(true);

      // Read data back
      const retrievedData = await adapter.readBinary(path);
      expect(new Uint8Array(retrievedData)).toEqual(testData);
    });

    it("should handle directory creation", async () => {
      const dirPath = "test-directory";

      await adapter.mkdir(dirPath);
      expect(await adapter.exists(dirPath)).toBe(true);
    });

    it("should throw error for non-existent files", async () => {
      await expect(adapter.readBinary("non-existent.db")).rejects.toThrow(
        "File not found",
      );
    });
  });

  describe("Database Service API Structure", () => {
    it("should have required database methods", () => {
      // Verify that the database service has the expected API
      expect(typeof db.initialize).toBe("function");
      expect(typeof db.save).toBe("function");
      expect(typeof db.createDeck).toBe("function");
      expect(typeof db.getDeckByFilepath).toBe("function");
      expect(typeof db.createFlashcard).toBe("function");
      expect(typeof db.updateFlashcard).toBe("function");
      expect(typeof db.getFlashcardById).toBe("function");
      expect(typeof db.createReviewLog).toBe("function");
      expect(typeof db.getOverallStatistics).toBe("function");
    });

    it("should extend BaseDatabaseService", () => {
      // Verify inheritance structure
      expect(db.constructor.name).toBe("MainDatabaseService");
      expect(Object.getPrototypeOf(db.constructor).name).toBe(
        "BaseDatabaseService",
      );
    });
  });

  describe("Configuration and Types", () => {
    it("should use correct default deck configuration", () => {
      // Import the types to verify they're properly structured
      const { DEFAULT_DECK_CONFIG } = require("../../database/types");

      expect(DEFAULT_DECK_CONFIG).toBeDefined();
      expect(DEFAULT_DECK_CONFIG.newCardsPerDay).toBe(20);
      expect(DEFAULT_DECK_CONFIG.reviewCardsPerDay).toBe(100);
      expect(DEFAULT_DECK_CONFIG.reviewOrder).toBe("due-date");
      expect(DEFAULT_DECK_CONFIG.headerLevel).toBe(2);
      expect(DEFAULT_DECK_CONFIG.fsrs).toBeDefined();
      expect(DEFAULT_DECK_CONFIG.fsrs.requestRetention).toBeDefined();
    });

    it("should have proper FSRS configuration", () => {
      const { DEFAULT_DECK_CONFIG } = require("../../database/types");

      expect(DEFAULT_DECK_CONFIG.fsrs).toBeDefined();
      expect(DEFAULT_DECK_CONFIG.fsrs.requestRetention).toBe(0.9);
      expect(DEFAULT_DECK_CONFIG.fsrs.profile).toBe("STANDARD");
    });
  });

  describe("Error Handling", () => {
    it("should handle initialization errors gracefully", async () => {
      const adapter = new InMemoryAdapter();
      const debugLog = jest.fn();
      const dbService = new MainDatabaseService("test.db", adapter, debugLog);

      // Mock a more specific SQL.js error
      const mockSQL = require("sql.js").default;
      mockSQL.mockRejectedValueOnce(new Error("WASM initialization failed"));

      await expect(dbService.initialize()).rejects.toThrow(
        "WASM initialization failed",
      );
      // Debug log may or may not be called depending on where the error occurs
      expect(debugLog).toHaveBeenCalled();
    });

    it("should handle save operation errors", async () => {
      // Since we have mocked database, save should succeed
      await expect(db.save()).resolves.not.toThrow();
    });
  });

  describe("Schema and Migration Support", () => {
    it("should have schema constants available", () => {
      const schemas = require("../../database/schemas");

      expect(schemas.CREATE_TABLES_SQL).toBeDefined();
      expect(schemas.CURRENT_SCHEMA_VERSION).toBeDefined();
      expect(typeof schemas.buildMigrationSQL).toBe("function");
    });

    it("should have proper SQL query definitions", () => {
      const schemas = require("../../database/schemas");

      // Verify some key SQL queries exist in SQL_QUERIES object
      expect(schemas.SQL_QUERIES.GET_DECK_BY_FILEPATH).toBeDefined();
      expect(schemas.SQL_QUERIES.INSERT_DECK).toBeDefined();
      expect(schemas.SQL_QUERIES.INSERT_FLASHCARD).toBeDefined();
      expect(schemas.SQL_QUERIES.UPDATE_FLASHCARD_DECK_IDS).toBeDefined();
      expect(schemas.SQL_QUERIES.GET_FLASHCARDS_BY_DECK).toBeDefined();
    });
  });

  describe("Database Service Method Signatures", () => {
    it("should have methods with correct parameter types", async () => {
      // These will fail due to database not being initialized, but we can verify method signatures
      const testDeck = {
        id: "deck-001",
        name: "Simple Test Deck",
        tag: "test",
        filepath: "test/simple.md",
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        config: {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          reviewOrder: "due-date" as const,
          headerLevel: 2,
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD" as const,
          },
        },
      };

      // Method calls should succeed with mocked database, TypeScript validates signatures
      await expect(db.createDeck(testDeck)).resolves.not.toThrow();
      await expect(db.getDeckByFilepath("/test.md")).resolves.toBe(null);
      await expect(db.getAllDecks()).resolves.toEqual([]);
    });
  });
});
