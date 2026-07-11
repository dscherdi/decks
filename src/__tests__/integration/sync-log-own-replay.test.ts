// Local-durability regression: a suspend/bury emitted just before a hard reload
// must survive even though the lazily-saved binary DB wasn't re-saved. The op
// lives only in this device's OWN sync-log; SyncLog.replayOwnLog() must re-apply
// it on startup (applyPending deliberately skips the own log).

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter } from "./database-test-utils";
import { setupRealSqlJs } from "./setup-real-sql";
import { SyncLog } from "../../services/SyncLog";
import { DeviceLocalState, type LocalStorageLike } from "../../services/DeviceLocalState";
import { Logger } from "../../utils/logging";
import { DEFAULT_PROFILE_ID } from "../../database/types";
import type { Flashcard } from "../../database/types";

class InMemoryStorage implements LocalStorageLike {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) ?? null) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}

function makeLogger(adapter: InMemoryAdapter): Logger {
  return new Logger(
    { debug: { enableLogging: false, performanceLogs: false } } as never,
    adapter,
    ".obsidian",
    "decks"
  );
}

interface Device {
  db: MainDatabaseService;
  log: SyncLog;
}

// A device "session": fresh DB on the given dbPath (loads any existing binary
// from the adapter) + a SyncLog bound to the same device identity (storage).
async function openSession(
  adapter: InMemoryAdapter,
  dbPath: string,
  storage: InMemoryStorage
): Promise<Device> {
  const logger = makeLogger(adapter);
  const db = new MainDatabaseService(dbPath, adapter, logger.debug.bind(logger));
  await db.initialize();
  const log = new SyncLog(adapter, new DeviceLocalState(storage), logger, db);
  db.setSyncLog(log);
  return { db, log };
}

async function seedCard(db: MainDatabaseService, cardId: string): Promise<void> {
  await db.createDeck({
    id: "deck_x",
    name: "X",
    filepath: "/x.md",
    tag: "#flashcards",
    lastReviewed: null,
    profileId: DEFAULT_PROFILE_ID,
  });
  await db.createFlashcard({
    id: cardId,
    deckId: "deck_x",
    front: "Q",
    back: "A",
    type: "header-paragraph",
    sourceFile: "/x.md",
    contentHash: "h",
    breadcrumb: "",
    notes: "",
    tags: [],
    clozeText: null,
    clozeOrder: null,
    state: "new",
    dueDate: "2026-05-10T00:00:00Z",
    interval: 0,
    repetitions: 0,
    difficulty: 5,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
  } as Omit<Flashcard, "created" | "modified">);
}

const DB_PATH = ".obsidian/plugins/decks/decks.db";
const CARD = "card_recover_me";

describe("SyncLog own-log replay (local durability on reload)", () => {
  beforeAll(async () => {
    await setupRealSqlJs();
  });

  it("recovers a suspend that only reached the own log (stale binary)", async () => {
    const adapter = new InMemoryAdapter();
    const storage = new InMemoryStorage();

    // Session 1: seed, save (=stale snapshot WITHOUT the suspend), suspend, flush
    // the log only (no second save — the snapshot is "lost").
    const s1 = await openSession(adapter, DB_PATH, storage);
    await seedCard(s1.db, CARD);
    await s1.db.save();
    await s1.db.suspendCard(CARD);
    await s1.log.flushNow();
    // Abandon the session WITHOUT closing — close() would save() and defeat the
    // "stale binary" premise. This models a hard reload with an unsaved snapshot.

    // Session 2 = hard reload: loads the stale binary; suspend is gone.
    const s2 = await openSession(adapter, DB_PATH, storage);
    expect((await s2.db.getFlashcardById(CARD))?.suspendedAt ?? null).toBeNull();

    // Recovery from the own log.
    await s2.log.replayOwnLog();
    expect((await s2.db.getFlashcardById(CARD))?.suspendedAt).toBeTruthy();
  });

  it("recovers a bury too (not suspend-specific)", async () => {
    const adapter = new InMemoryAdapter();
    const storage = new InMemoryStorage();
    const until = new Date(Date.now() + 86_400_000).toISOString();

    const s1 = await openSession(adapter, DB_PATH, storage);
    await seedCard(s1.db, CARD);
    await s1.db.save();
    await s1.db.buryCard(CARD, until);
    await s1.log.flushNow();
    // Abandon the session WITHOUT closing — close() would save() and defeat the
    // "stale binary" premise. This models a hard reload with an unsaved snapshot.

    const s2 = await openSession(adapter, DB_PATH, storage);
    expect((await s2.db.getFlashcardById(CARD))?.buriedUntil ?? null).toBeNull();
    await s2.log.replayOwnLog();
    expect((await s2.db.getFlashcardById(CARD))?.buriedUntil).toBe(until);
  });

  it("is idempotent — replaying twice leaves the same state", async () => {
    const adapter = new InMemoryAdapter();
    const storage = new InMemoryStorage();

    const s1 = await openSession(adapter, DB_PATH, storage);
    await seedCard(s1.db, CARD);
    await s1.db.save();
    await s1.db.suspendCard(CARD);
    await s1.log.flushNow();
    // Abandon the session WITHOUT closing — close() would save() and defeat the
    // "stale binary" premise. This models a hard reload with an unsaved snapshot.

    const s2 = await openSession(adapter, DB_PATH, storage);
    await s2.log.replayOwnLog();
    const first = (await s2.db.getFlashcardById(CARD))?.suspendedAt;
    expect(first).toBeTruthy();
    await s2.log.replayOwnLog();
    const second = (await s2.db.getFlashcardById(CARD))?.suspendedAt;
    expect(second).toBe(first); // unchanged (guard prevents a redundant modified bump)
  });

  it("is a no-op when the binary already has the op (fresh snapshot)", async () => {
    const adapter = new InMemoryAdapter();
    const storage = new InMemoryStorage();

    const s1 = await openSession(adapter, DB_PATH, storage);
    await seedCard(s1.db, CARD);
    await s1.db.suspendCard(CARD);
    await s1.log.flushNow();
    await s1.db.save(); // fresh snapshot INCLUDING the suspend + advanced watermark
    await s1.db.close();

    const s2 = await openSession(adapter, DB_PATH, storage);
    // Reloaded binary already has the suspend.
    const before = (await s2.db.getFlashcardById(CARD))?.suspendedAt;
    expect(before).toBeTruthy();
    await s2.log.replayOwnLog(); // near no-op, must not throw or change state
    expect((await s2.db.getFlashcardById(CARD))?.suspendedAt).toBe(before);
  });
});
