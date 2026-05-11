import { SyncLog } from "../services/SyncLog";
import {
  DeviceLocalState,
  type LocalStorageLike,
} from "../services/DeviceLocalState";
import type { Logger } from "../utils/logging";
import type { SyncOpV1 } from "../services/SyncLog.types";

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

class FakeAdapter {
  files = new Map<string, string>();
  appendCount = 0;
  failNext = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async append(path: string, data: string, _options?: unknown): Promise<void> {
    this.appendCount += 1;
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("simulated adapter.append failure");
    }
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }
}

function makeLogger(): Logger {
  // Minimal Logger surface used by SyncLog. The real class also takes
  // settings/adapter; for unit testing we only need the methods called.
  return {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  } as unknown as Logger;
}

function makeSyncLog(adapter: FakeAdapter): {
  log: SyncLog;
  state: DeviceLocalState;
  adapter: FakeAdapter;
} {
  const storage = new InMemoryStorage();
  const state = new DeviceLocalState(storage);
  // FakeAdapter implements just the subset of DataAdapter SyncLog uses.
  const log = new SyncLog(adapter as never, state, makeLogger());
  return { log, state, adapter };
}

// A sample op shape we can stuff into append() in tests without needing the
// full FSRS payload.
function sampleOp(cardId: string): SyncOpV1 {
  return {
    o: "rate",
    p: {
      c: cardId,
      st: 1,
      d: 5,
      due: "2026-05-12T00:00:00Z",
      rep: 1,
      lap: 0,
      state: "review",
      lastReviewed: "2026-05-11T00:00:00Z",
      interval: 1440,
      log: {
        id: `log_${cardId}`,
        flashcardId: cardId,
        sessionId: null,
        lastReviewedAt: "2026-05-11T00:00:00Z",
        shownAt: null,
        reviewedAt: "2026-05-11T00:00:00Z",
        rating: 3,
        ratingLabel: "good",
        timeElapsedMs: 1000,
        oldState: "new",
        oldRepetitions: 0,
        oldLapses: 0,
        oldStability: 0,
        oldDifficulty: 5,
        newState: "review",
        newRepetitions: 1,
        newLapses: 0,
        newStability: 1,
        newDifficulty: 5,
        oldIntervalMinutes: 0,
        newIntervalMinutes: 1440,
        oldDueAt: "2026-05-11T00:00:00Z",
        newDueAt: "2026-05-12T00:00:00Z",
        elapsedDays: 0,
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
  };
}

describe("SyncLog", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe("append + debounced flush", () => {
    it("buffers ops without writing to disk synchronously", () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);

      log.append(sampleOp("card_a"));
      log.append(sampleOp("card_b"));

      expect(adapter.appendCount).toBe(0);
      expect(log.bufferLengthForTests()).toBe(2);
    });

    it("flushes after the 2s debounce window", async () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);

      log.append(sampleOp("card_a"));
      jest.advanceTimersByTime(1999);
      expect(adapter.appendCount).toBe(0);

      jest.advanceTimersByTime(2);
      // Resolve the microtask queue so the awaited adapter.append() lands.
      await Promise.resolve();
      await Promise.resolve();

      expect(adapter.appendCount).toBe(1);
      expect(log.bufferLengthForTests()).toBe(0);
    });

    it("coalesces multiple appends within the window into one flush", async () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);

      for (let i = 0; i < 5; i++) log.append(sampleOp(`card_${i}`));
      jest.advanceTimersByTime(2001);
      await Promise.resolve();
      await Promise.resolve();

      expect(adapter.appendCount).toBe(1);
      const file = adapter.files.get(adapter.files.keys().next().value as string)!;
      expect(file.split("\n").filter(Boolean)).toHaveLength(5);
    });

    it("backstops flush at 10 buffered ops without waiting for the timer", async () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);

      // 9 ops: still buffered, debounce timer pending.
      for (let i = 0; i < 9; i++) log.append(sampleOp(`card_${i}`));
      // Resolve any pending microtasks (none should land yet).
      await Promise.resolve();
      expect(adapter.appendCount).toBe(0);

      // 10th op triggers the backstop.
      log.append(sampleOp("card_9"));
      await Promise.resolve();
      await Promise.resolve();

      expect(adapter.appendCount).toBe(1);
      expect(log.bufferLengthForTests()).toBe(0);
    });
  });

  describe("flushNow", () => {
    it("flushes immediately when called explicitly", async () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);

      log.append(sampleOp("card_a"));
      await log.flushNow();

      expect(adapter.appendCount).toBe(1);
      expect(log.bufferLengthForTests()).toBe(0);
    });

    it("is a no-op when buffer is empty", async () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);
      await log.flushNow();
      expect(adapter.appendCount).toBe(0);
    });

    it("cancels any pending debounce timer when called manually", async () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);

      log.append(sampleOp("card_a"));
      await log.flushNow();
      // Pending timer should be cleared; advancing time should not flush again.
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      expect(adapter.appendCount).toBe(1);
    });
  });

  describe("write content", () => {
    it("writes one JSONL line per op, with HLC + seq + v + o + p fields", async () => {
      const adapter = new FakeAdapter();
      const { log, state } = makeSyncLog(adapter);

      log.append(sampleOp("card_a"));
      log.append(sampleOp("card_b"));
      await log.flushNow();

      const path = `${state.getDeviceId()}.deckssynclog`;
      const content = adapter.files.get(path)!;
      const lines = content.split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(Array.isArray(parsed.hlc)).toBe(true);
        expect(parsed.hlc).toHaveLength(3);
        expect(typeof parsed.s).toBe("number");
        expect(parsed.v).toBe(1);
        expect(parsed.o).toBe("rate");
        expect(parsed.p.c).toMatch(/^card_/);
      }

      // Seq monotonic per-device.
      const seqs = lines.map((l) => JSON.parse(l).s as number);
      expect(seqs[1]).toBe(seqs[0] + 1);

      // HLC monotonic per-device too (lc increments within the same ms).
      const hlcs = lines.map((l) => JSON.parse(l).hlc as [number, number, string]);
      expect(hlcs[1][0]).toBeGreaterThanOrEqual(hlcs[0][0]);
      if (hlcs[0][0] === hlcs[1][0]) {
        expect(hlcs[1][1]).toBeGreaterThan(hlcs[0][1]);
      }
    });

    it("uses the device's own log path (vault root, .deckssynclog extension)", async () => {
      const adapter = new FakeAdapter();
      const { log, state } = makeSyncLog(adapter);

      log.append(sampleOp("card_a"));
      await log.flushNow();

      const expected = `${state.getDeviceId()}.deckssynclog`;
      expect(adapter.files.has(expected)).toBe(true);
      expect(log.ownLogPath).toBe(expected);
    });
  });

  describe("error handling", () => {
    it("re-buffers ops when adapter.append fails so the next flush retries", async () => {
      const adapter = new FakeAdapter();
      adapter.failNext = 1;
      const { log } = makeSyncLog(adapter);

      log.append(sampleOp("card_a"));
      log.append(sampleOp("card_b"));
      await log.flushNow();
      // First flush failed; ops still buffered.
      expect(log.bufferLengthForTests()).toBe(2);

      // Next flush succeeds.
      await log.flushNow();
      expect(adapter.appendCount).toBe(2);
      expect(log.bufferLengthForTests()).toBe(0);
      const written = adapter.files.values().next().value as string;
      expect(written.split("\n").filter(Boolean)).toHaveLength(2);
    });
  });

  describe("applyPending (Day 4 stub)", () => {
    it("is a no-op for now (full impl arrives Day 5)", async () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);
      await expect(log.applyPending()).resolves.toBeUndefined();
    });
  });
});
