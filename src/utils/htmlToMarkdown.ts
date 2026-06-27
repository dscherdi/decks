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
  // Markdown can't express these; keep them as raw inline HTML (Obsidian renders
  // it) so we don't lose sub/super-scripts, tables, etc.
  created.keep([
    "sub",
    "sup",
    "u",
    "kbd",
    "mark",
    "ins",
    "del",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "caption",
  ]);
  // Keep colored/styled <span>/<font> (drop plain wrappers to avoid Anki's noise).
  const keepStyled = {
    filter: (node: HTMLElement): boolean => {
      const name = node.nodeName.toLowerCase();
      if (name !== "span" && name !== "font") return false;
      return !!node.getAttribute("color") || /color\s*:/i.test(node.getAttribute("style") ?? "");
    },
    replacement: (_content: string, node: Node): string => (node as HTMLElement).outerHTML,
  };
  created.addRule("decks-keep-styled", keepStyled);
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
