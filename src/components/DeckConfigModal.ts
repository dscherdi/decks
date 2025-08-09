import { Modal, Platform } from "obsidian";
import type { Deck, DeckConfig } from "../database/types";
import type DecksPlugin from "../main";
import DeckConfigUI from "./DeckConfigUI.svelte";

export class DeckConfigModal extends Modal {
  private deck: Deck;
  private plugin: DecksPlugin;
  private onSave: (config: DeckConfig) => Promise<void>;
  private config: DeckConfig;
  private component: DeckConfigUI | null = null;

  constructor(
    plugin: DecksPlugin,
    deck: Deck,
    onSave: (config: DeckConfig) => Promise<void>,
  ) {
    super(plugin.app);
    this.plugin = plugin;
    this.deck = deck;
    this.onSave = onSave;
    this.config = { ...deck.config };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Add mobile-specific classes
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement && window.innerWidth <= 768) {
      modalEl.addClass("deck-config-modal-mobile");
    }

    // Modal title
    contentEl.createEl("h2", { text: `Configure Deck: ${this.deck.name}` });

    // Create container for Svelte component
    const componentContainer = contentEl.createDiv("deck-config-container");

    // Add CSS class for styling
    componentContainer.addClass("deck-config-container");

    // Mount Svelte component
    this.component = new DeckConfigUI({
      target: componentContainer,
      props: {
        deck: this.deck,
        config: this.config,
      },
    });

    // Listen to component events
    this.component.$on("save", (event) => {
      this.handleSave(event.detail);
    });

    this.component.$on("cancel", () => {
      this.close();
    });

    this.component.$on("configChange", (event) => {
      this.config = event.detail;
    });

    // Handle window resize for mobile adaptation
    const handleResize = () => {
      const modalEl = this.containerEl.querySelector(".modal");
      if (modalEl instanceof HTMLElement) {
        if (Platform.isIosApp || Platform.isAndroidApp) {
          modalEl.addClass("deck-config-modal-mobile");
        } else {
          modalEl.removeClass("deck-config-modal-mobile");
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Store resize handler for cleanup
    (this as any)._resizeHandler = handleResize;
  }

  private async handleSave(config: DeckConfig) {
    try {
      await this.onSave(config);
      this.close();
    } catch (error) {
      console.error("Error saving deck configuration:", error);
      // Could add a notice here if needed
    }
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
