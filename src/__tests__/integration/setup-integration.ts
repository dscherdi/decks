import { setupRealSqlJs } from "./setup-real-sql";

// Global setup for integration tests
beforeAll(async () => {
  // Initialize real SQL.js for all integration tests
  await setupRealSqlJs();
});

// Clean up after all integration tests
afterAll(() => {
  // Cleanup is handled in database-test-utils teardownTestDatabase
});

// Extend Jest timeout for integration tests
jest.setTimeout(30000);
