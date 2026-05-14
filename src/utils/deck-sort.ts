/**
 * Sort a list of decks / deck groups / custom decks so pinned items
 * appear first. Within each group (pinned / unpinned) order is by
 * the item's `name`, ASCII-case-insensitive. Stable — equal names keep
 * their original relative order.
 *
 * The pin-id space is shared across all three types (file deck ids,
 * deck-group ids, custom deck ids are unique enough not to collide),
 * so `pinnedIds` is just a flat Set against the per-item id.
 */
export function sortPinnedFirst<T extends { name: string }>(
  items: T[],
  getId: (item: T) => string,
  pinnedIds: ReadonlySet<string>,
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

  const byName = (a: T, b: T) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  pinned.sort(byName);
  unpinned.sort(byName);

  return [...pinned, ...unpinned];
}
