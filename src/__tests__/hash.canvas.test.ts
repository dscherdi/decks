import {
  generateFlashcardId,
  generateReverseFlashcardId,
  generateClozeFlashcardId,
} from "@decks/core";

describe("hash ID generators with sourceNodeId", () => {
  describe("generateFlashcardId", () => {
    it("is byte-identical with and without sourceNodeId undefined (markdown regression guard)", () => {
      const a = generateFlashcardId("What is X?", "deck_abc");
      const b = generateFlashcardId("What is X?", "deck_abc", undefined);
      expect(a).toBe(b);
    });

    it("changes the hash when sourceNodeId is provided", () => {
      const md = generateFlashcardId("What is X?", "deck_abc");
      const canvas = generateFlashcardId("What is X?", "deck_abc", "node-1");
      expect(canvas).not.toBe(md);
    });

    it("produces distinct IDs for the same front in different nodes", () => {
      const a = generateFlashcardId("Same Q", "deck_x", "node-a");
      const b = generateFlashcardId("Same Q", "deck_x", "node-b");
      expect(a).not.toBe(b);
    });
  });

  describe("generateReverseFlashcardId", () => {
    it("is stable when sourceNodeId is omitted (markdown regression guard)", () => {
      const a = generateReverseFlashcardId("original front", "deck_y");
      const b = generateReverseFlashcardId(
        "original front",
        "deck_y",
        undefined,
      );
      expect(a).toBe(b);
    });

    it("distinct across nodes when sourceNodeId varies", () => {
      const a = generateReverseFlashcardId("front", "deck_y", "node-1");
      const b = generateReverseFlashcardId("front", "deck_y", "node-2");
      expect(a).not.toBe(b);
    });
  });

  describe("generateClozeFlashcardId", () => {
    it("is stable when sourceNodeId is omitted (markdown regression guard)", () => {
      const a = generateClozeFlashcardId("front", "cloze", 0, "deck_z");
      const b = generateClozeFlashcardId(
        "front",
        "cloze",
        0,
        "deck_z",
        undefined,
      );
      expect(a).toBe(b);
    });

    it("distinct across nodes when sourceNodeId varies", () => {
      const a = generateClozeFlashcardId(
        "front",
        "cloze",
        0,
        "deck_z",
        "node-1",
      );
      const b = generateClozeFlashcardId(
        "front",
        "cloze",
        0,
        "deck_z",
        "node-2",
      );
      expect(a).not.toBe(b);
    });
  });
});
