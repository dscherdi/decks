import {
  generateFlashcardId,
  generateReverseFlashcardId,
  generateContentHash,
  generateDeckId,
} from "../utils/hash";

describe("hash utilities", () => {
  describe("generateReverseFlashcardId", () => {
    it("should return a string starting with rcard_", () => {
      expect(generateReverseFlashcardId("What is TypeScript?")).toMatch(
        /^rcard_/
      );
    });

    it("should differ from generateFlashcardId for the same input", () => {
      const text = "What is TypeScript?";
      expect(generateReverseFlashcardId(text)).not.toBe(
        generateFlashcardId(text)
      );
    });

    it("should differ from generateFlashcardId even with reverse: prefix in input", () => {
      const prefixed = "reverse:What is TypeScript?";
      expect(generateReverseFlashcardId("What is TypeScript?")).not.toBe(
        generateFlashcardId(prefixed)
      );
    });

    it("should be deterministic", () => {
      const text = "What is TypeScript?";
      expect(generateReverseFlashcardId(text)).toBe(
        generateReverseFlashcardId(text)
      );
    });

    it("should produce different IDs for different inputs", () => {
      expect(generateReverseFlashcardId("front A")).not.toBe(
        generateReverseFlashcardId("front B")
      );
    });

    it("should not collide with regular card IDs for any input", () => {
      const inputs = ["", "hello", "What is 2+2?", "reverse:test"];
      for (const input of inputs) {
        expect(generateReverseFlashcardId(input)).not.toBe(
          generateFlashcardId(input)
        );
        expect(generateReverseFlashcardId(input)).not.toBe(
          generateDeckId(input)
        );
      }
    });

    it("should handle empty string without throwing", () => {
      expect(() => generateReverseFlashcardId("")).not.toThrow();
      expect(generateReverseFlashcardId("")).toMatch(/^rcard_/);
    });
  });

  describe("generateFlashcardId", () => {
    it("should return a string starting with card_", () => {
      expect(generateFlashcardId("What is TypeScript?")).toMatch(/^card_/);
    });

    it("should be deterministic", () => {
      const text = "What is TypeScript?";
      expect(generateFlashcardId(text)).toBe(generateFlashcardId(text));
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
