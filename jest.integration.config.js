module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/integration/**/*.ts"],
  setupFilesAfterEnv: ["<rootDir>/src/test-setup.ts"],
  testTimeout: 30000, // Longer timeout for integration tests
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
  moduleFileExtensions: ["ts", "js", "json"],
  extensionsToTreatAsEsm: [".ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
    "!src/components/**", // Exclude Svelte components from coverage
  ],
  coverageDirectory: "coverage-integration",
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    // Mock Obsidian API but allow real database operations
    "^obsidian$": "<rootDir>/src/__mocks__/obsidian.ts",
    // Handle @ alias - no sql.js mock for integration tests
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: ["node_modules/(?!(sql\\.js)/)"],
  // Set up global test configuration for integration tests
  setupFilesAfterEnv: [
    "<rootDir>/src/test-setup.ts",
    "<rootDir>/src/__tests__/integration/setup-integration.ts",
  ],
  maxWorkers: 1, // Run integration tests serially to avoid database conflicts
  // Disable cache for integration tests to ensure fresh database state
  cache: false,
  // Clear mocks between tests to prevent state pollution
  clearMocks: true,
  restoreMocks: true,
};
