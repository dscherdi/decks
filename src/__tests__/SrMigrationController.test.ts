import { generateFlashcardId } from "@decks/core";
import type { App, CachedMetadata } from "obsidian";
import { TFile } from "../__mocks__/obsidian";
import { SrMigrationController, buildReviewProperties } from "@/services/SrMigrationController";
import type { SrMigrateOptions } from "@/services/SrMigrationController";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import type { DeckSynchronizer } from "@/services/DeckSynchronizer";
import type { DecksSettings } from "@/settings";
import type { Logger } from "@/utils/logging";

describe("buildReviewProperties", () => {
  it("carries over user properties and drops tags/position/sr-* keys", () => {
    const out = buildReviewProperties(
      {
        author: "Jane",
        tags: ["a", "b"],
        position: { start: 0 },
        "sr-due": "2024-01-01",
      },
      {}
    );
    expect(out).toContain("author: Jane");
    expect(out).not.toContain("tags:");
    expect(out).not.toContain("position");
    expect(out).not.toContain("sr-due");
  });

  it("injects cross-link properties on a note with no frontmatter", () => {
    const out = buildReviewProperties(undefined, {
      Flashcards: "[[Note (Flashcards)]]",
      "Origin note": "[[folder/Note]]",
    });
    expect(out).toContain("Flashcards: [[Note (Flashcards)]]");
    expect(out).toContain("Origin note: [[folder/Note]]");
  });

  it("overwrites an existing property instead of duplicating it", () => {
    const out = buildReviewProperties(
      { "Origin note": "https://user-supplied.example", author: "Jane" },
      { "Origin note": "[[folder/Note]]" }
    );
    // Exactly one "Origin note" key, holding the injected value.
    expect(out.match(/^Origin note:/gm)).toHaveLength(1);
    expect(out).toContain("Origin note: [[folder/Note]]");
    expect(out).not.toContain("https://user-supplied.example");
    expect(out).toContain("author: Jane");
  });

  it("overwrites case-insensitively (user 'origin note' vs injected 'Origin note')", () => {
    const out = buildReviewProperties(
      { "origin note": "old", Flashcards: "old-deck" },
      { "Origin note": "[[new]]", Flashcards: "[[deck]]" }
    );
    expect(out.match(/origin note:/gim)).toHaveLength(1);
    expect(out.match(/^Flashcards:/gm)).toHaveLength(1);
    expect(out).toContain("Origin note: [[new]]");
    expect(out).toContain("Flashcards: [[deck]]");
    expect(out).not.toContain("old");
  });

  it("returns an empty string when there is nothing to write", () => {
    expect(buildReviewProperties(undefined, {})).toBe("");
    expect(buildReviewProperties({ tags: ["x"] }, {})).toBe("");
  });
});

// A vault whose metadata cache trails each write, as Obsidian's does.
function makeVault(indexDelayMs: number) {
  const files = new Map<string, TFile>();
  const contents = new Map<string, string>();
  const cache = new Map<string, CachedMetadata>();

  const index = (path: string, content: string): void => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? "";
    const inFrontmatter = Array.from(frontmatter.matchAll(/^ {2}- (.+)$/gm), (m) => m[1]);
    const inline = Array.from(content.matchAll(/(^|\s)(#[\w/-]+)/g), (m) => ({ tag: m[2] }));
    cache.set(path, { frontmatter: { tags: inFrontmatter }, tags: inline });
  };
  const write = (path: string, content: string, delayMs: number): TFile => {
    const file = files.get(path) ?? new TFile(path);
    files.set(path, file);
    contents.set(path, content);
    if (delayMs === 0) index(path, content);
    else setTimeout(() => index(path, content), delayMs);
    return file;
  };

  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => Array.from(files.values()),
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: TFile) => contents.get(file.path) ?? "",
      create: async (path: string, content: string) => write(path, content, indexDelayMs),
      modify: async (file: TFile, content: string) => {
        write(file.path, content, indexDelayMs);
      },
      adapter: { exists: async () => false, mkdir: async () => undefined },
    },
    metadataCache: { getFileCache: (file: TFile) => cache.get(file.path) ?? null },
  };
  return { app, cache, contents, seed: (path: string, content: string) => write(path, content, 0) };
}

