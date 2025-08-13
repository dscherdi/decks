module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
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
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    // Mock Obsidian API
    "^obsidian$": "<rootDir>/src/__mocks__/obsidian.ts",
    // Mock sql.js
    "^sql\\.js$": "<rootDir>/src/__mocks__/sql.js.ts",
  },
  transformIgnorePatterns: ["node_modules/(?!(sql\\.js)/)"],
};
