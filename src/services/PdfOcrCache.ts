import { type App, normalizePath } from "obsidian";
import {
  type AiProviderConfig,
  type HttpClient,
  type ILogger,
  type RefactorImage,
  AiError,
  createProvider,
  yieldToUI,
} from "@decks/core";
import type { PdfDoc } from "../utils/pdf";
import { renderPageImage } from "../utils/pdf";

// How many page OCR calls run concurrently. A sliding window keeps this many
// requests in flight at all times (no per-batch barrier), bounded by network
// fan-out / provider rate limits and peak canvas memory (each render holds a
// full-page bitmap).
const OCR_CONCURRENCY = 8;

// Bounded retry for a single page's OCR call on transient upstream failures
// (rate limits / 5xx / network), so the busier pipeline doesn't fail a whole
// run on a flaky page.
const OCR_MAX_ATTEMPTS = 3;
const OCR_RETRY_BASE_MS = 300;

const OCR_SYSTEM = [
  "You are an OCR engine. Transcribe the page image into clean Markdown.",
  "Preserve headings, lists, tables, and paragraph structure.",
  "Transcribe mathematical notation as $LaTeX$.",
  "Output only the transcribed content — no commentary, preamble, or code fences.",
  "If the page is blank, output nothing.",
].join(" ");

const OCR_USER = "Transcribe this page.";

/** Reports OCR progress so the UI can show a per-page indicator. */
export interface OcrProgress {
  page: number;
  done: number;
  total: number;
  fromCache: boolean;
}

/** Per-page OCR exchange surfaced to the debug panel (only on a cache miss). */
export interface OcrDebugEntry {
  page: number;
  /** OCR sentinel (`decks-ocr-*`) sent to the backend. */
  model: string;
  system: string;
  user: string;
  /** `data:image/jpeg;base64,…` of the rendered page sent for OCR. */
  imageDataUrl: string;
  raw: string;
}

/**
 * Vault-backed per-page OCR text store. Renders selected PDF pages to images and
 * transcribes them with the tier's OCR model (the `ocrModel` sentinel), caching
 * each page's text on disk under
 * `<pdfHash>/<ocrModel>/<page>.md` — so each tier caches separately.
 * A second run over the same PDF/pages/tier reads from disk and never calls the
 * model again.
 */
export class PdfOcrCache {
  constructor(
    private readonly app: App,
    private readonly resolveFolder: () => string,
    private readonly buildConfig: () => Promise<AiProviderConfig>,
    private readonly http: HttpClient,
    private readonly logger?: ILogger,
  ) {}

  private dirPath(pdfHash: string, ocrModel: string): string {
    return normalizePath(`${this.resolveFolder()}/${pdfHash}/${ocrModel}`);
  }

  private pagePath(pdfHash: string, ocrModel: string, pageNum: number): string {
    return normalizePath(`${this.dirPath(pdfHash, ocrModel)}/${pageNum}.md`);
  }

  /** Cached OCR text for a page, or null on a miss. */
  async get(
    pdfHash: string,
    ocrModel: string,
    pageNum: number,
  ): Promise<string | null> {
    const path = this.pagePath(pdfHash, ocrModel, pageNum);
    try {
      if (await this.app.vault.adapter.exists(path)) {
        return await this.app.vault.adapter.read(path);
      }
    } catch (e) {
      this.logger?.debug(`PDF OCR cache read failed for ${path}: ${String(e)}`);
    }
    return null;
  }

  /** Persist OCR text for a page (overwrites). */
  async set(
    pdfHash: string,
    ocrModel: string,
    pageNum: number,
    text: string,
  ): Promise<void> {
    const path = this.pagePath(pdfHash, ocrModel, pageNum);
    const base = normalizePath(`${this.resolveFolder()}/${pdfHash}`);
    const dir = this.dirPath(pdfHash, ocrModel);
    try {
      if (!(await this.app.vault.adapter.exists(base))) {
        await this.app.vault.adapter.mkdir(base);
      }
      if (!(await this.app.vault.adapter.exists(dir))) {
        await this.app.vault.adapter.mkdir(dir);
      }
      await this.app.vault.adapter.write(path, text);
    } catch (e) {
      this.logger?.debug(`PDF OCR cache write failed for ${path}: ${String(e)}`);
    }
  }

