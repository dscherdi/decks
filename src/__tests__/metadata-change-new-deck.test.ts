jest.mock("obsidian", () => {
  const actual = jest.requireActual("../__mocks__/obsidian");
  class FuzzySuggestModal {}
  return { ...actual, FuzzySuggestModal };
});

import { pickDeckTag } from "@decks/core";
import DecksPlugin from "@/main";
import { TFile } from "../__mocks__/obsidian";
import type { CachedMetadata } from "../__mocks__/obsidian";

const cacheWith = (...tags: string[]): CachedMetadata => ({ tags: tags.map((tag) => ({ tag })) });

const pickedDeckTag = (cache: CachedMetadata): string | null =>
  pickDeckTag((cache.tags ?? []).map(({ tag }) => tag), "#decks");

// The parts of the plugin the two handlers touch for a markdown note.
function makePlugin(deckPaths: string[] = [], indexedBefore = cacheWith()) {
  const decks = new Set(deckPaths);
  // The tag each deck row carries; a deck starts with the plain deck tag.
  const deckTags = new Map<string, string>();
  // What Obsidian's index holds for the note; it trails the save.
  let indexed = indexedBefore;
  // Paths the discovery sync adopts when it runs.
  const adoptable = new Set<string>();
  // Whether the discovery sync gives a deck the tag its note has now.
  const syncRetags = { on: true };
  const awaitingDiscovery = new Set<string>();
  const deckSynchronizer = {
    isMigrating: false,
    createDeckForFile: jest.fn().mockResolvedValue(undefined),
    syncDeck: jest.fn().mockResolvedValue(true),
    sync: jest.fn(async () => {
      for (const path of awaitingDiscovery) if (adoptable.has(path)) decks.add(path);
      const tag = pickedDeckTag(indexed);
      if (tag && syncRetags.on) for (const path of decks) deckTags.set(path, tag);
    }),
  };
  const db = {
    getDeckByFilepath: jest.fn(async (path: string) =>
      decks.has(path) ? { id: path, tag: deckTags.get(path) ?? "#decks" } : null,
    ),
    updateDeck: jest.fn(async (path: string, updates: { tag?: string }) => {
      if (updates.tag) deckTags.set(path, updates.tag);
    }),
  };
  const scheduleFullSync = jest.fn();
  const scheduleDeckSync = jest.fn();
  const plugin = Object.assign(Object.create(DecksPlugin.prototype), {
    deckSynchronizer,
    app: {
      metadataCache: { getFileCache: () => indexed },
      vault: { getAbstractFileByPath: (path: string) => new TFile(path) },
    },
    logger: { debug: jest.fn() },
    settings: { parsing: { deckTag: "#decks" } },
    db,
    getDecksView: () => null,
    scheduleFullSync,
    scheduleDeckSync,
    awaitingDiscovery,
  });
  return {
    decks,
    deckTags,
    adoptable,
    syncRetags,
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
    // The index reporting the note on its own, as it does after any re-index.
    async reindex(file: TFile, cache: CachedMetadata) {
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
    const { reindex, scheduleFullSync } = makePlugin();
    const file = new TFile("Spanish.md");

    await reindex(file, cacheWith("#decks"));
    await reindex(file, cacheWith("#decks"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
  });

  it("stays quiet about a note the sync did not adopt", async () => {
    const { reindex, runDiscoverySync, scheduleFullSync } = makePlugin();
    const file = new TFile("Spanish.md");

    await reindex(file, cacheWith("#decks"));
    await runDiscoverySync();
    await reindex(file, cacheWith("#decks"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
  });

  it("asks again for a note whose deck came and went", async () => {
    const { reindex, decks, adoptable, runDiscoverySync, scheduleFullSync } = makePlugin();
    const file = new TFile("Spanish.md");
    adoptable.add("Spanish.md");

    await reindex(file, cacheWith("#decks"));
    await runDiscoverySync();
    expect(decks.has("Spanish.md")).toBe(true);
    decks.delete("Spanish.md");
    await reindex(file, cacheWith("#decks"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(2);
  });

  it("asks again when the tag is removed and added back", async () => {
    const { reindex, scheduleFullSync } = makePlugin();
    const file = new TFile("Spanish.md");

    await reindex(file, cacheWith("#decks"));
    await reindex(file, cacheWith());
    await reindex(file, cacheWith("#decks"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(2);
  });
});

describe("a deck note whose tag changes in a save", () => {
  it("asks for a sync that gives the deck its new tag", async () => {
    const { save, runDiscoverySync, deckTags, scheduleFullSync } = makePlugin(
      ["French.md"],
      cacheWith("#decks"),
    );

    await save(new TFile("French.md"), cacheWith("#decks/french"));

    // The "modify" handler compared the deck with the index from before the save.
    expect(deckTags.get("French.md")).toBeUndefined();
    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
    await runDiscoverySync();
    expect(deckTags.get("French.md")).toBe("#decks/french");
  });

  it("asks again for the next tag once the first one is in", async () => {
    const { save, runDiscoverySync, scheduleFullSync } = makePlugin(
      ["French.md"],
      cacheWith("#decks"),
    );
    const file = new TFile("French.md");

    await save(file, cacheWith("#decks/french"));
    await runDiscoverySync();
    await save(file, cacheWith("#decks/french"));
    expect(scheduleFullSync).toHaveBeenCalledTimes(1);

    await save(file, cacheWith("#decks/francais"));
    expect(scheduleFullSync).toHaveBeenCalledTimes(2);
  });

  it("asks once for a tag the sync does not take over", async () => {
    const { reindex, runDiscoverySync, syncRetags, scheduleFullSync } = makePlugin(
      ["French.md"],
      cacheWith("#decks"),
    );
    const file = new TFile("French.md");
    syncRetags.on = false;

    await reindex(file, cacheWith("#decks/french"));
    await runDiscoverySync();
    await reindex(file, cacheWith("#decks/french"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
  });

  it("asks for a sync when the deck carries the note's other deck tag", async () => {
    const { reindex, deckTags, scheduleFullSync } = makePlugin(["French.md"]);
    deckTags.set("French.md", "#decks/b");

    await reindex(new TFile("French.md"), cacheWith("#decks/a", "#decks/b"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the deck carries the tag picked for the note", async () => {
    const { reindex, deckTags, scheduleFullSync } = makePlugin(["French.md"]);
    deckTags.set("French.md", "#decks/a");

    await reindex(new TFile("French.md"), cacheWith("#decks/b", "#decks/a"));

    expect(scheduleFullSync).not.toHaveBeenCalled();
  });

  it("asks for a sync when a plainly tagged note gets a more specific deck tag", async () => {
    const { save, runDiscoverySync, deckTags, scheduleFullSync } = makePlugin(
      ["French.md"],
      cacheWith("#decks"),
    );

    await save(new TFile("French.md"), cacheWith("#decks", "#decks/french"));

    expect(scheduleFullSync).toHaveBeenCalledTimes(1);
    await runDiscoverySync();
    expect(deckTags.get("French.md")).toBe("#decks/french");
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
    const { reindex, db, scheduleFullSync } = makePlugin();

    await reindex(new TFile("Journal.md"), cacheWith("#other"));

    expect(db.getDeckByFilepath).not.toHaveBeenCalled();
    expect(scheduleFullSync).not.toHaveBeenCalled();
  });

  it("ignores files that are not markdown", async () => {
    const { reindex, scheduleFullSync } = makePlugin();

    await reindex(new TFile("Canvas/Map.canvas"), cacheWith("#decks"));

    expect(scheduleFullSync).not.toHaveBeenCalled();
  });

  it("stays out of the way of a migration", async () => {
    const { reindex, deckSynchronizer, scheduleFullSync } = makePlugin();
    deckSynchronizer.isMigrating = true;

    await reindex(new TFile("Spanish.md"), cacheWith("#decks"));

    expect(scheduleFullSync).not.toHaveBeenCalled();
  });
});
