/** Layout rules for the generator's Pages view, kept apart from the DOM so they can be tested. */

/** Device pixels one painted page may use; much larger canvases fail on some mobile webviews. */
export const MAX_PAGE_PIXELS = 4_200_000;

/** Painted pages kept beyond the ones in view. A phone sheet keeps fewer. */
export function canvasBudget(compact: boolean): number {
  return compact ? 4 : 6;
}

export interface PageScale {
  /** PDF units to CSS pixels: the page fitted to the column width. */
  css: number;
  /** PDF units to canvas pixels: sharp on dense screens, but never past the pixel cap. */
  pixel: number;
}

/** Zero scales mean the page cannot be laid out yet (no width, or an empty page box). */
export function renderScale(
  cssWidth: number,
  page: { width: number; height: number },
  dpr: number,
  maxPixels = MAX_PAGE_PIXELS,
): PageScale {
  if (!(cssWidth > 0) || !(page.width > 0) || !(page.height > 0)) return { css: 0, pixel: 0 };
  const css = cssWidth / page.width;
  const density = Number.isFinite(dpr) ? Math.min(Math.max(dpr, 1), 2) : 1;
  const ceiling = Math.sqrt(maxPixels / (page.width * page.height));
  return { css, pixel: Math.min(css * density, ceiling) };
}

export interface PaintPlan {
  /** Pages in view without a canvas, nearest to the anchor first. */
  paint: number[];
  /** Painted pages to release. */
  evict: number[];
}

/**
 * Pages in view are painted nearest the anchor first, at most twice the budget of them. Other
 * painted pages stay, nearest first, while the budget allows; the pinned page always stays.
 */
export function planWindow(o: {
  visible: readonly number[];
  painted: readonly number[];
  budget: number;
  pinned: number | null;
  anchor?: number | null;
}): PaintPlan {
  if (o.visible.length === 0) return { paint: [], evict: [] };
  const anchor = o.anchor ?? (Math.min(...o.visible) + Math.max(...o.visible)) / 2;
  // Ties go to the later page, the one a reader reaches next.
  const nearer = (a: number, b: number): number =>
    Math.abs(a - anchor) - Math.abs(b - anchor) || b - a;

  const painted = new Set(o.painted);
  const inView = [...o.visible].sort(nearer).slice(0, Math.max(1, o.budget * 2));
  const kept = new Set(inView);
  if (o.pinned !== null && painted.has(o.pinned)) kept.add(o.pinned);
  const spare = o.painted.filter((p) => !kept.has(p)).sort(nearer);
  for (const p of spare) {
    if (kept.size >= o.budget) break;
    kept.add(p);
  }
  return {
    paint: inView.filter((p) => !painted.has(p)),
    evict: o.painted.filter((p) => !kept.has(p)),
  };
}
