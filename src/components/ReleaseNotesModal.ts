import { Modal, App, MarkdownRenderer, Component } from "obsidian";
import RELEASE_NOTES_DATA from "../assets/ReleaseNotesData";

export class ReleaseNotesModal extends Modal {
  private markdownComponents: Component[] = [];

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.setTitle("What's new");

    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      modalEl.addClass("decks-release-notes-modal");
    }

    contentEl.addClass("decks-release-notes-content");

    for (const note of RELEASE_NOTES_DATA) {
      const markdown = `## v${note.version}\n\n${note.content}`;
      const section = contentEl.createDiv({ cls: "decks-release-notes-section" });
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      MarkdownRenderer.render(this.app, markdown, section, "", component).catch(
        console.error
      );
    }
  }

  onClose() {
    this.markdownComponents.forEach((c) => c.unload());
    this.markdownComponents = [];
    this.contentEl.empty();
  }
}
