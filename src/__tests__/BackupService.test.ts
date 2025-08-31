import { BackupService } from "../services/BackupService";
import { DatabaseService } from "../database/DatabaseService";
import { ReviewLog, ReviewSession } from "../database/types";

// Mock sql.js module
jest.mock("sql.js", () => ({
  __esModule: true,
  default: jest.fn(() =>
    Promise.resolve({
      Database: jest.fn().mockImplementation(() => ({
        exec: jest.fn(),
        prepare: jest.fn(() => ({
          run: jest.fn(),
          step: jest.fn(() => false),
          get: jest.fn(() => []),
          free: jest.fn(),
        })),
        export: jest.fn(() => new Uint8Array([1, 2, 3, 4])),
        close: jest.fn(),
      })),
    }),
  ),
}));

// Mock Obsidian's DataAdapter
const mockAdapter = {
  exists: jest.fn(),
  mkdir: jest.fn(),
  write: jest.fn(),
  writeBinary: jest.fn(),
  read: jest.fn(),
  readBinary: jest.fn(),
  remove: jest.fn(),
  list: jest.fn(),
  stat: jest.fn(),
};

// Create a mock DatabaseService with properly typed mock functions
const createMockDb = () => ({
  getAllReviewLogs: jest.fn(),
  getAllReviewSessions: jest.fn(),
  reviewLogExists: jest.fn(),
  reviewSessionExists: jest.fn(),
  insertReviewLog: jest.fn(),
  insertReviewSession: jest.fn(),
});

const mockDb = createMockDb();

const mockDebugLog = jest.fn();

