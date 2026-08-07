import { Component, ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import { DECKS_PRO_SITE_URL, I18n } from "@decks/core";
import RELEASE_NOTES_DATA from "../assets/ReleaseNotesData";

export const VIEW_TYPE_RELEASE_NOTES = "decks-release-notes-view";

/**
 * Release notes as a workspace tab rather than a modal, so it can be left open
 * and scrolled while the vault is used. The modal remains for the command.
 */
export class ReleaseNotesView extends ItemView {
  private markdownComponents: Component[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_RELEASE_NOTES;
  }

  getDisplayText(): string {
    return I18n.t.modals.releaseNotes.title;
  }

  getIcon(): string {
    return "sparkles";
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian's ItemView onOpen/onClose are async by contract; this override has no await
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-release-notes-tab");

    this.renderProBanner(contentEl);

    const notes = contentEl.createDiv({ cls: "decks-release-notes-content" });
    for (const note of RELEASE_NOTES_DATA) {
      const section = notes.createDiv({ cls: "decks-release-notes-section" });
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      MarkdownRenderer.render(
        this.app,
        `## v${note.version}\n\n${note.content}`,
        section,
        "",
        component,
      ).catch(console.error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian's ItemView onOpen/onClose are async by contract; this override has no await
  async onClose(): Promise<void> {
    this.markdownComponents.forEach((c) => c.unload());
    this.markdownComponents = [];
    this.contentEl.empty();
  }

  private renderProBanner(containerEl: HTMLElement): void {
    const banner = containerEl.createDiv({ cls: "decks-pro-banner" });
    const text = banner.createDiv({ cls: "decks-pro-banner-text" });
    text.createDiv({ cls: "decks-pro-banner-title", text: I18n.t.pro.heading });
    text.createDiv({ cls: "decks-pro-banner-body", text: I18n.t.pro.body });
    banner.createEl("a", {
      cls: "decks-pro-banner-cta",
      text: I18n.t.pro.cta,
      attr: { href: `${DECKS_PRO_SITE_URL}/pricing/` },
    });
  }
}
