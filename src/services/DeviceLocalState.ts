// Device-local state backed by window.localStorage.
//
// CRITICAL: this state must NOT live in data.json (plugin settings), which
// Obsidian Sync and iCloud propagate across devices. If two devices shared
// the same deviceId we'd recreate the concurrent-write conflict the entire
// per-device sync log architecture exists to prevent. localStorage is keyed
// to the local WebView's profile and never syncs (Electron uses platform
// storage on disk; Capacitor/WKWebView is sandboxed per app per device).

import { Platform } from "obsidian";
import type { HLCState } from "./HLC";

const KEY_DEVICE_ID = "decks_device_id";
const KEY_SEQ = "decks_sync_seq";
const KEY_HLC = "decks_hlc_state";

// On startup we skip ahead by this many seq numbers to guard against a hard
// kill that left in-memory increments un-persisted. Wasted seq numbers are
// harmless; reused are catastrophic (idempotency table keys by (device, seq)).
const SEQ_SKIP_AHEAD = 100;

function platformPrefix(): string {
  if (Platform.isIosApp) return "ios";
  if (Platform.isAndroidApp) return "and";
  if (Platform.isMacOS && Platform.isDesktopApp) return "mac";
  if (Platform.isWin) return "win";
  if (Platform.isLinux) return "lin";
  return "x";
}

function generateDeviceId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `${platformPrefix()}-${uuid.replace(/-/g, "").slice(0, 12)}`;
}

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Device-local sync state. Constructor reads from localStorage; if values
 * are missing or corrupt, fresh ones are generated and persisted. Pass a
 * `storage` adapter in tests to avoid touching the real localStorage.
 */
export class DeviceLocalState {
  private readonly storage: LocalStorageLike;
  private readonly deviceId: string;
  private nextSeq: number;
  private hlc: HLCState;

  constructor(storage?: LocalStorageLike) {
    this.storage = storage ?? (window.localStorage as LocalStorageLike);
    this.deviceId = this.loadDeviceId();
    const persistedSeq = this.loadSeq();
    // Skip ahead so a hard kill that lost the last in-memory increments
    // cannot reuse a previously-assigned seq.
    this.nextSeq = persistedSeq + SEQ_SKIP_AHEAD;
    this.persistSeq();
    this.hlc = this.loadHlc();
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Assign the next seq for this device's log. Synchronously persists so a
   * crash before the op's log line is written still advances the counter.
   */
  takeSeq(): number {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    this.persistSeq();
    return seq;
  }

  /**
   * The mutable HLC state. Callers (hlcSend, hlcReceive) mutate this in
   * place; call persistHlc() after.
   */
  getHlcState(): HLCState {
    return this.hlc;
  }

  /**
   * Persist current HLC state to localStorage. Synchronous (microsecond cost).
   * Call after every hlcSend/hlcReceive that mutated state.
   */
  persistHlc(): void {
    this.storage.setItem(
      KEY_HLC,
      JSON.stringify({ pt: this.hlc.pt, lc: this.hlc.lc })
    );
  }

  /**
   * Test-only: wipe the local state and start fresh. Useful for integration
   * tests that simulate "fresh install" or "localStorage evicted".
   */
  clearForTests(): void {
    this.storage.removeItem(KEY_DEVICE_ID);
    this.storage.removeItem(KEY_SEQ);
    this.storage.removeItem(KEY_HLC);
  }

  private persistSeq(): void {
    this.storage.setItem(KEY_SEQ, String(this.nextSeq));
  }

  private loadDeviceId(): string {
    const existing = this.storage.getItem(KEY_DEVICE_ID);
    if (existing && existing.length > 0) return existing;
    const fresh = generateDeviceId();
    this.storage.setItem(KEY_DEVICE_ID, fresh);
    return fresh;
  }

  private loadSeq(): number {
    const raw = this.storage.getItem(KEY_SEQ);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private loadHlc(): HLCState {
    const raw = this.storage.getItem(KEY_HLC);
    if (!raw) return { pt: 0, lc: 0 };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "pt" in parsed &&
        "lc" in parsed &&
        typeof (parsed as { pt: unknown }).pt === "number" &&
        typeof (parsed as { lc: unknown }).lc === "number"
      ) {
        return {
          pt: (parsed as { pt: number }).pt,
          lc: (parsed as { lc: number }).lc,
        };
      }
    } catch {
      // fall through to defaults
    }
    return { pt: 0, lc: 0 };
  }
}
