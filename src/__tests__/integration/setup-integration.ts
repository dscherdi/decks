import { setupRealSqlJs } from "./setup-real-sql";

// Global setup for integration tests
beforeAll(async () => {
  // Initialize real SQL.js for all integration tests
  await setupRealSqlJs();

  // Add global error handler to catch unhandled rejections with stack traces
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    throw reason;
  });
});

// Clean up after all integration tests
afterAll(() => {
  // Cleanup is handled in database-test-utils teardownTestDatabase
});

// Extend Jest timeout for integration tests
jest.setTimeout(30000);
