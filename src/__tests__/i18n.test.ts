import { I18n } from "@decks/core";
import type { DecksSettings } from "@/settings";
import { DEFAULT_SETTINGS } from "@/settings";

function settingsWith(language: DecksSettings["i18n"]["language"]): DecksSettings {
  return {
    ...DEFAULT_SETTINGS,
    i18n: { language },
  };
}

describe("I18n", () => {
  describe("init() with explicit language preference", () => {
    it("selects German when language is 'de'", () => {
      I18n.init(settingsWith("de"));
      expect(I18n.code).toBe("de");
      expect(I18n.t.deckList.title).toBe("Stapel");
    });

    it("selects Japanese when language is 'ja'", () => {
      I18n.init(settingsWith("ja"));
      expect(I18n.code).toBe("ja");
      expect(I18n.t.views.decks).toBe("デッキ");
    });

    it("selects English when language is 'en'", () => {
      I18n.init(settingsWith("en"));
      expect(I18n.code).toBe("en");
      expect(I18n.t.deckList.title).toBe("Decks");
    });
  });

  // With 'auto', core resolves from the systemLanguage argument the host passes
  // (the plugin passes Obsidian's getLanguage()); resolution itself is platform-agnostic.
  describe("init() with auto + systemLanguage", () => {
    it("uses the system language when 'auto'", () => {
      I18n.init(settingsWith("auto"), "fr");
      expect(I18n.code).toBe("fr");
    });

    it("strips region codes (zh-TW → zh)", () => {
      I18n.init(settingsWith("auto"), "zh-TW");
      expect(I18n.code).toBe("zh");
    });

    it("falls back to English for unsupported codes", () => {
      I18n.init(settingsWith("auto"), "pt");
      expect(I18n.code).toBe("en");
    });

    it("falls back to English when no system language is provided", () => {
      I18n.init(settingsWith("auto"), undefined);
      expect(I18n.code).toBe("en");
    });
  });

  describe("format()", () => {
    it("substitutes single placeholder", () => {
      expect(I18n.format("Hello {name}", { name: "world" })).toBe("Hello world");
    });

    it("substitutes multiple placeholders", () => {
      expect(
        I18n.format("{a} and {b} = {sum}", { a: 1, b: 2, sum: 3 })
      ).toBe("1 and 2 = 3");
    });

    it("leaves unknown placeholders intact", () => {
      expect(I18n.format("Hi {who}", {})).toBe("Hi {who}");
    });

    it("coerces numbers to strings", () => {
      expect(I18n.format("{n}", { n: 42 })).toBe("42");
    });

    it("handles strings with no placeholders", () => {
      expect(I18n.format("plain text", {})).toBe("plain text");
    });
  });

  describe("locales have full coverage", () => {
    it("every locale satisfies the Translations shape (compile-time check)", () => {
      // This test passing means the TypeScript compiler accepted every locale
      // file. If any locale were missing a key, the build would have failed.
      I18n.init(settingsWith("de"));
      expect(typeof I18n.t.deckList.title).toBe("string");
      I18n.init(settingsWith("es"));
      expect(typeof I18n.t.notices.languageChanged).toBe("string");
      I18n.init(settingsWith("ja"));
      expect(typeof I18n.t.settings.review.heading).toBe("string");
    });
  });
});
