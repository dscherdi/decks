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
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("statistics-modal");

      // Add mobile-specific classes
      if (window.innerWidth <= 768) {
        modalEl.addClass("statistics-modal-mobile");
      }
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

    // Handle window resize for mobile adaptation
    const handleResize = () => {
      if (modalEl instanceof HTMLElement) {
        if (window.innerWidth <= 768) {
          modalEl.addClass("statistics-modal-mobile");
        } else {
          modalEl.removeClass("statistics-modal-mobile");
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Store resize handler for cleanup
    (this as any)._resizeHandler = handleResize;
  }

  onClose() {
    const { contentEl } = this;

    // Clean up resize handler
    if ((this as any)._resizeHandler) {
      window.removeEventListener("resize", (this as any)._resizeHandler);
      delete (this as any)._resizeHandler;
    }

    // Destroy Svelte component
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }

    contentEl.empty();
  }
}
