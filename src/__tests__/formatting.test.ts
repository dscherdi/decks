import { formatTime, formatPace } from "../utils/formatting";

describe("Formatting Utilities", () => {
  describe("formatTime", () => {
    it("should format seconds to minutes correctly", () => {
      expect(formatTime(30)).toBe("0m");
      expect(formatTime(60)).toBe("1m");
      expect(formatTime(120)).toBe("2m");
      expect(formatTime(300)).toBe("5m");
    });

    it("should format seconds to hours and minutes correctly", () => {
      expect(formatTime(3600)).toBe("1h 0m");
      expect(formatTime(3660)).toBe("1h 1m");
      expect(formatTime(7200)).toBe("2h 0m");
      expect(formatTime(7320)).toBe("2h 2m");
    });

    it("should handle edge cases", () => {
      expect(formatTime(0)).toBe("0m");
      expect(formatTime(59)).toBe("0m");
      expect(formatTime(3599)).toBe("59m");
    });
  });

  describe("formatPace", () => {
    it("should format seconds correctly for values under 60", () => {
      expect(formatPace(45)).toBe("45.0s");
      expect(formatPace(30.5)).toBe("30.5s");
      expect(formatPace(59.9)).toBe("59.9s");
    });

    it("should format seconds to minutes and seconds for values 60 and above", () => {
      expect(formatPace(60)).toBe("1m 0s");
      expect(formatPace(75)).toBe("1m 15s");
      expect(formatPace(130)).toBe("2m 10s");
      expect(formatPace(125.7)).toBe("2m 6s");
    });

    it("should handle edge cases", () => {
      expect(formatPace(0)).toBe("0.0s");
      expect(formatPace(59)).toBe("59.0s");
      expect(formatPace(60.1)).toBe("1m 0s");
    });
  });
});
