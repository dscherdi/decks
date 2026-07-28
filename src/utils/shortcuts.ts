// Customizable review keyboard shortcuts: the five keys used while reviewing —
// four ratings plus the reveal/advance key.

export interface ReviewShortcuts {
  again: string;
  hard: string;
  good: string;
  easy: string;
  reveal: string;
}

export const DEFAULT_REVIEW_SHORTCUTS: ReviewShortcuts = {
  again: "1",
  hard: "2",
  good: "3",
  easy: "4",
  reveal: " ",
};

/**
 * Canonical form of a `KeyboardEvent.key` for storage/comparison. Single
 * characters are lowercased so `A` (shift held) and `a` bind to the same key;
 * named keys (Space, Enter, Arrow…) are left untouched.
 */
export function normalizeShortcutKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** True when a pressed key matches a stored binding, ignoring case. */
export function matchesShortcut(eventKey: string, bound: string): boolean {
  return normalizeShortcutKey(eventKey) === normalizeShortcutKey(bound);
}

const DISPLAY_NAMES: Record<string, string> = {
  " ": "Space",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Esc",
  Backspace: "Backspace",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** Human-readable label for a shortcut key, e.g. `" "` → "Space", `"a"` → "A". */
export function displayShortcutKey(key: string): string {
  if (key in DISPLAY_NAMES) return DISPLAY_NAMES[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

/** True when a pressed key is bound to any of the five review actions. */
export function isReviewShortcut(
  eventKey: string,
  shortcuts: ReviewShortcuts
): boolean {
  return (
    matchesShortcut(eventKey, shortcuts.again) ||
    matchesShortcut(eventKey, shortcuts.hard) ||
    matchesShortcut(eventKey, shortcuts.good) ||
    matchesShortcut(eventKey, shortcuts.easy) ||
    matchesShortcut(eventKey, shortcuts.reveal)
  );
}
