// Round-trip integration test for the SyncLog rate op.
//
// Simulates two devices sharing a vault: device A rates a card, the op
// lands in its log file, and device B's applyPending() picks it up and
// applies the same FSRS state to its local DB. Verifies the core
// promise of Day 5 — small log files carry per-card state changes between
// devices without going through the slow binary-DB merge path.

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { DatabaseTestUtils, InMemoryAdapter } from "./database-test-utils";
import { setupRealSqlJs } from "./setup-real-sql";
import { SyncLog } from "../../services/SyncLog";
import {
  DeviceLocalState,
  type LocalStorageLike,
} from "../../services/DeviceLocalState";
import { Logger } from "../../utils/logging";
import { DEFAULT_PROFILE_ID } from "../../database/types";
import type { Flashcard } from "../../database/types";

class InMemoryStorage implements LocalStorageLike {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

interface Device {
  db: MainDatabaseService;
  log: SyncLog;
  state: DeviceLocalState;
}

function makeLogger(adapter: InMemoryAdapter): Logger {
  // Logger constructor signature is verbose; minimal stub is fine here.
  return new Logger(
    { debug: { enableLogging: false, performanceLogs: false } } as never,
    adapter,
    ".obsidian",
    "decks"
  );
}

async function createDevice(
  adapter: InMemoryAdapter,
  dbPath: string,
  storage: InMemoryStorage
): Promise<Device> {
  const logger = makeLogger(adapter);
  const db = new MainDatabaseService(dbPath, adapter, logger.debug.bind(logger));
  await db.initialize();
  const state = new DeviceLocalState(storage);
  const log = new SyncLog(adapter, state, logger, db);
  return { db, log, state };
}

async function seedSharedCard(devices: Device[]): Promise<string> {
  const cardId = "card_shared_q";
  const deckId = "deck_shared";
  const now = "2026-05-10T00:00:00Z";

  for (const dev of devices) {
    await dev.db.createDeck({
      id: deckId,
      name: "Shared",
      filepath: "/shared.md",
      tag: "#flashcards",
      lastReviewed: null,
      profileId: DEFAULT_PROFILE_ID,
    });
    await dev.db.createFlashcard({
      id: cardId,
      deckId,
      front: "Q",
      back: "A",
      type: "header-paragraph",
      sourceFile: "/shared.md",
      contentHash: "h",
      breadcrumb: "",
      notes: "",
      tags: [],
      clozeText: null,
      clozeOrder: null,
      state: "new",
      dueDate: now,
      interval: 0,
      repetitions: 0,
      difficulty: 5,
      stability: 0,
      lapses: 0,
      lastReviewed: null,
    } as Omit<Flashcard, "created" | "modified">);
  }
  return cardId;
}

describe("SyncLog round-trip", () => {
  beforeAll(async () => {
    await setupRealSqlJs();
  });

  // Each test constructs its own InMemoryAdapter + DBs, so nothing global
  // needs tearing down between tests.

  it(
    "rate op on device A is applied to device B's DB via sync log",
    async () => {
      // Both devices share the same adapter (their vault); they each
      // have their own DB file and their own deviceId state.
      const sharedAdapter = new InMemoryAdapter();
      const deviceA = await createDevice(
        sharedAdapter,
        "/dba.db",
        new InMemoryStorage()
      );
      const deviceB = await createDevice(
        sharedAdapter,
        "/dbb.db",
        new InMemoryStorage()
      );
      expect(deviceA.state.getDeviceId()).not.toBe(deviceB.state.getDeviceId());

      const cardId = await seedSharedCard([deviceA, deviceB]);

      // Device A simulates a `rate` op (Scheduler-style): updates the local
      // card, inserts the review log row, then emits a sync-log op.
      const reviewedAt = "2030-05-11T12:00:00Z";
      const logId = "log_test_1";
      await deviceA.db.updateFlashcard(cardId, {
        state: "review",
        stability: 4.2,
        difficulty: 5.1,
        dueDate: "2026-05-20T00:00:00Z",
        repetitions: 1,
        lapses: 0,
        lastReviewed: reviewedAt,
        interval: 1440,
      });
      await deviceA.db.insertReviewLog({
        id: logId,
        flashcardId: cardId,
        sessionId: undefined,
        lastReviewedAt: "2026-05-10T00:00:00Z",
        shownAt: undefined,
        reviewedAt,
        rating: 3,
        ratingLabel: "good",
        timeElapsedMs: 1500,
        oldState: "new",
        oldRepetitions: 0,
        oldLapses: 0,
        oldStability: 0,
        oldDifficulty: 5,
        newState: "review",
        newRepetitions: 1,
        newLapses: 0,
        newStability: 4.2,
        newDifficulty: 5.1,
        oldIntervalMinutes: 0,
        newIntervalMinutes: 1440,
        oldDueAt: "2026-05-10T00:00:00Z",
        newDueAt: "2026-05-20T00:00:00Z",
        elapsedDays: 1,
        retrievability: 0.9,
        requestRetention: 0.9,
        profile: "STANDARD",
        maximumIntervalDays: 36500,
        minMinutes: 1,
        fsrsWeightsVersion: "1.0",
        schedulerVersion: "1.0",
      });
      deviceA.log.append({
        o: "rate",
        p: {
          c: cardId,
          st: 4.2,
          d: 5.1,
          due: "2026-05-20T00:00:00Z",
          rep: 1,
          lap: 0,
          state: "review",
          lastReviewed: reviewedAt,
          interval: 1440,
          log: {
            id: logId,
            flashcardId: cardId,
            sessionId: null,
            lastReviewedAt: "2026-05-10T00:00:00Z",
            shownAt: null,
            reviewedAt,
            rating: 3,
            ratingLabel: "good",
            timeElapsedMs: 1500,
            oldState: "new",
            oldRepetitions: 0,
            oldLapses: 0,
            oldStability: 0,
            oldDifficulty: 5,
            newState: "review",
            newRepetitions: 1,
            newLapses: 0,
            newStability: 4.2,
            newDifficulty: 5.1,
            oldIntervalMinutes: 0,
            newIntervalMinutes: 1440,
            oldDueAt: "2026-05-10T00:00:00Z",
            newDueAt: "2026-05-20T00:00:00Z",
            elapsedDays: 1,
            retrievability: 0.9,
            requestRetention: 0.9,
            profile: "STANDARD",
            maximumIntervalDays: 36500,
            minMinutes: 1,
            fsrsWeightsVersion: "1.0",
            schedulerVersion: "1.0",
            noteModelId: null,
            cardTemplateId: null,
            contentHash: null,
            client: null,
          },
        },
      });
      // Force the buffered op to the shared "vault" so device B can see it.
      await deviceA.log.flushNow();

      // Sanity check: the log file exists on the shared adapter and contains
      // one JSONL line.
      const logPath = deviceA.log.ownLogPath;
      const logContent = await sharedAdapter.read(logPath);
      expect(logContent.split("\n").filter(Boolean)).toHaveLength(1);

      // Device B's local card is still in the pre-review state.
      const beforeB = await deviceB.db.getFlashcardById(cardId);
      expect(beforeB?.state).toBe("new");
      expect(beforeB?.stability).toBe(0);

      // Device B applies pending ops from device A's log.
      await deviceB.log.applyPending();

      // Device B's card now reflects device A's review.
      const afterB = await deviceB.db.getFlashcardById(cardId);
      expect(afterB?.state).toBe("review");
      expect(afterB?.stability).toBeCloseTo(4.2);
      expect(afterB?.difficulty).toBeCloseTo(5.1);
      expect(afterB?.dueDate).toBe("2026-05-20T00:00:00Z");

      // Device B's review_logs table has the row from device A.
      const logRow = await deviceB.db.getLatestReviewLogForFlashcard(cardId);
      expect(logRow?.id).toBe(logId);
      expect(logRow?.ratingLabel).toBe("good");

      // Device B's journal_state advanced past seq 100 (device A's first
      // op got the post-skip-ahead seq).
      const state = await deviceB.db.getJournalState();
      expect(state).toHaveLength(1);
      expect(state[0].sourceDeviceId).toBe(deviceA.state.getDeviceId());
      expect(state[0].lastAppliedSeq).toBeGreaterThanOrEqual(100);

      // Replaying applyPending is a no-op (idempotency).
      const insertCountBefore = (await deviceB.db.querySql<{ c: number }>(
        "SELECT COUNT(*) as c FROM review_logs WHERE id = ?",
        [logId],
        { asObject: true }
      ))[0].c;
      await deviceB.log.applyPending();
      const insertCountAfter = (await deviceB.db.querySql<{ c: number }>(
        "SELECT COUNT(*) as c FROM review_logs WHERE id = ?",
        [logId],
        { asObject: true }
      ))[0].c;
      expect(insertCountAfter).toBe(insertCountBefore);
    },
    20000
  );
});
