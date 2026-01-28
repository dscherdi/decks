import { App, Modal } from "obsidian";
import type { Deck, DeckProfile } from "../../database/types";
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
  private profiles: DeckProfile[] = [];
  private component: DeckConfigComponent | null = null;
  private resizeHandler?: () => void;

  constructor(
    app: App,
    deck: Deck,
    db: IDatabaseService,
    deckSynchronizer: DeckSynchronizer,
    onRefreshStats: (deckId: string) => Promise<void>
  ) {
    super(app);
    this.deck = deck;
    this.db = db;
    this.deckSynchronizer = deckSynchronizer;
    this.onRefreshStats = onRefreshStats;
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
        onsave: (data: { profileId: string; profileUpdates: Partial<DeckProfile> }) => {
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
    selectionMode: "deck" | "tag";
    selectedDeckId?: string;
    selectedTag?: string;
  }) {
    try {
      const { profileId, profileUpdates, selectionMode, selectedDeckId, selectedTag } =
        data;

      if (selectionMode === "tag" && selectedTag) {
        // Apply profile to all decks with this tag
        await this.db.applyProfileToTag(profileId, selectedTag);
        await this.db.save();

        // Get all affected decks and refresh their stats
        const affectedDecks = await this.db.getDecksByTag(selectedTag);
        for (const deck of affectedDecks) {
          await this.onRefreshStats(deck.id);
        }
      } else if (selectionMode === "deck" && selectedDeckId) {
        // Get old profile to check if headerLevel changed
        const oldProfile = this.profiles.find((p) => p.id === this.deck.profileId);
        let selectedProfile = this.profiles.find((p) => p.id === profileId);

        // Check if this is a new profile (doesn't exist in database yet)
        const existingProfile = await this.db.getProfileById(profileId);

        if (!existingProfile && Object.keys(profileUpdates).length > 0) {
          // New profile - create it with all required fields from profileUpdates
          const newProfile: DeckProfile = {
            id: profileId,
            name: profileUpdates.name!,
            hasNewCardsLimitEnabled: profileUpdates.hasNewCardsLimitEnabled!,
            newCardsPerDay: profileUpdates.newCardsPerDay!,
            hasReviewCardsLimitEnabled: profileUpdates.hasReviewCardsLimitEnabled!,
            reviewCardsPerDay: profileUpdates.reviewCardsPerDay!,
            headerLevel: profileUpdates.headerLevel!,
            reviewOrder: profileUpdates.reviewOrder!,
            fsrs: profileUpdates.fsrs!,
            isDefault: false,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          };
          await this.db.createProfile(newProfile);

          // Fetch back from database to get proper timestamps
          const fetchedProfile = await this.db.getProfileById(profileId);
          if (fetchedProfile) {
            selectedProfile = fetchedProfile;
          }
        } else if (existingProfile && Object.keys(profileUpdates).length > 0) {
          // Existing profile - update it
          await this.db.updateProfile(profileId, profileUpdates);

          // Fetch updated profile
          const fetchedProfile = await this.db.getProfileById(profileId);
          if (fetchedProfile) {
            selectedProfile = fetchedProfile;
          }
        }

        // Save the database after profile create/update but before deck update
        // This ensures the profile exists before we try to reference it
        await this.db.save();

        // Check if headerLevel changed (either from profile switch or profile edit)
        const newHeaderLevel =
          profileUpdates.headerLevel !== undefined
            ? profileUpdates.headerLevel
            : selectedProfile?.headerLevel;

        const headerLevelChanged =
          oldProfile &&
          newHeaderLevel !== undefined &&
          oldProfile.headerLevel !== newHeaderLevel;

        // Update deck with new profileId if changed
        if (this.deck.profileId !== profileId) {
          await this.db.updateDeck(selectedDeckId, { profileId });
          await this.db.save(); // Save again after deck update
        }

        // If header level changed, force resync the deck
        if (headerLevelChanged) {
          const updatedDeck = await this.db.getDeckById(selectedDeckId);
          if (updatedDeck) {
            await yieldToUI();
            await this.deckSynchronizer.syncDeck(updatedDeck.filepath, true);
          }
        }

        // Refresh stats for this deck
        await this.onRefreshStats(selectedDeckId);
      }

      this.close();
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
