import { filterByMinCount } from "@decks/core";

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
const statsMap = (m: Record<string, Stats>) =>
  (id: string): Stats | undefined => m[id];

describe("filterByMinCount", () => {
  const items: Item[] = [
    { id: "tiny", name: "Title deck" },
    { id: "small", name: "Small deck" },
    { id: "medium", name: "Medium deck" },
    { id: "large", name: "Large deck" },
  ];
  const stats = statsMap({
    tiny: { newCount: 0, dueCount: 0, totalCount: 1 },
    small: { newCount: 0, dueCount: 0, totalCount: 3 },
    medium: { newCount: 0, dueCount: 0, totalCount: 25 },
    large: { newCount: 0, dueCount: 0, totalCount: 200 },
  });

  it("threshold 0 returns items unchanged", () => {
    const result = filterByMinCount(items, idOf, stats, new Set(), 0);
    expect(result).toBe(items);
  });

  it("negative threshold returns items unchanged", () => {
    const result = filterByMinCount(items, idOf, stats, new Set(), -5);
    expect(result).toBe(items);
  });

  it("threshold 2 drops the 1-card title deck", () => {
    const result = filterByMinCount(items, idOf, stats, new Set(), 2);
    expect(result.map((i) => i.id)).toEqual(["small", "medium", "large"]);
  });

  it("threshold above the largest deck drops everything (no pins)", () => {
    const result = filterByMinCount(items, idOf, stats, new Set(), 9999);
    expect(result).toEqual([]);
  });

  it("pinned items survive any threshold", () => {
    const result = filterByMinCount(
      items,
      idOf,
      stats,
      new Set(["tiny"]),
      9999,
    );
    expect(result.map((i) => i.id)).toEqual(["tiny"]);
  });

  it("items with no stats are treated as totalCount: 0", () => {
    const sparseStats = statsMap({
      large: { newCount: 0, dueCount: 0, totalCount: 200 },
    });
    const result = filterByMinCount(items, idOf, sparseStats, new Set(), 1);
    // tiny/small/medium have no stats -> total 0 -> filtered out
    expect(result.map((i) => i.id)).toEqual(["large"]);
  });

  it("items with no stats stay when pinned", () => {
    const result = filterByMinCount(
      items,
      idOf,
      (_id) => undefined,
      new Set(["medium"]),
      1,
    );
    expect(result.map((i) => i.id)).toEqual(["medium"]);
  });

  it("does not mutate the input array", () => {
    const snapshot = items.map((i) => i.id);
    filterByMinCount(items, idOf, stats, new Set(), 5);
    expect(items.map((i) => i.id)).toEqual(snapshot);
  });
});
