// The PDF panel replaced a sidebar reader, three header toggles and a model chip;
// these scans keep them from coming back by accident.

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const src = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(src, rel), "utf8");

describe("the merged PDF panel", () => {
  it("leaves no sidebar reader behind", () => {
    const main = read("main.ts");
    expect(main).not.toMatch(/VIEW_TYPE_AI_READER|AiReaderView|readerView\(|registerReaderSelection/);
    expect(main).not.toContain("open-ai-reader");
    for (const gone of [
      "components/AiReaderView.ts",
      "components/AiReaderPanel.svelte",
      "components/PdfSelectionPopover.ts",
      "services/PdfSelection.ts",
    ]) {
      expect(existsSync(path.join(src, gone))).toBe(false);
    }
  });

  it("opens from the PDF rather than from header toggles", () => {
    const gen = read("components/AiGeneratorModal.svelte");
    expect(gen).not.toContain("showChapters");
    expect(gen).not.toContain("decks-ai-gen-model-chip");
    expect(gen).toContain("togglePdfPanel");
  });

  it("builds the pages view without innerHTML or inline styles", () => {
    for (const rel of ["components/PdfPagesView.svelte", "utils/pdf.ts"]) {
      const text = read(rel);
      expect(text).not.toMatch(/innerHTML|outerHTML/);
      expect(text).not.toMatch(/\.style\.[a-zA-Z]/);
      expect(text).not.toMatch(/\sstyle:[\w-]+=/);
    }
  });

  it("never builds a page link from link text", () => {
    for (const rel of ["main.ts", "components/AiGeneratorModal.svelte"]) {
      expect(read(rel)).not.toMatch(/openLinkText\([^)]*#page=/);
    }
  });
});
