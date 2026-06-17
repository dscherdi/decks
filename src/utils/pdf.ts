import { arrayBufferToBase64, loadPdfJs } from "obsidian";
import type { RefactorImage } from "@decks/core";

// Longest-edge cap (px) for rendered page images. 720p == 1280x720, so a page's
// longest side is bounded to 1280 — keeps text legible for OCR while bounding
// token cost and mobile canvas memory.
const MAX_EDGE_PX = 1280;

// JPEG quality for rendered OCR page images. JPEG is far smaller than PNG for
// scanned/photographic pages; 0.85 stays legible for OCR.
const JPEG_QUALITY = 0.85;

/** A chapter/subchapter node derived from the PDF outline (bookmarks). */
export interface ChapterNode {
  /** Stable id (path through the outline tree). */
  id: string;
  title: string;
  /** 1-based first page of the section. */
  startPage: number;
  /** 1-based last page (inclusive); equals the document end for the last node. */
  endPage: number;
  children: ChapterNode[];
}

// Minimal structural subset of the pdf.js API we depend on; loadPdfJs() returns
// the full module untyped (Promise<any>), so we narrow it here.
interface TextItem {
  str?: string;
}
interface TextContent {
  items: TextItem[];
}
interface Viewport {
  width: number;
  height: number;
}
interface RenderTask {
  promise: Promise<void>;
}
interface PdfPage {
  getViewport(params: { scale: number }): Viewport;
  getTextContent(): Promise<TextContent>;
  render(params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: Viewport;
  }): RenderTask;
}
interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineItem[];
}
export interface PdfDoc {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  getOutline(): Promise<OutlineItem[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}
interface PdfModule {
  getDocument(params: { data: Uint8Array }): { promise: Promise<PdfDoc> };
}

/**
 * Parse PDF bytes into a pdf.js document via Obsidian's bundled pdf.js.
 * pdf.js transfers (detaches) the buffer it's handed to its worker, so we pass a
 * copy (`bytes.slice(0)`) — the caller's ArrayBuffer stays usable afterwards
 * (e.g. for hashing).
 */
export async function loadPdf(bytes: ArrayBuffer): Promise<PdfDoc> {
  const pdfjs = (await loadPdfJs()) as PdfModule;
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
}

/**
 * Stable cache key for a PDF's bytes. A 32-bit rolling hash over the whole
 * buffer (base36) — changes whenever the file content changes, so editing a PDF
 * invalidates its OCR cache rather than reusing stale text.
 */
export function hashPdf(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let hash = 0;
  for (let i = 0; i < view.length; i++) {
    hash = (hash << 5) - hash + view[i];
    hash = hash & hash;
  }
  return `${view.length.toString(36)}_${Math.abs(hash).toString(36)}`;
}

/** Resolve an outline item's destination to its 1-based page number, or null. */
async function destToPage(
  doc: PdfDoc,
  dest: string | unknown[] | null,
): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const index = await doc.getPageIndex(explicit[0]);
    return index + 1;
  } catch {
    return null;
  }
}

/**
 * Build the chapter tree from the PDF outline, mapping each node to a page
 * range. `endPage` of each node extends to just before the next sibling/parent
 * boundary (or the document end). Falls back to fixed page-range chunks when the
 * PDF has no outline.
 */
export async function extractOutline(doc: PdfDoc): Promise<ChapterNode[]> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline || outline.length === 0) {
    return fixedChunks(doc.numPages);
  }

  // First pass: resolve start pages, preserving tree shape.
  const build = async (
    items: OutlineItem[],
    prefix: string,
  ): Promise<ChapterNode[]> => {
    const nodes: ChapterNode[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const startPage = (await destToPage(doc, item.dest)) ?? 1;
      const id = `${prefix}${i}`;
      nodes.push({
        id,
        title: item.title?.trim() || `Section ${i + 1}`,
        startPage,
        endPage: doc.numPages, // patched below
        children: item.items?.length ? await build(item.items, `${id}.`) : [],
      });
    }
    return nodes;
  };

  const tree = await build(outline, "");

  // Second pass: a node's endPage is one before the next node (in document
  // order) that starts on a later page.
  const flat: ChapterNode[] = [];
  const collect = (nodes: ChapterNode[]): void => {
    for (const n of nodes) {
      flat.push(n);
      collect(n.children);
    }
  };
  collect(tree);
  flat.sort((a, b) => a.startPage - b.startPage);
  for (let i = 0; i < flat.length; i++) {
    let end = doc.numPages;
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].startPage > flat[i].startPage) {
        end = flat[j].startPage - 1;
        break;
      }
    }
    flat[i].endPage = Math.max(flat[i].startPage, end);
  }
  return tree;
}

