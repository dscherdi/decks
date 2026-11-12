jest.mock("obsidian", () => {
  const actual = jest.requireActual("../__mocks__/obsidian");
  class FuzzySuggestModal {}
  return { ...actual, FuzzySuggestModal };
});

import DecksPlugin from "@/main";
import { DecksView } from "@/components/DecksView";
import { CanvasFileEventHandlers } from "@/services/CanvasFileEventHandlers";
import { generateDeckId } from "@decks/core";
import type { Deck, DeckStats } from "@/database/types";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import type { DeckSynchronizer } from "@/services/DeckSynchronizer";
import type { DecksSettings } from "@/settings";
import type { Logger } from "@/utils/logging";
import { TFile } from "../__mocks__/obsidian";

interface DeckRow extends Deck {
  cards: number;
}

function deckRow(filepath: string, cards: number, tag = "#decks"): DeckRow {
  const name = filepath.split("/").pop()!.replace(/\.(md|canvas)$/, "");
  return {
    id: generateDeckId(filepath),
    name,
    filepath,
    tag,
    lastReviewed: null,
    profileId: "profile_default",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    cards,
  };
}

// The deck table, as far as the handlers under test read and write it.
class FakeDb {
  rows: DeckRow[] = [];
  // What another device left on disk; syncWithDisk swaps it in.
  onDisk: DeckRow[] | null = null;

  getDeckByFilepath = async (path: string) => this.rows.find((r) => r.filepath === path) ?? null;
  getAllDecksWithProfiles = async () => this.rows.map((r) => ({ ...r }));
  renameDeck = async (oldId: string, newId: string, name: string, filepath: string) => {
    const row = this.rows.find((r) => r.id === oldId);
    if (row) Object.assign(row, { id: newId, name, filepath });
  };
  deleteDeckByFilepath = async (path: string) => {
    this.rows = this.rows.filter((r) => r.filepath !== path);
  };
  syncWithDisk = async () => {
    if (this.onDisk) this.rows = this.onDisk;
  };
  updateFlashcardDeckIds = jest.fn().mockResolvedValue(undefined);
  setDeckLastSyncedMtime = jest.fn().mockResolvedValue(undefined);
  updateDeck = jest.fn().mockResolvedValue(undefined);
  save = jest.fn().mockResolvedValue(undefined);
}

// Holds what DeckListPanel.svelte holds: its own deck list and the counts by deck id.
class FakePanel {
  decks: Deck[] = [];
  stats = new Map<string, DeckStats>();

  updateAll = async (newDecks?: Deck[], newStats?: Map<string, DeckStats>) => {
    if (newDecks) this.decks = newDecks;
    if (newStats) this.stats = newStats;
  };
  updateGlobalReviewToday = jest.fn();

  // One row per deck in the panel's list, as the Files tree renders them.
  fileRows(): string[] {
    return this.decks.map((d) => `${d.filepath} (${this.stats.get(d.id)?.totalCount ?? 0})`).sort();
  }
}

function makeHarness(initial: DeckRow[]) {
  const db = new FakeDb();
  db.rows = initial;
  const panel = new FakePanel();
  const logger = { debug: jest.fn(), error: jest.fn(), performance: jest.fn() };

  const deckManager = {
    getAllDeckStatsMap: async () =>
      new Map<string, DeckStats>(
        db.rows.map((r) => [
          r.id,
          { deckId: r.id, newCount: r.cards, dueCount: 0, totalCount: r.cards, matureCount: 0 },
        ]),
      ),
    getGlobalDailyCapStatus: jest.fn().mockResolvedValue(null),
    updateFlashcardDeckIds: jest.fn().mockResolvedValue(undefined),
  };

  const deckSynchronizer = {
    isMigrating: false,
    createDeckForFile: jest.fn(async (path: string, tag: string) => {
      db.rows.push(deckRow(path, 0, tag));
    }),
    syncDeck: jest.fn(async (deckId: string) => {
      const row = db.rows.find((r) => r.id === deckId);
      if (row) row.cards = 2;
      return true;
    }),
  };

  // The real view methods, over the fake database and panel.
  const view: DecksView = Object.create(DecksView.prototype);
  Object.assign(view, { db, deckManager, deckListPanelComponent: panel, logger });

  const settings = {
    parsing: { deckTag: "#decks" },
    canvasDecks: { folderPath: "Canvas", tagName: "#decks/canvas" },
  } as unknown as DecksSettings;

  const plugin = {
    db,
    deckManager,
    deckSynchronizer,
    logger,
    settings,
    app: {
      vault: {
        adapter: {
          exists: jest.fn().mockResolvedValue(true),
          stat: jest.fn().mockResolvedValue({ mtime: 5 }),
        },
      },
    },
    pendingStatsRefresh: null,
    lastKnownDatabaseMtime: 0,
    getDecksView: () => view,
    scheduleStatsRefresh: DecksPlugin.prototype["scheduleStatsRefresh"],
    canvasFileEvents: null as CanvasFileEventHandlers | null,
  };
  // Wired as main.ts wires it in onload.
  plugin.canvasFileEvents = new CanvasFileEventHandlers({
    settings,
    db: db as unknown as IDatabaseService,
    deckSynchronizer: deckSynchronizer as unknown as DeckSynchronizer,
    logger: logger as unknown as Logger,
    scheduleDeckSync: jest.fn(),
    scheduleFullSync: jest.fn(),
    scheduleStatsRefresh: () => plugin.scheduleStatsRefresh(),
    refreshStats: async () => {
      await view.refreshStats();
    },
  });

  return { plugin: plugin as unknown as DecksPlugin, db, panel, view };
}

