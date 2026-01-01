import initSqlJs, { Database } from "sql.js";

// Global SQL.js instance for integration tests
let SQL: any = null;

export async function setupRealSqlJs(): Promise<void> {
  try {
    // Make initSqlJs available globally for MainDatabaseService
    // MainDatabaseService expects a function that returns the SQL module when called
    (global as any).initSqlJs = async (config?: any) => {
      if (!SQL) {
        // Initialize SQL.js with WASM
        // Override locateFile to use local node_modules instead of web URLs
        SQL = await initSqlJs({
          ...config,
          // For Node.js environment, we need to provide the WASM file path
          // This MUST come after ...config to override MainDatabaseService's web URL
          locateFile: (file: string) => {
            // In Node.js test environment, sql.js will handle WASM loading from node_modules
            return `node_modules/sql.js/dist/${file}`;
          },
        });
      }
      return SQL;
    };

    console.debug("Real SQL.js initialized for integration tests");
  } catch (error) {
    console.error("Failed to initialize real SQL.js:", error);
    throw error;
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
