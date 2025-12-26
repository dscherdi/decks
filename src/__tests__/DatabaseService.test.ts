import { MainDatabaseService } from "../database/MainDatabaseService";

// Mock adapter
const mockAdapter = {
  exists: jest.fn().mockResolvedValue(false),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readBinary: jest.fn().mockResolvedValue(null),
  writeBinary: jest.fn().mockResolvedValue(undefined),
} as any;

describe("DatabaseService Error Handling", () => {
  const debugLog = jest.fn();

  it("should throw error when database not initialized", async () => {
    const uninitializedService = new MainDatabaseService(
      "test.db",
      mockAdapter,
      debugLog
    );

    // Don't initialize the database - leave it uninitialized
    await expect(uninitializedService.executeSql("SELECT 1")).rejects.toThrow(
      "Database not initialized"
    );
    await expect(uninitializedService.querySql("SELECT 1")).rejects.toThrow(
      "Database not initialized"
    );
  });
});
