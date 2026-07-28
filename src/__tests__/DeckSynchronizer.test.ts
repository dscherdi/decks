import { DeckSynchronizer } from "../services/DeckSynchronizer";
import type { DeckManager } from "../services/DeckManager";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { DecksSettings } from "../settings";
import type { DataAdapter } from "obsidian";

// Minimal settings: logging/notices disabled so the synchronizer's Logger and
// ProgressTracker stay quiet and don't touch the (absent) adapter.
const settings = {
  debug: { enableLogging: false, performanceLogs: false },
  ui: { enableNotices: false },
} as unknown as DecksSettings;

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("DeckSynchronizer concurrency", () => {
  it("coalesces overlapping sync() calls instead of throwing", async () => {
    let syncDecksCalls = 0;
    const gate = deferred<void>();

    const deckManager = {
      // First call blocks on the gate so we can fire overlapping callers;
      // later calls resolve immediately.
      syncDecks: jest.fn(async () => {
        syncDecksCalls += 1;
        if (syncDecksCalls === 1) await gate.promise;
      }),
      syncFlashcardsForDeck: jest.fn(async () => undefined),
      getStaleDeckIds: jest.fn(async () => new Set<string>()),
    } as unknown as DeckManager;

    const db = {
      getAllDecks: jest.fn(async () => []),
      countTotalCards: jest.fn(async () => 0),
      countAllCards: jest.fn(async () => 0),
      isDirty: jest.fn(() => false),
      save: jest.fn(async () => undefined),
    } as unknown as IDatabaseService;

    const sync = new DeckSynchronizer(
      db,
      deckManager,
      settings,
      undefined as unknown as DataAdapter,
      ""
    );

    // Start the first run (blocked), then fire two more while it's in flight.
    const first = sync.sync();
    const second = sync.sync();
    const third = sync.sync();

    // Release the first run; everything resolves without throwing.
    gate.resolve();
    const results = await Promise.all([first, second, third]);
    for (const r of results) expect(r.success).toBe(true);

    // First run + one coalesced trailing run = exactly two scans.
    expect(syncDecksCalls).toBe(2);
  });

  it("runs a fresh sync once the previous one has finished", async () => {
    const deckManager = {
      syncDecks: jest.fn(async () => undefined),
      syncFlashcardsForDeck: jest.fn(async () => undefined),
      getStaleDeckIds: jest.fn(async () => new Set<string>()),
    } as unknown as DeckManager;
    const db = {
      getAllDecks: jest.fn(async () => []),
      countTotalCards: jest.fn(async () => 0),
      countAllCards: jest.fn(async () => 0),
      isDirty: jest.fn(() => false),
      save: jest.fn(async () => undefined),
    } as unknown as IDatabaseService;

    const sync = new DeckSynchronizer(
      db,
      deckManager,
      settings,
      undefined as unknown as DataAdapter,
      ""
    );

    await sync.sync();
    await sync.sync();
    expect((deckManager.syncDecks as jest.Mock).mock.calls).toHaveLength(2);
  });
});

describe("DeckSynchronizer incremental work", () => {
  const decks = [
    { id: "d1", name: "Deck 1", filepath: "a.md" },
    { id: "d2", name: "Deck 2", filepath: "b.md" },
  ];

  function build(staleIds: string[], dirty: boolean) {
    const deckManager = {
      syncDecks: jest.fn(async () => undefined),
      syncFlashcardsForDeck: jest.fn(async () => undefined),
      getStaleDeckIds: jest.fn(async () => new Set(staleIds)),
    } as unknown as DeckManager;
    const db = {
      getAllDecks: jest.fn(async () => decks),
      countTotalCards: jest.fn(async () => 0),
      countAllCards: jest.fn(async () => 7),
      isDirty: jest.fn(() => dirty),
      save: jest.fn(async () => undefined),
    } as unknown as IDatabaseService;
    const sync = new DeckSynchronizer(
      db,
      deckManager,
      settings,
      undefined as unknown as DataAdapter,
      ""
    );
    return { sync, deckManager, db };
  }

  it("only syncs stale decks and never per-deck counts", async () => {
    const { sync, deckManager, db } = build(["d2"], true);
    await sync.sync();
    expect((deckManager.syncFlashcardsForDeck as jest.Mock).mock.calls).toHaveLength(1);
    expect((deckManager.syncFlashcardsForDeck as jest.Mock).mock.calls[0][0]).toBe("d2");
    // Per-deck counting is gone; only the single aggregate is used.
    expect(db.countTotalCards).not.toHaveBeenCalled();
    expect(db.countAllCards).toHaveBeenCalledTimes(1);
  });

  it("skips save when nothing changed (DB not dirty)", async () => {
    const { sync, deckManager, db } = build([], false);
    await sync.sync();
    expect(deckManager.syncFlashcardsForDeck).not.toHaveBeenCalled();
    expect(db.save).not.toHaveBeenCalled();
    // No decks synced → aggregate count skipped too.
    expect(db.countAllCards).not.toHaveBeenCalled();
  });

  it("saves when the DB is dirty after syncing a stale deck", async () => {
    const { sync, db } = build(["d1"], true);
    await sync.sync();
    expect(db.save).toHaveBeenCalledTimes(1);
  });

  it("force syncs every deck regardless of staleness", async () => {
    const { sync, deckManager } = build([], true);
    await sync.sync({ force: true });
    expect((deckManager.syncFlashcardsForDeck as jest.Mock).mock.calls).toHaveLength(2);
    // getStaleDeckIds is bypassed on force.
    expect(deckManager.getStaleDeckIds).not.toHaveBeenCalled();
  });
});