function makeController(indexDelayMs = 0) {
  const vault = makeVault(indexDelayMs);
  const logs: string[] = [];
  const db = {
    getProfileById: async (id: string) => ({
      id,
      headerLevel: 2,
      fsrs: { requestRetention: 0.9, profile: "STANDARD" },
    }),
    createTagMapping: async () => undefined,
    insertAnchorBindings: async () => undefined,
    getReviewLogById: async () => null,
    insertReviewLog: async (log: { id: string }) => {
      logs.push(log.id);
    },
    batchUpdateFlashcards: async () => undefined,
  };
  // Records, at the moment the sync starts, which written files were indexed.
  const indexedAtSync: boolean[] = [];
  const deckSynchronizer = {
    isMigrating: false,
    sync: jest.fn(async () => {
      for (const path of vault.contents.keys()) {
        if (path.startsWith("Decks/")) indexedAtSync.push(vault.cache.has(path));
      }
      return { success: true };
    }),
  };
  const controller = new SrMigrationController(
    vault.app as unknown as App,
    db as unknown as IDatabaseService,
    deckSynchronizer as unknown as DeckSynchronizer,
    { parsing: { deckTag: "#decks" } } as unknown as DecksSettings,
    { debug: jest.fn(), error: jest.fn() } as unknown as Logger
  );
  return { controller, vault, logs, indexedAtSync, deckSynchronizer };
}

const LEGACY_NOTE = [
  "#flashcards/french",
  "",
  "bonjour::hello <!--SR:!2026-11-14,6,270-->",
  "merci::thank you <!--SR:!2026-11-10,3,250-->",
  "au revoir::goodbye <!--SR:!2026-11-09,2,230-->",
  "le chien:::the dog <!--SR:!2026-11-21,14,270!2026-11-10,4,250-->",
  "",
  'How do you say "library" in French?',
  "?",
  "la bibliothèque",
  "<!--SR:!2026-11-18,10,270-->",
  "",
  "Paris is the capital of ==France==. <!--SR:!2026-11-27,21,290-->",
].join("\n");

const SCAN_OPTIONS = {
  sourceFolder: "",
  srBaseTag: "#flashcards",
  srReviewTag: "#review",
  inlineSep: "::",
  multiSep: "?",
  clozeSep: ";;",
};
const MIGRATE_OPTIONS: SrMigrateOptions = {
  ...SCAN_OPTIONS,
  targetFolder: "Decks",
  profileId: "profile_default",
  format: "smart",
  sameFolder: false,
  archiveOriginals: false,
};

describe("SrMigrationController counts", () => {
  it("reports the same cards and history after Scan and after Migrate", async () => {
    const { controller, vault } = makeController();
    vault.seed("French basics.md", LEGACY_NOTE);

    const scanned = await controller.scan(SCAN_OPTIONS);
    const summary = await controller.migrate(MIGRATE_OPTIONS);

    // Seven flashcards (the reverse line is two) plus the note kept as a review note.
    expect(scanned).toEqual({ fileCount: 1, cardCount: 8, withHistory: 7 });
    expect(summary.filesMigrated).toBe(scanned.fileCount);
    expect(summary.cardsMigrated).toBe(scanned.cardCount);
    expect(summary.withHistory).toBe(scanned.withHistory);
    expect(summary.filesCreated).toBe(2);
  });

  it("does not give the review note the schedule of its last card", async () => {
    const { controller, vault, logs } = makeController();
    vault.seed("French basics.md", LEGACY_NOTE);
    await controller.migrate(MIGRATE_OPTIONS);
    expect(logs).not.toContain(`log_migrate_${generateFlashcardId("French basics")}`);
    expect(logs).toHaveLength(7);
  });
});

describe("SrMigrationController sync timing", () => {
  it("syncs only once the written files are indexed", async () => {
    const { controller, vault, indexedAtSync, deckSynchronizer } = makeController(120);
    vault.seed("French basics.md", LEGACY_NOTE);
    await controller.migrate(MIGRATE_OPTIONS);
    expect(deckSynchronizer.sync).toHaveBeenCalledTimes(1);
    expect(indexedAtSync).toEqual([true, true]);
  });
});
