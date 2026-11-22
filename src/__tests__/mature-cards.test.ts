import { describe, test, expect } from "@jest/globals";
import { isCardMature, getCardMaturityType } from "../database/types";
import type { Flashcard } from "../database/types";

describe("Mature cards", () => {
  // Interval follows stability at the default retention; the tests below pull them apart on purpose.
  const createTestCard = (
    state: "new" | "review",
    stability: number,
    interval = stability * 1440
  ): Flashcard => ({
    id: "test-card",
    deckId: "test-deck",
    front: "Test Front",
    back: "Test Back",
    type: "header-paragraph",
    sourceFile: "test.md",
    contentHash: "hash123",
    breadcrumb: "",
    notes: "",
    clozeText: null,
    clozeOrder: null,
    state,
    dueDate: new Date().toISOString(),
    interval,
    repetitions: 1,
    difficulty: 5.0,
    stability,
    lapses: 0,
    lastReviewed: new Date().toISOString(),
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  });

  describe("isCardMature", () => {
    test("new cards are never mature", () => {
      expect(isCardMature(createTestCard("new", 50))).toBe(false);
    });

    test("review cards under 21 days of stability are not mature", () => {
      for (const stability of [0.01, 0.5, 1, 7, 14, 20.99]) {
        expect(isCardMature(createTestCard("review", stability))).toBe(false);
      }
    });

    test("review cards from 21 days of stability are mature", () => {
      for (const stability of [21, 30, 60, 365]) {
        expect(isCardMature(createTestCard("review", stability))).toBe(true);
      }
    });

    test("stability decides, not the interval", () => {
      // A higher retention target shortens the interval without weakening the memory.
      expect(isCardMature(createTestCard("review", 30, 10 * 1440))).toBe(true);
      expect(isCardMature(createTestCard("review", 10, 40 * 1440))).toBe(false);
    });
  });

  describe("getCardMaturityType", () => {
    test("classifies new, review and mature cards", () => {
      expect(getCardMaturityType(createTestCard("new", 50))).toBe("new");
      expect(getCardMaturityType(createTestCard("review", 14))).toBe("review");
      expect(getCardMaturityType(createTestCard("review", 21))).toBe("mature");
    });

    test("classifies typical stabilities", () => {
      const cases: Array<[number, string]> = [
        [0.003, "review"],
        [1, "review"],
        [7, "review"],
        [20.9, "review"],
        [21, "mature"],
        [90, "mature"],
        [180, "mature"],
        [365, "mature"],
      ];
      for (const [stability, expected] of cases) {
        expect(getCardMaturityType(createTestCard("review", stability))).toBe(expected);
      }
    });
  });
});
