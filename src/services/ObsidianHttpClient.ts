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
}
