import { TFile } from "../__mocks__/obsidian";
import {
  CanvasFileEventHandlers,
  isInCanvasFolder,
} from "../services/CanvasFileEventHandlers";
import type { DecksSettings } from "../settings";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { DeckSynchronizer } from "../services/DeckSynchronizer";
import type { Deck } from "../database/types";
import type { Logger } from "../utils/logging";

function makeSettings(folderPath: string, tagName = "#decks/canvas"): DecksSettings {
  return {
    canvasDecks: { folderPath, tagName },
  } as unknown as DecksSettings;
}

interface Mocks {
  db: jest.Mocked<IDatabaseService>;
  deckSynchronizer: jest.Mocked<DeckSynchronizer>;
  logger: jest.Mocked<Logger>;
  scheduleDeckSync: jest.Mock<void, [string]>;
  refreshStats: jest.Mock<Promise<void>, []>;
}

function makeMocks(): Mocks {
  const db = {
    getDeckByFilepath: jest.fn(),
    deleteDeckByFilepath: jest.fn().mockResolvedValue(undefined),
    renameDeck: jest.fn().mockResolvedValue(undefined),
    updateFlashcardDeckIds: jest.fn().mockResolvedValue(undefined),
    setDeckLastSyncedMtime: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IDatabaseService>;

  const deckSynchronizer = {
    sync: jest.fn().mockResolvedValue({ totalDecks: 0, totalFlashcards: 0, success: true }),
    syncDeck: jest.fn().mockResolvedValue(undefined),
    createDeckForFile: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<DeckSynchronizer>;

  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    performance: jest.fn(),
  } as unknown as jest.Mocked<Logger>;

  return {
    db,
    deckSynchronizer,
    logger,
    scheduleDeckSync: jest.fn(),
    refreshStats: jest.fn().mockResolvedValue(undefined),
  };
}

function makeHandler(folder: string, mocks?: Mocks) {
  const m = mocks ?? makeMocks();
  const handlers = new CanvasFileEventHandlers({
    settings: makeSettings(folder),
    db: m.db,
    deckSynchronizer: m.deckSynchronizer,
    logger: m.logger,
    scheduleDeckSync: m.scheduleDeckSync,
    refreshStats: m.refreshStats,
  });
  return { handlers, mocks: m };
}

function deckRow(id: string, filepath: string): Deck {
  return {
    id,
    name: filepath.split("/").pop()!.replace(/\.canvas$/, ""),
    filepath,
    tag: "#decks/canvas",
    lastReviewed: null,
    profileId: "profile_default",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
  };
}

describe("isInCanvasFolder", () => {
  it("returns false when folderPath is empty", () => {
    expect(isInCanvasFolder("anywhere/foo.canvas", makeSettings(""))).toBe(false);
  });

  it("returns true for files inside the configured folder", () => {
    expect(isInCanvasFolder("Canvas decks/A.canvas", makeSettings("Canvas decks"))).toBe(true);
    expect(isInCanvasFolder("Canvas decks/sub/B.canvas", makeSettings("Canvas decks"))).toBe(true);
  });

  it("returns false for files outside the configured folder", () => {
    expect(isInCanvasFolder("Other/A.canvas", makeSettings("Canvas decks"))).toBe(false);
  });

  it("tolerates a trailing slash on folderPath", () => {
    expect(isInCanvasFolder("Canvas decks/A.canvas", makeSettings("Canvas decks/"))).toBe(true);
  });
});

describe("CanvasFileEventHandlers.onModified", () => {
  it("schedules a debounced sync for an existing canvas deck", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    mocks.db.getDeckByFilepath.mockResolvedValue(deckRow("deck_abc", "Canvas decks/A.canvas"));
    await handlers.onModified(new TFile("Canvas decks/A.canvas"));
    expect(mocks.scheduleDeckSync).toHaveBeenCalledWith("deck_abc");
    expect(mocks.deckSynchronizer.createDeckForFile).not.toHaveBeenCalled();
  });

  it("creates and syncs the deck when no row exists yet", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    const created = deckRow("deck_new", "Canvas decks/New.canvas");
    mocks.db.getDeckByFilepath
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);
    await handlers.onModified(new TFile("Canvas decks/New.canvas"));
    expect(mocks.deckSynchronizer.createDeckForFile).toHaveBeenCalledWith(
      "Canvas decks/New.canvas",
      "#decks/canvas",
    );
    expect(mocks.deckSynchronizer.syncDeck).toHaveBeenCalledWith("deck_new");
    expect(mocks.refreshStats).toHaveBeenCalled();
  });

  it("no-ops for canvas files outside the configured folder", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    await handlers.onModified(new TFile("Other/X.canvas"));
    expect(mocks.db.getDeckByFilepath).not.toHaveBeenCalled();
    expect(mocks.scheduleDeckSync).not.toHaveBeenCalled();
    expect(mocks.deckSynchronizer.createDeckForFile).not.toHaveBeenCalled();
  });

  it("no-ops when canvas scanning is disabled (empty folder)", async () => {
    const { handlers, mocks } = makeHandler("");
    await handlers.onModified(new TFile("Canvas decks/A.canvas"));
    expect(mocks.db.getDeckByFilepath).not.toHaveBeenCalled();
  });
});

