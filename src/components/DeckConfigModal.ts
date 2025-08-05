import { Modal } from "obsidian";
import type { Deck, DeckConfig } from "../database/types";
import type FlashcardsPlugin from "../main";
import DeckConfigUI from "./DeckConfigUI.svelte";

export class DeckConfigModal extends Modal {
  private deck: Deck;
  private plugin: FlashcardsPlugin;
  private onSave: (config: DeckConfig) => Promise<void>;
  private config: DeckConfig;
  private component: DeckConfigUI | null = null;

  constructor(
    plugin: FlashcardsPlugin,
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

    // Modal title
    contentEl.createEl("h2", { text: `Configure Deck: ${this.deck.name}` });

    // Create container for Svelte component
    const componentContainer = contentEl.createDiv("deck-config-container");

    // Add container styles
    componentContainer.style.padding = "0";
    componentContainer.style.margin = "0";

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

    // Destroy Svelte component
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }

    contentEl.empty();
  }
}
