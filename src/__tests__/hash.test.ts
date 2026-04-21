import {
  generateFlashcardId,
  generateReverseFlashcardId,
  generateContentHash,
  generateDeckId,
} from "../utils/hash";

describe("hash utilities", () => {
  describe("generateReverseFlashcardId", () => {
    it("should return a string starting with rcard_", () => {
      expect(generateReverseFlashcardId("What is TypeScript?", "deck_1")).toMatch(
        /^rcard_/
      );
    });

    it("should differ from generateFlashcardId for the same input", () => {
      const text = "What is TypeScript?";
      const deckId = "deck_1";
      expect(generateReverseFlashcardId(text, deckId)).not.toBe(
        generateFlashcardId(text, deckId)
      );
    });

    it("should differ from generateFlashcardId even with reverse: prefix in input", () => {
      const prefixed = "reverse:What is TypeScript?";
      expect(generateReverseFlashcardId("What is TypeScript?", "deck_1")).not.toBe(
        generateFlashcardId(prefixed, "deck_1")
      );
    });

    it("should be deterministic", () => {
      const text = "What is TypeScript?";
      const deckId = "deck_1";
      expect(generateReverseFlashcardId(text, deckId)).toBe(
        generateReverseFlashcardId(text, deckId)
      );
    });

    it("should produce different IDs for different inputs", () => {
      expect(generateReverseFlashcardId("front A", "deck_1")).not.toBe(
        generateReverseFlashcardId("front B", "deck_1")
      );
    });

    it("should not collide with regular card IDs for any input", () => {
      const inputs = ["", "hello", "What is 2+2?", "reverse:test"];
      for (const input of inputs) {
        expect(generateReverseFlashcardId(input, "deck_1")).not.toBe(
          generateFlashcardId(input, "deck_1")
        );
        expect(generateReverseFlashcardId(input, "deck_1")).not.toBe(
          generateDeckId(input)
        );
      }
    });

    it("should handle empty string without throwing", () => {
      expect(() => generateReverseFlashcardId("", "deck_1")).not.toThrow();
      expect(generateReverseFlashcardId("", "deck_1")).toMatch(/^rcard_/);
    });

    it("should produce different IDs for same text in different decks", () => {
      expect(generateReverseFlashcardId("front A", "deck_1")).not.toBe(
        generateReverseFlashcardId("front A", "deck_2")
      );
    });
  });

  describe("generateFlashcardId", () => {
    it("should return a string starting with card_", () => {
      expect(generateFlashcardId("What is TypeScript?", "deck_1")).toMatch(/^card_/);
    });

    it("should be deterministic", () => {
      const text = "What is TypeScript?";
      const deckId = "deck_1";
      expect(generateFlashcardId(text, deckId)).toBe(generateFlashcardId(text, deckId));
    });

    it("should produce different IDs for same text in different decks", () => {
      const question = "What is 2+2?";
      expect(generateFlashcardId(question, "deck_1")).not.toBe(
        generateFlashcardId(question, "deck_2")
      );
    });
  });

  describe("generateContentHash", () => {
    it("should return different hashes for different content", () => {
      expect(generateContentHash("content A")).not.toBe(
        generateContentHash("content B")
      );
    });

    it("should be deterministic", () => {
      expect(generateContentHash("some back text")).toBe(
        generateContentHash("some back text")
      );
    });
  });
});
