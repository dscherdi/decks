import {
  recoverInterruptedWrite,
  writeBinaryAtomic,
  writingPathFor,
  type AtomicWriteAdapter,
} from "@/database/atomic-write";

const DB = "plugins/decks/flashcards.db";
const TMP = writingPathFor(DB);

/** In-memory adapter that can be told to fail partway through a write. */
class FakeAdapter implements AtomicWriteAdapter {
  files = new Map<string, number>();
  renameOverwrites = true;
  /** Truncate every write to this many bytes, imitating an interrupted write. */
  truncateTo: number | null = null;
  /** Throw after writing, imitating a crash mid-save. */
  throwOnWrite = false;
  renameClearsDestinationFirst = false;
  /** Each write takes a turn of the event loop and is short until it ends, as a large one is. */
  slowWrites = false;

  constructor(seed: Record<string, number> = {}) {
    for (const [p, size] of Object.entries(seed)) this.files.set(p, size);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    if (this.slowWrites) {
      this.files.set(path, Math.floor(data.byteLength / 2));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const size = this.truncateTo ?? data.byteLength;
    this.files.set(path, size);
    if (this.throwOnWrite) throw new Error("interrupted");
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async rename(from: string, to: string): Promise<void> {
    if (!this.renameOverwrites && this.files.has(to)) {
      throw new Error("EEXIST: destination exists");
    }
    // The phone clears the destination before it looks for the source.
    if (this.renameClearsDestinationFirst) this.files.delete(to);
    const size = this.files.get(from);
    if (size === undefined) throw new Error("ENOENT");
    this.files.delete(from);
    this.files.set(to, size);
  }
  async stat(path: string): Promise<{ size?: number } | null> {
    const size = this.files.get(path);
    return size === undefined ? null : { size };
  }
}

const payload = (bytes: number) => new ArrayBuffer(bytes);

describe("saving the database cannot destroy it", () => {
  it("replaces the destination only once the new file is complete", async () => {
    const a = new FakeAdapter({ [DB]: 6_000_000 });
    await writeBinaryAtomic(a, DB, payload(11_788_288));

    expect(a.files.get(DB)).toBe(11_788_288);
    expect(a.files.has(TMP)).toBe(false);
  });

  // The failure that cost a user their vault: an 11 MB write cut short at 6 MiB
  // left the live database truncated, with the header still claiming 2,878 pages.
  it("leaves the existing database untouched when the write is short", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    a.truncateTo = 6_291_456;

    await expect(writeBinaryAtomic(a, DB, payload(11_788_288))).rejects.toThrow(
      /wrote 6291456 of 11788288/,
    );

    // The point of the whole exercise: the old database is still whole.
    expect(a.files.get(DB)).toBe(11_788_288);
    // And the partial file is not left lying around to be adopted later.
    expect(a.files.has(TMP)).toBe(false);
  });

  it("never writes through the destination path itself", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    const written: string[] = [];
    const spy = a.writeBinary.bind(a);
    a.writeBinary = async (path, data) => {
      written.push(path);
      return spy(path, data);
    };

    await writeBinaryAtomic(a, DB, payload(500));
    expect(written).toEqual([TMP]);
  });

  it("still succeeds where rename refuses to overwrite", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    a.renameOverwrites = false;

    await writeBinaryAtomic(a, DB, payload(12_000_000));
    expect(a.files.get(DB)).toBe(12_000_000);
    expect(a.files.has(TMP)).toBe(false);
  });

  it("creates the file when there is nothing to replace", async () => {
    const a = new FakeAdapter();
    await writeBinaryAtomic(a, DB, payload(4096));
    expect(a.files.get(DB)).toBe(4096);
  });
});

