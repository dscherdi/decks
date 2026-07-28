import { sortDeckList } from "@decks/core";

interface Item {
  id: string;
  name: string;
}

interface Stats {
  newCount: number;
  dueCount: number;
  totalCount: number;
}

const idOf = (item: Item) => item.id;
const noStats = (_id: string): Stats | undefined => undefined;
const statsMap = (m: Record<string, Stats>) =>
  (id: string): Stats | undefined => m[id];

describe("sortDeckList", () => {
  describe("name-asc (default)", () => {
    it("returns the same array reference when input is empty", () => {
      const items: Item[] = [];
      expect(sortDeckList(items, idOf, noStats, new Set(), "name-asc")).toBe(items);
    });

    it("with no pins, sorts everything alphabetically", () => {
      const items: Item[] = [
        { id: "1", name: "Charlie" },
        { id: "2", name: "alpha" },
        { id: "3", name: "Bravo" },
      ];
      const sorted = sortDeckList(items, idOf, noStats, new Set(), "name-asc");
      expect(sorted.map((i) => i.name)).toEqual(["alpha", "Bravo", "Charlie"]);
    });

    it("pinned items come first, alphabetical within each group", () => {
      const items: Item[] = [
        { id: "1", name: "Charlie" },
        { id: "2", name: "Alpha" },
        { id: "3", name: "Bravo" },
        { id: "4", name: "Delta" },
      ];
      const sorted = sortDeckList(
        items,
        idOf,
        noStats,
        new Set(["3", "1"]),
        "name-asc",
      );
      expect(sorted.map((i) => i.name)).toEqual([
        "Bravo",
        "Charlie",
        "Alpha",
        "Delta",
      ]);
    });

    it("case-insensitive sort", () => {
      const items: Item[] = [
        { id: "1", name: "banana" },
        { id: "2", name: "Apple" },
        { id: "3", name: "cherry" },
      ];
      const sorted = sortDeckList(items, idOf, noStats, new Set(), "name-asc");
      expect(sorted.map((i) => i.name)).toEqual(["Apple", "banana", "cherry"]);
    });

    it("sorts embedded numbers naturally (Cyrillic)", () => {
      const names = [
        "Урок 1",
        "Урок 10",
        "Урок 11",
        "Урок 12",
        "Урок 2",
        "Урок 3",
      ];
      // Shuffle-ish input; expect ascending natural order.
      const items: Item[] = [
        { id: "a", name: "Урок 10" },
        { id: "b", name: "Урок 2" },
        { id: "c", name: "Урок 1" },
        { id: "d", name: "Урок 12" },
        { id: "e", name: "Урок 3" },
        { id: "f", name: "Урок 11" },
      ];
      const sorted = sortDeckList(items, idOf, noStats, new Set(), "name-asc");
      expect(sorted.map((i) => i.name)).toEqual([
        "Урок 1",
        "Урок 2",
        "Урок 3",
        "Урок 10",
        "Урок 11",
        "Урок 12",
      ]);
      // Sanity: this differs from plain lexicographic order.
      expect(sorted.map((i) => i.name)).not.toEqual([...names].sort());
    });

    it("sorts embedded numbers naturally (Latin, case-insensitive)", () => {
      const items: Item[] = [
        { id: "1", name: "File10" },
        { id: "2", name: "file2" },
        { id: "3", name: "File1" },
      ];
      const sorted = sortDeckList(items, idOf, noStats, new Set(), "name-asc");
      expect(sorted.map((i) => i.name)).toEqual(["File1", "file2", "File10"]);
    });

    it("name-desc reverses natural order", () => {
      const items: Item[] = [
        { id: "a", name: "Lesson 2" },
        { id: "b", name: "Lesson 10" },
        { id: "c", name: "Lesson 1" },
      ];
      const sorted = sortDeckList(items, idOf, noStats, new Set(), "name-desc");
      expect(sorted.map((i) => i.name)).toEqual([
        "Lesson 10",
        "Lesson 2",
        "Lesson 1",
      ]);
    });

    it("does not mutate the input array", () => {
      const items: Item[] = [
        { id: "1", name: "Charlie" },
        { id: "2", name: "Alpha" },
      ];
      const snapshot = items.map((i) => i.id);
      sortDeckList(items, idOf, noStats, new Set(["2"]), "name-asc");
      expect(items.map((i) => i.id)).toEqual(snapshot);
    });

    it("pinned ids that don't match any item are ignored without crashing", () => {
      const items: Item[] = [
        { id: "1", name: "Alpha" },
        { id: "2", name: "Beta" },
      ];
      const sorted = sortDeckList(
        items,
        idOf,
        noStats,
        new Set(["ghost", "phantom"]),
        "name-asc",
      );
      expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Beta"]);
    });
  });

  describe("name-desc", () => {
    it("reverses alphabetical order within each partition", () => {
      const items: Item[] = [
        { id: "1", name: "Alpha" },
        { id: "2", name: "Bravo" },
        { id: "3", name: "Charlie" },
        { id: "4", name: "Delta" },
      ];
      const sorted = sortDeckList(
        items,
        idOf,
        noStats,
        new Set(["1", "2"]),
        "name-desc",
      );
      expect(sorted.map((i) => i.name)).toEqual([
        "Bravo",
        "Alpha",
        "Delta",
        "Charlie",
      ]);
    });
  });

  describe("new-asc / new-desc", () => {
    const items: Item[] = [
      { id: "a", name: "Aardvark" },
      { id: "b", name: "Beaver" },
      { id: "c", name: "Cobra" },
    ];
    const stats = statsMap({
      a: { newCount: 10, dueCount: 0, totalCount: 10 },
      b: { newCount: 2, dueCount: 0, totalCount: 2 },
      c: { newCount: 5, dueCount: 0, totalCount: 5 },
    });

    it("sorts ascending by newCount", () => {
      const sorted = sortDeckList(items, idOf, stats, new Set(), "new-asc");
      expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
    });

    it("sorts descending by newCount", () => {
      const sorted = sortDeckList(items, idOf, stats, new Set(), "new-desc");
      expect(sorted.map((i) => i.id)).toEqual(["a", "c", "b"]);
    });

    it("ties break by name ascending in both directions", () => {
      const tied: Item[] = [
        { id: "x", name: "Banana" },
        { id: "y", name: "Apple" },
        { id: "z", name: "Cherry" },
      ];
      const tiedStats = statsMap({
        x: { newCount: 5, dueCount: 0, totalCount: 5 },
        y: { newCount: 5, dueCount: 0, totalCount: 5 },
        z: { newCount: 5, dueCount: 0, totalCount: 5 },
      });
      const asc = sortDeckList(tied, idOf, tiedStats, new Set(), "new-asc");
      const desc = sortDeckList(tied, idOf, tiedStats, new Set(), "new-desc");
      expect(asc.map((i) => i.name)).toEqual(["Apple", "Banana", "Cherry"]);
      expect(desc.map((i) => i.name)).toEqual(["Apple", "Banana", "Cherry"]);
    });
  });

  describe("due-asc / due-desc", () => {
    const items: Item[] = [
      { id: "a", name: "Aardvark" },
      { id: "b", name: "Beaver" },
      { id: "c", name: "Cobra" },
    ];
    const stats = statsMap({
      a: { newCount: 0, dueCount: 0, totalCount: 1 },
      b: { newCount: 0, dueCount: 12, totalCount: 12 },
      c: { newCount: 0, dueCount: 3, totalCount: 3 },
    });

    it("sorts ascending by dueCount", () => {
      const sorted = sortDeckList(items, idOf, stats, new Set(), "due-asc");
      expect(sorted.map((i) => i.id)).toEqual(["a", "c", "b"]);
    });

    it("sorts descending by dueCount", () => {
      const sorted = sortDeckList(items, idOf, stats, new Set(), "due-desc");
      expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
    });
  });

  describe("missing stats", () => {
    it("treats missing stats as zero for numeric sorts", () => {
      const items: Item[] = [
        { id: "a", name: "Anchor" },
        { id: "b", name: "Buoy" },
        { id: "c", name: "Cable" },
      ];
      const partial = statsMap({
        b: { newCount: 5, dueCount: 5, totalCount: 10 },
      });
      const sorted = sortDeckList(items, idOf, partial, new Set(), "new-desc");
      // b (5) first; a and c both have no stats (0), so name-asc tiebreak
      expect(sorted.map((i) => i.id)).toEqual(["b", "a", "c"]);
    });
  });

  describe("pinned partition sorts independently", () => {
    it("pinned items use the chosen sort mode within their group", () => {
      const items: Item[] = [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
        { id: "c", name: "Charlie" },
        { id: "d", name: "Delta" },
      ];
      const stats = statsMap({
        a: { newCount: 1, dueCount: 0, totalCount: 1 },
        b: { newCount: 8, dueCount: 0, totalCount: 8 },
        c: { newCount: 3, dueCount: 0, totalCount: 3 },
        d: { newCount: 5, dueCount: 0, totalCount: 5 },
      });
      const sorted = sortDeckList(
        items,
        idOf,
        stats,
        new Set(["a", "b"]),
        "new-desc",
      );
      // pinned (b, a) sorted by new-desc -> b (8), a (1)
      // unpinned (c, d) sorted by new-desc -> d (5), c (3)
      expect(sorted.map((i) => i.id)).toEqual(["b", "a", "d", "c"]);
    });
  });
});