// The panel as it stands once Decks has painted the current decks.
async function paintedHarness(initial: DeckRow[]) {
  const harness = makeHarness(initial);
  await harness.view.refreshDecksAndStats();
  return harness;
}

describe("the panel's deck list after an event that changes which decks exist", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows a renamed deck note under its new path", async () => {
    const { plugin, panel } = await paintedHarness([deckRow("Notes/French.md", 3)]);
    expect(panel.fileRows()).toEqual(["Notes/French.md (3)"]);

    await DecksPlugin.prototype.handleFileRename.call(
      plugin,
      new TFile("Notes/Spanish.md"),
      "Notes/French.md",
    );

    expect(panel.fileRows()).toEqual(["Notes/Spanish.md (3)"]);
  });

  it("drops the row of a deleted deck note", async () => {
    const { plugin, panel } = await paintedHarness([
      deckRow("French.md", 3),
      deckRow("German.md", 4),
    ]);
    jest.useFakeTimers();

    await DecksPlugin.prototype.handleFileDelete.call(plugin, new TFile("French.md"));
    await jest.runAllTimersAsync();

    expect(panel.fileRows()).toEqual(["German.md (4)"]);
  });

  it("lists a canvas deck first seen on a change", async () => {
    const { plugin, panel } = await paintedHarness([deckRow("French.md", 3)]);

    await DecksPlugin.prototype.handleFileChange.call(plugin, new TFile("Canvas/Map.canvas"));

    expect(panel.fileRows()).toEqual(["Canvas/Map.canvas (2)", "French.md (3)"]);
  });

  it("shows a renamed canvas deck under its new path", async () => {
    const { plugin, panel } = await paintedHarness([
      deckRow("Canvas/Map.canvas", 5, "#decks/canvas"),
    ]);

    await DecksPlugin.prototype.handleFileRename.call(
      plugin,
      new TFile("Canvas/Atlas.canvas"),
      "Canvas/Map.canvas",
    );

    expect(panel.fileRows()).toEqual(["Canvas/Atlas.canvas (5)"]);
  });

  it("lists a canvas moved into the canvas folder", async () => {
    const { plugin, panel } = await paintedHarness([]);

    await DecksPlugin.prototype.handleFileRename.call(
      plugin,
      new TFile("Canvas/Map.canvas"),
      "Elsewhere/Map.canvas",
    );

    expect(panel.fileRows()).toEqual(["Canvas/Map.canvas (2)"]);
  });

  it("drops a canvas deck moved out of the canvas folder", async () => {
    const { plugin, panel } = await paintedHarness([
      deckRow("Canvas/Map.canvas", 5, "#decks/canvas"),
    ]);

    await DecksPlugin.prototype.handleFileRename.call(
      plugin,
      new TFile("Elsewhere/Map.canvas"),
      "Canvas/Map.canvas",
    );

    expect(panel.fileRows()).toEqual([]);
  });

  it("drops the row of a deleted canvas deck", async () => {
    const { plugin, panel } = await paintedHarness([
      deckRow("Canvas/Map.canvas", 5, "#decks/canvas"),
    ]);
    jest.useFakeTimers();

    await DecksPlugin.prototype.handleFileDelete.call(plugin, new TFile("Canvas/Map.canvas"));
    await jest.runAllTimersAsync();

    expect(panel.fileRows()).toEqual([]);
  });

  it("lists the deck created for generated cards", async () => {
    const { plugin, panel } = await paintedHarness([deckRow("French.md", 3)]);

    const deckId = await DecksPlugin.prototype["registerGeneratedDeck"].call(
      plugin,
      "AI/Generated.md",
      "#decks",
      "",
    );

    expect(deckId).toBe(generateDeckId("AI/Generated.md"));
    expect(panel.fileRows()).toEqual(["AI/Generated.md (2)", "French.md (3)"]);
  });

  it("follows the decks another device left in the database file", async () => {
    const { plugin, db, panel } = await paintedHarness([deckRow("French.md", 3)]);
    db.onDisk = [deckRow("German.md", 4), deckRow("Italian.md", 1)];

    await DecksPlugin.prototype["checkForDatabaseChanges"].call(plugin, "flashcards.db");

    expect(panel.fileRows()).toEqual(["German.md (4)", "Italian.md (1)"]);
  });
});

describe("DecksView.refreshStats", () => {
  it("sends the panel the deck list the counts belong to", async () => {
    const { db, panel, view } = await paintedHarness([deckRow("French.md", 3)]);
    db.rows = [deckRow("German.md", 4)];

    await view.refreshStats();

    expect(panel.fileRows()).toEqual(["German.md (4)"]);
  });
});
