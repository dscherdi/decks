// Tests for BackupService.restoreFromFile — the "pick any .db on disk and
// restore from it" entry point used by the new file-picker UI button. The
// path-less variant: input is raw bytes, output is a fully-restored DB.

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { BackupService } from "../../services/BackupService";
import { InMemoryAdapter } from "./database-test-utils";
import { setupRealSqlJs } from "./setup-real-sql";
import { Logger } from "../../utils/logging";

function makeLogger(adapter: InMemoryAdapter): Logger {
  return new Logger(
    { debug: { enableLogging: false, performanceLogs: false } } as never,
    adapter,
    ".obsidian",
    "decks"
  );
}

async function freshDb(path: string): Promise<{ db: MainDatabaseService; adapter: InMemoryAdapter }> {
  await setupRealSqlJs();
  const adapter = new InMemoryAdapter();
  const logger = makeLogger(adapter);
  const db = new MainDatabaseService(path, adapter, logger.debug.bind(logger));
  await db.initialize();
  return { db, adapter };
}

async function exportDbBytes(db: MainDatabaseService): Promise<Uint8Array> {
  return db.exportDatabaseToBuffer();
}

describe("BackupService.restoreFromFile", () => {
  it("restores raw bytes into a fresh DB (round-trip)", async () => {
    // Source: a DB with one custom profile. (`restoreFromBackupData` deliberately
    // skips the `decks` and `flashcards` tables — those are derived from the
    // markdown vault on next sync. It DOES restore deckprofiles, tag mappings,
    // custom decks, review logs, etc. — the DB-only state worth preserving
    // across a fresh install.)
    const source = await freshDb("/src.db");
    await source.db.createProfile({
      id: "profile_source",
      name: "Source profile",
      hasNewCardsLimitEnabled: true,
      newCardsPerDay: 42,
      hasReviewCardsLimitEnabled: false,
      reviewCardsPerDay: 100,
      headerLevel: 3,
      reviewOrder: "due-date",
      learningSteps: "1m",
      relearningSteps: "10m",
      fsrs: { requestRetention: 0.85, profile: "STANDARD", useTrainedWeights: false },
      clozeEnabled: true,
      clozeShowContext: "hidden",
      isDefault: false,
    });
    const backupBytes = await exportDbBytes(source.db);

    const dest = await freshDb("/dst.db");
    expect(await dest.db.getProfileById("profile_source")).toBeNull();

    const backupService = new BackupService(
      dest.adapter,
      "/unused",
      makeLogger(dest.adapter).debug.bind(makeLogger(dest.adapter))
    );

    await backupService.restoreFromFile(backupBytes, dest.db);

    const restored = await dest.db.getProfileById("profile_source");
    expect(restored).not.toBeNull();
    expect(restored!.name).toBe("Source profile");
    expect(restored!.newCardsPerDay).toBe(42);
  });

  it("accepts ArrayBuffer as well as Uint8Array (mirrors File.arrayBuffer())", async () => {
    const source = await freshDb("/src.db");
    await source.db.createProfile({
      id: "profile_a",
      name: "A",
      hasNewCardsLimitEnabled: false,
      newCardsPerDay: 20,
      hasReviewCardsLimitEnabled: false,
      reviewCardsPerDay: 100,
      headerLevel: 2,
      reviewOrder: "due-date",
      learningSteps: "1m",
      relearningSteps: "10m",
      fsrs: { requestRetention: 0.9, profile: "STANDARD", useTrainedWeights: false },
      clozeEnabled: true,
      clozeShowContext: "hidden",
      isDefault: false,
    });
    const bytes = await exportDbBytes(source.db);
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );

    const dest = await freshDb("/dst.db");
    const backupService = new BackupService(dest.adapter, "/unused", () => undefined);
    await backupService.restoreFromFile(arrayBuffer as ArrayBuffer, dest.db);

    expect((await dest.db.getProfileById("profile_a"))!.name).toBe("A");
  });

  it("rejects non-SQLite buffers with a clear error", async () => {
    const dest = await freshDb("/dst.db");
    const backupService = new BackupService(dest.adapter, "/unused", () => undefined);

    const notADb = new TextEncoder().encode("this is just some text, not a SQLite file at all");
    await expect(backupService.restoreFromFile(notADb, dest.db)).rejects.toThrow(
      /SQLite/i
    );
  });

  it("rejects buffers that are too small to be a SQLite database", async () => {
    const dest = await freshDb("/dst.db");
    const backupService = new BackupService(dest.adapter, "/unused", () => undefined);

    const tooSmall = new Uint8Array(50);
    await expect(backupService.restoreFromFile(tooSmall, dest.db)).rejects.toThrow(
      /too small/i
    );
  });

  it("rejects backups with a future schema version", async () => {
    const source = await freshDb("/src.db");
    const bytes = await exportDbBytes(source.db);

    // Tamper with the user_version (bytes 60–63, big-endian) to claim
    // schema v999 — a version this plugin doesn't know how to handle.
    const tampered = new Uint8Array(bytes);
    const view = new DataView(tampered.buffer);
    view.setUint32(60, 999, false);

    const dest = await freshDb("/dst.db");
    const backupService = new BackupService(dest.adapter, "/unused", () => undefined);

    await expect(backupService.restoreFromFile(tampered, dest.db)).rejects.toThrow(
      /schema v999/
    );
  });

  it("invokes the progress callback with completion", async () => {
    const source = await freshDb("/src.db");
    const bytes = await exportDbBytes(source.db);

    const dest = await freshDb("/dst.db");
    const backupService = new BackupService(dest.adapter, "/unused", () => undefined);

    const progressCalls: Array<[number, number]> = [];
    await backupService.restoreFromFile(bytes, dest.db, (current, total) => {
      progressCalls.push([current, total]);
    });

    expect(progressCalls[0]).toEqual([0, 100]);
    expect(progressCalls[progressCalls.length - 1]).toEqual([100, 100]);
  });
});
