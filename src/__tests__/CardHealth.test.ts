import {
  computeCardHealth,
  isCardLeech,
  isCardDense,
} from "../services/CardHealth";

const thresholds = { leechThreshold: 8, denseCardCharThreshold: 500 };

describe("CardHealth", () => {
  describe("computeCardHealth", () => {
    it("returns healthy for low lapses and short back", () => {
      const result = computeCardHealth(
        { lapses: 2, back: "short answer" },
        thresholds
      );
      expect(result).toEqual({ isLeech: false, isDense: false });
    });

    it("flags leech when lapses >= threshold", () => {
      const result = computeCardHealth(
        { lapses: 8, back: "x" },
        thresholds
      );
      expect(result.isLeech).toBe(true);
      expect(result.isDense).toBe(false);
    });

    it("does not flag leech when lapses below threshold", () => {
      const result = computeCardHealth(
        { lapses: 7, back: "x" },
        thresholds
      );
      expect(result.isLeech).toBe(false);
    });

    it("flags dense when back length >= threshold", () => {
      const back = "a".repeat(500);
      const result = computeCardHealth({ lapses: 0, back }, thresholds);
      expect(result.isDense).toBe(true);
      expect(result.isLeech).toBe(false);
    });

    it("does not flag dense when back length below threshold", () => {
      const back = "a".repeat(499);
      const result = computeCardHealth({ lapses: 0, back }, thresholds);
      expect(result.isDense).toBe(false);
    });

    it("flags both when card is leech and dense", () => {
      const back = "a".repeat(800);
      const result = computeCardHealth({ lapses: 12, back }, thresholds);
      expect(result.isLeech).toBe(true);
      expect(result.isDense).toBe(true);
    });

    it("respects custom thresholds", () => {
      const custom = { leechThreshold: 3, denseCardCharThreshold: 100 };
      const result = computeCardHealth(
        { lapses: 3, back: "a".repeat(100) },
        custom
      );
      expect(result).toEqual({ isLeech: true, isDense: true });
    });

    it("treats empty back as not dense", () => {
      const result = computeCardHealth(
        { lapses: 0, back: "" },
        thresholds
      );
      expect(result.isDense).toBe(false);
    });
  });

  describe("isCardLeech", () => {
    it("returns true at boundary", () => {
      expect(isCardLeech({ lapses: 8 }, 8)).toBe(true);
    });
    it("returns false below boundary", () => {
      expect(isCardLeech({ lapses: 7 }, 8)).toBe(false);
    });
  });

  describe("isCardDense", () => {
    it("returns true at boundary", () => {
      expect(isCardDense({ back: "a".repeat(500) }, 500)).toBe(true);
    });
    it("returns false below boundary", () => {
      expect(isCardDense({ back: "a".repeat(499) }, 500)).toBe(false);
    });
  });
});
