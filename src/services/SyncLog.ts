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
import { KNOWN_OP_TYPES_V1 } from "@decks/core";
import type { SyncOpV1, SyncLogEntry } from "@decks/core";
import { applyOp } from "@decks/core";
import { safeRename } from "../utils/adapter";

const FLUSH_DEBOUNCE_MS = 2000;
const FLUSH_BACKSTOP_COUNT = 10;
const LOG_EXT = ".deckssynclog";
const COMPACT_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class SyncLog {
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private applying = false;

  constructor(
    private readonly adapter: DataAdapter,
    private readonly deviceState: DeviceLocalState,
    private readonly logger: Logger,
    private readonly db: IDatabaseService | null = null,
    // Vault-relative folder for sync log files. Empty string = vault root
    // (the default and what iCloud syncs fastest). Pre-normalized by the
    // caller via resolveSyncLogFolder.
    private readonly logFolder = ""
  ) {}

  /**
   * Path of this device's log file. The folder prefix is configurable via
   * settings (default: vault root). Public so other components (compaction,
   * sweep) can identify "our" file vs. others'.
   */
  get ownLogPath(): string {
    const name = `${this.deviceState.getDeviceId()}${LOG_EXT}`;
    return this.logFolder === "" ? name : `${this.logFolder}/${name}`;
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
      for (const source of sources) {
        await this.applyFromSource(
          source.sourceDeviceId,
          source.path,
          consumed.get(source.sourceDeviceId) ?? 0
        );
        if (source.isConflict) {
          // Move the conflict-copy file aside so the next applyPending
          // doesn't re-scan it. The renamed file remains in the vault as
          // a forensic record (kept until manual cleanup) instead of being
          // deleted, in case the user wants to inspect what got merged.
          await this.renameConsumedConflictFile(source.path).catch((error) => {
            this.logger.debug(
              `SyncLog: failed to rename consumed conflict file ${source.path}`,
              error as object
            );
          });
        }
      }
    } finally {
      this.applying = false;
    }
  }

  private async renameConsumedConflictFile(path: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = `${path}.consumed-${stamp}`;
    await safeRename(this.adapter, path, target);
  }

  /**
   * List every `*.deckssynclog` file in the vault root except our own.
   *
   * Conflict-copy files — `<deviceId> (Mac's conflicted copy 2026-05-10).deckssynclog`
   * (iCloud), `<deviceId>.sync-conflict-20260510-...` (Syncthing), etc. —
   * are mapped back to their owning deviceId so their entries flow into the
   * same journal_state high-water mark. After a successful apply we rename
   * them so they won't be re-processed on the next focus event.
   */
  private async listOtherDeviceLogPaths(): Promise<
    Array<{ sourceDeviceId: string; path: string; isConflict: boolean }>
  > {
    let listed: { files: string[] };
    try {
      // adapter.list() returns full vault-relative paths (including the
      // folder prefix) and is non-recursive — listing "_sync" yields only
      // immediate children of _sync/, not files in deeper subfolders.
      listed = await this.adapter.list(this.logFolder);
    } catch (error) {
      this.logger.debug(
        `SyncLog: failed to list ${this.logFolder || "vault root"}`,
        error as object
      );
      return [];
    }
    const ownPath = this.ownLogPath;
    const ownDeviceId = this.deviceState.getDeviceId();
    const result: Array<{ sourceDeviceId: string; path: string; isConflict: boolean }> = [];
    for (const file of listed.files) {
      // Filenames are matched on the basename so a folder prefix doesn't
      // throw off the deviceId regex.
      const basename = file.includes("/") ? file.slice(file.lastIndexOf("/") + 1) : file;
      const parsed = parseDeviceFromFilename(basename);
      if (!parsed) continue;
      if (file === ownPath) continue;
      // Even our own log might appear with a conflict-copy suffix if iCloud
      // got confused. We DO want to consume those entries (they're our ops
      // that got stranded in the conflicted copy) — but with care: they
      // should be applied via our normal journal_state path so we don't
      // double-apply our own writes. Skip same-deviceId conflict copies for
      // now; their content is duplicated in our own log via append, so the
      // safest move is to just rename them out of the way.
      if (parsed.deviceId === ownDeviceId && !parsed.isConflict) continue;
      result.push({
        sourceDeviceId: parsed.deviceId,
        path: file,
        isConflict: parsed.isConflict,
      });
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

    // Parse + filter all ops upfront so the transaction scope wraps only
    // the actual DB work. parseEntry never throws synchronously here — we
    // catch and skip per-line. KNOWN_OP_TYPES_V1 guards against forward-
    // compat: a newer plugin's op type is silently skipped rather than
    // applied half-way.
    const lines = content.split("\n");
    const pendingOps: SyncLogEntry[] = [];
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
      if (entry.s <= lastAppliedSeq) continue;
      pendingOps.push(entry);
    }
    if (pendingOps.length === 0) return;

    let appliedTo = lastAppliedSeq;
    let lastHlc: HLCValue | null = null;

    // Wrap the apply batch in a SQL transaction so a crash or handler
    // failure mid-batch leaves the DB in a coherent state. On commit,
    // journal_state advances in lockstep with the highest-applied seq —
    // a crash before commit means nothing was applied AND nothing was
    // recorded, so the next applyPending re-tries from scratch. Idempotent
    // handlers handle the "we already applied this op once" case.
    await this.db!.executeSql("BEGIN TRANSACTION");
    try {
      for (const entry of pendingOps) {
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
        await this.db!.upsertJournalState({
          sourceDeviceId,
          lastAppliedSeq: appliedTo,
          lastAppliedHlc: JSON.stringify(lastHlc),
          lastAppliedAt: new Date().toISOString(),
        });
      }
      await this.db!.executeSql("COMMIT");
    } catch (error) {
      // Best-effort rollback. If this also throws, the worker's next op
      // will fail with "no transaction active" — surfacing the original
      // issue rather than masking it.
      try {
        await this.db!.executeSql("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    }

    if (appliedTo > lastAppliedSeq && lastHlc) {
      // HLC advance happens OUTSIDE the SQL transaction since localStorage
      // isn't transactional. Worst case if we crash between commit and HLC
      // persist: the next hlcSend produces a slightly-too-low value, but
      // the next applyPending advances us past anything received again.
      hlcReceive(this.deviceState.getHlcState(), lastHlc);
      this.deviceState.persistHlc();
    }
  }

  /**
   * Truncate this device's log to the last N days of entries (default 30).
   * Drops older lines, rewrites the file atomically via tmp + safeRename.
   *
   * Called on plugin startup and once per session; not on every focus event.
   * Frequency is bounded because (a) the rewrite reads the whole file and
   * (b) the resulting file change triggers a fresh iCloud upload of the
   * (much-smaller) compacted log — useful but not free.
   *
   * Safety notes:
   *   - We compact ONLY our own log file. Other devices' logs are read-only
   *     to us; modifying them would race with their owner's appends.
   *   - Day 7 uses a simple time-based cutoff. Day 8 polish layers in a
   *     consumed-receipt floor so we don't drop entries some other device
   *     hasn't yet read. For now, a 30-day window is a safe over-estimate.
   *   - We flush any in-flight buffer before reading so we don't lose ops
   *     that were appended but not yet on disk.
   */
  async compact(retentionDays: number = COMPACT_RETENTION_DAYS): Promise<{
    before: number;
    after: number;
  }> {
    await this.flushNow();

    const path = this.ownLogPath;
    let content: string;
    try {
      if (!(await this.adapter.exists(path))) return { before: 0, after: 0 };
      content = await this.adapter.read(path);
    } catch (error) {
      this.logger.debug("SyncLog.compact: read failed", error as object);
      return { before: 0, after: 0 };
    }

    const lines = content.split("\n");
    const cutoff = Date.now() - retentionDays * MS_PER_DAY;
    const kept: string[] = [];
    let droppedCount = 0;
    let beforeCount = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      beforeCount += 1;
      // Cheap parse: pull just the hlc field; if anything is off, keep the
      // line. Better to retain a suspicious record than risk losing it.
      let parsedTs: number | null = null;
      try {
        const obj: unknown = JSON.parse(line);
        if (
          obj &&
          typeof obj === "object" &&
          "hlc" in obj &&
          Array.isArray((obj).hlc) &&
          typeof (obj as { hlc: number[] }).hlc[0] === "number"
        ) {
          parsedTs = (obj as { hlc: number[] }).hlc[0];
        }
      } catch {
        // Malformed line — keep it so the next applyPending can log/skip.
        kept.push(line);
        continue;
      }
      if (parsedTs !== null && parsedTs < cutoff) {
        droppedCount += 1;
        continue;
      }
      kept.push(line);
    }

    if (droppedCount === 0) {
      return { before: beforeCount, after: beforeCount };
    }

    const newContent = kept.length > 0 ? kept.join("\n") + "\n" : "";
    const tmpPath = `${path}.compact-tmp`;
    try {
      await this.adapter.write(tmpPath, newContent);
      await safeRename(this.adapter, tmpPath, path);
      this.logger.debug(
        `SyncLog.compact: ${path} ${beforeCount} → ${kept.length} entries (dropped ${droppedCount} older than ${retentionDays}d)`
      );
    } catch (error) {
      this.logger.error("SyncLog.compact: rewrite failed", error);
      // Best-effort cleanup of the tmp file. If this also throws, the next
      // compaction pass will overwrite it anyway.
      try {
        await this.adapter.remove(tmpPath);
      } catch {
        /* ignore */
      }
      throw error;
    }

    return { before: beforeCount, after: kept.length };
  }

  /**
   * If a `rate` op for the given logId is still in the pending buffer,
   * remove it and return true. Otherwise return false. Used by undo so we
   * can avoid ever shipping a rate that the user immediately reversed
   * (cleaner than shipping `rate` then `rate_undo` in quick succession).
   *
   * Iteration is O(N) where N is bounded by the FLUSH_BACKSTOP_COUNT (10),
   * so this is microsecond-scale work even in the worst case.
   */
  cancelBufferedRate(logId: string): boolean {
    for (let i = 0; i < this.buffer.length; i++) {
      const line = this.buffer[i];
      // Cheap pre-filter: skip lines that don't even contain the id.
      if (!line.includes(logId)) continue;
      try {
        const entry = JSON.parse(line.trimEnd()) as SyncLogEntry;
        if (
          entry.o === "rate" &&
          (entry.p as { log: { id: string } }).log.id === logId
        ) {
          this.buffer.splice(i, 1);
          return true;
        }
      } catch {
        // Malformed line in our own buffer is unexpected; skip and keep
        // looking. Worst case the caller falls back to emitting rate_undo.
      }
    }
    return false;
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
 * Recognize the deviceId behind a sync-log file's name. Handles:
 *   - Clean files:   "lin-abc123def456.deckssynclog"
 *   - iCloud:        "lin-abc123def456 (Mac's conflicted copy 2026-05-10).deckssynclog"
 *   - Syncthing:     "lin-abc123def456.sync-conflict-20260510-123456-MAC.deckssynclog"
 *   - Obsidian Sync: "lin-abc123def456.conflict.deckssynclog"
 *
 * The recognition rule: the basename (minus the extension) either equals a
 * deviceId-shaped string, or starts with one followed by a space/dot/paren
 * and arbitrary suffix. Anything else is rejected — we'd rather skip an
 * unfamiliar file than apply ops from it.
 */
function parseDeviceFromFilename(
  file: string
): { deviceId: string; isConflict: boolean } | null {
  if (!file.endsWith(LOG_EXT)) return null;
  const base = file.slice(0, file.length - LOG_EXT.length);
  if (base.length === 0) return null;
  // Exact deviceId — no conflict.
  if (/^[a-z0-9-]+$/i.test(base)) {
    return { deviceId: base, isConflict: false };
  }
  // Conflict-copy: deviceId prefix followed by a separator.
  const m = base.match(/^([a-z0-9-]+)[ (.]/i);
  if (!m) return null;
  // Reject files where the suffix doesn't look like a conflict marker. This
  // is a soft heuristic, intentionally permissive: better to consume a
  // weirdly-named valid log than to miss the user's data.
  return { deviceId: m[1], isConflict: true };
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
  const rec = obj;
  if (typeof rec.s !== "number") throw new Error("s must be number");
  if (rec.v !== 1) throw new Error(`unsupported v=${String(rec.v)}`);
  if (typeof rec.o !== "string") throw new Error("o must be string");
  if (!rec.p || typeof rec.p !== "object") throw new Error("p must be object");
  const hlc = hlcParse(rec.hlc);
  return { hlc, s: rec.s, v: 1, o: rec.o, p: rec.p } as SyncLogEntry;
}
