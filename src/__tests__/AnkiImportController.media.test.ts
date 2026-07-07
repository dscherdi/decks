import { type App, Vault } from "obsidian";
import { AnkiImportController } from "../services/AnkiImportController";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { DeckSynchronizer } from "../services/DeckSynchronizer";
import type { DecksSettings } from "../settings";
import type { Logger } from "../utils/logging";

// copyMedia is private; this narrows it to just the surface the test drives.
interface MediaCopier {
  copyMedia(
    parsed: { mediaFiles: string[] },
    loaded: { mediaByName: Map<string, string>; entries: Record<string, Uint8Array> },
    base: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<number>;
}

function makeController(vault: Vault): MediaCopier {
  const app = { vault } as unknown as App;
  const logger = { debug() {}, error() {} } as unknown as Logger;
  const controller = new AnkiImportController(
    app,
    {} as unknown as IDatabaseService,
    {} as unknown as DeckSynchronizer,
    {} as unknown as DecksSettings,
    logger
  );
  return controller as unknown as MediaCopier;
}

describe("AnkiImportController media copy", () => {
  const TARGET = "Anki Import/media/img.png";

  it("overwrites existing media on re-import (refreshes changed bytes)", async () => {
    const vault = new Vault();
    const copier = makeController(vault);
    const loaded = {
      mediaByName: new Map([["img.png", "0"]]),
      entries: { "0": new Uint8Array([1, 1, 1]) } as Record<string, Uint8Array>,
    };
    const parsed = { mediaFiles: ["img.png"] };

    const first = await copier.copyMedia(parsed, loaded, "Anki Import");
    expect(first).toBe(1);
    expect(Array.from(vault._readBinary(TARGET) ?? [])).toEqual([1, 1, 1]);

    // Re-import with changed bytes under the same filename.
    loaded.entries["0"] = new Uint8Array([2, 2, 2]);
    const second = await copier.copyMedia(parsed, loaded, "Anki Import");
    expect(second).toBe(1);
    expect(Array.from(vault._readBinary(TARGET) ?? [])).toEqual([2, 2, 2]);
    // No duplicate file — the same path was overwritten, not re-created.
    expect(vault.getFiles().filter((f) => f.path === TARGET)).toHaveLength(1);
  });

  it("ensures the shared media folder once regardless of file count", async () => {
    const vault = new Vault();
    let existsCalls = 0;
    let mkdirCalls = 0;
    // Override just the folder ops so the mock's writeBinary still records bytes.
    vault.adapter.exists = async (): Promise<boolean> => {
      existsCalls++;
      return false;
    };
    vault.adapter.mkdir = async (): Promise<void> => {
      mkdirCalls++;
    };
    const copier = makeController(vault);
    const names = ["a.png", "b.png", "c.png", "d.png"];
    const loaded = {
      mediaByName: new Map(names.map((n, i) => [n, String(i)])),
      entries: Object.fromEntries(names.map((n, i) => [String(i), new Uint8Array([i])])) as Record<
        string,
        Uint8Array
      >,
    };

    const copied = await copier.copyMedia({ mediaFiles: names }, loaded, "Anki Import");
    expect(copied).toBe(names.length);
    // All files written.
    for (let i = 0; i < names.length; i++) {
      expect(Array.from(vault._readBinary(`Anki Import/media/${names[i]}`) ?? [])).toEqual([i]);
    }
    // Folder ensured once (2 path segments → 2 checks), not O(files).
    expect(existsCalls).toBe(2);
    expect(mkdirCalls).toBe(2);
  });

  it("reports copy progress, ending at (total, total)", async () => {
    const vault = new Vault();
    const copier = makeController(vault);
    const names = Array.from({ length: 120 }, (_, i) => `f${i}.mp3`);
    const loaded = {
      mediaByName: new Map(names.map((n, i) => [n, String(i)])),
      entries: Object.fromEntries(names.map((n, i) => [String(i), new Uint8Array([i % 7])])) as Record<
        string,
        Uint8Array
      >,
    };
    const calls: Array<[number, number]> = [];
    const copied = await copier.copyMedia({ mediaFiles: names }, loaded, "Anki Import", (done, total) =>
      calls.push([done, total])
    );
    expect(copied).toBe(names.length);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every(([, total]) => total === names.length)).toBe(true);
    const dones = calls.map(([done]) => done);
    expect(dones).toEqual([...dones].sort((a, b) => a - b)); // non-decreasing
    expect(dones[dones.length - 1]).toBe(names.length); // final = total
  });
});