/** Fallback chapter list for outline-less PDFs: fixed 10-page chunks. */
function fixedChunks(numPages: number, size = 10): ChapterNode[] {
  const nodes: ChapterNode[] = [];
  for (let start = 1; start <= numPages; start += size) {
    const end = Math.min(start + size - 1, numPages);
    nodes.push({
      id: `chunk-${start}`,
      title: `Pages ${start}–${end}`,
      startPage: start,
      endPage: end,
      children: [],
    });
  }
  return nodes;
}

/**
 * Extract a page's embedded text layer (the free, non-Decks-Pro path). Returns
 * little/nothing for scanned pages — those need OCR (a Decks Pro feature).
 */
export async function extractPageText(doc: PdfDoc, pageNum: number): Promise<string> {
  const page = await doc.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items
    .map((it) => it.str ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render a PDF page to a JPEG `RefactorImage`, capping the longest edge to
 * MAX_EDGE_PX (720p). Used for the OCR path and scanned pages.
 */
export async function renderPageImage(
  doc: PdfDoc,
  pageNum: number,
): Promise<RefactorImage> {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_EDGE_PX / Math.max(base.width, base.height), 4);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire 2D canvas context for PDF render");

  // JPEG has no alpha: paint white first so transparent page areas don't
  // composite to black (which would wreck OCR).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Failed to encode PDF page as JPEG");
  const dataBase64 = arrayBufferToBase64(await blob.arrayBuffer());
  return { mimeType: "image/jpeg", dataBase64 };
}

/**
 * How a PDF section is turned into text fed to the generation model. The path is
 * chosen by the active provider — `"ocr"` for Decks Pro (rendered pages → OCR),
 * `"text"` for any BYO provider (free pdf.js embedded-text extraction).
 */
export type PdfParseMode = "text" | "ocr";

/** Runs OCR for the given pages; `onEach` ticks once per page transcribed. */
export type OcrRunner = (
  pagesToOcr: number[],
  onEach?: () => void,
) => Promise<Map<number, string>>;

/**
 * Resolve the selected pages into a single `sourceContext` string. In "text"
 * mode every page uses its embedded text layer (free, on-device); in "ocr" mode
 * every page is transcribed via the injected `ocr` runner (Decks Pro). The `ocr`
 * callback is supplied by the caller (backed by PdfOcrCache).
 *
 * `onProgress(done, total)` fires once per processed page so callers can show a
 * unified per-page loading indicator.
 */
export async function buildSectionContent(
  doc: PdfDoc,
  pages: number[],
  mode: PdfParseMode,
  ocr: OcrRunner,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const total = pages.length;
  let done = 0;
  const tick = (): void => {
    done += 1;
    onProgress?.(done, total);
  };

  const textByPage = new Map<number, string>();
  if (mode === "ocr") {
    const ocrText = await ocr(pages, tick);
    for (const [p, t] of ocrText) textByPage.set(p, t);
  } else {
    for (const p of pages) {
      textByPage.set(p, await extractPageText(doc, p));
      tick();
    }
  }

  const parts: string[] = [];
  for (const p of pages) {
    const t = textByPage.get(p);
    if (t) parts.push(t);
  }
  return parts.join("\n\n");
}

/** Flatten selected chapter ids into the unique, sorted page numbers they cover. */
export function pagesForSelection(
  chapters: ChapterNode[],
  selectedIds: Set<string>,
): number[] {
  const pages = new Set<number>();
  const walk = (nodes: ChapterNode[]): void => {
    for (const n of nodes) {
      if (selectedIds.has(n.id)) {
        for (let p = n.startPage; p <= n.endPage; p++) pages.add(p);
      }
      walk(n.children);
    }
  };
  walk(chapters);
  return [...pages].sort((a, b) => a - b);
}
