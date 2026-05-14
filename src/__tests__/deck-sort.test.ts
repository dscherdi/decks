import { sortPinnedFirst } from "../utils/deck-sort";

interface Item {
  id: string;
  name: string;
}

const idOf = (item: Item) => item.id;

describe("sortPinnedFirst", () => {
  it("returns the same array reference when input is empty", () => {
    const items: Item[] = [];
    expect(sortPinnedFirst(items, idOf, new Set())).toBe(items);
  });

  it("with no pins, sorts everything alphabetically", () => {
    const items: Item[] = [
      { id: "1", name: "Charlie" },
      { id: "2", name: "alpha" },
      { id: "3", name: "Bravo" },
    ];
    const sorted = sortPinnedFirst(items, idOf, new Set());
    expect(sorted.map((i) => i.name)).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("pinned items come first, alphabetical within each group", () => {
    const items: Item[] = [
      { id: "1", name: "Charlie" },
      { id: "2", name: "Alpha" },
      { id: "3", name: "Bravo" },
      { id: "4", name: "Delta" },
    ];
    const sorted = sortPinnedFirst(items, idOf, new Set(["3", "1"]));
    expect(sorted.map((i) => i.name)).toEqual([
      "Bravo",
      "Charlie",
      "Alpha",
      "Delta",
    ]);
  });

  it("all items pinned -> alphabetical order", () => {
    const items: Item[] = [
      { id: "1", name: "Gamma" },
      { id: "2", name: "Alpha" },
      { id: "3", name: "Beta" },
    ];
    const sorted = sortPinnedFirst(items, idOf, new Set(["1", "2", "3"]));
    expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("pinned ids that don't match any item are ignored without crashing", () => {
    const items: Item[] = [
      { id: "1", name: "Alpha" },
      { id: "2", name: "Beta" },
    ];
    const sorted = sortPinnedFirst(items, idOf, new Set(["ghost", "phantom"]));
    expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Beta"]);
  });

  it("does not mutate the input array", () => {
    const items: Item[] = [
      { id: "1", name: "Charlie" },
      { id: "2", name: "Alpha" },
    ];
    const snapshot = items.map((i) => i.id);
    sortPinnedFirst(items, idOf, new Set(["2"]));
    expect(items.map((i) => i.id)).toEqual(snapshot);
  });

  it("case-insensitive sort: lowercase and uppercase intermix correctly", () => {
    const items: Item[] = [
      { id: "1", name: "banana" },
      { id: "2", name: "Apple" },
      { id: "3", name: "cherry" },
    ];
    const sorted = sortPinnedFirst(items, idOf, new Set());
    expect(sorted.map((i) => i.name)).toEqual(["Apple", "banana", "cherry"]);
  });
});
