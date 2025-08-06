import { Modal } from "obsidian";
import type DecksPlugin from "../main";
import StatisticsUI from "./StatisticsUI.svelte";

export class StatisticsModal extends Modal {
  private plugin: DecksPlugin;
  private component: StatisticsUI | null = null;

  constructor(plugin: DecksPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Add CSS classes for styling
    const modalEl = this.containerEl.querySelector(".modal") as HTMLElement;
    if (modalEl) {
      modalEl.addClass("statistics-modal");
    }
    this.containerEl.addClass("statistics-modal-container");
    contentEl.addClass("statistics-modal-content");

    // Modal title
    const titleEl = contentEl.createEl("h2", { text: "Overall Statistics" });
    titleEl.addClass("statistics-modal-title");

    // Create container for Svelte component
    const componentContainer = contentEl.createDiv("statistics-container");
    componentContainer.addClass("statistics-modal-component-container");

    // Mount Svelte component
    this.component = new StatisticsUI({
      target: componentContainer,
      props: {
        plugin: this.plugin,
      },
    });

    // Listen to component events
    this.component.$on("close", () => {
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;

    // Destroy Svelte component
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }

    contentEl.empty();
  }
}
