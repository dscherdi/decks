import {
  parseSteps,
  validateLearningSteps,
  validateRelearningSteps,
  getDefaultLearningSteps,
  getDefaultRelearningSteps,
  formatStepInterval,
} from "../utils/step-parser";

describe("Step Parser", () => {
  describe("parseSteps", () => {
    it("should parse minutes", () => {
      expect(parseSteps("1m")).toEqual([1]);
      expect(parseSteps("10m")).toEqual([10]);
      expect(parseSteps("1m 6m 10m")).toEqual([1, 6, 10]);
    });

    it("should parse hours", () => {
      expect(parseSteps("1h")).toEqual([60]);
      expect(parseSteps("2h")).toEqual([120]);
    });

    it("should parse days", () => {
      expect(parseSteps("1d")).toEqual([1440]);
      expect(parseSteps("3d")).toEqual([4320]);
    });

    it("should parse mixed units", () => {
      expect(parseSteps("1m 1d 3d")).toEqual([1, 1440, 4320]);
      expect(parseSteps("5m 1h 1d")).toEqual([5, 60, 1440]);
    });

    it("should return empty array for empty string", () => {
      expect(parseSteps("")).toEqual([]);
      expect(parseSteps("  ")).toEqual([]);
    });

    it("should return empty array for invalid tokens", () => {
      expect(parseSteps("abc")).toEqual([]);
      expect(parseSteps("1x")).toEqual([]);
      expect(parseSteps("1m abc 10m")).toEqual([]);
    });

    it("should handle extra whitespace", () => {
      expect(parseSteps("  1m  6m  10m  ")).toEqual([1, 6, 10]);
    });

    it("should handle decimal values", () => {
      expect(parseSteps("1.5m")).toEqual([1.5]);
      expect(parseSteps("0.5d")).toEqual([720]);
    });

    it("should reject zero or negative values", () => {
      expect(parseSteps("0m")).toEqual([]);
    });
  });

  describe("validateLearningSteps", () => {
    it("should accept single value with any unit", () => {
      expect(validateLearningSteps("1m", "STANDARD")).toEqual({ valid: true });
      expect(validateLearningSteps("1m", "INTENSIVE")).toEqual({ valid: true });
      expect(validateLearningSteps("10m", "INTENSIVE")).toEqual({ valid: true });
      expect(validateLearningSteps("1h", "STANDARD")).toEqual({ valid: true });
      expect(validateLearningSteps("1d", "INTENSIVE")).toEqual({ valid: true });
    });

    it("should reject multiple values", () => {
      const result = validateLearningSteps("1m 10m", "INTENSIVE");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("single interval");
    });

    it("should accept empty string", () => {
      expect(validateLearningSteps("", "STANDARD")).toEqual({ valid: true });
      expect(validateLearningSteps("", "INTENSIVE")).toEqual({ valid: true });
    });

    it("should reject invalid format", () => {
      const result = validateLearningSteps("abc", "INTENSIVE");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid format");
    });
  });

  describe("validateRelearningSteps", () => {
    it("should accept single value for both profiles", () => {
      expect(validateRelearningSteps("10m", "STANDARD")).toEqual({ valid: true });
      expect(validateRelearningSteps("10m", "INTENSIVE")).toEqual({ valid: true });
      expect(validateRelearningSteps("1h", "STANDARD")).toEqual({ valid: true });
    });

    it("should reject multiple values", () => {
      const result = validateRelearningSteps("10m 1d", "STANDARD");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("single interval");
    });

    it("should accept empty string", () => {
      expect(validateRelearningSteps("", "STANDARD")).toEqual({ valid: true });
    });

    it("should reject invalid format", () => {
      const result = validateRelearningSteps("abc", "STANDARD");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid format");
    });
  });

  describe("getDefaultLearningSteps", () => {
    it("should return 1m for both profiles", () => {
      expect(getDefaultLearningSteps("INTENSIVE")).toBe("1m");
      expect(getDefaultLearningSteps("STANDARD")).toBe("1m");
    });
  });

  describe("getDefaultRelearningSteps", () => {
    it("should return 10m for both profiles", () => {
      expect(getDefaultRelearningSteps("INTENSIVE")).toBe("10m");
      expect(getDefaultRelearningSteps("STANDARD")).toBe("10m");
    });
  });

  describe("formatStepInterval", () => {
    it("should format minutes", () => {
      expect(formatStepInterval(1)).toBe("1m");
      expect(formatStepInterval(10)).toBe("10m");
      expect(formatStepInterval(30)).toBe("30m");
    });

    it("should format hours when evenly divisible", () => {
      expect(formatStepInterval(60)).toBe("1h");
      expect(formatStepInterval(120)).toBe("2h");
    });

    it("should format days when evenly divisible", () => {
      expect(formatStepInterval(1440)).toBe("1d");
      expect(formatStepInterval(4320)).toBe("3d");
    });

    it("should prefer days over hours", () => {
      expect(formatStepInterval(1440)).toBe("1d");
    });

    it("should use minutes for non-whole hour/day values", () => {
      expect(formatStepInterval(90)).toBe("90m");
      expect(formatStepInterval(45)).toBe("45m");
    });
  });
});