describe("recovering a write that was interrupted", () => {
  // Dying between the remove and the rename is the one window the swap leaves.
  // The temporary file is then the only complete copy, so it must be adopted —
  // otherwise startup sees no database and cheerfully creates an empty one.
  it("promotes the temporary file when the database is missing", async () => {
    const a = new FakeAdapter({ [TMP]: 11_788_288 });

    await expect(recoverInterruptedWrite(a, DB)).resolves.toBe(true);
    expect(a.files.get(DB)).toBe(11_788_288);
    expect(a.files.has(TMP)).toBe(false);
  });

  // A leftover temp next to an intact database is debris from a failed save,
  // and is older than what is live. Adopting it would roll the user back.
  it("discards the temporary file when the database is present", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288, [TMP]: 6_291_456 });

    await expect(recoverInterruptedWrite(a, DB)).resolves.toBe(false);
    expect(a.files.get(DB)).toBe(11_788_288);
    expect(a.files.has(TMP)).toBe(false);
  });

  it("does nothing when there is no temporary file", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    await expect(recoverInterruptedWrite(a, DB)).resolves.toBe(false);
    expect(a.files.get(DB)).toBe(11_788_288);
  });
});

// Adapters are not required to report a size. Refusing to save on that would
// break persistence entirely on any platform whose stat is unhelpful, which is
// worse than the truncation it guards against.
describe("adapters that cannot report a size", () => {
  it("saves anyway when stat reports zero", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    a.stat = async () => ({ size: 0 });

    await writeBinaryAtomic(a, DB, payload(12_000_000));
    expect(a.files.get(DB)).toBe(12_000_000);
  });

  it("saves anyway when stat returns nothing", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    a.stat = async () => null;

    await writeBinaryAtomic(a, DB, payload(12_000_000));
    expect(a.files.get(DB)).toBe(12_000_000);
  });

  it("saves anyway when stat throws", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    a.stat = async () => {
      throw new Error("stat unsupported");
    };

    await writeBinaryAtomic(a, DB, payload(12_000_000));
    expect(a.files.get(DB)).toBe(12_000_000);
  });
});

// Two saves started together shared one temporary file. The slower one found it
// gone and removed the database it was meant to replace.
describe("two saves at once", () => {
  it("keeps the database when the saves overlap", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });

    const results = await Promise.allSettled([
      writeBinaryAtomic(a, DB, payload(12_000_000)),
      writeBinaryAtomic(a, DB, payload(12_000_100)),
    ]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(a.files.get(DB)).toBe(12_000_100);
    expect(a.files.has(TMP)).toBe(false);
  });

  it("keeps the database on a platform whose rename clears the destination first", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    a.renameClearsDestinationFirst = true;

    await Promise.allSettled([
      writeBinaryAtomic(a, DB, payload(12_000_000)),
      writeBinaryAtomic(a, DB, payload(12_000_100)),
    ]);

    expect(a.files.get(DB)).toBe(12_000_100);
  });

  it("does not take a half-written file of the other save for a short write", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    a.slowWrites = true;

    const results = await Promise.allSettled([
      writeBinaryAtomic(a, DB, payload(12_000_000)),
      writeBinaryAtomic(a, DB, payload(12_000_100)),
    ]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(a.files.get(DB)).toBe(12_000_100);
  });

  it("runs the next save after one that failed", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    a.truncateTo = 6_291_456;
    const failing = writeBinaryAtomic(a, DB, payload(12_000_000));
    const following = failing.catch(() => {
      a.truncateTo = null;
      return writeBinaryAtomic(a, DB, payload(12_000_100));
    });

    await expect(failing).rejects.toThrow(/wrote 6291456/);
    await following;
    expect(a.files.get(DB)).toBe(12_000_100);
  });
});

describe("a temporary file that is gone", () => {
  it("fails the save and leaves the database alone", async () => {
    const a = new FakeAdapter({ [DB]: 11_788_288 });
    a.renameClearsDestinationFirst = true;
    const write = a.writeBinary.bind(a);
    a.writeBinary = async (path, data) => {
      await write(path, data);
      a.files.delete(path);
    };
    a.stat = async () => null;

    await expect(writeBinaryAtomic(a, DB, payload(12_000_000))).rejects.toThrow(/temporary file is gone/);
    expect(a.files.get(DB)).toBe(11_788_288);
  });
});