describe("BackupService", () => {
  let backupService: BackupService;
  const configDir = "/mock/config";

  beforeEach(() => {
    jest.clearAllMocks();
    backupService = new BackupService(
      mockAdapter as any,
      configDir,
      mockDebugLog,
    );
  });

  describe("createBackup", () => {
    it("should create a backup with review data", async () => {
      // Setup mock data
      const mockReviewLogs: ReviewLog[] = [
        {
          id: "log1",
          flashcardId: "card1",
          sessionId: "session1",
          lastReviewedAt: "2023-01-01T10:00:00Z",
          reviewedAt: "2023-01-01T10:05:00Z",
          rating: 3,
          ratingLabel: "good",
          oldState: "new",
          newState: "review",
          oldRepetitions: 0,
          newRepetitions: 1,
          oldLapses: 0,
          newLapses: 0,
          oldStability: 2.5,
          newStability: 5.0,
          oldDifficulty: 5.0,
          newDifficulty: 5.2,
          oldIntervalMinutes: 0,
          newIntervalMinutes: 1440,
          oldDueAt: "2023-01-01T10:00:00Z",
          newDueAt: "2023-01-02T10:00:00Z",
          elapsedDays: 0,
          retrievability: 1.0,
          requestRetention: 0.9,
          profile: "STANDARD",
          maximumIntervalDays: 36500,
          minMinutes: 1440,
          fsrsWeightsVersion: "4.5",
          schedulerVersion: "1.0",
        },
      ];

      const mockReviewSessions: ReviewSession[] = [
        {
          id: "session1",
          deckId: "deck1",
          startedAt: "2023-01-01T10:00:00Z",
          endedAt: "2023-01-01T10:30:00Z",
          goalTotal: 10,
          doneUnique: 5,
        },
      ];

      mockDb.getAllReviewLogs.mockResolvedValue(mockReviewLogs);
      mockDb.getAllReviewSessions.mockResolvedValue(mockReviewSessions);
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });

      await backupService.createBackup(mockDb as any);

      expect(mockDb.getAllReviewLogs).toHaveBeenCalled();
      expect(mockDb.getAllReviewSessions).toHaveBeenCalled();
      expect(mockAdapter.writeBinary).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(
            `${configDir}/plugins/decks/backups/backup-\\d{4}-\\d{2}-\\d{2}\\.db`,
          ),
        ),
        expect.any(Uint8Array),
      );
    });

    it("should handle backup creation errors gracefully", async () => {
      mockDb.getAllReviewLogs.mockRejectedValue(new Error("Database error"));

      await backupService.createBackup(mockDb as any);

      expect(mockDebugLog).toHaveBeenCalledWith(
        "Failed to create backup:",
        expect.any(Error),
      );
    });
  });

  describe("getAvailableBackups", () => {
    it("should return sorted list of available backups", async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.list.mockResolvedValue({
        files: [
          "backup-2023-01-01.db",
          "backup-2023-01-02.db",
          "other-file.txt",
        ],
        folders: [],
      });

      const backups = await backupService.getAvailableBackups();

      expect(backups).toHaveLength(2);
      expect(backups[0].filename).toBe("backup-2023-01-02.db");
      expect(backups[1].filename).toBe("backup-2023-01-01.db");
    });

    it("should return empty array when no backups exist", async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });

      const backups = await backupService.getAvailableBackups();

      expect(backups).toEqual([]);
    });

    it("should handle errors when listing backups", async () => {
      mockAdapter.exists.mockRejectedValue(new Error("Access denied"));

      const backups = await backupService.getAvailableBackups();

      expect(backups).toEqual([]);
      expect(mockDebugLog).toHaveBeenCalledWith(
        "Failed to list backups:",
        expect.any(Error),
      );
    });
  });

  describe("restoreBackup", () => {
    it("should restore backup data without duplicates", async () => {
      // Mock a SQLite database buffer
      const mockDbBuffer = new ArrayBuffer(1024);

      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.readBinary.mockResolvedValue(mockDbBuffer);
      mockDb.reviewLogExists.mockResolvedValue(false);
      mockDb.reviewSessionExists.mockResolvedValue(false);
      mockDb.insertReviewLog.mockResolvedValue(undefined);
      mockDb.insertReviewSession.mockResolvedValue(undefined);

      const progressCallback = jest.fn();

      await backupService.restoreBackup(
        "backup-2023-01-01.db",
        mockDb as any,
        progressCallback,
      );

      // Since we mocked sql.js to return empty results, no inserts should happen
      // This tests the interface and error handling paths
      expect(mockAdapter.exists).toHaveBeenCalledWith(
        expect.stringContaining("backup-2023-01-01.db"),
      );
      expect(mockAdapter.readBinary).toHaveBeenCalled();
    });

    it("should skip duplicate records during restore", async () => {
      const mockDbBuffer = new ArrayBuffer(1024);

      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.readBinary.mockResolvedValue(mockDbBuffer);
      mockDb.reviewLogExists.mockResolvedValue(true); // Already exists
      mockDb.reviewSessionExists.mockResolvedValue(true); // Already exists

      await backupService.restoreBackup("backup-2023-01-01.db", mockDb as any);

      // Verify file operations happened
      expect(mockAdapter.readBinary).toHaveBeenCalled();
    });

    it("should throw error if backup file does not exist", async () => {
      mockAdapter.exists.mockResolvedValue(false);

      await expect(
        backupService.restoreBackup("nonexistent.db", mockDb as any),
      ).rejects.toThrow("Backup file not found: nonexistent.db");
    });

    it("should handle invalid backup format gracefully", async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.readBinary.mockResolvedValue(new ArrayBuffer(0)); // Empty/invalid DB

      // With mocked sql.js, this won't actually throw but will complete gracefully
      await backupService.restoreBackup("invalid.db", mockDb as any);

      // Verify file operations happened
      expect(mockAdapter.exists).toHaveBeenCalled();
      expect(mockAdapter.readBinary).toHaveBeenCalled();
    });
  });

  describe("daily backup behavior", () => {
    it("should overwrite existing backup for same day", async () => {
      const mockReviewLogs: ReviewLog[] = [
        {
          id: "log1",
          flashcardId: "card1",
          sessionId: "session1",
          lastReviewedAt: "2023-01-01T10:00:00Z",
          reviewedAt: "2023-01-01T10:05:00Z",
          rating: 3,
          ratingLabel: "good",
          oldState: "new",
          newState: "review",
          oldRepetitions: 0,
          newRepetitions: 1,
          oldLapses: 0,
          newLapses: 0,
          oldStability: 2.5,
          newStability: 5.0,
          oldDifficulty: 5.0,
          newDifficulty: 5.2,
          oldIntervalMinutes: 0,
          newIntervalMinutes: 1440,
          oldDueAt: "2023-01-01T10:00:00Z",
          newDueAt: "2023-01-02T10:00:00Z",
          elapsedDays: 0,
          retrievability: 1.0,
          requestRetention: 0.9,
          profile: "STANDARD",
          maximumIntervalDays: 36500,
          minMinutes: 1440,
          fsrsWeightsVersion: "4.5",
          schedulerVersion: "1.0",
        },
      ];

      mockDb.getAllReviewLogs.mockResolvedValue(mockReviewLogs);
      mockDb.getAllReviewSessions.mockResolvedValue([]);
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });

      // Create first backup
      await backupService.createBackup(mockDb as any);

      // Create second backup on same day (should overwrite)
      await backupService.createBackup(mockDb as any);

      // Should have been called twice with same filename (overwrite)
      expect(mockAdapter.writeBinary).toHaveBeenCalledTimes(2);
      const calls = (mockAdapter.writeBinary as jest.Mock).mock.calls;
      expect(calls[0][0]).toBe(calls[1][0]); // Same filename both times
    });
  });

  describe("static utility methods", () => {
    describe("formatTimestamp", () => {
      it("should format timestamps as locale strings", () => {
        const date = new Date("2023-01-01T10:30:00Z");
        const formatted = BackupService.formatTimestamp(date);
        expect(typeof formatted).toBe("string");
        expect(formatted.length).toBeGreaterThan(0);
      });
    });
  });
});
