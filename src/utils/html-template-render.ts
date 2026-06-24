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
export function renderHtmlIntoShadow(el: HTMLElement, rawHtml: string): void {
  const host = el.createDiv({ cls: "decks-template-host" });
  const shadow = host.attachShadow({ mode: "open" });

  const wrapper = document.createElement("div");
  wrapper.className = "decks-template-shadow-root";
  applyThemeVars(wrapper);

  const clean = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script"],
  });
  // Parse without innerHTML, then move the sanitized nodes into the wrapper.
  const parsed = new DOMParser().parseFromString(clean, "text/html");
  wrapper.append(...Array.from(parsed.body.childNodes));

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
  deckFilePath?: string
): void {
  if (engine === "html") {
    renderHtmlIntoShadow(el, content);
  } else {
    renderMarkdown(content, el, deckFilePath);
  }
}
