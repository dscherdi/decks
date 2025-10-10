import { BackupService } from "../services/BackupService";
import { IDatabaseService } from "../database/DatabaseFactory";

// Helper function to create a complete mock database
function createMockDatabase() {
  return {
    // Initialization methods
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),

    // Deck operations
    createDeck: jest.fn().mockResolvedValue("deck-id"),
    getDeckById: jest.fn().mockResolvedValue(null),
    getDeckByFilepath: jest.fn().mockResolvedValue(null),
    getDeckByTag: jest.fn().mockResolvedValue(null),
    getAllDecks: jest.fn().mockResolvedValue([]),
    updateDeck: jest.fn().mockResolvedValue(undefined),
    updateDeckTimestamp: jest.fn().mockResolvedValue(undefined),
    updateDeckLastReviewed: jest.fn().mockResolvedValue(undefined),
    updateDeckHeaderLevel: jest.fn().mockResolvedValue(undefined),
    renameDeck: jest.fn().mockResolvedValue(undefined),
    deleteDeck: jest.fn().mockResolvedValue(undefined),
    deleteDeckByFilepath: jest.fn().mockResolvedValue(undefined),

    // Flashcard operations
    createFlashcard: jest.fn().mockResolvedValue(undefined),
    getFlashcardById: jest.fn().mockResolvedValue(null),
    getFlashcardsByDeck: jest.fn().mockResolvedValue([]),
    getAllFlashcards: jest.fn().mockResolvedValue([]),
    getDueFlashcards: jest.fn().mockResolvedValue([]),
    getReviewableFlashcards: jest.fn().mockResolvedValue([]),
    getNewCardsForReview: jest.fn().mockResolvedValue([]),
    getReviewCardsForReview: jest.fn().mockResolvedValue([]),
    updateFlashcard: jest.fn().mockResolvedValue(undefined),
    updateFlashcardDeckIds: jest.fn().mockResolvedValue(undefined),
    deleteFlashcard: jest.fn().mockResolvedValue(undefined),
    deleteFlashcardsByFile: jest.fn().mockResolvedValue(undefined),

    // Batch operations
    batchCreateFlashcards: jest.fn().mockResolvedValue(undefined),
    batchUpdateFlashcards: jest.fn().mockResolvedValue(undefined),
    batchDeleteFlashcards: jest.fn().mockResolvedValue(undefined),

    // Review log operations
    createReviewLog: jest.fn().mockResolvedValue(undefined),
    insertReviewLog: jest.fn().mockResolvedValue(undefined),
    getLatestReviewLogForFlashcard: jest.fn().mockResolvedValue(null),
    getAllReviewLogs: jest.fn().mockResolvedValue([]),
    reviewLogExists: jest.fn().mockResolvedValue(false),

    // Review session operations
    createReviewSession: jest.fn().mockResolvedValue("session-id"),
    getReviewSessionById: jest.fn().mockResolvedValue(null),
    getActiveReviewSession: jest.fn().mockResolvedValue(null),
    getAllReviewSessions: jest.fn().mockResolvedValue([]),
    updateReviewSessionDoneUnique: jest.fn().mockResolvedValue(undefined),
    endReviewSession: jest.fn().mockResolvedValue(undefined),
    insertReviewSession: jest.fn().mockResolvedValue(undefined),
    reviewSessionExists: jest.fn().mockResolvedValue(false),
    isCardReviewedInSession: jest.fn().mockResolvedValue(false),

    // Statistics operations moved to StatisticsService
    getDailyReviewCounts: jest
      .fn()
      .mockResolvedValue({ newCount: 0, reviewCount: 0 }),
    getOverallStatistics: jest.fn().mockResolvedValue({
      totalCards: 0,
      newCards: 0,
      reviewCards: 0,
      matureCards: 0,
      dueToday: 0,
      dueTomorrow: 0,
      learningCards: 0,
      avgSuccessRate: 0,
      avgInterval: 0,
      totalReviews: 0,
      reviewsToday: 0,
      timeSpentToday: 0,
    }),

    // Count operations
    countNewCards: jest.fn().mockResolvedValue(0),
    countDueCards: jest.fn().mockResolvedValue(0),
    countTotalCards: jest.fn().mockResolvedValue(0),
    countNewCardsToday: jest.fn().mockResolvedValue(0),
    countReviewCardsToday: jest.fn().mockResolvedValue(0),

    // Forecast operations
    getScheduledDueByDay: jest.fn().mockResolvedValue([]),
    getScheduledDueByDayMulti: jest.fn().mockResolvedValue([]),
    getCurrentBacklog: jest.fn().mockResolvedValue(0),
    getCurrentBacklogMulti: jest.fn().mockResolvedValue(0),
    getDeckReviewCountRange: jest.fn().mockResolvedValue(0),

    // Optimized review log queries for statistics
    getReviewLogsByDeck: jest.fn().mockResolvedValue([]),
    getReviewLogsByDecks: jest.fn().mockResolvedValue([]),

    // Utility operations
    purgeDatabase: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),

    // Transaction methods removed - no longer using transactions

    // Backup operations
    createBackupDatabase: jest.fn().mockResolvedValue(undefined),
    restoreFromBackupDatabase: jest.fn().mockResolvedValue(undefined),
    exportDatabaseToBuffer: jest
      .fn()
      .mockResolvedValue(new Uint8Array([1, 2, 3])),
    createBackupDatabaseInstance: jest.fn().mockResolvedValue("mockBackupDb"),
    queryBackupDatabase: jest.fn().mockResolvedValue([]),
    closeBackupDatabaseInstance: jest.fn().mockResolvedValue(undefined),
  };
}

