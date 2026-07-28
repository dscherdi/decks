import { App, Component, Keymap } from "obsidian";

/**
 * Make internal Obsidian links inside a rendered markdown container behave like
 * Obsidian: clicking opens the linked note and jumps to its heading/block, and
 * hovering shows the page-preview popover. Delegated on the container so it
 * covers anchors added by the async `MarkdownRenderer.render` and is cleaned up
 * with the owning component.
 */
export function wireInternalLinks(
  app: App,
  containerEl: HTMLElement,
  sourcePath: string,
  component: Component,
  hoverSource = "decks"
): void {
  const linkFrom = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return null;
    const anchor = target.closest("a.internal-link");
    return anchor instanceof HTMLElement ? anchor : null;
  };

  const linktextOf = (anchor: HTMLElement): string | null =>
    anchor.getAttribute("data-href") ?? anchor.getAttribute("href");

  component.registerDomEvent(containerEl, "click", (evt: MouseEvent) => {
    const anchor = linkFrom(evt.target);
    if (!anchor) return;
    const linktext = linktextOf(anchor);
    if (!linktext) return;
    evt.preventDefault();
    // Obsidian's own link behavior: resolves the (relative) link against the
    // card's source file and scrolls to the heading/block; mod-click = new tab.
    void app.workspace.openLinkText(linktext, sourcePath, Keymap.isModEvent(evt));
  });

  component.registerDomEvent(containerEl, "mouseover", (evt: MouseEvent) => {
    const anchor = linkFrom(evt.target);
    if (!anchor) return;
    const linktext = linktextOf(anchor);
    if (!linktext) return;
    app.workspace.trigger("hover-link", {
      event: evt,
      source: hoverSource,
      hoverParent: component,
      targetEl: anchor,
      linktext,
      sourcePath,
    });
  });
}
