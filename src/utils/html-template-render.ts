import DOMPurify from "dompurify";

/**
 * Rendering pipeline for table template card sides.
 *
 * Markdown engine → Obsidian's MarkdownRenderer (via the injected callback).
 * HTML engine → sanitized HTML mounted inside a Shadow DOM so the template's
 * CSS is fully encapsulated and cannot leak into the Obsidian UI. Obsidian's
 * theme variables are applied to the shadow root wrapper so cards still match
 * the active light/dark theme.
 */

export type RenderEngine = "html" | "md" | null | undefined;

export type MarkdownRenderFn = (
  content: string,
  el: HTMLElement,
  deckFilePath?: string
) => void;

/** Resolve a vault linkpath to a renderable resource URL (or null if unresolved). */
export type EmbedResolver = (linkpath: string) => string | null;

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;
// ![[path]] / ![[path|opts]] (ignores an optional #subpath); and ![alt](path).
const WIKI_EMBED = /!\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
const MD_EMBED = /!\[([^\]]*)\]\(([^)\s]+?)\)/g;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function imgTag(src: string, alt: string, opts?: string): string {
  let dims = "";
  let altText = alt;
  if (opts) {
    const o = opts.trim();
    const m = o.match(/^(\d+)(?:x(\d+))?$/);
    if (m) dims = ` width="${m[1]}"${m[2] ? ` height="${m[2]}"` : ""}`;
    else if (o) altText = o;
  }
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(altText)}"${dims}>`;
}

// Embeds pointing at the open internet (or already-resolved resource URLs) are
// used verbatim as the <img> src — no vault resolution, no extension check
// (the `!` already declares the embed an image).
const EXTERNAL_URL = /^(?:https?|data|app|capacitor):/i;

/**
 * Convert Obsidian image embeds in an HTML string to native <img> tags so they
 * render inside the Shadow DOM (which doesn't understand wikilinks). Vault
 * paths are resolved via `resolve`; external http(s)/data URLs are used as-is.
 * Note embeds (`![[note]]`), non-image vault paths, and unresolved vault paths
 * are left untouched.
 */
export function embedWikiImages(html: string, resolve: EmbedResolver): string {
  let out = html.replace(WIKI_EMBED, (full, rawPath: string, opts?: string) => {
    const path = rawPath.trim();
    if (EXTERNAL_URL.test(path)) return imgTag(path, path, opts);
    if (!IMAGE_EXT.test(path)) return full;
    const src = resolve(path);
    return src ? imgTag(src, path, opts) : full;
  });
  out = out.replace(MD_EMBED, (full, alt: string, rawPath: string) => {
    const path = rawPath.trim();
    if (EXTERNAL_URL.test(path)) return imgTag(path, alt || path);
    if (!IMAGE_EXT.test(path)) return full;
    const src = resolve(decodeURIComponent(path));
    return src ? imgTag(src, alt || path) : full;
  });
  return out;
}

// DOMPurify defaults + Obsidian's resource schemes (desktop app://, mobile capacitor://).
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|app|capacitor):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

// Obsidian theme variables copied onto the shadow root so the trapped CSS still
// resolves them (and the card matches the user's active theme).
const THEME_VARS = [
  "--background-primary",
  "--background-secondary",
  "--background-modifier-border",
  "--text-normal",
  "--text-muted",
  "--text-faint",
  "--text-accent",
  "--interactive-accent",
  "--font-text",
  "--font-monospace",
  "--font-text-size",
  "--code-background",
];

function applyThemeVars(wrapper: HTMLElement): void {
  const computed = getComputedStyle(document.body);
  const props: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = computed.getPropertyValue(name);
    if (value) props[name] = value.trim();
  }
  // Base look so bare cards inherit the theme; templates can override freely.
  props["background-color"] = "var(--background-primary)";
  props["color"] = "var(--text-normal)";
  props["font-family"] = "var(--font-text, inherit)";
  wrapper.setCssProps(props);
}

/**
 * Sanitize `rawHtml` (allow <style>, strip <script> and inline event handlers)
 * and mount it inside a fresh Shadow DOM hosted by a child of `el`. The caller
 * should empty `el` first; a new host is created each call so re-rendering the
 * same element never collides with a prior shadow root.
 */
export function renderHtmlIntoShadow(
  el: HTMLElement,
  rawHtml: string,
  resolve?: EmbedResolver
): void {
  const host = el.createDiv({ cls: "decks-template-host" });
  const shadow = host.attachShadow({ mode: "open" });

  const wrapper = document.createElement("div");
  wrapper.className = "decks-template-shadow-root";
  applyThemeVars(wrapper);

  const html = resolve ? embedWikiImages(rawHtml, resolve) : rawHtml;
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script"],
    ALLOWED_URI_REGEXP,
  });
  // Parse without innerHTML, then move the sanitized nodes into the wrapper.
  const parsed = new DOMParser().parseFromString(clean, "text/html");
  wrapper.append(...Array.from(parsed.body.childNodes));

  // Base rules so embedded media stays within the card. Appended before the
  // template's own <style> (which lives inside the wrapper) so source order
  // lets a template override these if it wants to.
  const baseStyle = document.createElement("style");
  baseStyle.textContent =
    "img,svg,video{max-width:100%;height:auto}img{display:block;margin-inline:auto}";
  shadow.appendChild(baseStyle);
  shadow.appendChild(wrapper);
}

/**
 * Render one resolved card side. HTML engine goes through the sanitized Shadow
 * DOM pipeline; everything else (markdown, or an absent engine) renders via the
 * injected markdown renderer. The caller empties `el` before calling.
 */
export function renderCardSide(
  el: HTMLElement,
  content: string,
  engine: RenderEngine,
  renderMarkdown: MarkdownRenderFn,
  deckFilePath?: string,
  resolve?: EmbedResolver
): void {
  if (engine === "html") {
    renderHtmlIntoShadow(el, content, resolve);
  } else {
    renderMarkdown(content, el, deckFilePath);
  }
}
