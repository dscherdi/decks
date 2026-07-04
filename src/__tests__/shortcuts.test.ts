import {
  DEFAULT_REVIEW_SHORTCUTS,
  normalizeShortcutKey,
  matchesShortcut,
  displayShortcutKey,
  isReviewShortcut,
} from "../utils/shortcuts";

describe("review shortcuts util", () => {
  describe("normalizeShortcutKey", () => {
    it("lowercases single characters so Shift+letter matches", () => {
      expect(normalizeShortcutKey("A")).toBe("a");
      expect(normalizeShortcutKey("a")).toBe("a");
    });

    it("leaves named keys and Space untouched", () => {
      expect(normalizeShortcutKey(" ")).toBe(" ");
      expect(normalizeShortcutKey("Enter")).toBe("Enter");
      expect(normalizeShortcutKey("ArrowRight")).toBe("ArrowRight");
    });
  });

  describe("matchesShortcut", () => {
    it("matches case-insensitively for letters", () => {
      expect(matchesShortcut("A", "a")).toBe(true);
      expect(matchesShortcut("s", "S")).toBe(true);
    });

    it("matches Space and symbols exactly", () => {
      expect(matchesShortcut(" ", " ")).toBe(true);
      expect(matchesShortcut(";", ";")).toBe(true);
      expect(matchesShortcut("a", "b")).toBe(false);
    });
  });

  describe("displayShortcutKey", () => {
    it("names Space and arrows, uppercases letters", () => {
      expect(displayShortcutKey(" ")).toBe("Space");
      expect(displayShortcutKey("a")).toBe("A");
      expect(displayShortcutKey(";")).toBe(";");
      expect(displayShortcutKey("ArrowRight")).toBe("→");
      expect(displayShortcutKey("Escape")).toBe("Esc");
    });
  });

  describe("isReviewShortcut", () => {
    it("is true for any of the five bound keys (case-insensitive)", () => {
      const sc = { again: "a", hard: "s", good: "d", easy: "f", reveal: " " };
      expect(isReviewShortcut("A", sc)).toBe(true);
      expect(isReviewShortcut("s", sc)).toBe(true);
      expect(isReviewShortcut(" ", sc)).toBe(true);
      expect(isReviewShortcut("b", sc)).toBe(false);
    });

    it("recognizes the defaults", () => {
      for (const key of ["1", "2", "3", "4", " "]) {
        expect(isReviewShortcut(key, DEFAULT_REVIEW_SHORTCUTS)).toBe(true);
      }
      expect(isReviewShortcut("s", DEFAULT_REVIEW_SHORTCUTS)).toBe(false);
    });
  });
});