  /** OCR a single page image via the tier's OCR model, retrying transient errors. */
  private async ocrImage(
    image: RefactorImage,
    ocrModel: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const config = await this.buildConfig();
    config.model = ocrModel;
    const provider = createProvider(config, this.http);
    let lastErr: unknown;
    for (let attempt = 0; attempt < OCR_MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw new AiError("aborted", "OCR aborted");
      try {
        const raw = await provider.complete({
          system: OCR_SYSTEM,
          user: OCR_USER,
          images: [image],
          signal,
          json: false,
        });
        return raw.trim();
      } catch (e) {
        // Empty model output is a valid blank page (the OCR prompt says "output
        // nothing" for blanks); don't treat it as an error.
        if (e instanceof AiError && e.code === "invalid_output") return "";
        lastErr = e;
        const last = attempt === OCR_MAX_ATTEMPTS - 1;
        if (signal?.aborted || last || !isTransient(e)) throw e;
        this.logger?.debug(
          `OCR transient error (attempt ${attempt + 1}), retrying: ${String(e)}`,
        );
        await delay(OCR_RETRY_BASE_MS * (attempt + 1), signal);
      }
    }
    throw lastErr;
  }

  /** Resolve one page: cache hit, or render → OCR → cache. Returns the rendered
   * image on a miss (for the debug panel). */
  private async ocrPage(
    doc: PdfDoc,
    pdfHash: string,
    ocrModel: string,
    pageNum: number,
    signal?: AbortSignal,
  ): Promise<{ text: string; fromCache: boolean; image?: RefactorImage }> {
    const cached = await this.get(pdfHash, ocrModel, pageNum);
    if (cached !== null) return { text: cached, fromCache: true };
    const image = await renderPageImage(doc, pageNum);
    const text = await this.ocrImage(image, ocrModel, signal);
    await this.set(pdfHash, ocrModel, pageNum, text);
    return { text, fromCache: false, image };
  }

  /**
   * OCR the given pages of `doc` with the tier's `ocrModel`, returning their text
   * keyed by page number. Uses a sliding-window worker pool that keeps
   * `OCR_CONCURRENCY` pages in flight at all times (no per-batch barrier) — as one
   * page finishes the next queued page starts immediately. Cache hits (same
   * pdf/tier/page) resolve without a model call.
   */
  async runOcr(
    doc: PdfDoc,
    pdfHash: string,
    ocrModel: string,
    pages: number[],
    onProgress?: (p: OcrProgress) => void,
    signal?: AbortSignal,
    onDebug?: (e: OcrDebugEntry) => void,
  ): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    let done = 0;
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (!signal?.aborted) {
        const i = nextIndex++;
        if (i >= pages.length) return;
        const pageNum = pages[i];
        try {
          const { text, fromCache, image } = await this.ocrPage(
            doc,
            pdfHash,
            ocrModel,
            pageNum,
            signal,
          );
          out.set(pageNum, text);
          onProgress?.({ page: pageNum, done: ++done, total: pages.length, fromCache });
          if (onDebug && !fromCache && image) {
            onDebug({
              page: pageNum,
              model: ocrModel,
              system: OCR_SYSTEM,
              user: OCR_USER,
              imageDataUrl: `data:${image.mimeType};base64,${image.dataBase64}`,
              raw: text,
            });
          }
        } catch (e) {
          // Abort stops the whole run; any other persistent per-page failure
          // degrades that page to empty text so one bad page can't abort the
          // chapter (or leak the other in-flight workers).
          if (signal?.aborted || (e instanceof AiError && e.code === "aborted")) {
            throw e;
          }
          this.logger?.debug(`OCR page ${pageNum} failed, skipping: ${String(e)}`);
          out.set(pageNum, "");
          onProgress?.({
            page: pageNum,
            done: ++done,
            total: pages.length,
            fromCache: false,
          });
        }
        await yieldToUI();
      }
    };

    const poolSize = Math.min(OCR_CONCURRENCY, pages.length);
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
    return out;
  }
}

/** Whether an error is worth retrying (rate limit / 5xx / transient network). */
function isTransient(e: unknown): boolean {
  if (!(e instanceof AiError)) return false;
  if (e.code === "rate_limited" || e.code === "network_error") return true;
  return e.status !== undefined && (e.status === 429 || e.status >= 500);
}

/** Sleep that rejects early if the signal aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new AiError("aborted", "OCR aborted"));
      },
      { once: true },
    );
  });
}
