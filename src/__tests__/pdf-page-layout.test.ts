import {
  MAX_PAGE_PIXELS,
  canvasBudget,
  planWindow,
  renderScale,
} from "../utils/pdf-page-layout";

const LETTER = { width: 612, height: 792 };

describe("renderScale", () => {
  it("fits the page to the column width", () => {
    const s = renderScale(416, LETTER, 1);
    expect(s.css).toBeCloseTo(416 / 612);
    expect(s.pixel).toBeCloseTo(s.css);
  });

  it("paints at the device density, clamped between 1 and 2", () => {
    const css = 416 / 612;
    expect(renderScale(416, LETTER, 2).pixel).toBeCloseTo(css * 2);
    expect(renderScale(416, LETTER, 3).pixel).toBeCloseTo(css * 2);
    expect(renderScale(416, LETTER, 0.5).pixel).toBeCloseTo(css);
    expect(renderScale(416, LETTER, Number.NaN).pixel).toBeCloseTo(css);
  });

  it("keeps the canvas under the pixel cap without changing the layout scale", () => {
    const s = renderScale(2400, LETTER, 2);
    expect(s.css).toBeCloseTo(2400 / 612);
    const area = LETTER.width * s.pixel * LETTER.height * s.pixel;
    expect(area).toBeLessThanOrEqual(MAX_PAGE_PIXELS + 1);
    expect(area).toBeGreaterThan(MAX_PAGE_PIXELS * 0.99);
    expect(s.pixel).toBeLessThan(s.css * 2);
  });

  it("honours a smaller cap", () => {
    const s = renderScale(612, LETTER, 1, 100_000);
    expect(LETTER.width * s.pixel * LETTER.height * s.pixel).toBeCloseTo(100_000, -1);
  });

  it("returns zero scales when there is nothing to lay out", () => {
    expect(renderScale(0, LETTER, 2)).toEqual({ css: 0, pixel: 0 });
    expect(renderScale(400, { width: 0, height: 792 }, 2)).toEqual({ css: 0, pixel: 0 });
    expect(renderScale(Number.NaN, LETTER, 2)).toEqual({ css: 0, pixel: 0 });
  });
});

describe("canvasBudget", () => {
  it("keeps fewer canvases on a phone sheet", () => {
    expect(canvasBudget(true)).toBeLessThan(canvasBudget(false));
    expect(canvasBudget(true)).toBe(4);
    expect(canvasBudget(false)).toBe(6);
  });
});

describe("planWindow", () => {
  it("does nothing while no page is in view", () => {
    expect(planWindow({ visible: [], painted: [1, 2, 3], budget: 2, pinned: null })).toEqual({
      paint: [],
      evict: [],
    });
  });

  it("paints the pages in view, nearest to the anchor first", () => {
    const plan = planWindow({ visible: [4, 5, 6, 7], painted: [], budget: 6, pinned: null, anchor: 6 });
    expect(plan.paint).toEqual([6, 7, 5, 4]);
    expect(plan.evict).toEqual([]);
  });

  it("orders around the middle of the view when no anchor is given, later page first on a tie", () => {
    const plan = planWindow({ visible: [1, 2, 3], painted: [], budget: 6, pinned: null });
    expect(plan.paint).toEqual([2, 3, 1]);
  });

  it("skips pages that are already painted", () => {
    const plan = planWindow({ visible: [3, 4, 5], painted: [4], budget: 6, pinned: null, anchor: 4 });
    expect(plan.paint).toEqual([5, 3]);
  });

  it("keeps painted pages within the budget, nearest first and the later one on a tie", () => {
    const plan = planWindow({
      visible: [10, 11],
      painted: [1, 2, 8, 9, 10, 11, 12, 20],
      budget: 4,
      pinned: null,
      anchor: 10,
    });
    expect(plan.paint).toEqual([]);
    expect(plan.evict.sort((a, b) => a - b)).toEqual([1, 2, 8, 20]);
  });

  it("never evicts the pinned page, even past the budget", () => {
    const plan = planWindow({
      visible: [30, 31],
      painted: [3, 29, 30, 31, 32],
      budget: 3,
      pinned: 3,
      anchor: 30,
    });
    expect(plan.evict).not.toContain(3);
    expect(plan.evict.sort((a, b) => a - b)).toEqual([29, 32]);
  });

  it("paints pages in view beyond the budget, up to twice it", () => {
    const plan = planWindow({ visible: [1, 2, 3, 4, 5], painted: [], budget: 3, pinned: null, anchor: 3 });
    expect(plan.paint).toEqual([3, 4, 2, 5, 1]);
  });

  it("caps the pages in view so a layout that does not scroll cannot paint everything", () => {
    const visible = Array.from({ length: 40 }, (_, i) => i + 1);
    const plan = planWindow({ visible, painted: [1, 40], budget: 2, pinned: null, anchor: 3 });
    expect(plan.paint).toEqual([3, 4, 2, 5]);
    expect(plan.evict.sort((a, b) => a - b)).toEqual([1, 40]);
  });

  it("ignores a pinned page that is not painted", () => {
    const plan = planWindow({ visible: [5], painted: [5, 6], budget: 1, pinned: 40, anchor: 5 });
    expect(plan.paint).toEqual([]);
    expect(plan.evict).toEqual([6]);
  });
});
