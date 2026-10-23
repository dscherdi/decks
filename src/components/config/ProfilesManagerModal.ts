import { App, Modal } from "obsidian";
import type { DeckProfile } from "../../database/types";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type { ProfilesManagerComponent } from "../../types/svelte-components";
import { decksWithChangedParsing, type DeckWithProfile, type TagScopeOptions } from "@decks/core";
import ProfilesManagerUI from "./ProfilesManagerUI.svelte";
import { mount, unmount } from "svelte";
import { makeModalResponsive, type ResponsiveModalHandle } from "../../utils/responsive-modal";

export class ProfilesManagerModal extends Modal {
  private db: IDatabaseService;
  private profiles: DeckProfile[] = [];
  private component: ProfilesManagerComponent | null = null;
  private onProfilesChanged: () => Promise<void>;
  private reparseDeck: (deckId: string) => Promise<unknown>;
  private decksAtOpen: DeckWithProfile[] = [];
  private responsiveHandle?: ResponsiveModalHandle;
  private trainedWeightsAvailable: boolean;
  private initialTab: "settings" | "assignments";
  private initialProfileId?: string;
  private tagScope?: TagScopeOptions;
  private meaningAvailable: boolean;

  constructor(
    app: App,
    db: IDatabaseService,
    onProfilesChanged: () => Promise<void>,
    reparseDeck: (deckId: string) => Promise<unknown>,
    trainedWeightsAvailable = false,
    initialTab: "settings" | "assignments" = "settings",
    initialProfileId?: string,
    tagScope?: TagScopeOptions,
    meaningAvailable = false
  ) {
    super(app);
    this.db = db;
    this.onProfilesChanged = onProfilesChanged;
    this.reparseDeck = reparseDeck;
    this.trainedWeightsAvailable = trainedWeightsAvailable;
    this.initialTab = initialTab;
    this.initialProfileId = initialProfileId;
    this.tagScope = tagScope;
    this.meaningAvailable = meaningAvailable;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.responsiveHandle = makeModalResponsive(this);

    contentEl.addClass("decks-profiles-manager-container");

    // Load all profiles + decks (decks drive the Assignments tab's tag list).
    this.profiles = await this.db.getAllProfiles();
    const allDecks = await this.db.getAllDecks();
    this.decksAtOpen = await this.db.getAllDecksWithProfiles();

    // Mount Svelte component
    this.component = mount(ProfilesManagerUI, {
      target: contentEl,
      props: {
        db: this.db,
        initialProfiles: this.profiles,
        trainedWeightsAvailable: this.trainedWeightsAvailable,
        initialTab: this.initialTab,
        initialProfileId: this.initialProfileId,
        allDecks,
        tagScope: this.tagScope,
        meaningAvailable: this.meaningAvailable,
        onclose: () => {
          this.close();
        },
      },
    }) as ProfilesManagerComponent;
  }

  onClose() {
    const { contentEl } = this;

    this.responsiveHandle?.dispose();
    this.responsiveHandle = undefined;

    // Unmount Svelte component
    if (this.component) {
      void unmount(this.component);
      this.component = null;
    }

    contentEl.empty();

    // Defer refresh to avoid blocking the close handler
    window.setTimeout(() => {
      void this.reparseChangedDecks()
        .catch(console.error)
        .then(() => this.onProfilesChanged());
    }, 0);
  }

  // A note whose profile now parses other headings is unchanged on disk, so the mtime gate would skip it.
  private async reparseChangedDecks(): Promise<void> {
    const changed = decksWithChangedParsing(this.decksAtOpen, await this.db.getAllDecksWithProfiles());
    for (const deck of changed) await this.reparseDeck(deck.id);
  }
}
