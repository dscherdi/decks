import initSqlJs, { Database } from "sql.js";

// Global SQL.js instance for integration tests
let SQL: any = null;

/**
 * Where sql.js should look for its wasm. The default is relative to the
 * process's working directory, which only resolves when the run starts in this
 * package — another host running these suites sets an absolute one first.
 */
let wasmDir = "node_modules/sql.js/dist/";

export function setSqlWasmDir(dir: string): void {
  wasmDir = dir.endsWith("/") ? dir : `${dir}/`;
}

/**
 * Initialise sql.js and publish it as the global the database services reach
 * for. Eager, not lazy: `createRealDatabase` reads the same instance directly,
 * and a host whose database never calls the global would otherwise leave it
 * unset and fail there instead.
 */
export async function setupRealSqlJs(): Promise<void> {
  try {
    if (!SQL) {
      SQL = await initSqlJs({ locateFile: (file: string) => `${wasmDir}${file}` });
    }
    (global as any).initSqlJs = async () => SQL;
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
