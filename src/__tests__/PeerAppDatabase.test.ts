import type { Stat } from "obsidian";
import type { DirectoryDeckRecord } from "@decks/core";
import { PeerAppDatabase } from "../services/PeerAppDatabase";
import type { PeerDirectoryMergeResult } from "../database/peer-directory";
import type { VaultLocalStorage } from "../utils/device-marks";

const PATH = ".decksmd/flashcards.db";

class VaultStorage implements VaultLocalStorage {
  private store = new Map<string, string>();
  loadLocalStorage(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  saveLocalStorage(key: string, data: string | null): void {
    if (data === null) this.store.delete(key);
    else this.store.set(key, data);
  }
}

function deck(id: string, modified: string): DirectoryDeckRecord {
  return {
    id,
    publisher: "decksmd",
    slug: id,
    version: 1,
    title: id,
    description: "",
    manifestJson: "{}",
    archiveSha256: "",
    fileTagsByKey: {},
    importedAt: modified,
    modified,
    removedAt: null,
  };
}

interface World {
  file: Stat | null;
  held: DirectoryDeckRecord[];
  storage: VaultStorage;
  reads: number;
  merges: Uint8Array[];
  messages: string[];
  merge: (bytes: Uint8Array) => Promise<PeerDirectoryMergeResult>;
}

function world(): World {
  return {
    file: stat(1),
    held: [],
    storage: new VaultStorage(),
    reads: 0,
    merges: [],
    messages: [],
    merge: () => Promise.resolve({ merged: true, changed: false }),
  };
}

/** A fresh instance over the same files and storage, as after a restart. */
function session(w: World): PeerAppDatabase {
  const adapter = {
    stat: (path: string) => Promise.resolve(path === PATH ? w.file : null),
    readBinary: () => {
      w.reads += 1;
      return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
    },
  };
  const db = {
    mergePeerDirectory: (bytes: Uint8Array) => {
      w.merges.push(bytes);
      return w.merge(bytes);
    },
    listDirectoryDecks: () => Promise.resolve(w.held),
  };
  return new PeerAppDatabase(adapter, db, PATH, w.storage, (message) => w.messages.push(message));
}

const stat = (mtime: number, size = 100): Stat => ({ type: "file", ctime: 0, mtime, size });

/** Lets a merge that will never finish get as far as it can. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("PeerAppDatabase", () => {
  it("does nothing when the app has no database in this vault", async () => {
    const w = world();
    w.file = null;
    expect(await session(w).mergeIfChanged()).toBe(false);
    expect(w.reads).toBe(0);
  });

  it("reads the file once until it changes", async () => {
    const w = world();
    w.merge = () => Promise.resolve({ merged: true, changed: true });
    const peer = session(w);
    expect(await peer.mergeIfChanged()).toBe(true);
    expect(await peer.mergeIfChanged()).toBe(false);
    expect(w.merges).toHaveLength(1);
    w.file = stat(2);
    await peer.mergeIfChanged();
    expect(w.merges).toHaveLength(2);
  });

  it("reads a file again when it could not be merged, even unchanged", async () => {
    const w = world();
    const results: PeerDirectoryMergeResult[] = [
      { merged: false, changed: false },
      { merged: true, changed: true },
    ];
    w.merge = () => Promise.resolve(results.shift() ?? { merged: true, changed: false });
    const peer = session(w);
    expect(await peer.mergeIfChanged()).toBe(false);
    expect(await peer.mergeIfChanged()).toBe(true);
    expect(w.merges).toHaveLength(2);
  });

  it("does not read a merged version again after a restart", async () => {
    const w = world();
    w.held = [deck("german-a1", "2026-11-01")];
    await session(w).mergeIfChanged();
    expect(await session(w).mergeIfChanged()).toBe(false);
    expect(w.reads).toBe(1);
  });

  it("reads the same version again when the database here no longer holds the same decks", async () => {
    const w = world();
    w.held = [deck("german-a1", "2026-11-01"), deck("french-a1", "2026-11-09")];
    await session(w).mergeIfChanged();
    // A restored backup or an older copy of the database file.
    w.held = [deck("german-a1", "2026-11-01")];
    await session(w).mergeIfChanged();
    expect(w.reads).toBe(2);
  });

  it("reads again after a restart when the merge brought decks that were never saved", async () => {
    const w = world();
    w.merge = () => {
      w.held = [deck("french-a1", "2026-11-09")];
      return Promise.resolve({ merged: true, changed: true });
    };
    await session(w).mergeIfChanged();
    w.held = [];
    await session(w).mergeIfChanged();
    expect(w.reads).toBe(2);
  });

  it("leaves a version alone once two sessions ended in the middle of merging it", async () => {
    const w = world();
    w.merge = () => new Promise<PeerDirectoryMergeResult>(() => {});
    void session(w).mergeIfChanged();
    await settle();
    void session(w).mergeIfChanged();
    await settle();
    expect(w.reads).toBe(2);

    const third = session(w);
    expect(await third.mergeIfChanged()).toBe(false);
    expect(await third.mergeIfChanged()).toBe(false);
    expect(w.reads).toBe(2);
    expect(w.messages).toHaveLength(1);
  });

  it("tries again when the file changes after being left alone", async () => {
    const w = world();
    w.merge = () => new Promise<PeerDirectoryMergeResult>(() => {});
    void session(w).mergeIfChanged();
    await settle();
    void session(w).mergeIfChanged();
    await settle();

    w.file = stat(2);
    w.merge = () => Promise.resolve({ merged: true, changed: true });
    expect(await session(w).mergeIfChanged()).toBe(true);
    expect(w.reads).toBe(3);
  });

  it("does not count a merge that failed with an error as cut off", async () => {
    const w = world();
    w.merge = () => Promise.reject(new Error("worker error"));
    for (let i = 0; i < 3; i++) {
      await expect(session(w).mergeIfChanged()).rejects.toThrow("worker error");
    }
    expect(w.reads).toBe(3);
  });
});
