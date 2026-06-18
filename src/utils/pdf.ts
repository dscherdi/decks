import { arrayBufferToBase64, loadPdfJs } from "obsidian";
import type { PdfDoc, PdfPage, RefactorImage } from "@decks/core";

// Pure PDF logic lives in core; this module adds the Obsidian/DOM adapters.
export {
  hashPdf,
  hashImage,
  extractOutline,
  extractPageText,
  buildSectionContent,
  pagesForSelection,
} from "@decks/core";
export type { ChapterNode, PdfDoc, PdfParseMode, OcrRunner } from "@decks/core";

// Longest-edge cap (px) for rendered page images (720p) — legible for OCR while
// bounding token cost and mobile canvas memory.
const MAX_EDGE_PX = 1280;

// JPEG quality for rendered OCR page images (smaller than PNG, still legible).
const JPEG_QUALITY = 0.85;

interface PdfModule {
  getDocument(params: { data: Uint8Array }): { promise: Promise<PdfDoc> };
}

/**
 * Parse PDF bytes into a pdf.js document via Obsidian's bundled pdf.js. pdf.js
 * detaches the buffer it's handed, so we pass a copy and leave the caller's intact.
 */
export async function loadPdf(bytes: ArrayBuffer): Promise<PdfDoc> {
  const pdfjs = (await loadPdfJs()) as PdfModule;
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
}

/** Render a PDF page to a JPEG image, capping the longest edge to 720p. */
export async function renderPageImage(
  doc: PdfDoc,
  pageNum: number,
): Promise<RefactorImage> {
  const page: PdfPage = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_EDGE_PX / Math.max(base.width, base.height), 4);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire 2D canvas context for PDF render");

  // JPEG has no alpha: paint white first so transparent areas don't go black.
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
