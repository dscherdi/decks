import { DeckManager } from "../services/DeckManager";
import { DatabaseService } from "../database/DatabaseService";
import { Vault, MetadataCache, TFile, CachedMetadata } from "obsidian";
import { Deck, Flashcard } from "../database/types";

// Mock the database service
jest.mock("../database/DatabaseService");

describe("DeckManager", () => {
  let deckManager: DeckManager;
  let mockVault: Vault;
  let mockMetadataCache: MetadataCache;
  let mockDb: jest.Mocked<DatabaseService>;

  beforeEach(() => {
    // Create mock instances
    mockVault = new Vault();
    mockMetadataCache = new MetadataCache();
    mockDb = new DatabaseService("test.db") as jest.Mocked<DatabaseService>;

    // Reset mocks
    jest.clearAllMocks();
    (mockVault as any)._clear();
    (mockMetadataCache as any)._clear();

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
          tag: "#flashcards/history",
        }),
      );
    });

    it("should not create duplicate decks", async () => {
      // Mock existing deck
      mockDb.getAllDecks.mockResolvedValue([
        {
          id: "deck_123",
          name: "Math",
          tag: "#flashcards/math",
          lastReviewed: null,
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

      // Should include the header as a flashcard since it doesn't contain "flashcard" keyword
      expect(flashcards).toHaveLength(4);
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
      expect(flashcards[3]).toEqual({
        front: "Spanish Vocabulary",
        back: expect.stringContaining("| Spanish | English |"),
        type: "header-paragraph",
        lineNumber: 1,
      });
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
        name: "Test",
        tag: "#flashcards/test",
        lastReviewed: null,
        created: "2024-01-01",
        modified: "2024-01-01",
      };

      mockDb.getDeckByTag.mockResolvedValue(deck);
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

      await deckManager.syncFlashcardsForDeck("#flashcards/test");

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
      const id1 = (deckManager as any).generateFlashcardId("What is 2+2?");
      const id2 = (deckManager as any).generateFlashcardId("What is 2+2?");

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^card_[a-z0-9]+$/);
    });

    it("should generate different IDs for different content", () => {
      const id1 = (deckManager as any).generateFlashcardId("Question 1");
      const id2 = (deckManager as any).generateFlashcardId("Question 2");

      expect(id1).not.toBe(id2);
    });

    it("should sync flashcards by deck name", async () => {
      const deck: Deck = {
        id: "deck_123",
        name: "Test",
        tag: "#flashcards/test",
        lastReviewed: null,
        created: "2024-01-01",
        modified: "2024-01-01",
      };

      mockDb.getDeckByName.mockResolvedValue(deck);
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

      // Add file with basename "Test" to match deck name
      (mockVault as any)._addFile("Test.md", "## Question\n\nAnswer");
      (mockMetadataCache as any)._setCache("Test.md", {
        tags: [{ tag: "#flashcards/test" }],
      });

      await deckManager.syncFlashcardsForDeckByName("Test");

      // Verify deck was found by name
      expect(mockDb.getDeckByName).toHaveBeenCalledWith("Test");
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
      const name = (deckManager as any).extractDeckNameFromFiles(files);
      expect(name).toBe("Math Formulas");
    });

    it("should handle single file", () => {
      const files = [
        { basename: "Spanish Vocabulary", path: "spanish.md" } as TFile,
      ];
      const name = (deckManager as any).extractDeckNameFromFiles(files);
      expect(name).toBe("Spanish Vocabulary");
    });

    it("should handle empty files array", () => {
      const files: TFile[] = [];
      const name = (deckManager as any).extractDeckNameFromFiles(files);
      expect(name).toBe("General");
    });
  });
});
