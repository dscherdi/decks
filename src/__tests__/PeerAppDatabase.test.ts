import type { Stat } from "obsidian";
import { PeerAppDatabase } from "../services/PeerAppDatabase";
import type { PeerDirectoryMergeResult } from "../database/peer-directory";

const PATH = ".decksmd/flashcards.db";

function setup(stats: Array<Stat | null>, results: PeerDirectoryMergeResult[]) {
  const reads: string[] = [];
  const merges: Uint8Array[] = [];
  const adapter = {
    stat: (path: string) => Promise.resolve(stats.shift() ?? null).then((stat) => (path === PATH ? stat : null)),
    readBinary: (path: string) => {
      reads.push(path);
      return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
    },
  };
  const db = {
    mergePeerDirectory: (bytes: Uint8Array) => {
      merges.push(bytes);
      return Promise.resolve(results.shift() ?? { merged: true, changed: false });
    },
  };
  return { peer: new PeerAppDatabase(adapter, db, PATH), reads, merges };
}

const stat = (mtime: number, size = 100): Stat => ({ type: "file", ctime: 0, mtime, size });

describe("PeerAppDatabase", () => {
  it("does nothing when the app has no database in this vault", async () => {
    const { peer, reads } = setup([null], []);
    expect(await peer.mergeIfChanged()).toBe(false);
    expect(reads).toEqual([]);
  });

  it("reads the file once until it changes", async () => {
    const { peer, merges } = setup([stat(1), stat(1), stat(2)], [{ merged: true, changed: true }]);
    expect(await peer.mergeIfChanged()).toBe(true);
    expect(await peer.mergeIfChanged()).toBe(false);
    expect(merges).toHaveLength(1);
    await peer.mergeIfChanged();
    expect(merges).toHaveLength(2);
  });

  it("reads a file again when it could not be merged, even unchanged", async () => {
    const { peer, merges } = setup([stat(1), stat(1)], [{ merged: false, changed: false }, { merged: true, changed: true }]);
    expect(await peer.mergeIfChanged()).toBe(false);
    expect(await peer.mergeIfChanged()).toBe(true);
    expect(merges).toHaveLength(2);
  });
});
