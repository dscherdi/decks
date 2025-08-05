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

    // Override modal positioning and size
    const modalEl = this.containerEl.querySelector(".modal") as HTMLElement;
    if (modalEl) {
      modalEl.style.width = "600px";
      modalEl.style.maxWidth = "90vw";
      modalEl.style.height = "80vh";
      modalEl.style.maxHeight = "80vh";
      modalEl.style.margin = "auto";
      modalEl.style.position = "fixed";
      modalEl.style.top = "50%";
      modalEl.style.left = "50%";
      modalEl.style.transform = "translate(-50%, -50%)";
    }

    // Override container styles for centering
    this.containerEl.style.display = "flex";
    this.containerEl.style.alignItems = "center";
    this.containerEl.style.justifyContent = "center";
    this.containerEl.style.position = "fixed";
    this.containerEl.style.top = "0";
    this.containerEl.style.left = "0";
    this.containerEl.style.width = "100vw";
    this.containerEl.style.height = "100vh";
    this.containerEl.style.zIndex = "1000";

    // Remove default scroll from content
    contentEl.style.overflow = "hidden";
    contentEl.style.height = "100%";

    // Modal title
    const titleEl = contentEl.createEl("h2", { text: "Overall Statistics" });
    titleEl.style.margin = "0 0 16px 0";
    titleEl.style.padding = "0 20px";

    // Create container for Svelte component
    const componentContainer = contentEl.createDiv("statistics-container");

    // Add container styles
    componentContainer.style.padding = "0";
    componentContainer.style.margin = "0";
    componentContainer.style.height = "calc(80vh - 60px)";
    componentContainer.style.width = "100%";
    componentContainer.style.overflowY = "auto";
    componentContainer.style.overflowX = "hidden";

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
