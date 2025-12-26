module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.spec.ts",
    "!**/__tests__/**/setup-*.ts",
    "!**/__tests__/**/test-db-utils.ts",
    "!**/__tests__/integration/**", // Exclude integration tests - run with npm run test:integration
  ],
  setupFilesAfterEnv: ["<rootDir>/src/test-setup.ts"],
  testTimeout: 10000, // Increased timeout for integration tests
  // Disable automatic mocking - use real implementations
  automock: false,
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
  maxWorkers: 1,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    // Mock Obsidian API for unit tests only
    "^obsidian$": "<rootDir>/src/__mocks__/obsidian.ts",
    // Mock Svelte runtime and components
    "^svelte$": "<rootDir>/src/__mocks__/svelte.ts",
    "\\.svelte$": "<rootDir>/src/__mocks__/svelte-component.ts",
    // Handle @ alias - DO NOT mock sql.js, use real implementation
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: ["node_modules/(?!(sql\\.js)/)"],
};
