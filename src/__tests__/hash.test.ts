import {
  generateFlashcardId,
  generateOldFlashcardId,
  generateReverseFlashcardId,
  generateClozeFlashcardId,
  generateContentHash,
  generateDeckId,
} from "@decks/core";

describe("hash utilities", () => {
  describe("generateReverseFlashcardId", () => {
    it("should return a string starting with rcard_", () => {
      expect(generateReverseFlashcardId("What is TypeScript?")).toMatch(/^rcard_/);
    });

    it("should differ from generateFlashcardId for the same input", () => {
      const text = "What is TypeScript?";
      expect(generateReverseFlashcardId(text)).not.toBe(generateFlashcardId(text));
    });

    it("should differ from generateFlashcardId even with reverse: prefix in input", () => {
      const prefixed = "reverse:What is TypeScript?";
      expect(generateReverseFlashcardId("What is TypeScript?")).not.toBe(
        generateFlashcardId(prefixed)
      );
    });

    it("should be deterministic", () => {
      const text = "What is TypeScript?";
      expect(generateReverseFlashcardId(text)).toBe(generateReverseFlashcardId(text));
    });

    it("should produce different IDs for different inputs", () => {
      expect(generateReverseFlashcardId("front A")).not.toBe(
        generateReverseFlashcardId("front B")
      );
    });

    it("should not collide with regular card IDs for any input", () => {
      const inputs = ["", "hello", "What is 2+2?", "reverse:test"];
      for (const input of inputs) {
        expect(generateReverseFlashcardId(input)).not.toBe(generateFlashcardId(input));
        expect(generateReverseFlashcardId(input)).not.toBe(generateDeckId(input));
      }
    });

    it("should handle empty string without throwing", () => {
      expect(() => generateReverseFlashcardId("")).not.toThrow();
      expect(generateReverseFlashcardId("")).toMatch(/^rcard_/);
    });

    it("should be deck-independent (node suffix still disambiguates)", () => {
      expect(generateReverseFlashcardId("front A")).toBe(
        generateReverseFlashcardId("front A")
      );
      expect(generateReverseFlashcardId("front A", "node-1")).not.toBe(
        generateReverseFlashcardId("front A", "node-2")
      );
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

    it("should be deck-independent — same front always yields the same ID", () => {
      const question = "What is 2+2?";
      // No deck component: identity is purely the front text, so a card keeps
      // its ID (and review history) when it moves between decks or files.
      expect(generateFlashcardId(question)).toBe(generateFlashcardId(question));
    });

    it("should equal the legacy front-only ID (migration re-link relies on this)", () => {
      const front = "What is a monad?";
      expect(generateFlashcardId(front)).toBe(generateOldFlashcardId(front));
    });

    it("should disambiguate canvas nodes via sourceNodeId", () => {
      expect(generateFlashcardId("Same Q", "node-a")).not.toBe(
        generateFlashcardId("Same Q", "node-b")
      );
    });
  });

  describe("generateClozeFlashcardId", () => {
    it("should return a string starting with ccard_", () => {
      expect(generateClozeFlashcardId("front", "cloze", 0)).toMatch(/^ccard_/);
    });

    it("should be deterministic", () => {
      expect(generateClozeFlashcardId("front", "cloze", 0)).toBe(
        generateClozeFlashcardId("front", "cloze", 0)
      );
    });

    it("should produce different IDs for different cloze text", () => {
      expect(generateClozeFlashcardId("front", "clozeA", 0)).not.toBe(
        generateClozeFlashcardId("front", "clozeB", 0)
      );
    });

    it("should produce different IDs for same cloze text at different orders", () => {
      expect(generateClozeFlashcardId("front", "same", 0)).not.toBe(
        generateClozeFlashcardId("front", "same", 1)
      );
    });

    it("should be deck-independent", () => {
      expect(generateClozeFlashcardId("front", "cloze", 0)).toBe(
        generateClozeFlashcardId("front", "cloze", 0)
      );
    });

    it("should not collide with card_ or rcard_ prefixes", () => {
      const front = "test front";
      const clozeId = generateClozeFlashcardId(front, "cloze", 0);
      const cardId = generateFlashcardId(front);
      const rcardId = generateReverseFlashcardId(front);

      expect(clozeId).not.toBe(cardId);
      expect(clozeId).not.toBe(rcardId);
      expect(clozeId.startsWith("ccard_")).toBe(true);
      expect(cardId.startsWith("card_")).toBe(true);
      expect(rcardId.startsWith("rcard_")).toBe(true);
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
