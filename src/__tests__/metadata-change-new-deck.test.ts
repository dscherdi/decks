jest.mock("obsidian", () => {
  const actual = jest.requireActual("../__mocks__/obsidian");
  class FuzzySuggestModal {}
  return { ...actual, FuzzySuggestModal };
});

import DecksPlugin from "@/main";
import { TFile } from "../__mocks__/obsidian";
import type { CachedMetadata } from "../__mocks__/obsidian";

const cacheWith = (...tags: string[]): CachedMetadata => ({ tags: tags.map((tag) => ({ tag })) });

// The parts of the plugin the two handlers touch for a markdown note.
function makePlugin(deckPaths: string[] = [], indexedBefore = cacheWith()) {
  const decks = new Set(deckPaths);
  // What Obsidian's index holds for the note; it trails the save.
  let indexed = indexedBefore;
  // Paths the discovery sync adopts when it runs.
  const adoptable = new Set<string>();
  const awaitingDiscovery = new Set<string>();
  const deckSynchronizer = {
    isMigrating: false,
    createDeckForFile: jest.fn().mockResolvedValue(undefined),
    syncDeck: jest.fn().mockResolvedValue(true),
    sync: jest.fn(async () => {
      for (const path of awaitingDiscovery) if (adoptable.has(path)) decks.add(path);
    }),
  };
  const db = {
    getDeckByFilepath: jest.fn(async (path: string) =>
      decks.has(path) ? { id: "deck_old", tag: "#decks" } : null,
    ),
    updateDeck: jest.fn().mockResolvedValue(undefined),
  };
  const scheduleFullSync = jest.fn();
  const scheduleDeckSync = jest.fn();
  const plugin = {
    deckSynchronizer,
    app: { metadataCache: { getFileCache: () => indexed } },
    logger: { debug: jest.fn() },
    settings: { parsing: { deckTag: "#decks" } },
    db,
    getDecksView: () => null,
    scheduleFullSync,
    scheduleDeckSync,
    awaitingDiscovery,
  };
  return {
    plugin: plugin as unknown as DecksPlugin,
    decks,
    adoptable,
    // The debounced discovery sync that scheduleFullSync leads to.
    runDiscoverySync: () => DecksPlugin.prototype["runDebouncedFullSync"].call(plugin),
    db,
    deckSynchronizer,
    scheduleFullSync,
    scheduleDeckSync,
    // One save as Obsidian reports it: "modify" first, the re-indexed cache after.
    async save(file: TFile, cache: CachedMetadata) {
      await DecksPlugin.prototype.handleFileChange.call(plugin, file);
      indexed = cache;
      await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cache);
    },
  };
}

describe("a note that gets its deck tag in a save", () => {
  it("asks for a discovery sync when the tag is the last thing saved", async () => {
    const { save, scheduleFullSync, deckSynchronizer } = makePlugin();

    await save(new TFile("Spanish.md"), cacheWith("#decks"));

    // The "modify" handler read the index before it had the tag.
    expect(deckSynchronizer.createDeckForFile).not.toHaveBeenCalled();
    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
  });

  it("accepts a sub-tag of the deck tag", async () => {
    const { save, scheduleFullSync } = makePlugin();

    await save(new TFile("Spanish.md"), cacheWith("#decks/spanish"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
  });

  it("asks once while the note still has no deck", async () => {
    const { plugin, scheduleFullSync } = makePlugin();
    const file = new TFile("Spanish.md");

    await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cacheWith("#decks"));
    await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cacheWith("#decks"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
  });

  it("stays quiet about a note the sync did not adopt", async () => {
    const { plugin, runDiscoverySync, scheduleFullSync } = makePlugin();
    const file = new TFile("Spanish.md");

    await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cacheWith("#decks"));
    await runDiscoverySync();
    await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cacheWith("#decks"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
  });

  it("asks again for a note whose deck came and went", async () => {
    const { plugin, decks, adoptable, runDiscoverySync, scheduleFullSync } = makePlugin();
    const file = new TFile("Spanish.md");
    adoptable.add("Spanish.md");

    await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cacheWith("#decks"));
    await runDiscoverySync();
    expect(decks.has("Spanish.md")).toBe(true);
    decks.delete("Spanish.md");
    await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cacheWith("#decks"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(2);
  });

  it("asks again when the tag is removed and added back", async () => {
    const { plugin, scheduleFullSync } = makePlugin();
    const file = new TFile("Spanish.md");

    await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cacheWith("#decks"));
    await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cacheWith());
    await DecksPlugin.prototype.handleMetadataChanged.call(plugin, file, cacheWith("#decks"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(2);
  });
});

describe("handleMetadataChanged on notes that need nothing", () => {
  it("adds no sync for a note that already has a deck", async () => {
    const { save, scheduleFullSync, scheduleDeckSync } = makePlugin(
      ["French.md"],
      cacheWith("#decks"),
    );
    const file = new TFile("French.md");

    await save(file, cacheWith("#decks"));
    await save(file, cacheWith("#decks"));

    expect(scheduleFullSync).not.toHaveBeenCalled();
    // Only the debounced per-deck sync the "modify" handler schedules, once per save.
    expect(scheduleDeckSync).toHaveBeenCalledTimes(2);
  });

  it("does not query the database for an untagged note", async () => {
    const { plugin, db, scheduleFullSync } = makePlugin();

    await DecksPlugin.prototype.handleMetadataChanged.call(
      plugin,
      new TFile("Journal.md"),
      cacheWith("#other"),
    );

    expect(db.getDeckByFilepath).not.toHaveBeenCalled();
    expect(scheduleFullSync).not.toHaveBeenCalled();
  });

  it("ignores files that are not markdown", async () => {
    const { plugin, scheduleFullSync } = makePlugin();

    await DecksPlugin.prototype.handleMetadataChanged.call(
      plugin,
      new TFile("Canvas/Map.canvas"),
      cacheWith("#decks"),
    );

    expect(scheduleFullSync).not.toHaveBeenCalled();
  });

  it("stays out of the way of a migration", async () => {
    const { plugin, deckSynchronizer, scheduleFullSync } = makePlugin();
    deckSynchronizer.isMigrating = true;

    await DecksPlugin.prototype.handleMetadataChanged.call(
      plugin,
      new TFile("Spanish.md"),
      cacheWith("#decks"),
    );

    expect(scheduleFullSync).not.toHaveBeenCalled();
  });
});
