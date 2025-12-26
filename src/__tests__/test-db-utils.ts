import initSqlJs from "sql.js";
import { MainDatabaseService } from "../database/MainDatabaseService";
import { InMemoryAdapter } from "./integration/database-test-utils";

let SQL: any = null;

/**
 * Create a test database instance with real SQL.js
 * This is shared between unit tests and integration tests
 */
export async function createTestDatabase(): Promise<MainDatabaseService> {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
    });
    (global as any).initSqlJs = async () => SQL;
  }

  const adapter = new InMemoryAdapter();
  const db = new MainDatabaseService("test.db", adapter, jest.fn());
  await db.initialize();
  return db;
}

/**
 * Clean up test database
 */
export async function cleanupTestDatabase(
  db: MainDatabaseService
): Promise<void> {
  await db.close();
}
