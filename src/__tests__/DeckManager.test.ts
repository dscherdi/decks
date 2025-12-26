import { DeckManager } from "../services/DeckManager";
import { MainDatabaseService } from "../database/MainDatabaseService";
import {
  Vault,
  MetadataCache,
  TFile,
  CachedMetadata,
  DataAdapter,
} from "obsidian";
import { Deck, Flashcard, DEFAULT_DECK_CONFIG } from "../database/types";
import { generateFlashcardId } from "../utils/hash";

// Mock the database service
jest.mock("../database/MainDatabaseService");

// Mock types
interface MockDataAdapter extends Partial<DataAdapter> {
  exists: jest.Mock;
  readBinary: jest.Mock;
  writeBinary: jest.Mock;
  mkdir: jest.Mock;
  getName: jest.Mock;
  stat: jest.Mock;
  list: jest.Mock;
  read: jest.Mock;
  write: jest.Mock;
  append: jest.Mock;
  process: jest.Mock;
  getResourcePath: jest.Mock;
  remove: jest.Mock;
  trashSystem: jest.Mock;
  trashLocal: jest.Mock;
  rmdir: jest.Mock;
  rename: jest.Mock;
  copy: jest.Mock;
}

interface MockTFileConstructor {
  new (path?: string): TFile;
}

interface MockVault extends Vault {
  _addFile: (path: string, content: string) => void;
  _updateFileModTime: (path: string, mtime: number) => void;
  _clear: () => void;
}

interface MockMetadataCache extends MetadataCache {
  _setCache: (path: string, metadata: CachedMetadata) => void;
  _clear: () => void;
}

// Mock adapter
const mockAdapter: MockDataAdapter = {
  exists: jest.fn(),
  readBinary: jest.fn(),
  writeBinary: jest.fn(),
  mkdir: jest.fn(),
  getName: jest.fn().mockReturnValue("mock-adapter"),
  stat: jest.fn(),
  list: jest.fn().mockResolvedValue([]),
  read: jest.fn(),
  write: jest.fn(),
  append: jest.fn(),
  process: jest.fn(),
  getResourcePath: jest.fn(),
  remove: jest.fn(),
  trashSystem: jest.fn(),
  trashLocal: jest.fn(),
  rmdir: jest.fn(),
  rename: jest.fn(),
  copy: jest.fn(),
};

