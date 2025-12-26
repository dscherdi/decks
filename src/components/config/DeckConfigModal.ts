import { App, Modal } from "obsidian";
import type { Deck, DeckConfig } from "../../database/types";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type { DeckSynchronizer } from "../../services/DeckSynchronizer";
import type { DeckConfigComponent } from "../../types/svelte-components";
import { yieldToUI } from "../../utils/ui";
import DeckConfigUI from "./DeckConfigUI.svelte";
import { mount, unmount } from "svelte";

export class DeckConfigModal extends Modal {
  private deck: Deck;
  private db: IDatabaseService;
  private deckSynchronizer: DeckSynchronizer;
  private onRefreshStats: (deckId: string) => Promise<void>;
  private config: DeckConfig;
  private component: DeckConfigComponent | null = null;
  private resizeHandler?: () => void;

  constructor(
    app: App,
    deck: Deck,
    db: IDatabaseService,
    deckSynchronizer: DeckSynchronizer,
    onRefreshStats: (deckId: string) => Promise<void>,
  ) {
    super(app);
    this.deck = deck;
    this.db = db;
    this.deckSynchronizer = deckSynchronizer;
    this.onRefreshStats = onRefreshStats;
    this.config = { ...deck.config };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Add mobile-specific classes
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      if (window.innerWidth <= 768) {
        modalEl.addClass("decks-modal-mobile");
      } else {
        modalEl.removeClass("decks-modal-mobile");
      }
    }

    // Modal title
    contentEl.addClass("decks-deck-config-container");

    // Mount Svelte component using Svelte 5 API
    this.component = mount(DeckConfigUI, {
      target: contentEl,
      props: {
        deck: this.deck,
        config: this.config,
        onsave: (detail: DeckConfig) => {
          this.handleSave(detail);
        },
        oncancel: () => {
          this.close();
        },
        onconfigChange: (detail: DeckConfig) => {
          this.config = detail;
        },
      },
    }) as DeckConfigComponent;

    // Handle window resize for mobile adaptation
    const handleResize = () => {
      const modalEl = this.containerEl.querySelector(".modal");
      if (modalEl instanceof HTMLElement) {
        if (window.innerWidth <= 768) {
          modalEl.addClass("decks-modal-mobile");
        } else {
          modalEl.removeClass("decks-modal-mobile");
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Store resize handler for cleanup
    this.resizeHandler = handleResize;
  }

  private async handleSave(config: DeckConfig) {
    try {
      await this.updateDeckConfig(this.deck.id, config);
      this.close();
    } catch (error) {
      console.error("Error saving deck configuration:", error);
      // Could add a notice here if needed
    }
  }

  private async updateDeckConfig(
    deckId: string,
    config: Partial<DeckConfig>,
  ): Promise<void> {
    // Validate profile and requestRetention if provided
    if (
      config.fsrs?.profile &&
      !["INTENSIVE", "STANDARD"].includes(config.fsrs.profile)
    ) {
      throw new Error(`Invalid profile: ${config.fsrs.profile}`);
    }

    if (config.fsrs?.requestRetention !== undefined) {
      const rr = config.fsrs.requestRetention;
      if (rr <= 0.5 || rr >= 0.995) {
        throw new Error(
          `requestRetention must be in range (0.5, 0.995), got ${rr}`,
        );
      }
    }

    // Get current config and merge with updates
    const decks = await this.db.getAllDecks();
    const deck = decks.find((d: Deck) => d.id === deckId);
    if (!deck) {
      throw new Error(`Deck not found: ${deckId}`);
    }

    const currentConfig = deck.config;

    // Check if header level is changing
    const headerLevelChanged =
      config.headerLevel !== undefined &&
      config.headerLevel !== currentConfig.headerLevel;

    const updatedConfig = {
      ...currentConfig,
      ...config,
      fsrs: {
        ...currentConfig.fsrs,
        ...config.fsrs,
      },
    };

    await this.db.updateDeck(deckId, { config: updatedConfig });

    // If header level changed, force resync the deck to clean up old flashcards
    if (headerLevelChanged) {
      const updatedDeck = await this.db.getDeckById(deckId);
      if (updatedDeck) {
        console.log(
          `Header level changed for deck ${updatedDeck.name}, forcing resync`,
        );
        await yieldToUI();
        await this.deckSynchronizer.syncDeck(updatedDeck.filepath, true);
      }
    }

    // Refresh stats for this deck since config changes can affect displayed stats
    await this.onRefreshStats(deckId);
  }

  onClose() {
    const { contentEl } = this;

    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }

    // Unmount Svelte component using Svelte 5 API
    if (this.component) {
      unmount(this.component);
      this.component = null;
    }

    contentEl.empty();
  }
}
