import type { App } from "obsidian";
import type { AiProviderConfig, HttpClient } from "@decks/core";
import { PdfOcrCache } from "../services/PdfOcrCache";
import type { PdfDoc } from "../utils/pdf";

/** In-memory DataAdapter-backed App for exercising the cache's file I/O. */
function fakeApp(): { app: App; store: Map<string, string> } {
  const store = new Map<string, string>();
  const dirs = new Set<string>();
  const app = {
    vault: {
      adapter: {
        exists: async (p: string) => store.has(p) || dirs.has(p),
        read: async (p: string) => store.get(p) ?? "",
        write: async (p: string, data: string) => void store.set(p, data),
        mkdir: async (p: string) => void dirs.add(p),
      },
    },
  } as unknown as App;
  return { app, store };
}

const noHttp = {} as HttpClient;
const noConfig = (): Promise<AiProviderConfig> =>
  Promise.resolve({ provider: "decks-pro", model: "x", apiKey: "k" });

describe("PdfOcrCache get/set", () => {
  const OCR = "decks-ocr-fast";

  it("returns null on a miss and the stored text after a set", async () => {
    const { app } = fakeApp();
    const cache = new PdfOcrCache(app, () => "pdf-ocr", noConfig, noHttp);

    expect(await cache.get("hash1", OCR, 3)).toBeNull();
    await cache.set("hash1", OCR, 3, "page three text");
    expect(await cache.get("hash1", OCR, 3)).toBe("page three text");
  });

  it("writes per-page files under <folder>/<hash>/<ocrModel>/<page>.md", async () => {
    const { app, store } = fakeApp();
    const cache = new PdfOcrCache(app, () => "cache/pdf", noConfig, noHttp);
    await cache.set("abc", OCR, 7, "hello");
    expect(store.get(`cache/pdf/abc/${OCR}/7.md`)).toBe("hello");
  });

  it("caches the two tiers separately", async () => {
    const { app } = fakeApp();
    const cache = new PdfOcrCache(app, () => "pdf-ocr", noConfig, noHttp);
    await cache.set("h", "decks-ocr-fast", 1, "fast text");
    expect(await cache.get("h", "decks-ocr-quality", 1)).toBeNull();
    expect(await cache.get("h", "decks-ocr-fast", 1)).toBe("fast text");
  });
});

describe("PdfOcrCache.runOcr", () => {
  const OCR = "decks-ocr-fast";

  it("serves fully-cached pages without invoking the model", async () => {
    const { app } = fakeApp();
    const cache = new PdfOcrCache(app, () => "pdf-ocr", noConfig, noHttp);
    await cache.set("h", OCR, 1, "one");
    await cache.set("h", OCR, 2, "two");

    const progress: boolean[] = [];
    const result = await cache.runOcr({} as PdfDoc, "h", OCR, [1, 2], (p) =>
      progress.push(p.fromCache),
    );

    expect(result.get(1)).toBe("one");
    expect(result.get(2)).toBe("two");
    // Both pages came from cache, so no render/model call was needed.
    expect(progress).toEqual([true, true]);
  });

  it("returns every page (keyed by page number) for a large cached set", async () => {
    const { app } = fakeApp();
    const cache = new PdfOcrCache(app, () => "pdf-ocr", noConfig, noHttp);
    const pages = Array.from({ length: 20 }, (_, i) => i + 1);
    for (const p of pages) await cache.set("h", OCR, p, `page-${p}`);

    let done = 0;
    const result = await cache.runOcr({} as PdfDoc, "h", OCR, pages, () => done++);

    // The sliding-window pool resolves all pages regardless of completion order.
    expect(result.size).toBe(20);
    for (const p of pages) expect(result.get(p)).toBe(`page-${p}`);
    expect(done).toBe(20);
  });
});