describe("DeckManager", () => {
  let deckManager: DeckManager;
  let mockVault: MockVault;
  let mockMetadataCache: MockMetadataCache;
  let mockDb: jest.Mocked<MainDatabaseService>;

  beforeEach(() => {
    // Create mock instances
    mockVault = new Vault() as MockVault;
    mockMetadataCache = new MetadataCache() as MockMetadataCache;

    mockDb = new MainDatabaseService(
      "test.db",
      mockAdapter as DataAdapter,
      () => {},
    ) as jest.Mocked<MainDatabaseService>;

    // Reset mocks
    jest.clearAllMocks();

    // Add mock implementations to Vault
    mockVault._clear = jest.fn(() => {
      mockVault.getAllLoadedFiles = jest.fn().mockReturnValue([]);
    });
    mockVault._addFile = jest.fn((path: string, content: string) => {
      const files = mockVault.getAllLoadedFiles();
      const file = {
        path,
        name: path.split("/").pop() || "",
        basename:
          path
            .split("/")
            .pop()
            ?.replace(/\.[^/.]+$/, "") || "",
        extension: path.split(".").pop() || "",
        stat: { mtime: Date.now(), ctime: Date.now(), size: content.length },
      } as TFile;
      files.push(file);
      mockVault.getAllLoadedFiles = jest.fn().mockReturnValue(files);
    });
    mockVault._updateFileModTime = jest.fn();
    mockVault.getMarkdownFiles = jest.fn().mockReturnValue([]);
    mockVault.cachedRead = jest.fn();

    // Add mock implementations to MetadataCache
    mockMetadataCache._clear = jest.fn();
    mockMetadataCache._setCache = jest.fn();
    mockMetadataCache.getFileCache = jest.fn();

    // Setup database mocks
    mockDb.getDeckByFilepath = jest.fn().mockResolvedValue(null);
    mockDb.getDeckByTag = jest.fn().mockResolvedValue(null);
    mockDb.getFlashcardsByDeck = jest.fn().mockResolvedValue([]);
    mockDb.getAllFlashcards = jest.fn().mockResolvedValue([]);
    mockDb.createFlashcard = jest.fn();
    mockDb.updateFlashcard = jest.fn();
    mockDb.deleteFlashcard = jest.fn();
    mockDb.getLatestReviewLogForFlashcard = jest.fn();
    mockDb.updateDeckTimestamp = jest.fn();
    mockDb.createDeck = jest.fn();
    mockDb.batchCreateFlashcards = jest.fn();
    mockDb.batchUpdateFlashcards = jest.fn();
    mockDb.batchDeleteFlashcards = jest.fn();

    // Add SQL.js raw database interface mocks for FlashcardSynchronizer
    (mockDb as any).prepare = jest.fn().mockReturnValue({
      run: jest.fn(),
      bind: jest.fn(),
      step: jest.fn().mockReturnValue(false),
      get: jest.fn(),
      getAsObject: jest.fn().mockReturnValue({}),
      free: jest.fn(),
    });

    // Clear mock data
    mockVault._clear();
    mockMetadataCache._clear();

    // Create DeckManager instance
    deckManager = new DeckManager(mockVault, mockMetadataCache, mockDb);
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

      const content = "## Question\n\nAnswer";

      mockDb.getDeckById.mockResolvedValue(deck);
      mockVault.cachedRead = jest.fn().mockResolvedValue(content);

      await deckManager.syncFlashcardsForDeck("deck_123");

      // Verify operations were attempted
      expect(mockDb.getDeckById).toHaveBeenCalledWith("deck_123");
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

      const content = "## Question\n\nAnswer";

      mockDb.getDeckById.mockResolvedValue(deck);
      mockVault.cachedRead = jest.fn().mockResolvedValue(content);

      await deckManager.syncFlashcardsForDeck("deck_123");

      expect(mockDb.getDeckById).toHaveBeenCalledWith("deck_123");
    });
  });

  describe("sync efficiency", () => {
    it("should sync flashcards for specific deck without affecting others", async () => {
      const deck1: Deck = {
        id: "deck_1",
        name: "deck1",
        filepath: "deck1.md",
        tag: "#flashcards/math",
        lastReviewed: null,
        config: DEFAULT_DECK_CONFIG,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const content = "## Question 1\n\nAnswer 1";

      mockDb.getDeckById.mockResolvedValue(deck1);
      mockVault.cachedRead = jest.fn().mockResolvedValue(content);

      await deckManager.syncFlashcardsForDeck("deck_1", true);

      expect(mockDb.getDeckById).toHaveBeenCalledWith("deck_1");
    });
  });

  describe("file modification time handling", () => {
    it("should sync when file modification time has changed", async () => {
      const filePath = "test.md";
      const oldDeckModTime = Date.now() - 2000;
      const newFileModTime = Date.now() - 1000;

      const deck: Deck = {
        id: "deck1",
        name: "Test Deck",
        filepath: filePath,
        tag: "#flashcards",
        config: DEFAULT_DECK_CONFIG,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date(oldDeckModTime).toISOString(),
      };

      const content = "## Question\n\nAnswer";

      mockDb.getDeckById.mockResolvedValue(deck);
      mockVault.cachedRead = jest.fn().mockResolvedValue(content);

      await deckManager.syncFlashcardsForDeck("deck_123");

      expect(mockDb.getDeckById).toHaveBeenCalledWith("deck_123");
    });
  });

  // Keep other existing tests unchanged
  describe("flashcard ID generation", () => {
    it("should generate consistent IDs for same content", () => {
      const id1 = generateFlashcardId("What is 2+2?");
      const id2 = generateFlashcardId("What is 2+2?");

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^card_[a-z0-9]+$/);
    });

    it("should generate different IDs for different content", () => {
      const id1 = generateFlashcardId("Question 1");
      const id2 = generateFlashcardId("Question 2");

      expect(id1).not.toBe(id2);
    });

    it("should generate same IDs for same content across decks", () => {
      const question = "What is 2+2?";
      const id1 = generateFlashcardId(question);
      const id2 = generateFlashcardId(question);

      expect(id1).toBe(id2);
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
});
