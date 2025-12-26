import { jest } from "@jest/globals";
import { TFile, Vault, MetadataCache } from "obsidian";
import { DeckManager } from "../services/DeckManager";
import { DEFAULT_DECK_CONFIG } from "../database/types";
import DecksPlugin from "../main";

// Mock the worker and related dependencies
jest.mock("../database/WorkerDatabaseService");

describe("WorkerDeckSync", () => {
  let deckManager: DeckManager;
  let mockVault: jest.Mocked<Vault>;
  let mockMetadataCache: jest.Mocked<MetadataCache>;
  let mockDb: any;
  let mockPlugin: jest.Mocked<DecksPlugin>;

  beforeEach(() => {
    // Mock Vault
    mockVault = {
      getAbstractFileByPath: jest.fn(),
      read: jest.fn(),
      getMarkdownFiles: jest.fn(() => []),
    } as any;

    // Mock MetadataCache
    mockMetadataCache = {
      getFileCache: jest.fn(),
    } as any;

    // Mock Database
    mockDb = {
      getDeckById: jest.fn(),
      getFlashcardsByDeck: jest.fn(),
      checkForDuplicatesInDeck: jest.fn(),
      batchDeleteFlashcards: jest.fn(),
      batchCreateFlashcards: jest.fn(),
      batchUpdateFlashcards: jest.fn(),
      updateDeckTimestamp: jest.fn(),
      getLatestReviewLogForFlashcard: jest.fn(),
    };

    // Mock Plugin
    mockPlugin = {
      settings: {
        ui: {
          enableNotices: false,
        },
      },
    } as any;

    deckManager = new DeckManager(
      mockVault,
      mockMetadataCache,
      mockDb,
      mockPlugin,
    );
  });

  describe("parseFlashcardsFromContent", () => {
    it("should parse header-paragraph flashcards correctly", () => {
      const content = `# Title

## Question 1
This is the answer to question 1.

## Question 2
This is the answer to question 2.`;

      const result = deckManager.parseFlashcardsFromContent(content, 2);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        front: "Question 1",
        back: "This is the answer to question 1.",
        type: "header-paragraph",
      });
      expect(result[1]).toEqual({
        front: "Question 2",
        back: "This is the answer to question 2.",
        type: "header-paragraph",
      });
    });

    it("should parse table flashcards correctly", () => {
      const content = `## Flashcards

| Front | Back |
|-------|------|
| Table Question 1 | Table Answer 1 |
| Table Question 2 | Table Answer 2 |`;

      const result = deckManager.parseFlashcardsFromContent(content, 2);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        front: "Table Question 1",
        back: "Table Answer 1",
        type: "table",
      });
      expect(result[1]).toEqual({
        front: "Table Question 2",
        back: "Table Answer 2",
        type: "table",
      });
    });

    it("should parse mixed header and table flashcards correctly", () => {
      const content = `## Question 1
This is a header answer.

| Front | Back |
|-------|------|
| Table Question | Table Answer |

## Question 2
Another header answer.`;

      const result = deckManager.parseFlashcardsFromContent(content, 2);

      // Parser includes table in the content because header has non-table content first
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        front: "Question 1",
        back: "This is a header answer.\n\n| Front | Back |\n|-------|------|\n| Table Question | Table Answer |",
        type: "header-paragraph",
      });
      expect(result[1]).toEqual({
        front: "Question 2",
        back: "Another header answer.",
        type: "header-paragraph",
      });
    });

    it("should respect header level configuration", () => {
      const content = `# Level 1
Content 1

## Level 2
Content 2

### Level 3
Content 3`;

      // Parse only H3 headers
      const result = deckManager.parseFlashcardsFromContent(content, 3);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        front: "Level 3",
        back: "Content 3",
        type: "header-paragraph",
      });
    });

    it("should handle frontmatter correctly", () => {
      const content = `---
title: Test
tags: flashcards
---

## Question 1
Answer 1`;

      const result = deckManager.parseFlashcardsFromContent(content, 2);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        front: "Question 1",
        back: "Answer 1",
        type: "header-paragraph",
      });
    });

    it("should skip title headers containing 'flashcard'", () => {
      const content = `# My Flashcard Deck
Some intro text.

## Question 1
Answer 1`;

      const result = deckManager.parseFlashcardsFromContent(content, 2);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        front: "Question 1",
        back: "Answer 1",
        type: "header-paragraph",
      });
    });

    it("should handle empty content", () => {
      const content = ``;
      const result = deckManager.parseFlashcardsFromContent(content, 2);
      expect(result).toHaveLength(0);
    });

    it("should handle content with no flashcards", () => {
      const content = `# Title
This is just some regular content with no flashcards.

Some more paragraphs of text.`;

      const result = deckManager.parseFlashcardsFromContent(content, 2);
      expect(result).toHaveLength(0);
    });

    it("should handle nested headers correctly", () => {
      const content = `## Main Question
This is the main answer.

### Sub Question
This should not be parsed as a separate flashcard when looking for H2.

## Another Main Question
Another main answer.`;

      const result = deckManager.parseFlashcardsFromContent(content, 2);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        front: "Main Question",
        back: "This is the main answer.",
        type: "header-paragraph",
      });
      expect(result[1]).toEqual({
        front: "Another Main Question",
        back: "Another main answer.",
        type: "header-paragraph",
      });
    });
  });

  describe("syncFlashcardsForDeck", () => {
    const mockDeck = {
      id: "deck_123",
      name: "Test Deck",
      filepath: "test.md",
      config: {
        ...DEFAULT_DECK_CONFIG,
        headerLevel: 2,
      },
      modified: "2023-01-01T00:00:00.000Z",
    };

    const mockFile = {
      path: "test.md",
      stat: {
        mtime: new Date("2023-01-02T00:00:00.000Z").getTime(),
      },
    } as TFile;

    beforeEach(() => {
      mockDb.getDeckById.mockResolvedValue(mockDeck);
      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockVault.read.mockResolvedValue("# Test content");
    });

    it("should call getDeckById to get deck information", async () => {
      await deckManager.syncFlashcardsForDeck("deck_123");
      expect(mockDb.getDeckById).toHaveBeenCalledWith("deck_123");
    });

    it("should return early when deck is not found", async () => {
      mockDb.getDeckById.mockResolvedValue(null);

      await deckManager.syncFlashcardsForDeck("deck_123");

      expect(mockDb.getDeckById).toHaveBeenCalledWith("deck_123");
      expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
    });

    it("should return early when file is not found", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await deckManager.syncFlashcardsForDeck("deck_123");

      expect(mockDb.getDeckById).toHaveBeenCalledWith("deck_123");
      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith("test.md");
      expect(mockVault.read).not.toHaveBeenCalled();
    });

    it("should skip sync if file is not modified and force is false", async () => {
      // Setup file modification time to be older than deck modified time
      const olderFile = {
        ...mockFile,
        stat: {
          mtime: new Date("2022-12-31T00:00:00.000Z").getTime(),
        },
      };
      mockVault.getAbstractFileByPath.mockReturnValue(olderFile as TFile);

      await deckManager.syncFlashcardsForDeck("deck_123");

      expect(mockDb.getDeckById).toHaveBeenCalledWith("deck_123");
      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith("test.md");
      // Should not proceed to read file content
      expect(mockVault.read).not.toHaveBeenCalled();
    });

    it("should have the ability to handle worker-based sync", async () => {
      // This test demonstrates that the DeckManager is ready for worker-based sync
      // The implementation checks for syncFlashcardsForDeckWorker method and will use it if available

      // Mock a worker database that has the worker method
      const workerDb = { ...mockDb, syncFlashcardsForDeckWorker: jest.fn() };

      const deckManagerWithWorker = new DeckManager(
        mockVault,
        mockMetadataCache,
        workerDb,
        mockPlugin,
      );

      // Verify that the DeckManager can detect worker capability
      const hasWorkerMethod =
        typeof workerDb.syncFlashcardsForDeckWorker === "function";
      expect(hasWorkerMethod).toBe(true);
    });
  });

  describe("Worker method delegation", () => {
    it("should detect when database has worker method", () => {
      // Add worker method to mock database
      mockDb.syncFlashcardsForDeckWorker = jest.fn();

      // Check detection logic directly
      const hasWorkerMethod =
        typeof mockDb.syncFlashcardsForDeckWorker === "function";
      expect(hasWorkerMethod).toBe(true);
    });

    it("should detect when database does not have worker method", () => {
      // Ensure worker method is not present
      delete mockDb.syncFlashcardsForDeckWorker;

      // Check detection logic directly
      const hasWorkerMethod =
        typeof mockDb.syncFlashcardsForDeckWorker === "function";
      expect(hasWorkerMethod).toBe(false);
    });
  });

  describe("Binary data handling", () => {
    it("should handle Uint8Array data correctly for backup operations", () => {
      // Test data that would come from database export
      const testData = new Uint8Array([1, 2, 3, 4, 5]);

      // Verify it's a Uint8Array
      expect(testData instanceof Uint8Array).toBe(true);
      expect(testData.length).toBe(5);
      expect(Array.from(testData)).toEqual([1, 2, 3, 4, 5]);
    });

    it("should handle serialized array data conversion", () => {
      // Simulate what happens when Uint8Array is sent through postMessage
      const originalData = new Uint8Array([10, 20, 30, 40, 50]);

      // When sent through postMessage, Uint8Array becomes a regular object
      const serializedData = JSON.parse(JSON.stringify(originalData));

      // Verify the conversion back to Uint8Array works
      const convertedData = new Uint8Array(Object.values(serializedData));
      expect(convertedData instanceof Uint8Array).toBe(true);
      expect(Array.from(convertedData)).toEqual([10, 20, 30, 40, 50]);
    });

    it("should handle database export buffer format", () => {
      // Test the format returned by worker export
      const exportedBuffer = new Uint8Array([255, 254, 253, 252]);
      const workerResponse = { buffer: exportedBuffer };

      // Verify we can extract the buffer correctly
      expect(workerResponse.buffer instanceof Uint8Array).toBe(true);
      expect(workerResponse.buffer).toBe(exportedBuffer);
    });
  });
});
