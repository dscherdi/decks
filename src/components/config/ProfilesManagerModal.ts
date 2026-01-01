import { App, Modal } from "obsidian";
import type { DeckProfile } from "../../database/types";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type { ProfilesManagerComponent } from "../../types/svelte-components";
import ProfilesManagerUI from "./ProfilesManagerUI.svelte";
import { mount, unmount } from "svelte";

export class ProfilesManagerModal extends Modal {
  private db: IDatabaseService;
  private profiles: DeckProfile[] = [];
  private component: ProfilesManagerComponent | null = null;
  private onProfilesChanged: () => Promise<void>;

  constructor(
    app: App,
    db: IDatabaseService,
    onProfilesChanged: () => Promise<void>
  ) {
    super(app);
    this.db = db;
    this.onProfilesChanged = onProfilesChanged;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Add modal classes
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      if (window.innerWidth <= 768) {
        modalEl.addClass("decks-modal-mobile");
      }
    }

    contentEl.addClass("decks-profiles-manager-container");

    // Load all profiles
    this.profiles = await this.db.getAllProfiles();

    // Mount Svelte component
    this.component = mount(ProfilesManagerUI, {
      target: contentEl,
      props: {
        db: this.db,
        initialProfiles: this.profiles,
        onclose: () => {
          this.close();
        },
      },
    }) as ProfilesManagerComponent;
  }

  onClose() {
    const { contentEl } = this;

    // Unmount Svelte component
    if (this.component) {
      void unmount(this.component);
      this.component = null;
    }

    contentEl.empty();

    // Notify parent that profiles may have changed
    void this.onProfilesChanged();
  }
}
