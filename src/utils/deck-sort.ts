import type { DeckListSortMode } from "../settings";

interface SortableStats {
  newCount: number;
  dueCount: number;
  totalCount: number;
}

/**
 * Sort a list of decks / deck groups / custom decks. Pinned items always
 * come first; both partitions are sorted independently by the chosen mode.
 *
 * Numeric modes (`new-*`, `due-*`) break ties by ASCII-case-insensitive name
 * so the order is deterministic across renders. Missing stats default to 0 —
 * e.g. a deck group whose member stats haven't resolved yet still sorts
 * sensibly (and not via NaN comparison).
 *
 * The pin-id space is shared across all three item types (file deck ids,
 * deck-group ids, custom deck ids are unique enough not to collide), so
 * `pinnedIds` is a flat Set against the per-item id.
 */
export function sortDeckList<T extends { name: string }>(
  items: T[],
  getId: (item: T) => string,
  getStats: (id: string) => SortableStats | undefined,
  pinnedIds: ReadonlySet<string>,
  sortMode: DeckListSortMode,
): T[] {
  if (items.length === 0) return items;

  const pinned: T[] = [];
  const unpinned: T[] = [];

  for (const item of items) {
    if (pinnedIds.has(getId(item))) {
      pinned.push(item);
    } else {
      unpinned.push(item);
    }
  }

  const comparator = makeComparator(getId, getStats, sortMode);
  pinned.sort(comparator);
  unpinned.sort(comparator);

  return [...pinned, ...unpinned];
}

function compareNames(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function makeComparator<T extends { name: string }>(
  getId: (item: T) => string,
  getStats: (id: string) => SortableStats | undefined,
  sortMode: DeckListSortMode,
): (a: T, b: T) => number {
  switch (sortMode) {
    case "name-asc":
      return (a, b) => compareNames(a, b);
    case "name-desc":
      return (a, b) => compareNames(b, a);
    case "new-asc":
      return (a, b) => {
        const av = getStats(getId(a))?.newCount ?? 0;
        const bv = getStats(getId(b))?.newCount ?? 0;
        return av - bv || compareNames(a, b);
      };
    case "new-desc":
      return (a, b) => {
        const av = getStats(getId(a))?.newCount ?? 0;
        const bv = getStats(getId(b))?.newCount ?? 0;
        return bv - av || compareNames(a, b);
      };
    case "due-asc":
      return (a, b) => {
        const av = getStats(getId(a))?.dueCount ?? 0;
        const bv = getStats(getId(b))?.dueCount ?? 0;
        return av - bv || compareNames(a, b);
      };
    case "due-desc":
      return (a, b) => {
        const av = getStats(getId(a))?.dueCount ?? 0;
        const bv = getStats(getId(b))?.dueCount ?? 0;
        return bv - av || compareNames(a, b);
      };
  }
}

/**
 * Drop items with `totalCount < threshold`, except those whose id is in
 * `pinnedIds` — pinned decks are always visible regardless of size.
 * Missing stats are treated as `totalCount: 0`, so a stats-less item
 * is hidden when the threshold is >= 1.
 */
export function filterByMinCount<T>(
  items: T[],
  getId: (item: T) => string,
  getStats: (id: string) => SortableStats | undefined,
  pinnedIds: ReadonlySet<string>,
  threshold: number,
): T[] {
  if (!Number.isFinite(threshold) || threshold <= 0) return items;
  return items.filter((item) => {
    const id = getId(item);
    if (pinnedIds.has(id)) return true;
    const total = getStats(id)?.totalCount ?? 0;
    return total >= threshold;
  });
}
