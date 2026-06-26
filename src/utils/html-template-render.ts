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
  "--line-height-normal",
  "--code-background",
];

// Copy Obsidian's theme custom properties onto the wrapper so the template
// resolves them inside the shadow. Only the variables are pinned — concrete
// background/color/font come from the baseline sheet's API (see BASELINE_RESET)
// so a template can override them via :host{--bg/--padding/...}.
function applyThemeVars(wrapper: HTMLElement): void {
  const computed = getComputedStyle(document.body);
  const props: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = computed.getPropertyValue(name);
    if (value) props[name] = value.trim();
  }
  wrapper.setCssProps(props);
}

// Baseline reset injected ahead of user content. Exposes a CSS variable API on
// :host (padding/align/justify/bg) with sensible defaults; a template's own
// <style> (mounted after, so it wins the cascade) can override them, e.g.
// :host{--padding:0} for edge-to-edge. --bg defaults transparent so the shell's
// themed background shows through.
const BASELINE_RESET =
  ":host{display:block;width:100%;height:100%;" +
  "--padding:2rem;--align:center;--justify:center;--bg:transparent}" +
  ".decks-template-wrapper{width:100%;min-height:100%;box-sizing:border-box;" +
  "padding:var(--padding);display:flex;flex-direction:column;" +
  "align-items:var(--align);justify-content:var(--justify);background:var(--bg);" +
  "font-family:var(--font-text);font-size:var(--font-text-size);" +
  "line-height:var(--line-height-normal);color:var(--text-normal);text-align:center}" +
  ".decks-template-wrapper>*:first-child{margin-top:0}" +
  "img,svg,video{max-width:100%;height:auto}" +
  "img{display:block;margin-inline:auto}";

// Class-based theme support inside the shadow: the host body carries
// `theme-dark`/`theme-light`, so we mirror it onto each wrapper so templates
// authoring `.theme-dark .x {}` resolve. A single observer on the active
// document body keeps every live wrapper in sync and self-disposes when none
// remain (no teardown hook exists, so the set prunes detached wrappers).
const themeWrappers = new Set<HTMLElement>();
let themeObserver: MutationObserver | null = null;

function applyThemeClass(wrapper: HTMLElement): void {
  const isDark = activeDocument.body.classList.contains("theme-dark");
  wrapper.removeClass(isDark ? "theme-light" : "theme-dark");
  wrapper.addClass(isDark ? "theme-dark" : "theme-light");
}

function registerThemeWrapper(wrapper: HTMLElement): void {
  applyThemeClass(wrapper);
  themeWrappers.add(wrapper);
  if (themeObserver) return;
  themeObserver = new MutationObserver(() => {
    for (const w of themeWrappers) {
      if (w.isConnected) applyThemeClass(w);
      else themeWrappers.delete(w);
    }
    if (themeWrappers.size === 0 && themeObserver) {
      themeObserver.disconnect();
      themeObserver = null;
    }
  });
  themeObserver.observe(activeDocument.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
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
  wrapper.className = "decks-template-wrapper markdown-rendered";
  applyThemeVars(wrapper);
  registerThemeWrapper(wrapper);

  const html = resolve ? embedWikiImages(rawHtml, resolve) : rawHtml;
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script"],
    ALLOWED_URI_REGEXP,
  });
  // Parse without innerHTML, then move the sanitized nodes into the wrapper.
  const parsed = new DOMParser().parseFromString(clean, "text/html");
  wrapper.append(...Array.from(parsed.body.childNodes));

  // Baseline reset via a constructable stylesheet: adopted sheets sit below the
  // template's own in-tree <style> in the cascade, so a template still overrides
  // these defaults. (A <style> element isn't usable here — styles.css can't
  // pierce the shadow root, and creating <style> nodes is disallowed.)
  const baseSheet = new CSSStyleSheet();
  baseSheet.replaceSync(BASELINE_RESET);
  shadow.adoptedStyleSheets = [baseSheet];
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
