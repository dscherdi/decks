import { describe, test, expect } from "@jest/globals";
import { isCardMature, getCardMaturityType } from "../database/types";
import type { Flashcard } from "../database/types";

describe("Mature Cards (TODO 19)", () => {
  // Helper to create a test flashcard
  const createTestCard = (
    state: "new" | "review",
    interval: number
  ): Flashcard => ({
    id: "test-card",
    deckId: "test-deck",
    front: "Test Front",
    back: "Test Back",
    type: "header-paragraph",
    sourceFile: "test.md",
    contentHash: "hash123",

    state,
    dueDate: new Date().toISOString(),
    interval, // in minutes
    repetitions: 1,
    difficulty: 5.0,
    stability: 2.5,
    lapses: 0,
    lastReviewed: new Date().toISOString(),
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  });

  describe("isCardMature", () => {
    test("should return false for new cards regardless of interval", () => {
      const newCard = createTestCard("new", 50000); // > 21 days but new state
      expect(isCardMature(newCard)).toBe(false);
    });

    test("should return false for review cards with interval <= 21 days", () => {
      // Test various intervals under the 21-day threshold
      const intervals = [
        1, // 1 minute
        60, // 1 hour
        1440, // 1 day
        10080, // 1 week (7 days)
        20160, // 2 weeks (14 days)
        30240, // exactly 21 days
      ];

      intervals.forEach((interval) => {
        const card = createTestCard("review", interval);
        expect(isCardMature(card)).toBe(false);
      });
    });

    test("should return true for review cards with interval > 21 days", () => {
      // Test various intervals over the 21-day threshold
      const intervals = [
        30241, // 21 days + 1 minute
        43200, // 30 days
        86400, // 60 days
        525600, // 1 year
      ];

      intervals.forEach((interval) => {
        const card = createTestCard("review", interval);
        expect(isCardMature(card)).toBe(true);
      });
    });

    test("should handle edge case: exactly 21 days (30,240 minutes)", () => {
      const card = createTestCard("review", 30240);
      expect(isCardMature(card)).toBe(false); // exactly 21 days is NOT mature
    });

    test("should handle edge case: 21 days + 1 minute (30,241 minutes)", () => {
      const card = createTestCard("review", 30241);
      expect(isCardMature(card)).toBe(true); // over 21 days IS mature
    });
  });

  describe("getCardMaturityType", () => {
    test("should return 'new' for new cards", () => {
      const newCard = createTestCard("new", 50000);
      expect(getCardMaturityType(newCard)).toBe("new");
    });

    test("should return 'review' for review cards with interval <= 21 days", () => {
      const reviewCard = createTestCard("review", 20000); // < 21 days
      expect(getCardMaturityType(reviewCard)).toBe("review");
    });

    test("should return 'mature' for review cards with interval > 21 days", () => {
      const matureCard = createTestCard("review", 40000); // > 21 days
      expect(getCardMaturityType(matureCard)).toBe("mature");
    });

    test("should handle boundary cases correctly", () => {
      // Exactly 21 days should be "review", not "mature"
      const exactly21Days = createTestCard("review", 30240);
      expect(getCardMaturityType(exactly21Days)).toBe("review");

      // Over 21 days should be "mature"
      const over21Days = createTestCard("review", 30241);
      expect(getCardMaturityType(over21Days)).toBe("mature");
    });
  });

  describe("Mature card definition consistency", () => {
    test("should match SQL query logic (interval > 30240)", () => {
      // This test ensures our TypeScript logic matches the SQL query in schemas.ts
      // SQL: f.interval > 30240 THEN 'mature'

      const notMature = createTestCard("review", 30240);
      const mature = createTestCard("review", 30241);

      expect(isCardMature(notMature)).toBe(false);
      expect(isCardMature(mature)).toBe(true);

      expect(getCardMaturityType(notMature)).toBe("review");
      expect(getCardMaturityType(mature)).toBe("mature");
    });

    test("should use correct threshold value (21 days = 30,240 minutes)", () => {
      const EXPECTED_THRESHOLD = 21 * 24 * 60; // 21 days in minutes
      expect(EXPECTED_THRESHOLD).toBe(30240);

      // Test that our threshold matches this calculation
      const justUnder = createTestCard("review", EXPECTED_THRESHOLD);
      const justOver = createTestCard("review", EXPECTED_THRESHOLD + 1);

      expect(isCardMature(justUnder)).toBe(false);
      expect(isCardMature(justOver)).toBe(true);
    });
  });

  describe("Real-world interval examples", () => {
    test("should classify typical FSRS intervals correctly", () => {
      const testCases = [
        { interval: 1, expected: "review", description: "1 minute (Again)" },
        { interval: 5, expected: "review", description: "5 minutes (Hard)" },
        { interval: 10, expected: "review", description: "10 minutes (Good)" },
        { interval: 40, expected: "review", description: "40 minutes (Easy)" },
        { interval: 1440, expected: "review", description: "1 day" },
        { interval: 2880, expected: "review", description: "2 days" },
        { interval: 4320, expected: "review", description: "3 days" },
        { interval: 10080, expected: "review", description: "1 week" },
        { interval: 20160, expected: "review", description: "2 weeks" },
        {
          interval: 30240,
          expected: "review",
          description: "21 days (boundary)",
        },
        { interval: 31680, expected: "mature", description: "22 days" },
        { interval: 43200, expected: "mature", description: "30 days" },
        { interval: 129600, expected: "mature", description: "90 days" },
        { interval: 259200, expected: "mature", description: "180 days" },
        { interval: 525600, expected: "mature", description: "1 year" },
      ];

      testCases.forEach(({ interval, expected, description }) => {
        const card = createTestCard("review", interval);
        expect(getCardMaturityType(card)).toBe(expected);
      });
    });
  });
});
