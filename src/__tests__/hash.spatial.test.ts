import {
  generateSpatialFlashcardId,
  generateSpatialClozeFlashcardId,
} from "@decks/core";

describe("hash spatial ID generators", () => {
  describe("generateSpatialFlashcardId", () => {
    it("is deterministic for the same (front, edgeId)", () => {
      const a = generateSpatialFlashcardId("front", "edge_xyz");
      const b = generateSpatialFlashcardId("front", "edge_xyz");
      expect(a).toBe(b);
    });

    it("uses the scard_ prefix", () => {
      expect(generateSpatialFlashcardId("f", "e")).toMatch(/^scard_/);
    });

    it("differs across fronts when edgeId is the same (cross-canvas edge reuse is safe)", () => {
      const a = generateSpatialFlashcardId("front A", "edge");
      const b = generateSpatialFlashcardId("front B", "edge");
      expect(a).not.toBe(b);
    });

    it("differs across edges when the front is the same (same-canvas tiebreak)", () => {
      const a = generateSpatialFlashcardId("front", "edge_1");
      const b = generateSpatialFlashcardId("front", "edge_2");
      expect(a).not.toBe(b);
    });
  });

  describe("generateSpatialClozeFlashcardId", () => {
    it("is deterministic for the same inputs", () => {
      const a = generateSpatialClozeFlashcardId("f", "e", "Paris", 0);
      const b = generateSpatialClozeFlashcardId("f", "e", "Paris", 0);
      expect(a).toBe(b);
    });

    it("uses the sccard_ prefix", () => {
      expect(generateSpatialClozeFlashcardId("f", "e", "x", 0)).toMatch(/^sccard_/);
    });

    it("differs across cloze order", () => {
      const a = generateSpatialClozeFlashcardId("f", "e", "Paris", 0);
      const b = generateSpatialClozeFlashcardId("f", "e", "Paris", 1);
      expect(a).not.toBe(b);
    });

    it("differs across cloze text", () => {
      const a = generateSpatialClozeFlashcardId("f", "e", "Paris", 0);
      const b = generateSpatialClozeFlashcardId("f", "e", "Madrid", 0);
      expect(a).not.toBe(b);
    });

    it("differs from the non-cloze spatial id even at order 0", () => {
      const cloze = generateSpatialClozeFlashcardId("f", "e", "Paris", 0);
      const plain = generateSpatialFlashcardId("f", "e");
      expect(cloze).not.toBe(plain);
    });
  });
});
