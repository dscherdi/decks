// Append-only per-device sync log.
//
// Each device writes to `<deviceId>.deckssynclog` in vault root. The custom
// extension keeps the file out of Obsidian's file explorer; vault-root
// placement keeps it on iCloud's first-class sync priority. One file per
// device — never shared — so concurrent offline writes never collide.
//
// Ops flow:
//   write side: append(o, p) -> in-memory buffer -> flush (debounced)
//                            -> adapter.append() to <deviceId>.deckssynclog
//   read side:  applyPending() -> list other devices' log files
//                              -> parse new JSONL lines since high-water mark
//                              -> idempotent handler per op
//                              -> advance journal_state row for that source
//
// Buffer + debounce keeps iCloud's "file stability" heuristic from blocking
// uploads during an active review burst: we coalesce N ops in a 2s window
// into one append, which iCloud sees as a single small write.

import type { DataAdapter } from "obsidian";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { Logger } from "../utils/logging";
import { DeviceLocalState } from "./DeviceLocalState";
import { hlcReceive, hlcSend, hlcParse, type HLCValue } from "./HLC";
import { KNOWN_OP_TYPES_V1 } from "./SyncLog.types";
import type { SyncOpV1, SyncLogEntry } from "./SyncLog.types";
import { applyOp } from "./SyncLog.handlers";

const FLUSH_DEBOUNCE_MS = 2000;
const FLUSH_BACKSTOP_COUNT = 10;
const LOG_EXT = ".deckssynclog";

export class SyncLog {
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private applying = false;

  constructor(
    private readonly adapter: DataAdapter,
    private readonly deviceState: DeviceLocalState,
    private readonly logger: Logger,
    private readonly db: IDatabaseService | null = null
  ) {}

  /**
   * Path of this device's log file in the vault root. Public so other
   * components (compaction, sweep) can identify "our" file vs. others'.
   */
  get ownLogPath(): string {
    return `${this.deviceState.getDeviceId()}${LOG_EXT}`;
  }

