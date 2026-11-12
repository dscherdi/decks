jest.mock("obsidian", () => {
  const actual = jest.requireActual("../__mocks__/obsidian");
  class FuzzySuggestModal {}
  return { ...actual, FuzzySuggestModal };
});

import DecksPlugin from "@/main";
import { TFile } from "../__mocks__/obsidian";

// The parts of the plugin handleFileChange touches for a markdown note.
function makePlugin(tags: string[], existingDeckId?: string) {
  const decks = new Map<string, { id: string; tag: string }>();
  if (existingDeckId) decks.set("French.md", { id: existingDeckId, tag: tags[0] });
  const view = {
    refreshStats: jest.fn().mockResolvedValue(undefined),
    refreshDecksAndStats: jest.fn().mockResolvedValue(undefined),
  };
  const deckSynchronizer = {
    isMigrating: false,
    createDeckForFile: jest.fn(async (path: string, tag: string) => {
      decks.set(path, { id: "deck_new", tag });
    }),
    syncDeck: jest.fn().mockResolvedValue(true),
  };
  const scheduleDeckSync = jest.fn();
  const plugin = {
    deckSynchronizer,
    app: { metadataCache: { getFileCache: () => ({ tags: tags.map((tag) => ({ tag })) }) } },
    logger: { debug: jest.fn() },
    settings: { parsing: { deckTag: "#decks" } },
    db: {
      getDeckByFilepath: jest.fn(async (path: string) => decks.get(path) ?? null),
      updateDeck: jest.fn().mockResolvedValue(undefined),
    },
    getDecksView: () => view,
    scheduleDeckSync,
  };
  return { plugin: plugin as unknown as DecksPlugin, view, deckSynchronizer, scheduleDeckSync };
}

describe("handleFileChange on a markdown note", () => {
  it("reloads the panel's deck list when a note gets its deck tag after creation", async () => {
    const { plugin, view, deckSynchronizer } = makePlugin(["#decks"]);

    await DecksPlugin.prototype.handleFileChange.call(plugin, new TFile("French.md"));

    expect(deckSynchronizer.createDeckForFile).toHaveBeenCalledWith("French.md", "#decks");
    expect(deckSynchronizer.syncDeck).toHaveBeenCalledWith("deck_new");
    expect(view.refreshDecksAndStats).toHaveBeenCalledTimes(1);
  });

  it("only schedules a sync for a note that already has a deck", async () => {
    const { plugin, view, deckSynchronizer, scheduleDeckSync } = makePlugin(["#decks"], "deck_old");

    await DecksPlugin.prototype.handleFileChange.call(plugin, new TFile("French.md"));

    expect(deckSynchronizer.createDeckForFile).not.toHaveBeenCalled();
    expect(scheduleDeckSync).toHaveBeenCalledWith("deck_old");
    expect(view.refreshDecksAndStats).not.toHaveBeenCalled();
  });

  it("leaves an untagged note alone", async () => {
    const { plugin, view, deckSynchronizer } = makePlugin(["#other"]);

    await DecksPlugin.prototype.handleFileChange.call(plugin, new TFile("French.md"));

    expect(deckSynchronizer.createDeckForFile).not.toHaveBeenCalled();
    expect(view.refreshDecksAndStats).not.toHaveBeenCalled();
    expect(view.refreshStats).not.toHaveBeenCalled();
  });
});
