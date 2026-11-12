import { SyncLog } from "../services/SyncLog";
import { DeviceLocalState, type LocalStorageLike } from "../services/DeviceLocalState";
import type { Logger } from "../utils/logging";
import type { VaultLocalStorage } from "../utils/device-marks";
import type { JournalStateRow } from "@decks/core";

const OTHER = "mac-aaaaaaaaaaaa";
const OTHER_LOG = `${OTHER}.deckssynclog`;

class DeviceStorage implements LocalStorageLike {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

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

class FakeAdapter {
  private files = new Map<string, { text: string; mtime: number }>();
  private clock = 1000;
  reads: string[] = [];

  put(path: string, text: string): void {
    this.clock += 1000;
    this.files.set(path, { text, mtime: this.clock });
  }
  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }
  async stat(path: string): Promise<{ type: "file"; ctime: number; mtime: number; size: number } | null> {
    const file = this.files.get(path);
    return file ? { type: "file", ctime: 0, mtime: file.mtime, size: file.text.length } : null;
  }
  async read(path: string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw new Error(`not found: ${path}`);
    this.reads.push(path);
    return file.text;
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

class FakeDb {
  journal = new Map<string, JournalStateRow>();
  async executeSql(): Promise<void> {}
  async getJournalState(): Promise<JournalStateRow[]> {
    return [...this.journal.values()];
  }
  async upsertJournalState(row: JournalStateRow): Promise<void> {
    this.journal.set(row.sourceDeviceId, row);
  }
}

function line(seq: number, op = "client_hello"): string {
  return JSON.stringify({ hlc: [seq, 0, OTHER], s: seq, v: 1, o: op, p: { identity: 4 } }) + "\n";
}

function makeLogger(): Logger {
  return { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() } as unknown as Logger;
}

function session(adapter: FakeAdapter, db: FakeDb, marks: VaultLocalStorage | null): SyncLog {
  const state = new DeviceLocalState(new DeviceStorage());
  return new SyncLog(adapter as never, state, makeLogger(), db as never, "", marks);
}

describe("SyncLog read marks", () => {
  let adapter: FakeAdapter;
  let db: FakeDb;
  let marks: VaultStorage;

  beforeEach(() => {
    adapter = new FakeAdapter();
    db = new FakeDb();
    marks = new VaultStorage();
    adapter.put(OTHER_LOG, line(1) + line(2));
  });

  it("reads another device's log once while it stays as it is", async () => {
    const log = session(adapter, db, marks);
    await log.applyPending();
    await log.applyPending();
    expect(adapter.reads).toEqual([OTHER_LOG]);
    expect(db.journal.get(OTHER)?.lastAppliedSeq).toBe(2);
  });

  it("does not read an unchanged log in the next session either", async () => {
    await session(adapter, db, marks).applyPending();
    await session(adapter, db, marks).applyPending();
    expect(adapter.reads).toHaveLength(1);
  });

  it("reads the log again once it has grown and applies the new lines", async () => {
    const log = session(adapter, db, marks);
    await log.applyPending();
    adapter.put(OTHER_LOG, line(1) + line(2) + line(3));
    await log.applyPending();
    expect(adapter.reads).toHaveLength(2);
    expect(db.journal.get(OTHER)?.lastAppliedSeq).toBe(3);
  });

  it("reads an unchanged log again when the database is behind it", async () => {
    await session(adapter, db, marks).applyPending();
    // A database loaded from an older file has not applied these lines yet.
    db.journal.clear();
    await session(adapter, db, marks).applyPending();
    expect(adapter.reads).toHaveLength(2);
    expect(db.journal.get(OTHER)?.lastAppliedSeq).toBe(2);
  });

  it("keeps reading a log that ends in an op this version cannot apply", async () => {
    adapter.put(OTHER_LOG, line(1) + line(2, "op_from_a_newer_version"));
    const log = session(adapter, db, marks);
    await log.applyPending();
    await log.applyPending();
    expect(adapter.reads).toHaveLength(2);
    expect(db.journal.get(OTHER)?.lastAppliedSeq).toBe(1);
  });

  it("keeps reading a log with a line that does not parse", async () => {
    adapter.put(OTHER_LOG, line(1) + '{"hlc":[2,0,"mac-aaaaaaaaaaaa"],"s":2,"v":1,"o":"client_he');
    const log = session(adapter, db, marks);
    await log.applyPending();
    await log.applyPending();
    expect(adapter.reads).toHaveLength(2);
  });

  it("reads every time when it has nowhere to keep marks", async () => {
    const log = session(adapter, db, null);
    await log.applyPending();
    await log.applyPending();
    expect(adapter.reads).toHaveLength(2);
  });

  it("parses only the lines it has not applied", async () => {
    await session(adapter, db, marks).applyPending();
    adapter.put(OTHER_LOG, line(1) + line(2) + line(3));
    const parse = jest.spyOn(JSON, "parse");
    try {
      await session(adapter, db, marks).applyPending();
      const parsedLines = parse.mock.calls.filter(([text]) => text.startsWith('{"hlc"'));
      expect(parsedLines).toHaveLength(1);
    } finally {
      parse.mockRestore();
    }
    expect(db.journal.get(OTHER)?.lastAppliedSeq).toBe(3);
  });

  it("still applies a line whose fields come in another order", async () => {
    const reordered = JSON.stringify({ s: 3, v: 1, o: "client_hello", p: { identity: 4 }, hlc: [3, 0, OTHER] });
    adapter.put(OTHER_LOG, line(1) + line(2) + reordered + "\n");
    await session(adapter, db, marks).applyPending();
    expect(db.journal.get(OTHER)?.lastAppliedSeq).toBe(3);
  });
});
