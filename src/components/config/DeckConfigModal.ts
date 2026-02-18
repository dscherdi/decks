import { App, Modal } from "obsidian";
import type { Deck, DeckProfile } from "../../database/types";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type { DeckConfigComponent } from "../../types/svelte-components";
import DeckConfigUI from "./DeckConfigUI.svelte";
import { mount, unmount } from "svelte";

export class DeckConfigModal extends Modal {
  private deck: Deck;
  private db: IDatabaseService;
  private onRefreshDecksAndStats: () => Promise<void>;
  private profiles: DeckProfile[] = [];
  private component: DeckConfigComponent | null = null;
  private resizeHandler?: () => void;

  constructor(
    app: App,
    deck: Deck,
    db: IDatabaseService,
    onRefreshDecksAndStats: () => Promise<void>
  ) {
    super(app);
    this.deck = deck;
    this.db = db;
    this.onRefreshDecksAndStats = onRefreshDecksAndStats;
  }

  async onOpen() {
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

    // Load all profiles
    this.profiles = await this.db.getAllProfiles();

    // Load all decks for deck selector
    const allDecks = await this.db.getAllDecks();

    // Mount Svelte component using Svelte 5 API
    this.component = mount(DeckConfigUI, {
      target: contentEl,
      props: {
        db: this.db,
        initialDeck: this.deck,
        initialProfiles: this.profiles,
        allDecks: allDecks,
        onsave: (data: { profileId: string; profileUpdates: Partial<DeckProfile>; selectedTag: string }) => {
          void this.handleSave(data);
        },
        oncancel: () => {
          this.close();
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
    this.resizeHandler = handleResize;
  }

  private async handleSave(data: {
    profileId: string;
    profileUpdates: Partial<DeckProfile>;
    selectedTag: string;
  }) {
    try {
      const { profileId, selectedTag } = data;

      await this.db.applyProfileToTag(profileId, selectedTag);
      await this.db.save();

      this.close();

      setTimeout(() => {
        void this.onRefreshDecksAndStats();
      }, 0);
    } catch (error) {
      console.error("Error saving deck configuration:", error);
    }
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
      void unmount(this.component);
      this.component = null;
    }

    contentEl.empty();
  }
}
