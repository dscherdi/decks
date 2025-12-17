import { App, Modal, Notice, Platform } from "obsidian";
import type { Deck, DeckConfig } from "../database/types";
import type { DatabaseService } from "../database/DatabaseService";
import type { DeckSynchronizer } from "../services/DeckSynchronizer";
import { yieldToUI } from "../utils/ui";
import DeckConfigUI from "./DeckConfigUI.svelte";

export class DeckConfigModal extends Modal {
  private deck: Deck;
  private db: DatabaseService;
  private deckSynchronizer: DeckSynchronizer;
  private onRefreshStats: (deckId: string) => Promise<void>;
  private config: DeckConfig;
  private component: DeckConfigUI | null = null;
  private resizeHandler?: () => void;

  constructor(
    app: App,
    deck: Deck,
    db: DatabaseService,
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
      if (
        window.innerWidth <= 768 ||
        Platform.isPhone ||
        (Platform.isTablet && window.innerWidth < window.innerHeight)
      ) {
        modalEl.addClass("decks-modal-mobile");
        modalEl.removeClass("decks-modal-tablet");
      } else if (window.innerWidth <= 1080 || Platform.isTablet) {
        modalEl.addClass("decks-modal-tablet");
        modalEl.removeClass("decks-modal-mobile");
      } else {
        modalEl.removeClass("decks-modal-tablet");
        modalEl.removeClass("decks-modal-mobile");
      }
    }

    // Modal title
    contentEl.addClass("decks-deck-config-container");

    // Mount Svelte component
    this.component = new DeckConfigUI({
      target: contentEl,
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
        if (
          window.innerWidth <= 768 ||
          Platform.isPhone ||
          (Platform.isTablet && window.innerWidth < window.innerHeight)
        ) {
          modalEl.addClass("decks-modal-mobile");
          modalEl.removeClass("decks-modal-tablet");
        } else if (window.innerWidth <= 1080 || Platform.isTablet) {
          modalEl.addClass("decks-modal-tablet");
          modalEl.removeClass("decks-modal-mobile");
        } else {
          modalEl.removeClass("decks-modal-tablet");
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
      // Use Notice for user-facing error since this component doesn't have debugLog
      new Notice("Error saving deck configuration");
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
    const deck = decks.find((d) => d.id === deckId);
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
        // Use Notice for user feedback since this component doesn't have debugLog
        new Notice(
          `Resyncing deck "${updatedDeck.name}" due to header level change`,
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

    // Destroy Svelte component
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }

    contentEl.empty();
  }
}