// Mock DataAdapter
const mockAdapter = {
  exists: jest.fn(),
  mkdir: jest.fn(),
  writeBinary: jest.fn(),
  readBinary: jest.fn(),
  list: jest.fn(),
  stat: jest.fn(),
  remove: jest.fn(),
};

// Mock Notice
jest.mock("obsidian", () => ({
  Notice: jest.fn(),
}));

// Mock yieldToUI
jest.mock("@/utils/ui", () => ({
  yieldToUI: jest.fn().mockResolvedValue(undefined),
}));

describe("BackupService", () => {
  let backupService: BackupService;
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = createMockDatabase();
    backupService = new BackupService(
      mockAdapter as any,
      "/vault/.obsidian",
      jest.fn(),
    );
  });

  describe("createBackup", () => {
    it("should create a SQLite backup successfully", async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });

      const result = await backupService.createBackup(mockDb);

      // Should create backup with today's date and .db extension
      const today = new Date().toISOString().slice(0, 10);
      const expectedFilename = `backup-${today}.db`;
      expect(result).toBe(expectedFilename);

      expect(mockDb.createBackupDatabase).toHaveBeenCalledWith(
        `/vault/.obsidian/plugins/decks/backups/${expectedFilename}`,
      );
    });

    it("should create backup directory if it doesn't exist", async () => {
      mockAdapter.exists.mockResolvedValue(false);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });

      await backupService.createBackup(mockDb);

      expect(mockAdapter.mkdir).toHaveBeenCalledWith(
        "/vault/.obsidian/plugins/decks/backups",
      );
    });

    it("should handle database backup errors", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      mockDb.createBackupDatabase.mockRejectedValue(
        new Error("Database backup failed"),
      );

      await expect(backupService.createBackup(mockDb)).rejects.toThrow(
        "Database backup failed",
      );

      consoleSpy.mockRestore();
    });
  });

  describe("getAvailableBackups", () => {
    it("should return empty array when backup directory doesn't exist", async () => {
      mockAdapter.exists.mockResolvedValue(false);

      const result = await backupService.getAvailableBackups();

      expect(result).toEqual([]);
    });

    it("should return list of available SQLite backups", async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.list.mockResolvedValue({
        files: [
          "backup-2023-01-01.db",
          "backup-2023-01-02.db",
          "other-file.txt",
        ],
        folders: [],
      });
      mockAdapter.stat.mockImplementation((path) => {
        if (path.includes("backup-2023-01-01.db")) {
          return Promise.resolve({ mtime: 1672531200000, size: 1024 });
        }
        if (path.includes("backup-2023-01-02.db")) {
          return Promise.resolve({ mtime: 1672617600000, size: 2048 });
        }
        return Promise.resolve(null);
      });

      const result = await backupService.getAvailableBackups();

      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe("backup-2023-01-02.db");
      expect(result[1].filename).toBe("backup-2023-01-01.db");
      expect(result[0].size).toBe(2048);
    });

    it("should filter only .db backup files", async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.list.mockResolvedValue({
        files: [
          "backup-2023-01-01.db",
          "backup-2023-01-02.json",
          "not-backup.db",
          "backup-2023-01-03.db",
        ],
        folders: [],
      });
      mockAdapter.stat.mockResolvedValue({ mtime: Date.now(), size: 1024 });

      const result = await backupService.getAvailableBackups();

      expect(result).toHaveLength(2);
      expect(result.map((b) => b.filename)).toEqual([
        "backup-2023-01-01.db",
        "backup-2023-01-03.db",
      ]);
    });
  });

  describe("restoreFromBackup", () => {
    it("should restore from SQLite backup successfully", async () => {
      const filename = "backup-2023-01-01.db";
      mockAdapter.exists.mockResolvedValue(true);
      const progressCallback = jest.fn();

      await backupService.restoreFromBackup(filename, mockDb, progressCallback);

      expect(mockDb.restoreFromBackupDatabase).toHaveBeenCalledWith(
        `/vault/.obsidian/plugins/decks/backups/${filename}`,
      );
      expect(progressCallback).toHaveBeenCalledWith(0, 100);
      expect(progressCallback).toHaveBeenCalledWith(100, 100);
    });

    it("should restore without progress callback", async () => {
      const filename = "backup-2023-01-01.db";
      mockAdapter.exists.mockResolvedValue(true);

      await backupService.restoreFromBackup(filename, mockDb);

      expect(mockDb.restoreFromBackupDatabase).toHaveBeenCalledWith(
        `/vault/.obsidian/plugins/decks/backups/${filename}`,
      );
    });

    it("should throw error if backup file does not exist", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      mockAdapter.exists.mockResolvedValue(false);

      await expect(
        backupService.restoreFromBackup("nonexistent.db", mockDb),
      ).rejects.toThrow("Backup file not found: nonexistent.db");

      consoleSpy.mockRestore();
    });

    it("should handle database restore errors", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      const filename = "backup-2023-01-01.db";
      mockAdapter.exists.mockResolvedValue(true);
      mockDb.restoreFromBackupDatabase.mockRejectedValue(
        new Error("Database restore failed"),
      );

      await expect(
        backupService.restoreFromBackup(filename, mockDb),
      ).rejects.toThrow("Database restore failed");

      consoleSpy.mockRestore();
    });
  });

  describe("backup management", () => {
    it("should clean up old backups when max exceeded", async () => {
      backupService.setMaxBackups(3);
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.list.mockResolvedValue({
        files: [
          "backup-2023-01-01.db",
          "backup-2023-01-02.db",
          "backup-2023-01-03.db",
          "backup-2023-01-04.db",
          "backup-2023-01-05.db",
        ],
        folders: [],
      });

      mockAdapter.stat.mockImplementation((path) => {
        const filename = path.split("/").pop();
        const dateMatch = filename?.match(/backup-(\d{4}-\d{2}-\d{2})\.db/);
        if (dateMatch) {
          const date = new Date(dateMatch[1]);
          return Promise.resolve({ mtime: date.getTime(), size: 1024 });
        }
        return Promise.resolve({ mtime: Date.now(), size: 1024 });
      });

      await backupService.createBackup(mockDb);

      // Should remove 2 oldest backups (keep newest 3)
      expect(mockAdapter.remove).toHaveBeenCalledTimes(2);
      expect(mockAdapter.remove).toHaveBeenCalledWith(
        "/vault/.obsidian/plugins/decks/backups/backup-2023-01-01.db",
      );
      expect(mockAdapter.remove).toHaveBeenCalledWith(
        "/vault/.obsidian/plugins/decks/backups/backup-2023-01-02.db",
      );
    });

    it("should overwrite backup from same day", async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });

      // Create first backup
      await backupService.createBackup(mockDb);

      // Create second backup on same day (should overwrite)
      await backupService.createBackup(mockDb);

      // Should have been called twice with same filename (overwrite)
      expect(mockDb.createBackupDatabase).toHaveBeenCalledTimes(2);
      const today = new Date().toISOString().slice(0, 10);
      const expectedPath = `/vault/.obsidian/plugins/decks/backups/backup-${today}.db`;
      expect(mockDb.createBackupDatabase).toHaveBeenNthCalledWith(
        1,
        expectedPath,
      );
      expect(mockDb.createBackupDatabase).toHaveBeenNthCalledWith(
        2,
        expectedPath,
      );
    });
  });

  describe("formatFileSize", () => {
    it("should format file sizes correctly", () => {
      expect(backupService.formatFileSize(0)).toBe("0 B");
      expect(backupService.formatFileSize(500)).toBe("500 B");
      expect(backupService.formatFileSize(1024)).toBe("1 KB");
      expect(backupService.formatFileSize(1536)).toBe("1.5 KB");
      expect(backupService.formatFileSize(1048576)).toBe("1 MB");
      expect(backupService.formatFileSize(1073741824)).toBe("1 GB");
    });
  });
});
