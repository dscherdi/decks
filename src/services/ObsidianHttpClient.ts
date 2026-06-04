import { requestUrl } from "obsidian";
import type { HttpClient, HttpRequest, HttpResponse } from "@decks/core";

/**
 * HttpClient backed by Obsidian's `requestUrl`, which bypasses browser CORS so
 * provider REST endpoints (OpenAI, Anthropic, Gemini, local servers) are
 * reachable from the renderer. `throw: false` lets the core layer inspect
 * non-2xx status codes and map them to typed errors itself.
 */
export class ObsidianHttpClient implements HttpClient {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const res = await requestUrl({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body,
      throw: false,
    });
    return { status: res.status, text: res.text };
  }

  /**
   * Streaming transport via `fetch` (the only renderer API that exposes a
   * readable body). Unlike `requestUrl` this is subject to CORS, so callers fall
   * back to `request()` when a provider rejects browser streaming. Decodes the
   * byte stream to text and forwards each chunk to `onChunk`.
   */
  async stream(
    req: HttpRequest,
    onChunk: (text: string) => void,
  ): Promise<void> {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Provider returned ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!res.body) {
      throw new Error("Streaming response had no body");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) onChunk(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onChunk(tail);
  }
}
