import { chipToggle, clampPaneWidth, paneMaxWidth, pdfPanelViews, shownPdfView } from "../components/pdf-panel";

describe("the PDF panel's views", () => {
  it("always offers chapters and pages, then concepts and blueprint when available", () => {
    expect(pdfPanelViews({ concepts: false, blueprint: false })).toEqual(["chapters", "pages"]);
    expect(pdfPanelViews({ concepts: true, blueprint: true })).toEqual([
      "chapters",
      "pages",
      "concepts",
      "blueprint",
    ]);
  });

  it("puts the cards first once there are any, and keeps only them without a PDF", () => {
    expect(pdfPanelViews({ cards: true, concepts: true, blueprint: false })).toEqual([
      "cards",
      "chapters",
      "pages",
      "concepts",
    ]);
    expect(pdfPanelViews({ cards: true, pdf: false, concepts: true, blueprint: true })).toEqual(["cards"]);
    expect(shownPdfView("chapters", ["cards"])).toBe("cards");
  });

  it("falls back to chapters when the requested view is not offered", () => {
    const basic = pdfPanelViews({ concepts: true, blueprint: false });
    expect(shownPdfView("blueprint", basic)).toBe("chapters");
    expect(shownPdfView("concepts", basic)).toBe("concepts");
  });
});

describe("a PDF chip", () => {
  it("opens the panel, switches PDFs, and closes on a second click", () => {
    let s: { open: boolean; activeId: string | null } = { open: false, activeId: null };
    s = chipToggle(s, "a");
    expect(s).toEqual({ open: true, activeId: "a" });
    s = chipToggle(s, "b");
    expect(s).toEqual({ open: true, activeId: "b" });
    s = chipToggle(s, "b");
    expect(s).toEqual({ open: false, activeId: "b" });
  });
});

describe("the pane width", () => {
  it("stays between the minimum and 70% of the view", () => {
    expect(clampPaneWidth(100, 1400)).toBe(280);
    expect(clampPaneWidth(1200, 1400)).toBe(980);
    expect(clampPaneWidth(500.4, 1400)).toBe(500);
    expect(clampPaneWidth(Number.NaN, 1400)).toBe(440);
    expect(clampPaneWidth(600, 300)).toBe(280);
    expect(paneMaxWidth(1400)).toBe(980);
    expect(paneMaxWidth(0)).toBe(280);
  });
});
