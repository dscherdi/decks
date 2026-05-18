import { I18n } from "@/i18n/I18n";
import type { DecksSettings } from "@/settings";
import { DEFAULT_SETTINGS } from "@/settings";

// Mock obsidian's getLanguage so we can drive the auto-detection path.
jest.mock("obsidian", () => ({
  getLanguage: jest.fn(),
}));

import { getLanguage } from "obsidian";
const getLanguageMock = getLanguage as jest.MockedFunction<typeof getLanguage>;

function settingsWith(language: DecksSettings["i18n"]["language"]): DecksSettings {
  return {
    ...DEFAULT_SETTINGS,
    i18n: { language },
  };
}

describe("I18n", () => {
  beforeEach(() => {
    getLanguageMock.mockReset();
  });

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

  describe("init() with auto", () => {
    it("falls back to Obsidian's getLanguage() when 'auto'", () => {
      getLanguageMock.mockReturnValue("fr");
      I18n.init(settingsWith("auto"));
      expect(I18n.code).toBe("fr");
    });

    it("strips region codes (zh-TW → zh)", () => {
      getLanguageMock.mockReturnValue("zh-TW");
      I18n.init(settingsWith("auto"));
      expect(I18n.code).toBe("zh");
    });

    it("falls back to English for unsupported codes", () => {
      getLanguageMock.mockReturnValue("pt");
      I18n.init(settingsWith("auto"));
      expect(I18n.code).toBe("en");
    });

    it("falls back to English when getLanguage() throws", () => {
      getLanguageMock.mockImplementation(() => {
        throw new Error("not available");
      });
      I18n.init(settingsWith("auto"));
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
