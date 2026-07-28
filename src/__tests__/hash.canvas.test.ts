import {
  generateFlashcardId,
  generateReverseFlashcardId,
  generateClozeFlashcardId,
} from "@decks/core";

describe("hash ID generators with sourceNodeId", () => {
  describe("generateFlashcardId", () => {
    it("is byte-identical with and without sourceNodeId undefined (markdown regression guard)", () => {
      const a = generateFlashcardId("What is X?");
      const b = generateFlashcardId("What is X?", undefined);
      expect(a).toBe(b);
    });

    it("changes the hash when sourceNodeId is provided", () => {
      const md = generateFlashcardId("What is X?");
      const canvas = generateFlashcardId("What is X?", "node-1");
      expect(canvas).not.toBe(md);
    });

    it("produces distinct IDs for the same front in different nodes", () => {
      const a = generateFlashcardId("Same Q", "node-a");
      const b = generateFlashcardId("Same Q", "node-b");
      expect(a).not.toBe(b);
    });
  });

  describe("generateReverseFlashcardId", () => {
    it("is stable when sourceNodeId is omitted (markdown regression guard)", () => {
      const a = generateReverseFlashcardId("original front");
      const b = generateReverseFlashcardId("original front", undefined);
      expect(a).toBe(b);
    });

    it("distinct across nodes when sourceNodeId varies", () => {
      const a = generateReverseFlashcardId("front", "node-1");
      const b = generateReverseFlashcardId("front", "node-2");
      expect(a).not.toBe(b);
    });
  });

  describe("generateClozeFlashcardId", () => {
    it("is stable when sourceNodeId is omitted (markdown regression guard)", () => {
      const a = generateClozeFlashcardId("front", "cloze", 0);
      const b = generateClozeFlashcardId("front", "cloze", 0, undefined);
      expect(a).toBe(b);
    });

    it("distinct across nodes when sourceNodeId varies", () => {
      const a = generateClozeFlashcardId("front", "cloze", 0, "node-1");
      const b = generateClozeFlashcardId("front", "cloze", 0, "node-2");
      expect(a).not.toBe(b);
    });
  });
});
