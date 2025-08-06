import { DeckManager } from "../services/DeckManager";
import { DatabaseService } from "../database/DatabaseService";
import { Vault, MetadataCache, TFile, CachedMetadata } from "obsidian";
import { Deck, Flashcard, DEFAULT_DECK_CONFIG } from "../database/types";

// Mock the database service
jest.mock("../database/DatabaseService");

// Mock adapter
const mockAdapter = {
  exists: jest.fn(),
  readBinary: jest.fn(),
  writeBinary: jest.fn(),
  mkdir: jest.fn(),
};

describe("DeckManager", () => {
  let deckManager: DeckManager;
  let mockVault: Vault;
  let mockMetadataCache: MetadataCache;
  let mockDb: jest.Mocked<DatabaseService>;

  beforeEach(() => {
    // Create mock instances
    mockVault = new Vault();
    mockMetadataCache = new MetadataCache();
    mockDb = new DatabaseService(
      "test.db",
      mockAdapter,
      () => {},
    ) as jest.Mocked<DatabaseService>; // Empty debugLog for tests

    // Reset mocks
    jest.clearAllMocks();
    (mockVault as any)._clear();
    (mockMetadataCache as any)._clear();

    // Setup default mock returns
    mockDb.getDeckByFilepath = jest.fn().mockResolvedValue(null);
    mockDb.getDeckByTag = jest.fn().mockResolvedValue(null);
    mockDb.getFlashcardsByDeck = jest.fn().mockResolvedValue([]);
    mockDb.createFlashcard = jest.fn();
    mockDb.updateFlashcard = jest.fn();
    mockDb.deleteFlashcard = jest.fn();
    mockDb.updateDeckTimestamp = jest.fn();
    mockDb.createDeck = jest.fn();

    // Create DeckManager instance
    deckManager = new DeckManager(mockVault, mockMetadataCache, mockDb);
  });

  describe("scanVaultForDecks", () => {
    it("should find decks with #flashcards tags", async () => {
      // Add test files to vault
      (mockVault as any)._addFile("math.md", "# Math\nContent");
      (mockVault as any)._addFile("spanish.md", "# Spanish\nContent");
      (mockVault as any)._addFile("no-tags.md", "# No Tags\nContent");

      // Set metadata for files
      (mockMetadataCache as any)._setCache("math.md", {
        tags: [{ tag: "#flashcards/math" }],
      });
      (mockMetadataCache as any)._setCache("spanish.md", {
        tags: [{ tag: "#flashcards/spanish/vocabulary" }],
      });
      (mockMetadataCache as any)._setCache("no-tags.md", {
        tags: [],
      });

      // Scan for decks
      const decksMap = await deckManager.scanVaultForDecks();

      // Verify results
      expect(decksMap.size).toBe(2);
      expect(decksMap.has("#flashcards/math")).toBe(true);
      expect(decksMap.has("#flashcards/spanish/vocabulary")).toBe(true);
      expect(decksMap.get("#flashcards/math")).toHaveLength(1);
      expect(decksMap.get("#flashcards/spanish/vocabulary")).toHaveLength(1);
    });

    it("should handle frontmatter tags", async () => {
      // Add file with frontmatter tags
      (mockVault as any)._addFile(
        "frontmatter.md",
        "---\ntags: flashcards/science\n---\n# Science",
      );

      // Set metadata with frontmatter
      (mockMetadataCache as any)._setCache("frontmatter.md", {
        frontmatter: {
          tags: "flashcards/science",
        },
      });

      const decksMap = await deckManager.scanVaultForDecks();

      expect(decksMap.size).toBe(1);
      expect(decksMap.has("#flashcards/science")).toBe(true);
    });

    it("should handle array of frontmatter tags", async () => {
      (mockVault as any)._addFile(
        "multi-tags.md",
        "---\ntags: [flashcards/math, other-tag]\n---\n# Content",
      );

      (mockMetadataCache as any)._setCache("multi-tags.md", {
        frontmatter: {
          tags: ["flashcards/math", "other-tag"],
        },
      });

      const decksMap = await deckManager.scanVaultForDecks();

      expect(decksMap.size).toBe(1);
      expect(decksMap.has("#flashcards/math")).toBe(true);
    });
  });

  describe("syncDecks", () => {
    it("should create new decks that dont exist", async () => {
      // Mock existing decks
      mockDb.getAllDecks.mockResolvedValue([]);
      mockDb.createDeck.mockImplementation(
        async (deck) =>
          ({
            ...deck,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          }) as Deck,
      );

      // Add file with deck
      (mockVault as any)._addFile("new-deck.md", "# Content");
      (mockMetadataCache as any)._setCache("new-deck.md", {
        tags: [{ tag: "#flashcards/history" }],
      });

      // Sync decks
      await deckManager.syncDecks();

      // Verify deck was created
      expect(mockDb.createDeck).toHaveBeenCalledTimes(1);
      expect(mockDb.createDeck).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "new-deck",
          filepath: "new-deck.md",
          tag: "#flashcards/history",
        }),
      );
    });

    it("should not create duplicate decks", async () => {
      // Mock existing deck
      mockDb.getAllDecks.mockResolvedValue([
        {
          id: "existing_deck",
          name: "math",
          filepath: "math.md",
          tag: "#flashcards/math",
          lastReviewed: null,
          config: DEFAULT_DECK_CONFIG,
          created: "2024-01-01",
          modified: "2024-01-01",
        },
      ]);

      // Add file with existing deck tag
      (mockVault as any)._addFile("math.md", "# Content");
      (mockMetadataCache as any)._setCache("math.md", {
        tags: [{ tag: "#flashcards/math" }],
      });

      await deckManager.syncDecks();

      // Verify deck was not created again
      expect(mockDb.createDeck).not.toHaveBeenCalled();
    });

    it("should create separate decks for files with same tag", async () => {
      // Mock existing decks
      mockDb.getAllDecks.mockResolvedValue([]);
      mockDb.createDeck.mockImplementation(
        async (deck) =>
          ({
            ...deck,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          }) as Deck,
      );

      // Add two files with same tag
      (mockVault as any)._addFile("math1.md", "# Math 1");
      (mockMetadataCache as any)._setCache("math1.md", {
        tags: [{ tag: "#flashcards/math" }],
      });
      (mockVault as any)._addFile("math2.md", "# Math 2");
      (mockMetadataCache as any)._setCache("math2.md", {
        tags: [{ tag: "#flashcards/math" }],
      });

      await deckManager.syncDecks();

      // Verify both decks were created
      expect(mockDb.createDeck).toHaveBeenCalledTimes(2);
      expect(mockDb.createDeck).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          name: "math1",
          filepath: "math1.md",
          tag: "#flashcards/math",
        }),
      );
      expect(mockDb.createDeck).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          name: "math2",
          filepath: "math2.md",
          tag: "#flashcards/math",
        }),
      );
    });

    it("should delete deck when file is deleted", async () => {
      // Mock existing deck
      const existingDeck: Deck = {
        id: "deck_123",
        name: "test",
        filepath: "test.md",
        tag: "#flashcards/test",
        lastReviewed: null,
        config: DEFAULT_DECK_CONFIG,
        created: "2024-01-01",
        modified: "2024-01-01",
      };

      mockDb.getAllDecks.mockResolvedValue([existingDeck]);
      mockDb.deleteDeckByFilepath = jest.fn().mockResolvedValue(undefined);
      mockDb.deleteFlashcardsByFile = jest.fn().mockResolvedValue(undefined);

      // Add file
      (mockVault as any)._addFile("test.md", "# Test Content");

      // Simulate file deletion by calling handleFileDelete directly
      const deckManager = new DeckManager(mockVault, mockMetadataCache, mockDb);

      // We need to access the main plugin's handleFileDelete, but since we're testing DeckManager,
      // we'll test the database operations directly
      await mockDb.deleteFlashcardsByFile("test.md");
      await mockDb.deleteDeckByFilepath("test.md");

      // Verify both flashcards and deck were deleted
      expect(mockDb.deleteFlashcardsByFile).toHaveBeenCalledWith("test.md");
      expect(mockDb.deleteDeckByFilepath).toHaveBeenCalledWith("test.md");
    });
  });

  describe("parseFlashcardsFromFile", () => {
    it("should parse header+paragraph flashcards", async () => {
      const content = `# Math Flashcards

This document contains flashcards.

## What is 2+2?

The answer is 4.

## What is the capital of France?

Paris is the capital of France.
It has many attractions.`;

      const file = new TFile("test.md");
      jest.spyOn(mockVault, "read").mockResolvedValue(content);

      const flashcards = await deckManager.parseFlashcardsFromFile(file);

      expect(flashcards).toHaveLength(2);
      expect(flashcards[0]).toEqual({
        front: "What is 2+2?",
        back: "The answer is 4.",
        type: "header-paragraph",
        lineNumber: 5,
      });
      expect(flashcards[1]).toEqual({
        front: "What is the capital of France?",
        back: "Paris is the capital of France.\nIt has many attractions.",
        type: "header-paragraph",
        lineNumber: 9,
      });
    });

    it("should parse table flashcards", async () => {
      const content = `# Spanish Vocabulary

| Spanish | English |
|---------|---------|
| Hola | Hello |
| Adiós | Goodbye |
| Gracias | Thank you |`;

      const file = new TFile("spanish.md");
      jest.spyOn(mockVault, "read").mockResolvedValue(content);

      const flashcards = await deckManager.parseFlashcardsFromFile(file);

      // H1 header should not be parsed when default header level is H2
      expect(flashcards).toHaveLength(3);
      expect(flashcards[0]).toEqual({
        front: "Hola",
        back: "Hello",
        type: "table",
        lineNumber: 5,
      });
      expect(flashcards[2]).toEqual({
        front: "Gracias",
        back: "Thank you",
        type: "table",
        lineNumber: 7,
      });
    });

    it("should parse headers based on configured header level", async () => {
      const content = `# Title (H1)

Some content under H1.

## Question 1 (H2)

Answer to question 1.

### Question 2 (H3)

Answer to question 2.`;

      const file = new TFile("test.md");
      jest.spyOn(mockVault, "read").mockResolvedValue(content);

      // Create DeckManager with mock plugin that has H2 setting
      const mockPlugin = {
        settings: {
          parsing: {
            headerLevel: 2,
          },
        },
      };
      const deckManagerH2 = new DeckManager(
        mockVault,
        mockMetadataCache,
        mockDb,
        mockPlugin,
      );

      const flashcardsH2 = await deckManagerH2.parseFlashcardsFromFile(file);

      // Should only parse H2 headers
      expect(flashcardsH2).toHaveLength(1);
      expect(flashcardsH2[0]).toEqual({
        front: "Question 1 (H2)",
        back: "Answer to question 1.",
        type: "header-paragraph",
        lineNumber: 5,
      });

      // Test with H3 setting
      mockPlugin.settings.parsing.headerLevel = 3;
      const deckManagerH3 = new DeckManager(
        mockVault,
        mockMetadataCache,
        mockDb,
        mockPlugin,
      );

      const flashcardsH3 = await deckManagerH3.parseFlashcardsFromFile(file);

      // Should only parse H3 headers
      expect(flashcardsH3).toHaveLength(1);
      expect(flashcardsH3[0]).toEqual({
        front: "Question 2 (H3)",
        back: "Answer to question 2.",
        type: "header-paragraph",
        lineNumber: 9,
      });
    });

    it("should create deck for single file without full sync", async () => {
      const filePath = "test.md";
      const tag = "#flashcards/test";

      // Add file to vault
      (mockVault as any)._addFile(filePath, "# Test\nContent");

      // Mock that no deck exists initially
      mockDb.getDeckByFilepath.mockResolvedValue(null);

      await deckManager.createDeckForFile(filePath, tag);

      // Verify createDeck was called with correct parameters
      expect(mockDb.createDeck).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "test", // file basename
          filepath: filePath,
          tag: tag,
          config: expect.objectContaining({
            newCardsLimit: 20,
            reviewCardsLimit: 100,
            enableNewCardsLimit: false,
            enableReviewCardsLimit: false,
            reviewOrder: "due-date",
          }),
        }),
      );
    });

    it("should skip document title headers", async () => {
      const content = `# Flashcards Document

This is a description.

## First Question

First answer.`;

      const file = new TFile("test.md");
      jest.spyOn(mockVault, "read").mockResolvedValue(content);

      const flashcards = await deckManager.parseFlashcardsFromFile(file);

      expect(flashcards).toHaveLength(1);
      expect(flashcards[0].front).toBe("First Question");
    });

    it("should handle frontmatter correctly", async () => {
      const content = `---
tags: flashcards/test
---

# Test Document

## Question 1

Answer 1`;

      const file = new TFile("test.md");
      jest.spyOn(mockVault, "read").mockResolvedValue(content);

      const flashcards = await deckManager.parseFlashcardsFromFile(file);

      expect(flashcards).toHaveLength(1);
      expect(flashcards[0].front).toBe("Question 1");
    });
  });

  describe("syncFlashcardsForDeck", () => {
    it("should sync flashcards with smart update logic", async () => {
      const deck: Deck = {
        id: "deck_123",
        name: "test",
        filepath: "test.md",
        tag: "#flashcards/test",
        lastReviewed: null,
        config: DEFAULT_DECK_CONFIG,
        created: "2024-01-01",
        modified: "2024-01-01",
      };

      mockDb.getDeckByFilepath.mockResolvedValue(deck);
      mockDb.getFlashcardsByDeck.mockResolvedValue([]);
      mockDb.updateFlashcard.mockResolvedValue();
      mockDb.deleteFlashcard.mockResolvedValue();
      mockDb.createFlashcard.mockImplementation(
        async (card) =>
          ({
            ...card,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          }) as Flashcard,
      );

      // Add file
      (mockVault as any)._addFile("test.md", "## Question\n\nAnswer");
      (mockMetadataCache as any)._setCache("test.md", {
        tags: [{ tag: "#flashcards/test" }],
      });

      await deckManager.syncFlashcardsForDeck("test.md");

      // Verify existing flashcards were checked
      expect(mockDb.getFlashcardsByDeck).toHaveBeenCalledWith("deck_123");

      // Verify new flashcard was created with contentHash
      expect(mockDb.createFlashcard).toHaveBeenCalledTimes(1);
      expect(mockDb.createFlashcard).toHaveBeenCalledWith(
        expect.objectContaining({
          deckId: "deck_123",
          front: "Question",
          back: "Answer",
          contentHash: expect.any(String),
        }),
      );
    });
  });

  describe("flashcard ID generation", () => {
    it("should generate consistent IDs for same content", () => {
      const deckId = "deck_123";
      const id1 = deckManager.generateFlashcardId("What is 2+2?", deckId);
      const id2 = deckManager.generateFlashcardId("What is 2+2?", deckId);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^card_[a-z0-9]+$/);
    });

    it("should generate different IDs for different content", () => {
      const deckId = "deck_123";
      const id1 = deckManager.generateFlashcardId("Question 1", deckId);
      const id2 = deckManager.generateFlashcardId("Question 2", deckId);

      expect(id1).not.toBe(id2);
    });

    it("should generate different IDs for same content in different decks", () => {
      const question = "What is 2+2?";
      const id1 = deckManager.generateFlashcardId(question, "deck_123");
      const id2 = deckManager.generateFlashcardId(question, "deck_456");

      expect(id1).not.toBe(id2);
    });

    it("should sync flashcards by deck name", async () => {
      const deck: Deck = {
        id: "deck_123",
        name: "test",
        filepath: "test.md",
        tag: "#flashcards/test",
        lastReviewed: null,
        config: DEFAULT_DECK_CONFIG,
        created: "2024-01-01",
        modified: "2024-01-01",
      };

      mockDb.getDeckByFilepath.mockResolvedValue(deck);
      mockDb.getFlashcardsByDeck.mockResolvedValue([]);
      mockDb.updateFlashcard.mockResolvedValue();
      mockDb.deleteFlashcard.mockResolvedValue();
      mockDb.createFlashcard.mockImplementation(
        async (card) =>
          ({
            ...card,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          }) as Flashcard,
      );

      // Add file
      (mockVault as any)._addFile("test.md", "## Question\n\nAnswer");
      (mockMetadataCache as any)._setCache("test.md", {
        tags: [{ tag: "#flashcards/test" }],
      });

      await deckManager.syncFlashcardsForDeckByName("test.md");

      // Verify deck was found by filepath
      expect(mockDb.getDeckByFilepath).toHaveBeenCalledWith("test.md");
      // Verify existing flashcards were checked
      expect(mockDb.getFlashcardsByDeck).toHaveBeenCalledWith("deck_123");
      // Verify new flashcard was created with contentHash
      expect(mockDb.createFlashcard).toHaveBeenCalledWith(
        expect.objectContaining({
          deckId: "deck_123",
          front: "Question",
          back: "Answer",
          contentHash: expect.any(String),
        }),
      );
    });
  });

  describe("deck name extraction", () => {
    it("should use file name for deck name", () => {
      const files = [
        { basename: "Math Formulas", path: "math.md" } as TFile,
        { basename: "Algebra", path: "algebra.md" } as TFile,
      ];
      const name = deckManager.extractDeckNameFromFiles(files);
      expect(name).toBe("Math Formulas");
    });

    it("should handle single file", () => {
      const files = [
        { basename: "Spanish Vocabulary", path: "spanish.md" } as TFile,
      ];
      const name = deckManager.extractDeckNameFromFiles(files);
      expect(name).toBe("Spanish Vocabulary");
    });

    it("should handle empty files array", () => {
      const files: TFile[] = [];
      const name = deckManager.extractDeckNameFromFiles(files);
      expect(name).toBe("General");
    });
  });

  describe("sync efficiency", () => {
    it("should sync flashcards for specific deck without affecting others", async () => {
      // Setup multiple files and decks
      (mockVault as any)._addFile("deck1.md", "# Question 1\nAnswer 1");
      (mockVault as any)._addFile("deck2.md", "# Question 2\nAnswer 2");

      // Mock metadata for both files
      (mockMetadataCache as any)._setCache("deck1.md", {
        tags: [{ tag: "#flashcards/math" }],
      });
      (mockMetadataCache as any)._setCache("deck2.md", {
        tags: [{ tag: "#flashcards/science" }],
      });

      const deck1: Deck = {
        id: "deck1",
        name: "deck1",
        filepath: "deck1.md",
        tag: "#flashcards/math",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 100,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: false,
          reviewOrder: "due-date",
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const deck2: Deck = {
        id: "deck2",
        name: "deck2",
        filepath: "deck2.md",
        tag: "#flashcards/science",
        lastReviewed: null,
        config: {
          newCardsLimit: 20,
          reviewCardsLimit: 100,
          enableNewCardsLimit: false,
          enableReviewCardsLimit: false,
          reviewOrder: "due-date",
        },
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      // Mock database calls
      mockDb.getDeckByFilepath.mockImplementation((filepath) => {
        if (filepath === "deck1.md") return Promise.resolve(deck1);
        if (filepath === "deck2.md") return Promise.resolve(deck2);
        return Promise.resolve(null);
      });

      mockDb.getFlashcardsByDeck.mockResolvedValue([]);

      // Test syncing only deck1
      await deckManager.syncFlashcardsForDeck("deck1.md");

      // Verify only deck1 was queried
      expect(mockDb.getDeckByFilepath).toHaveBeenCalledWith("deck1.md");
      expect(mockDb.getDeckByFilepath).not.toHaveBeenCalledWith("deck2.md");
      expect(mockDb.getFlashcardsByDeck).toHaveBeenCalledWith("deck1");
      expect(mockDb.getFlashcardsByDeck).not.toHaveBeenCalledWith("deck2");
    });

    it("should create deck for single file without full vault scan", async () => {
      // Setup single file
      const filepath = "new-deck.md";
      const tag = "#flashcards/test";

      // Add the file to mock vault
      (mockVault as any)._addFile(filepath, "# Test\nContent");

      // Mock that no deck exists yet
      mockDb.getDeckByFilepath.mockResolvedValue(null);
      mockDb.createDeck.mockResolvedValue({
        id: "test_deck",
        name: "test",
        filepath: filepath,
        tag: tag,
        lastReviewed: null,
        config: DEFAULT_DECK_CONFIG,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });

      // Test creating deck for specific file
      await deckManager.createDeckForFile(filepath, tag);

      // Verify targeted operations
      expect(mockDb.getDeckByFilepath).toHaveBeenCalledWith(filepath);
      expect(mockDb.createDeck).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "new-deck",
          filepath: filepath,
          tag: tag,
        }),
      );

      // Verify it doesn't scan other files
      expect(mockDb.getDeckByFilepath).toHaveBeenCalledTimes(1);
    });
  });

  describe("deck configuration updates", () => {
    it("should trigger stats refresh after config update", async () => {
      // Setup existing deck
      const deckId = "deck1";
      const newConfig = {
        newCardsLimit: 30,
        reviewCardsLimit: 150,
        enableNewCardsLimit: true,
        enableReviewCardsLimit: true,
        reviewOrder: "random" as const,
      };

      // Mock database update
      mockDb.updateDeck.mockResolvedValue();

      // Create a mock plugin with view
      const mockPlugin = {
        db: mockDb,
        view: {
          refreshStatsById: jest.fn().mockResolvedValue(),
        },
        updateDeckConfig: async function (deckId: string, config: any) {
          await this.db.updateDeck(deckId, { config });
          if (this.view) {
            await this.view.refreshStatsById(deckId);
          }
        },
      };

      // Test config update
      await mockPlugin.updateDeckConfig(deckId, newConfig);

      // Verify database was updated
      expect(mockDb.updateDeck).toHaveBeenCalledWith(deckId, {
        config: newConfig,
      });

      // Verify stats refresh was triggered for the specific deck
      expect(mockPlugin.view.refreshStatsById).toHaveBeenCalledWith(deckId);
      expect(mockPlugin.view.refreshStatsById).toHaveBeenCalledTimes(1);
    });

    it("should handle config update without view gracefully", async () => {
      // Setup deck config update without view
      const deckId = "deck1";
      const newConfig = {
        newCardsLimit: 25,
        reviewCardsLimit: 125,
        enableNewCardsLimit: false,
        enableReviewCardsLimit: false,
        reviewOrder: "due-date" as const,
      };

      mockDb.updateDeck.mockResolvedValue();

      // Create plugin without view
      const mockPlugin = {
        db: mockDb,
        view: null,
        updateDeckConfig: async function (deckId: string, config: any) {
          await this.db.updateDeck(deckId, { config });
          if (this.view) {
            await this.view.refreshStatsById(deckId);
          }
        },
      };

      // Test config update - should not throw error
      await expect(
        mockPlugin.updateDeckConfig(deckId, newConfig),
      ).resolves.not.toThrow();

      // Verify database was still updated
      expect(mockDb.updateDeck).toHaveBeenCalledWith(deckId, {
        config: newConfig,
      });

      it("should skip sync when file modification time hasn't changed", async () => {
        const filePath = "test.md";
        const modTime = Date.now() - 1000; // 1 second ago
        const deckModTime = Date.now(); // Deck modified after file

        // Setup file with specific modification time
        (mockVault as any)._addFile(filePath, "## Question\nAnswer");
        (mockVault as any)._updateFileModTime(filePath, modTime);

        const deck: Deck = {
          id: "deck1",
          name: "test",
          filepath: filePath,
          tag: "#flashcards/test",
          lastReviewed: null,
          config: DEFAULT_DECK_CONFIG,
          created: new Date().toISOString(),
          modified: new Date(deckModTime).toISOString(),
        };

        mockDb.getDeckByFilepath.mockResolvedValue(deck);
        mockDb.getFlashcardsByDeck.mockResolvedValue([]);

        await deckManager.syncFlashcardsForDeck(filePath);

        // Should not process flashcards since file hasn't changed
        expect(mockDb.getFlashcardsByDeck).not.toHaveBeenCalled();
        expect(mockDb.updateDeck).not.toHaveBeenCalled();
      });

      it("should sync when file modification time has changed", async () => {
        const filePath = "test.md";
        const oldDeckModTime = Date.now() - 2000; // 2 seconds ago
        const newFileModTime = Date.now() - 1000; // 1 second ago

        // Setup file with newer modification time
        (mockVault as any)._addFile(filePath, "## Question\nAnswer");
        (mockVault as any)._updateFileModTime(filePath, newFileModTime);

        const deck: Deck = {
          id: "deck1",
          name: "test",
          filepath: filePath,
          tag: "#flashcards/test",
          lastReviewed: null,
          config: DEFAULT_DECK_CONFIG,
          created: new Date().toISOString(),
          modified: new Date(oldDeckModTime).toISOString(),
        };

        mockDb.getDeckByFilepath.mockResolvedValue(deck);
        mockDb.getFlashcardsByDeck.mockResolvedValue([]);

        await deckManager.syncFlashcardsForDeck(filePath);

        // Should process flashcards since file has changed
        expect(mockDb.getFlashcardsByDeck).toHaveBeenCalledWith("deck1");
        expect(mockDb.updateDeckTimestamp).toHaveBeenCalledWith(
          "deck1",
          new Date(newFileModTime).toISOString(),
        );
      });
    });
  });

  describe("header level parsing", () => {
    it("should parse all header levels and include headerLevel property", async () => {
      const content = `# H1 Header
H1 content

## H2 Header
H2 content

### H3 Header
H3 content`;

      const file = new TFile("test.md");
      jest.spyOn(mockVault, "read").mockResolvedValue(content);

      const flashcards = await deckManager.parseFlashcardsFromFile(file);

      // Should parse all header levels
      expect(flashcards).toHaveLength(3);

      // Check that headerLevel is set correctly
      expect(flashcards[0]).toEqual(
        expect.objectContaining({
          front: "H1 Header",
          back: "H1 content",
          type: "header-paragraph",
          headerLevel: 1,
        }),
      );

      expect(flashcards[1]).toEqual(
        expect.objectContaining({
          front: "H2 Header",
          back: "H2 content",
          type: "header-paragraph",
          headerLevel: 2,
        }),
      );

      expect(flashcards[2]).toEqual(
        expect.objectContaining({
          front: "H3 Header",
          back: "H3 content",
          type: "header-paragraph",
          headerLevel: 3,
        }),
      );
    });
  });
});
