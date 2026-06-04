import { SyncLog } from "../services/SyncLog";
import {
  DeviceLocalState,
  type LocalStorageLike,
} from "../services/DeviceLocalState";
import type { Logger } from "../utils/logging";
import type { SyncOpV1 } from "@decks/core";

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
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async read(path: string): Promise<string> {
    const data = this.files.get(path);
    if (data === undefined) throw new Error(`not found: ${path}`);
    return data;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async rename(from: string, to: string): Promise<void> {
    const data = this.files.get(from);
    if (data === undefined) throw new Error(`ENOENT: ${from}`);
    this.files.set(to, data);
    this.files.delete(from);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
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
function sampleOp(cardId: string): SyncOpV1 & { o: "rate" } {
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

  describe("cancelBufferedRate", () => {
    it("removes a matching rate op from the buffer and returns true", () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);

      const op = sampleOp("card_a");
      log.append(op);
      expect(log.bufferLengthForTests()).toBe(1);

      const logId = op.p.log.id;
      expect(log.cancelBufferedRate(logId)).toBe(true);
      expect(log.bufferLengthForTests()).toBe(0);
    });

    it("returns false when no matching rate is buffered (already flushed)", async () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);

      const op = sampleOp("card_a");
      log.append(op);
      await log.flushNow();
      expect(log.bufferLengthForTests()).toBe(0);

      // Already on disk — caller would emit rate_undo instead.
      expect(log.cancelBufferedRate(op.p.log.id)).toBe(false);
    });

    it("only removes the rate matching the given logId, leaves others alone", () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);

      const opA = sampleOp("card_a");
      const opB = sampleOp("card_b");
      log.append(opA);
      log.append(opB);
      expect(log.bufferLengthForTests()).toBe(2);

      expect(log.cancelBufferedRate(opA.p.log.id)).toBe(true);
      expect(log.bufferLengthForTests()).toBe(1);
      // The remaining buffered op should be opB's.
      expect(log.cancelBufferedRate(opB.p.log.id)).toBe(true);
      expect(log.bufferLengthForTests()).toBe(0);
    });

    it("returns false for an unknown logId without disturbing the buffer", () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);
      log.append(sampleOp("card_a"));
      expect(log.cancelBufferedRate("log_never_existed")).toBe(false);
      expect(log.bufferLengthForTests()).toBe(1);
    });
  });

  describe("compact", () => {
    beforeEach(() => {
      // Compaction reads timestamps; use real timers so the cutoff math works.
      jest.useRealTimers();
    });

    // Build a JSONL line with a given pt (physical timestamp in ms). The rest
    // of the fields are placeholders — compact only looks at hlc[0].
    function makeLine(pt: number, seq: number): string {
      return (
        JSON.stringify({
          hlc: [pt, 0, "dev-x"],
          s: seq,
          v: 1,
          o: "rate",
          p: { c: "card_x" },
        }) + "\n"
      );
    }

    it("is a no-op when the log file doesn't exist", async () => {
      const adapter = new FakeAdapter();
      const { log } = makeSyncLog(adapter);
      const result = await log.compact();
      expect(result).toEqual({ before: 0, after: 0 });
    });

    it("drops entries older than the retention window and rewrites the file", async () => {
      const adapter = new FakeAdapter();
      const { log, state } = makeSyncLog(adapter);
      const path = `${state.getDeviceId()}.deckssynclog`;
      const now = Date.now();
      const old = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago
      const recent = now - 5 * 24 * 60 * 60 * 1000; // 5 days ago
      adapter.files.set(
        path,
        makeLine(old, 1) + makeLine(old, 2) + makeLine(recent, 3)
      );

      const result = await log.compact(30);
      expect(result.before).toBe(3);
      expect(result.after).toBe(1);

      const remaining = adapter.files.get(path)!;
      expect(remaining.split("\n").filter(Boolean)).toHaveLength(1);
      // The kept line must be the recent one.
      const kept = JSON.parse(remaining.split("\n")[0]);
      expect(kept.s).toBe(3);
    });

    it("is a no-op when nothing is older than the cutoff", async () => {
      const adapter = new FakeAdapter();
      const { log, state } = makeSyncLog(adapter);
      const path = `${state.getDeviceId()}.deckssynclog`;
      const now = Date.now();
      adapter.files.set(path, makeLine(now, 1) + makeLine(now, 2));

      const result = await log.compact(30);
      expect(result).toEqual({ before: 2, after: 2 });
      // File is untouched (no rename happened, content identical).
      expect(adapter.files.get(path)!.split("\n").filter(Boolean)).toHaveLength(2);
    });

    it("preserves malformed lines rather than silently dropping them", async () => {
      const adapter = new FakeAdapter();
      const { log, state } = makeSyncLog(adapter);
      const path = `${state.getDeviceId()}.deckssynclog`;
      const now = Date.now();
      const old = now - 60 * 24 * 60 * 60 * 1000;
      adapter.files.set(
        path,
        makeLine(old, 1) + "{not valid json\n" + makeLine(now, 2)
      );

      await log.compact(30);
      const remaining = adapter.files.get(path)!;
      // The malformed line is retained; only the genuinely-old line is dropped.
      expect(remaining).toContain("{not valid json");
      expect(remaining.split("\n").filter(Boolean)).toHaveLength(2);
    });

    it("flushes any pending buffered ops before reading", async () => {
      const adapter = new FakeAdapter();
      const { log, state } = makeSyncLog(adapter);
      const path = `${state.getDeviceId()}.deckssynclog`;

      // Seed an old entry on disk so something will be dropped.
      const old = Date.now() - 60 * 24 * 60 * 60 * 1000;
      adapter.files.set(path, makeLine(old, 1));

      // Append a fresh op that's still in the buffer.
      log.append({
        o: "rate",
        p: {
          c: "card_new",
          st: 1,
          d: 5,
          due: "2030-01-01T00:00:00Z",
          rep: 1,
          lap: 0,
          state: "review",
          lastReviewed: "2030-01-01T00:00:00Z",
          interval: 1440,
          log: {
            id: "log_new",
            flashcardId: "card_new",
            sessionId: null,
            lastReviewedAt: "2030-01-01T00:00:00Z",
            shownAt: null,
            reviewedAt: "2030-01-01T00:00:00Z",
            rating: 3,
            ratingLabel: "good",
            timeElapsedMs: 1,
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
            oldDueAt: "2030-01-01T00:00:00Z",
            newDueAt: "2030-01-02T00:00:00Z",
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
      });
      expect(log.bufferLengthForTests()).toBe(1);

      await log.compact(30);

      // Buffer drained, old entry dropped, new entry preserved on disk.
      expect(log.bufferLengthForTests()).toBe(0);
      const remaining = adapter.files.get(path)!;
      const kept = remaining.split("\n").filter(Boolean);
      expect(kept).toHaveLength(1);
      expect(JSON.parse(kept[0]).p.c).toBe("card_new");
    });
  });
});
