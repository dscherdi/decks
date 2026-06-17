import {
  type ChapterNode,
  type PdfDoc,
  buildSectionContent,
  extractOutline,
  hashPdf,
  pagesForSelection,
} from "../utils/pdf";

/** Build a fake pdf.js document from per-page text and an optional outline. */
function fakeDoc(opts: {
  pages: string[];
  outline?: Array<{ title: string; page: number }> | null;
}): PdfDoc {
  const { pages, outline } = opts;
  return {
    numPages: pages.length,
    async getPage(pageNumber: number) {
      const text = pages[pageNumber - 1] ?? "";
      return {
        getViewport: () => ({ width: 100, height: 100 }),
        async getTextContent() {
          return { items: text ? [{ str: text }] : [] };
        },
        render: () => ({ promise: Promise.resolve() }),
      };
    },
    async getOutline() {
      if (!outline) return null;
      // Encode each item's destination as an explicit [pageIndexRef] array.
      return outline.map((o) => ({
        title: o.title,
        dest: [{ pageIndex: o.page - 1 }],
        items: [],
      }));
    },
    async getDestination() {
      return null;
    },
    async getPageIndex(ref: unknown) {
      return (ref as { pageIndex: number }).pageIndex;
    },
  };
}

describe("hashPdf", () => {
  it("is deterministic for identical bytes", () => {
    const a = new Uint8Array([1, 2, 3, 4]).buffer;
    const b = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(hashPdf(a)).toBe(hashPdf(b));
  });

  it("changes when the content changes", () => {
    const a = new Uint8Array([1, 2, 3, 4]).buffer;
    const b = new Uint8Array([1, 2, 3, 5]).buffer;
    expect(hashPdf(a)).not.toBe(hashPdf(b));
  });

  it("still works on the caller's buffer after pdf.js detaches a copy", () => {
    // Regression: loadPdf passes a copy (bytes.slice(0)) to pdf.js, which
    // transfers/detaches it. The caller's buffer must remain usable for hashing.
    const bytes = new Uint8Array([9, 8, 7, 6, 5]).buffer;
    // Simulate pdf.js transferring the copy by detaching it (structuredClone
    // transfer); the original `bytes` must be unaffected.
    const copy = bytes.slice(0);
    structuredClone(copy, { transfer: [copy] }); // detaches `copy`, not `bytes`
    expect(() => hashPdf(bytes)).not.toThrow();
    expect(hashPdf(bytes)).toBe(hashPdf(new Uint8Array([9, 8, 7, 6, 5]).buffer));
  });
});

describe("extractOutline", () => {
  it("maps outline nodes to page ranges and patches end pages", async () => {
    const doc = fakeDoc({
      pages: ["one", "two", "three", "four", "five"],
      outline: [
        { title: "Chapter 1", page: 1 },
        { title: "Chapter 2", page: 3 },
      ],
    });
    const chapters = await extractOutline(doc);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ title: "Chapter 1", startPage: 1, endPage: 2 });
    expect(chapters[1]).toMatchObject({ title: "Chapter 2", startPage: 3, endPage: 5 });
  });

  it("falls back to fixed page-range chunks when there is no outline", async () => {
    const pages = Array.from({ length: 25 }, (_, i) => `page ${i}`);
    const chapters = await extractOutline(fakeDoc({ pages, outline: null }));
    expect(chapters).toHaveLength(3); // 10 + 10 + 5
    expect(chapters[0]).toMatchObject({ startPage: 1, endPage: 10 });
    expect(chapters[2]).toMatchObject({ startPage: 21, endPage: 25 });
  });
});

describe("pagesForSelection", () => {
  const tree: ChapterNode[] = [
    {
      id: "0",
      title: "A",
      startPage: 1,
      endPage: 4,
      children: [
        { id: "0.0", title: "A.1", startPage: 1, endPage: 2, children: [] },
        { id: "0.1", title: "A.2", startPage: 3, endPage: 4, children: [] },
      ],
    },
    { id: "1", title: "B", startPage: 5, endPage: 6, children: [] },
  ];

  it("returns the unique sorted pages of the selected nodes", () => {
    expect(pagesForSelection(tree, new Set(["0.1", "1"]))).toEqual([3, 4, 5, 6]);
  });

  it("dedupes overlapping parent + child selections", () => {
    expect(pagesForSelection(tree, new Set(["0", "0.0"]))).toEqual([1, 2, 3, 4]);
  });

  it("returns nothing when no chapter is selected", () => {
    expect(pagesForSelection(tree, new Set())).toEqual([]);
  });
});

describe("buildSectionContent", () => {
  const ALPHA = "alpha paragraph with plenty of embedded text";
  const GAMMA = "gamma paragraph with plenty of embedded text";
  const doc = fakeDoc({ pages: [ALPHA, "", GAMMA] });

  it("text mode reads embedded text and never OCRs", async () => {
    const ocr = jest.fn();
    const out = await buildSectionContent(doc, [1, 3], "text", ocr);
    expect(out).toBe(`${ALPHA}\n\n${GAMMA}`);
    expect(ocr).not.toHaveBeenCalled();
  });

  it("ocr mode sends every page through the OCR runner", async () => {
    const ocr = jest.fn(async (pages: number[]) =>
      new Map(pages.map((p) => [p, `ocr-${p}`])),
    );
    const out = await buildSectionContent(doc, [1, 2], "ocr", ocr);
    expect(ocr).toHaveBeenCalledWith([1, 2], expect.any(Function));
    expect(out).toBe("ocr-1\n\nocr-2");
  });

  it("reports per-page progress as pages are processed", async () => {
    // OCR runner ticks onEach per page, mirroring PdfOcrCache.runOcr.
    const ocr = jest.fn(async (pages: number[], onEach?: () => void) => {
      for (const _ of pages) onEach?.();
      return new Map(pages.map((p) => [p, `ocr-${p}`]));
    });
    const progress: Array<[number, number]> = [];
    await buildSectionContent(doc, [1, 2, 3], "ocr", ocr, (done, total) =>
      progress.push([done, total]),
    );
    // 3 pages → 3 ticks, monotonically increasing, total stable.
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("text mode reports progress per embedded-text page read", async () => {
    const ocr = jest.fn();
    const progress: Array<[number, number]> = [];
    await buildSectionContent(doc, [1, 3], "text", ocr, (done, total) =>
      progress.push([done, total]),
    );
    expect(ocr).not.toHaveBeenCalled();
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});
