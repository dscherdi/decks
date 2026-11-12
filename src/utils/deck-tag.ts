import { pickDeckTag } from "@decks/core";

// The one tag a note's deck carries: the shared pick among its deck tags, else the first tag that matched.
export function noteDeckTag(tags: readonly string[], baseTag: string): string | null {
  const matching = tags.filter((tag) => tag.startsWith(baseTag));
  return pickDeckTag(matching, baseTag) ?? matching[0] ?? null;
}
