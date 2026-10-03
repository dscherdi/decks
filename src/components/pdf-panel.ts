/** The views of the generator's PDF panel, in the order the switcher shows them. */
export type PdfPanelView = "chapters" | "pages" | "concepts" | "blueprint";

export const PDF_PANE_MIN_WIDTH = 280;
export const PDF_PANE_DEFAULT_WIDTH = 440;

/** Concepts needs a concept ledger; Blueprint needs the exam planner and multiple choice. */
export function pdfPanelViews(o: { concepts: boolean; blueprint: boolean }): PdfPanelView[] {
  const views: PdfPanelView[] = ["chapters", "pages"];
  if (o.concepts) views.push("concepts");
  if (o.blueprint) views.push("blueprint");
  return views;
}

/** The view to show; the requested one is kept so it comes back once it is offered again. */
export function shownPdfView(
  requested: PdfPanelView,
  available: readonly PdfPanelView[],
): PdfPanelView {
  return available.includes(requested) ? requested : "chapters";
}

/** A PDF chip opens the panel on that PDF, and closes it when it is already showing it. */
export function chipToggle(
  s: { open: boolean; activeId: string | null },
  id: string,
): { open: boolean; activeId: string } {
  if (s.open && s.activeId === id) return { open: false, activeId: id };
  return { open: true, activeId: id };
}

/** The widest the pane may be: 70% of the view, never under the minimum. */
export function paneMaxWidth(containerWidth: number): number {
  return Math.max(PDF_PANE_MIN_WIDTH, Math.floor((containerWidth * 7) / 10));
}

/** Keep a dragged pane width usable: never below the minimum, never more than 70% of the view. */
export function clampPaneWidth(width: number, containerWidth: number): number {
  const max = paneMaxWidth(containerWidth);
  if (!Number.isFinite(width)) return Math.min(PDF_PANE_DEFAULT_WIDTH, max);
  return Math.round(Math.min(Math.max(width, PDF_PANE_MIN_WIDTH), max));
}