describe("CanvasFileEventHandlers.onCreated", () => {
  it("kicks a full discovery sync when a canvas lands in the folder", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    await handlers.onCreated(new TFile("Canvas decks/A.canvas"));
    expect(mocks.deckSynchronizer.sync).toHaveBeenCalledTimes(1);
    expect(mocks.refreshStats).toHaveBeenCalled();
  });

  it("does nothing when the new canvas is outside the configured folder", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    await handlers.onCreated(new TFile("Other/A.canvas"));
    expect(mocks.deckSynchronizer.sync).not.toHaveBeenCalled();
    expect(mocks.refreshStats).not.toHaveBeenCalled();
  });

  it("does nothing when canvas scanning is disabled", async () => {
    const { handlers, mocks } = makeHandler("");
    await handlers.onCreated(new TFile("Canvas decks/A.canvas"));
    expect(mocks.deckSynchronizer.sync).not.toHaveBeenCalled();
  });
});

describe("CanvasFileEventHandlers.onDeleted", () => {
  it("removes the deck row regardless of current folder scope", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    await handlers.onDeleted("Canvas decks/A.canvas");
    expect(mocks.db.deleteDeckByFilepath).toHaveBeenCalledWith("Canvas decks/A.canvas");
    expect(mocks.refreshStats).toHaveBeenCalled();
  });

  it("does not throw when no matching deck exists", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    mocks.db.deleteDeckByFilepath.mockResolvedValue(undefined);
    await expect(handlers.onDeleted("Canvas decks/missing.canvas")).resolves.toBeUndefined();
  });
});

describe("CanvasFileEventHandlers.onRenamed", () => {
  it("renames the deck for in-scope → in-scope moves", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    const old = deckRow("deck_old", "Canvas decks/Old.canvas");
    mocks.db.getDeckByFilepath.mockResolvedValueOnce(old);

    const newFile = new TFile("Canvas decks/New.canvas");
    await handlers.onRenamed(newFile, "Canvas decks/Old.canvas");

    expect(mocks.db.renameDeck).toHaveBeenCalledWith(
      "deck_old",
      expect.stringMatching(/^deck_/),
      "New",
      "Canvas decks/New.canvas",
    );
    expect(mocks.db.updateFlashcardDeckIds).toHaveBeenCalledWith(
      "deck_old",
      expect.stringMatching(/^deck_/),
    );
    expect(mocks.db.setDeckLastSyncedMtime).toHaveBeenCalledWith(
      expect.stringMatching(/^deck_/),
      0,
    );
    expect(mocks.db.save).toHaveBeenCalled();
    expect(mocks.refreshStats).toHaveBeenCalled();
  });

  it("treats in-scope → out-of-scope as a delete", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    const newFile = new TFile("Other/Moved.canvas");
    await handlers.onRenamed(newFile, "Canvas decks/Was.canvas");

    expect(mocks.db.deleteDeckByFilepath).toHaveBeenCalledWith("Canvas decks/Was.canvas");
    expect(mocks.db.renameDeck).not.toHaveBeenCalled();
    expect(mocks.deckSynchronizer.createDeckForFile).not.toHaveBeenCalled();
  });

  it("treats out-of-scope → in-scope as a create", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    const created = deckRow("deck_new", "Canvas decks/Now.canvas");
    mocks.db.getDeckByFilepath.mockResolvedValueOnce(created);
    const newFile = new TFile("Canvas decks/Now.canvas");
    await handlers.onRenamed(newFile, "Other/WasHere.canvas");

    expect(mocks.deckSynchronizer.createDeckForFile).toHaveBeenCalledWith(
      "Canvas decks/Now.canvas",
      "#decks/canvas",
    );
    expect(mocks.deckSynchronizer.syncDeck).toHaveBeenCalledWith("deck_new");
    expect(mocks.db.renameDeck).not.toHaveBeenCalled();
    expect(mocks.db.deleteDeckByFilepath).not.toHaveBeenCalled();
  });

  it("no-ops for out-of-scope → out-of-scope renames", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    const newFile = new TFile("Other/B.canvas");
    await handlers.onRenamed(newFile, "Other/A.canvas");

    expect(mocks.db.deleteDeckByFilepath).not.toHaveBeenCalled();
    expect(mocks.db.renameDeck).not.toHaveBeenCalled();
    expect(mocks.deckSynchronizer.createDeckForFile).not.toHaveBeenCalled();
    expect(mocks.refreshStats).not.toHaveBeenCalled();
  });

  it("falls back to create when the in-scope rename has no matching deck row", async () => {
    const { handlers, mocks } = makeHandler("Canvas decks");
    mocks.db.getDeckByFilepath
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(deckRow("deck_fresh", "Canvas decks/New.canvas"));
    const newFile = new TFile("Canvas decks/New.canvas");
    await handlers.onRenamed(newFile, "Canvas decks/Old.canvas");

    expect(mocks.deckSynchronizer.createDeckForFile).toHaveBeenCalledWith(
      "Canvas decks/New.canvas",
      "#decks/canvas",
    );
    expect(mocks.deckSynchronizer.syncDeck).toHaveBeenCalledWith("deck_fresh");
    expect(mocks.db.renameDeck).not.toHaveBeenCalled();
  });
});
