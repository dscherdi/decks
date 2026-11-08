/** The `<mark>` indices a review container blanks together, as a half-open range. */
export interface ClozeMarkRange {
  start: number;
  end: number;
}

/** The range covering the active marks, or null when none sits outside math. */
export function clozeMarkRange(markActiveIndices: readonly number[]): ClozeMarkRange | null {
  if (markActiveIndices.length === 0) return null;
  return { start: Math.min(...markActiveIndices), end: Math.max(...markActiveIndices) + 1 };
}

export type ClozeMarkRole = "active" | "revealed" | "blank" | "context";

/** How the post-processor renders the mark at `index`. */
export function clozeMarkRole(
  index: number,
  range: ClozeMarkRange,
  mode: string,
  revealed: boolean
): ClozeMarkRole {
  if (index >= range.start && index < range.end) return revealed ? "revealed" : "active";
  return mode === "hidden" ? "blank" : "context";
}
