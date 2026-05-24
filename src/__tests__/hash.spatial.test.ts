import {
  generateSpatialFlashcardId,
  generateSpatialClozeFlashcardId,
} from "../utils/hash";

describe("hash spatial ID generators", () => {
  describe("generateSpatialFlashcardId", () => {
    it("is deterministic for the same (deckId, edgeId)", () => {
      const a = generateSpatialFlashcardId("deck_1", "edge_xyz");
      const b = generateSpatialFlashcardId("deck_1", "edge_xyz");
      expect(a).toBe(b);
    });

    it("uses the scard_ prefix", () => {
      expect(generateSpatialFlashcardId("d", "e")).toMatch(/^scard_/);
    });

    it("differs across decks when edgeId is the same", () => {
      const a = generateSpatialFlashcardId("deck_a", "edge");
      const b = generateSpatialFlashcardId("deck_b", "edge");
      expect(a).not.toBe(b);
    });

    it("differs across edges when deckId is the same", () => {
      const a = generateSpatialFlashcardId("deck", "edge_1");
      const b = generateSpatialFlashcardId("deck", "edge_2");
      expect(a).not.toBe(b);
    });
  });

  describe("generateSpatialClozeFlashcardId", () => {
    it("is deterministic for the same inputs", () => {
      const a = generateSpatialClozeFlashcardId("d", "e", "Paris", 0);
      const b = generateSpatialClozeFlashcardId("d", "e", "Paris", 0);
      expect(a).toBe(b);
    });

    it("uses the sccard_ prefix", () => {
      expect(generateSpatialClozeFlashcardId("d", "e", "x", 0)).toMatch(
        /^sccard_/,
      );
    });

    it("differs across cloze order", () => {
      const a = generateSpatialClozeFlashcardId("d", "e", "Paris", 0);
      const b = generateSpatialClozeFlashcardId("d", "e", "Paris", 1);
      expect(a).not.toBe(b);
    });

    it("differs across cloze text", () => {
      const a = generateSpatialClozeFlashcardId("d", "e", "Paris", 0);
      const b = generateSpatialClozeFlashcardId("d", "e", "Madrid", 0);
      expect(a).not.toBe(b);
    });

    it("differs from the non-cloze spatial id even at order 0", () => {
      const cloze = generateSpatialClozeFlashcardId("d", "e", "Paris", 0);
      const plain = generateSpatialFlashcardId("d", "e");
      expect(cloze).not.toBe(plain);
    });
  });
});
