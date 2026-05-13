import {
  resolveDbPath,
  resolveBackupFolder,
  resolveSyncLogFolder,
} from "../utils/paths";

const CTX = {
  manifestDir: ".obsidian/plugins/decks",
  manifestId: "decks",
  vaultConfigDir: ".obsidian",
};

function paths(overrides: Partial<{ dbFolder: string; backupFolder: string; syncLogFolder: string }> = {}) {
  return {
    dbFolder: "",
    backupFolder: "",
    syncLogFolder: "",
    ...overrides,
  };
}

describe("paths resolver", () => {
  describe("resolveDbPath", () => {
    it("returns the legacy default when dbFolder is empty", () => {
      expect(resolveDbPath(paths(), CTX)).toBe(".obsidian/plugins/decks/flashcards.db");
    });

    it("uses the configured folder when set", () => {
      expect(resolveDbPath(paths({ dbFolder: "decks-data" }), CTX)).toBe("decks-data/flashcards.db");
    });

    it("strips leading and trailing slashes", () => {
      expect(resolveDbPath(paths({ dbFolder: "/decks-data/" }), CTX)).toBe("decks-data/flashcards.db");
    });

    it("normalizes nested paths", () => {
      expect(resolveDbPath(paths({ dbFolder: "data/decks" }), CTX)).toBe("data/decks/flashcards.db");
    });

    it("falls back to default when value is only whitespace", () => {
      expect(resolveDbPath(paths({ dbFolder: "   " }), CTX)).toBe(".obsidian/plugins/decks/flashcards.db");
    });

    it("falls back to manifestId-derived path when manifestDir missing", () => {
      const ctx = { manifestDir: null, manifestId: "decks", vaultConfigDir: ".obsidian" };
      expect(resolveDbPath(paths(), ctx)).toBe(".obsidian/plugins/decks/flashcards.db");
    });
  });

  describe("resolveBackupFolder", () => {
    it("returns the legacy default when backupFolder is empty", () => {
      expect(resolveBackupFolder(paths(), CTX)).toBe(".obsidian/plugins/decks/backups");
    });

    it("uses the configured folder when set", () => {
      expect(resolveBackupFolder(paths({ backupFolder: "Backups/Decks" }), CTX)).toBe("Backups/Decks");
    });

    it("strips slashes", () => {
      expect(resolveBackupFolder(paths({ backupFolder: "/My Backups/" }), CTX)).toBe("My Backups");
    });
  });

  describe("resolveSyncLogFolder", () => {
    it("returns empty string (vault root) by default", () => {
      expect(resolveSyncLogFolder(paths())).toBe("");
    });

    it("uses the configured folder when set", () => {
      expect(resolveSyncLogFolder(paths({ syncLogFolder: "_sync" }))).toBe("_sync");
    });

    it("strips slashes", () => {
      expect(resolveSyncLogFolder(paths({ syncLogFolder: "/_sync/" }))).toBe("_sync");
    });
  });
});
