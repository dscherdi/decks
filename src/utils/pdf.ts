import { arrayBufferToBase64, loadPdfJs } from "obsidian";
import { passageFrom } from "@decks/core";
import type { PassageText, PdfDoc, PdfPage, RefactorImage } from "@decks/core";
import type { PageScale } from "./pdf-page-layout";

// Pure PDF logic lives in core; this module adds the Obsidian/DOM adapters.
export {
  hashPdf,
  hashImage,
  extractOutline,
  extractPageText,
  buildSectionContent,
  buildSectionPages,
  pageMarker,
  pagesForSelection,
  sectionsForSelection,
} from "@decks/core";
export type {
  ChapterNode,
  PageText,
  PdfDoc,
  PdfParseMode,
  OcrRunner,
  SelectedSection,
} from "@decks/core";

// Longest-edge cap (px) for rendered page images (720p) — legible for OCR while
// bounding token cost and mobile canvas memory.
const MAX_EDGE_PX = 1280;

// JPEG quality for rendered OCR page images (smaller than PNG, still legible).
const JPEG_QUALITY = 0.85;

interface PdfModule {
  getDocument(params: { data: Uint8Array; ownerDocument?: Document }): { promise: Promise<PdfDoc> };
}

/**
 * Parse PDF bytes into a pdf.js document via Obsidian's bundled pdf.js. pdf.js
 * detaches the buffer it's handed, so we pass a copy and leave the caller's intact.
 */
export async function loadPdf(bytes: ArrayBuffer, ownerDocument?: Document): Promise<PdfDoc> {
  const pdfjs = (await loadPdfJs()) as PdfModule;
  // pdf.js registers the document's fonts in this window; a popout's canvas cannot use the main window's.
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), ownerDocument }).promise;
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

  const canvas = activeDocument.createElement("canvas");
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

type PageViewport = ReturnType<PdfPage["getViewport"]>;
type PageRenderTask = ReturnType<PdfPage["render"]>;
type PageTextContent = Awaited<ReturnType<PdfPage["getTextContent"]>>;
type TextSource = ReadableStream<PageTextContent> | PageTextContent;

interface TextLayerParams {
  textContentSource: TextSource;
  container: HTMLElement;
  viewport: PageViewport;
}
interface TextLayerInstance {
  render(): Promise<void>;
  cancel(): void;
}
interface TextLayerTask {
  promise: Promise<void>;
  cancel(): void;
}

/** Newer pdf.js builds export a TextLayer class, older ones renderTextLayer; either may be absent. */
interface PdfTextApi {
  TextLayer?: new (params: TextLayerParams) => TextLayerInstance;
  renderTextLayer?: (params: TextLayerParams & { textDivs: HTMLElement[] }) => TextLayerTask;
}

interface StreamingPage extends PdfPage {
  streamTextContent(): ReadableStream<PageTextContent>;
}
interface CleanablePage extends PdfPage {
  cleanup(): void;
}
interface CancellableTask extends PageRenderTask {
  cancel(): void;
}

function canStreamText(page: PdfPage): page is StreamingPage {
  return "streamTextContent" in page && typeof page.streamTextContent === "function";
}
function canCleanUp(page: PdfPage): page is CleanablePage {
  return "cleanup" in page && typeof page.cleanup === "function";
}
function canCancel(task: PageRenderTask): task is CancellableTask {
  return "cancel" in task && typeof task.cancel === "function";
}

let textApi: PdfTextApi | null = null;
async function pdfTextApi(): Promise<PdfTextApi> {
  if (!textApi) {
    const lib: PdfTextApi = await loadPdfJs();
    textApi = lib;
  }
  return textApi;
}

/** A page painted into a page element, until it is released. */
export interface PagePaint {
  /** True when the page has selectable text; false when it is image-only or was released. */
  readonly done: Promise<boolean>;
  /** Stop painting and remove the canvas and the text layer. */
  release(): void;
}

/**
 * Paint `page` into `pageEl` as a canvas plus a selectable text layer laid over it.
 * The element is expected to be `scale.css` times the page's width.
 */
export function paintPage(page: PdfPage, pageEl: HTMLElement, scale: PageScale): PagePaint {
  const layout = page.getViewport({ scale: scale.css });
  const paintView = page.getViewport({ scale: scale.pixel });
  // The variables pdf.js sizes and places the text layer with.
  pageEl.setCssProps({
    "--scale-factor": String(scale.css),
    "--user-unit": "1",
    "--total-scale-factor": String(scale.css),
    "--scale-round-x": "1px",
    "--scale-round-y": "1px",
  });
  const canvas = pageEl.createEl("canvas", { cls: "decks-pdf-canvas" });
  canvas.width = Math.max(1, Math.ceil(paintView.width));
  canvas.height = Math.max(1, Math.ceil(paintView.height));
  const textEl = pageEl.createDiv({ cls: "decks-pdf-text-layer" });

  let released = false;
  let canvasTask: PageRenderTask | null = null;
  let textTask: { cancel(): void } | null = null;

  const paintCanvas = async (): Promise<void> => {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to acquire 2D canvas context for PDF page");
    canvasTask = page.render({ canvasContext: ctx, viewport: paintView });
    await canvasTask.promise;
  };

  const paintText = async (): Promise<boolean> => {
    const api = await pdfTextApi();
    if (released) return false;
    const source = canStreamText(page) ? page.streamTextContent() : await page.getTextContent();
    if (released) return false;
    if (api.TextLayer) {
      const layer = new api.TextLayer({ textContentSource: source, container: textEl, viewport: layout });
      textTask = layer;
      await layer.render();
    } else if (api.renderTextLayer) {
      const task = api.renderTextLayer({
        textContentSource: source,
        container: textEl,
        viewport: layout,
        textDivs: [],
      });
      textTask = task;
      await task.promise;
    } else {
      return false;
    }
    return (textEl.textContent ?? "").trim().length > 0;
  };

  const done = (async (): Promise<boolean> => {
    try {
      const [, hasText] = await Promise.all([paintCanvas(), paintText().catch(() => false)]);
      return !released && hasText;
    } catch (e) {
      // A released page's render rejects as cancelled; that is not a failure.
      if (released) return false;
      throw e;
    }
  })();

  return {
    done,
    release(): void {
      if (released) return;
      released = true;
      if (canvasTask && canCancel(canvasTask)) canvasTask.cancel();
      textTask?.cancel();
      // A zero-sized canvas frees its pixels now rather than at the next collection.
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      textEl.remove();
    },
  };
}

/** Let pdf.js drop the page's cached resources; it defers this while the page is still rendering. */
export function releasePdfPage(page: PdfPage): void {
  if (canCleanUp(page)) page.cleanup();
}

/** The passage selected inside `root`, or null when nothing usable is selected there. */
export function readPanelSelection(root: HTMLElement): PassageText | null {
  const selection = root.doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const anchor = selection.anchorNode;
  if (!anchor || !root.contains(anchor)) return null;
  const range = selection.getRangeAt(0);
  const start = pageOf(range.startContainer);
  // A passage that spans pages has no one page to cite; a wrong page is worse than none.
  const pageAttr = start !== null && start === pageOf(range.endContainer) ? start : null;
  return passageFrom(selection.toString(), pageAttr);
}

function pageOf(node: Node): string | null {
  const el = node.instanceOf(Element) ? node : node.parentElement;
  return el?.closest("[data-page-number]")?.getAttribute("data-page-number") ?? null;
}
