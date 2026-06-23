import TurndownService from "turndown";

let service: TurndownService | null = null;

function getService(): TurndownService {
  if (service) return service;
  const created = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  // Anki templates carry heavy CSS/JS — drop it rather than convert it.
  created.remove(["style", "script"]);
  // Decks markdown tokens already injected upstream (![[…]], ==…==, $…$) must
  // pass through untouched — disable turndown's markdown escaping.
  created.escape = (text: string) => text;
  service = created;
  return created;
}

/**
 * Convert an HTML fragment to markdown via turndown. Relies on the main-thread
 * DOM (Electron), so it is injected into core's Anki sanitizer rather than living
 * in the DOM-free core package.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return getService().turndown(html);
}
