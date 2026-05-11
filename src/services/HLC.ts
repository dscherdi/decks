// Hybrid Logical Clock for cross-device op ordering.
//
// Tolerates wall-clock skew between devices (iPhone vs Mac clocks drift):
// the local pt monotonically advances past any received pt, and lc breaks
// ties when two ops share a physical timestamp. Result: a total order on
// ops that respects causality, robust to skew measured in seconds-to-hours.
//
// Encoded over the wire as [pt, lc, deviceId] so the deviceId tiebreaker
// is stable across devices.

export type HLCValue = readonly [number, number, string];

export interface HLCState {
  pt: number;
  lc: number;
}

/**
 * Stamp a new op and advance local state. Returns the HLC value to embed
 * in the outgoing op record.
 */
export function hlcSend(state: HLCState, deviceId: string): HLCValue {
  const now = Date.now();
  if (now > state.pt) {
    state.pt = now;
    state.lc = 0;
  } else {
    state.lc += 1;
  }
  return [state.pt, state.lc, deviceId];
}

/**
 * Advance local state in response to a received HLC value (typically the
 * highest HLC seen in a sync log apply pass). Does NOT consume the value;
 * this only updates the local clock so future hlcSend() calls produce
 * values strictly greater than anything seen so far.
 */
export function hlcReceive(state: HLCState, incoming: HLCValue): void {
  const now = Date.now();
  const inPt = incoming[0];
  const inLc = incoming[1];
  const newPt = Math.max(state.pt, inPt, now);
  if (newPt === state.pt && newPt === inPt) {
    state.lc = Math.max(state.lc, inLc) + 1;
  } else if (newPt === state.pt) {
    state.lc += 1;
  } else if (newPt === inPt) {
    state.lc = inLc + 1;
  } else {
    state.lc = 0;
  }
  state.pt = newPt;
}

/**
 * Total ordering. Returns negative if a < b, positive if a > b, 0 if equal.
 * deviceId is the final tiebreaker so distinct devices stamping at the same
 * (pt, lc) still produce a deterministic order across the network.
 */
export function hlcCompare(a: HLCValue, b: HLCValue): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] < b[2]) return -1;
  if (a[2] > b[2]) return 1;
  return 0;
}

export function hlcEqual(a: HLCValue, b: HLCValue): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Serialize for storage in the sync log JSONL. Returns a 3-element tuple
 * (kept tight to minimize bytes per op).
 */
export function hlcSerialize(v: HLCValue): [number, number, string] {
  return [v[0], v[1], v[2]];
}

/**
 * Parse from a log line. Throws on malformed input — callers should wrap
 * in try/catch and skip the line per the per-line corruption isolation rule.
 */
export function hlcParse(raw: unknown): HLCValue {
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error("HLC: expected 3-element array");
  }
  const pt = raw[0];
  const lc = raw[1];
  const dev = raw[2];
  if (typeof pt !== "number" || typeof lc !== "number" || typeof dev !== "string") {
    throw new Error("HLC: invalid field types");
  }
  return [pt, lc, dev];
}