  /**
   * Build a log entry, stamp it with the next seq and a fresh HLC, and
   * push it to the in-memory buffer. Returns the seq number assigned.
   * The actual disk write is deferred to a debounced flush — callers
   * proceed immediately and don't await disk I/O.
   *
   * On a hot review path this is the budget-critical call. It does:
   *   1 localStorage write (seq counter)
   *   1 localStorage write (HLC state)
   *   1 JSON.stringify
   *   1 array push
   *   maybe 1 setTimeout schedule
   * No disk I/O. Total cost: tens of microseconds.
   */
  append<T extends SyncOpV1>(op: T): number {
    const seq = this.deviceState.takeSeq();
    const hlc = hlcSend(this.deviceState.getHlcState(), this.deviceState.getDeviceId());
    this.deviceState.persistHlc();
    const entry: SyncLogEntry = {
      hlc,
      s: seq,
      v: 1,
      o: op.o,
      p: op.p,
    } as SyncLogEntry;
    this.buffer.push(JSON.stringify(entry) + "\n");
    this.scheduleFlush();
    if (this.buffer.length >= FLUSH_BACKSTOP_COUNT) {
      // Don't await — caller doesn't need to wait for the flush. The
      // single-flight guard inside flushNow handles overlap.
      void this.flushNow();
    }
    return seq;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  /**
   * Drain the buffer to disk. Idempotent and safe to call concurrently
   * with append() (which may add more entries during the flush). Caller
   * sites include the debounce timer, the 10-op backstop, blur/quit/save
   * handlers, and the compaction prelude.
   *
   * On adapter.append() failure, lines are re-buffered so the next flush
   * retries. This trades a tiny "duplicate flush" risk (almost impossible
   * given single-flight) for durability against transient I/O errors.
   */
  async flushNow(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushing) return;
    if (this.buffer.length === 0) return;

    this.flushing = true;
    const toWrite = this.buffer;
    this.buffer = [];
    const payload = toWrite.join("");
    try {
      await this.adapter.append(this.ownLogPath, payload);
    } catch (error) {
      this.logger.error("SyncLog flush failed; re-buffering", error);
      // Put the unsaved lines back at the head of the buffer. Any ops
      // appended during the failed flush keep their order after them.
      this.buffer = [...toWrite, ...this.buffer];
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Pull all not-yet-applied ops from every other device's log file and
   * apply them to the local DB. Idempotent — replaying ops already in
   * `journal_state` is a no-op.
   *
   * Reads sources serially; within each source, applies ops in seq order and
   * stops on first gap (out-of-order delivery from iCloud will be re-tried on
   * the next focus event). A handler failure aborts that source and is logged
   * — other sources still proceed.
   */
  async applyPending(): Promise<void> {
    if (!this.db) {
      this.logger.debug("SyncLog.applyPending called without db; nothing to apply");
      return;
    }
    if (this.applying) return; // single-flight; focus events can fire in bursts
    this.applying = true;
    try {
      const sources = await this.listOtherDeviceLogPaths();
      const consumed = await this.loadJournalState();
      for (const { sourceDeviceId, path } of sources) {
        await this.applyFromSource(sourceDeviceId, path, consumed.get(sourceDeviceId) ?? 0);
      }
    } finally {
      this.applying = false;
    }
  }

  /**
   * List every `*.deckssynclog` file in the vault root except our own.
   * Conflict-copy files (e.g. `mac (conflicted copy ...).deckssynclog`) are
   * detected in Day 7's polish pass; for Day 5 we skip them silently — the
   * basename-equals-deviceId check below filters them out automatically since
   * a conflict-copy name contains parentheses and spaces.
   */
  private async listOtherDeviceLogPaths(): Promise<Array<{ sourceDeviceId: string; path: string }>> {
    let listed: { files: string[] };
    try {
      listed = await this.adapter.list("");
    } catch (error) {
      this.logger.debug("SyncLog: failed to list vault root", error as object);
      return [];
    }
    const ownPath = this.ownLogPath;
    const result: Array<{ sourceDeviceId: string; path: string }> = [];
    for (const file of listed.files) {
      if (!file.endsWith(LOG_EXT)) continue;
      if (file === ownPath) continue;
      const deviceId = file.slice(0, file.length - LOG_EXT.length);
      // Skip conflict-copy files; their basenames contain parentheses/spaces
      // that real deviceIds (UUID-derived) never have.
      if (!/^[a-z0-9-]+$/i.test(deviceId)) continue;
      result.push({ sourceDeviceId: deviceId, path: file });
    }
    return result;
  }

  private async loadJournalState(): Promise<Map<string, number>> {
    const rows = await this.db!.getJournalState();
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.sourceDeviceId, row.lastAppliedSeq);
    return map;
  }

  private async applyFromSource(
    sourceDeviceId: string,
    path: string,
    lastAppliedSeq: number
  ): Promise<void> {
    let content: string;
    try {
      content = await this.adapter.read(path);
    } catch (error) {
      this.logger.debug(`SyncLog: read failed for ${path}`, error as object);
      return;
    }

    const lines = content.split("\n");
    let appliedTo = lastAppliedSeq;
    let lastHlc: HLCValue | null = null;

    // No strict +1 gap-detection: log files are written via atomic
    // adapter.append, and iCloud delivers files as atomic units (never
    // partial). Source devices write seqs in order; the first encounter
    // with a new source picks up wherever its seqs started (post-skip-
    // ahead, that's typically 100+). The only "gap" we'd see comes from a
    // mid-line crash, which parseEntry handles by skipping the bad line.
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      let entry: SyncLogEntry;
      try {
        entry = parseEntry(line);
      } catch (error) {
        this.logger.debug(
          `SyncLog: skipping malformed line in ${path}`,
          error as object
        );
        continue;
      }
      if (!KNOWN_OP_TYPES_V1.has(entry.o)) {
        this.logger.debug(
          `SyncLog: skipping unknown op type "${entry.o}" from ${sourceDeviceId} (newer plugin?)`
        );
        continue;
      }
      if (entry.s <= appliedTo) continue;

      try {
        await applyOp(this.db!, sourceDeviceId, entry, this.logger);
      } catch (error) {
        this.logger.error(
          `SyncLog: handler for op ${entry.s} from ${sourceDeviceId} threw; stopping this source`,
          error
        );
        break;
      }

      appliedTo = entry.s;
      lastHlc = entry.hlc;
    }

    if (appliedTo > lastAppliedSeq && lastHlc) {
      // Advance local HLC past the highest received so future hlcSend()
      // values strictly dominate anything we just applied.
      hlcReceive(this.deviceState.getHlcState(), lastHlc);
      this.deviceState.persistHlc();

      await this.db!.upsertJournalState({
        sourceDeviceId,
        lastAppliedSeq: appliedTo,
        lastAppliedHlc: JSON.stringify(lastHlc),
        lastAppliedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Test-only inspection of the buffered (unflushed) line count. Used by
   * SyncLog.test.ts to verify the debounce/backstop semantics.
   */
  bufferLengthForTests(): number {
    return this.buffer.length;
  }
}

/**
 * Parse and shallow-validate one JSONL line into a SyncLogEntry. Throws on
 * malformed input; callers should try/catch and skip the line (per-line
 * corruption isolation — one bad line never invalidates the rest of a log).
 */
function parseEntry(line: string): SyncLogEntry {
  const obj: unknown = JSON.parse(line);
  if (
    !obj ||
    typeof obj !== "object" ||
    !("hlc" in obj) ||
    !("s" in obj) ||
    !("v" in obj) ||
    !("o" in obj) ||
    !("p" in obj)
  ) {
    throw new Error("missing required fields");
  }
  const rec = obj as { hlc: unknown; s: unknown; v: unknown; o: unknown; p: unknown };
  if (typeof rec.s !== "number") throw new Error("s must be number");
  if (rec.v !== 1) throw new Error(`unsupported v=${String(rec.v)}`);
  if (typeof rec.o !== "string") throw new Error("o must be string");
  if (!rec.p || typeof rec.p !== "object") throw new Error("p must be object");
  const hlc = hlcParse(rec.hlc);
  return { hlc, s: rec.s, v: 1, o: rec.o, p: rec.p } as SyncLogEntry;
}
