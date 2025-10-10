import initSqlJs, { Database } from "sql.js";

// Global SQL.js instance for integration tests
let SQL: any = null;

export async function setupRealSqlJs(): Promise<void> {
  if (!SQL) {
    try {
      // Initialize SQL.js with WASM
      SQL = await initSqlJs({
        // For Node.js environment, we need to provide the WASM file path
        locateFile: (file: string) => {
          // In Node.js test environment, sql.js will handle WASM loading
          return `node_modules/sql.js/dist/${file}`;
        },
      });

      // Make it globally available for MainDatabaseService
      (global as any).initSqlJs = () => Promise.resolve(SQL);

      console.log("Real SQL.js initialized for integration tests");
    } catch (error) {
      console.error("Failed to initialize real SQL.js:", error);
      throw error;
    }
  }
}

export function createRealDatabase(buffer?: Uint8Array): Database {
  if (!SQL) {
    throw new Error("SQL.js not initialized. Call setupRealSqlJs() first.");
  }

  return new SQL.Database(buffer);
}

export function teardownRealSqlJs(): void {
  SQL = null;
  delete (global as any).initSqlJs;
}

// Jest setup functions
export const setupIntegrationTests = async (): Promise<void> => {
  await setupRealSqlJs();
};

export const teardownIntegrationTests = (): void => {
  teardownRealSqlJs();
};
