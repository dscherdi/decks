<script lang="ts">
  import { onMount } from "svelte";
  import { Setting, Notice } from "obsidian";
  import type { DeckProfile, ProfileTagMapping } from "../../database/types";
  import type { IDatabaseService } from "../../database/DatabaseFactory";
  import type { ReviewOrder } from "../../types/ReviewOrder";
  import type { FSRSProfile } from "../../database/types";

  export let db: IDatabaseService;
  export let initialProfiles: DeckProfile[];
  export let onclose: () => void;

  let profiles: DeckProfile[] = initialProfiles;
  let selectedProfileId: string = "";
  let selectedProfile: DeckProfile | null = null;
  let tagMappings: ProfileTagMapping[] = [];
  let deckCount: number = 0;

  let profileSelectorContainer: HTMLElement;
  let profileNameContainer: HTMLElement;
  let newCardsLimitContainer: HTMLElement;
  let enableNewCardsContainer: HTMLElement;
  let reviewCardsLimitContainer: HTMLElement;
  let enableReviewCardsContainer: HTMLElement;
  let reviewOrderContainer: HTMLElement;
  let headerLevelContainer: HTMLElement;
  let requestRetentionContainer: HTMLElement;
  let fsrsProfileContainer: HTMLElement;
  let deckCountContainer: HTMLElement;
  let tagMappingsContainer: HTMLElement;

  let saving = false;

  // Form fields
  let profileName: string = "";
  let newCardsLimit: number = 20;
  let reviewCardsLimit: number = 100;
  let enableNewCardsLimit: boolean = false;
  let enableReviewCardsLimit: boolean = false;
  let reviewOrder: ReviewOrder = "due-date";
  let headerLevel: number = 2;
  let requestRetention: number = 0.9;
  let fsrsProfile: FSRSProfile = "STANDARD";

  // Track last event to prevent double execution
  let lastEventTime = 0;
  let lastEventType = "";

  async function selectProfile(profileId: string) {
    selectedProfileId = profileId;
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    selectedProfile = profile;

    // Load profile settings into form
    profileName = profile.name;
    newCardsLimit = profile.newCardsPerDay;
    reviewCardsLimit = profile.reviewCardsPerDay;
    enableNewCardsLimit = profile.hasNewCardsLimitEnabled;
    enableReviewCardsLimit = profile.hasReviewCardsLimitEnabled;
    reviewOrder = profile.reviewOrder;
    headerLevel = profile.headerLevel;
    requestRetention = profile.fsrs.requestRetention;
    fsrsProfile = profile.fsrs.profile;

    // Load tag mappings and deck count
    tagMappings = await db.getTagMappingsForProfile(profile.id);
    deckCount = await db.getDeckCountForProfile(profile.id);

    rebuildSettings();
  }

  async function handleCreateNewProfile() {
    const defaultProfile = await db.getDefaultProfile();
    const newProfileId = `profile_${Date.now()}`;

    const newProfile: DeckProfile = {
      ...defaultProfile,
      id: newProfileId,
      name: "New Profile",
      isDefault: false,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    await db.createProfile(newProfile);
    await db.save();

    // Reload profiles and select the new one
    profiles = await db.getAllProfiles();
    await selectProfile(newProfileId);
    rebuildProfileSelector();

    new Notice("Created new profile");
  }

  async function handleSaveProfile() {
    if (!selectedProfile) return;
    if (saving) return;

    saving = true;

    try {
      const updates: Partial<DeckProfile> = {
        name: profileName,
        newCardsPerDay: newCardsLimit,
        reviewCardsPerDay: reviewCardsLimit,
        hasNewCardsLimitEnabled: enableNewCardsLimit,
        hasReviewCardsLimitEnabled: enableReviewCardsLimit,
        reviewOrder: reviewOrder,
        headerLevel: headerLevel,
        fsrs: {
          requestRetention: requestRetention,
          profile: fsrsProfile,
        },
        modified: new Date().toISOString(),
      };

      await db.updateProfile(selectedProfile.id, updates);
      await db.save();

      // Reload profiles and reselect current
      profiles = await db.getAllProfiles();
      await selectProfile(selectedProfile.id);
      rebuildProfileSelector();

      new Notice("Profile saved successfully");
    } catch (error) {
      console.error("Error saving profile:", error);
      new Notice("Error saving profile");
    } finally {
      saving = false;
    }
  }

  async function handleDeleteProfile() {
    if (!selectedProfile || selectedProfile.isDefault) {
      new Notice("Cannot delete the DEFAULT profile");
      return;
    }

    const confirmDelete = confirm(
      `Are you sure you want to delete the profile "${selectedProfile.name}"?\n\nAll decks using this profile will be reset to the DEFAULT profile.`
    );

    if (!confirmDelete) return;

    await db.deleteProfile(selectedProfile.id);
    await db.save();

    // Reload profiles and select DEFAULT
    profiles = await db.getAllProfiles();
    const defaultProfile = profiles.find((p) => p.isDefault);
    if (defaultProfile) {
      await selectProfile(defaultProfile.id);
    }
    rebuildProfileSelector();

    new Notice("Profile deleted");
  }

  async function handleRemoveTagMapping(mappingId: string) {
    await db.deleteTagMapping(mappingId);
    await db.save();

    // Reload tag mappings
    if (selectedProfile) {
      tagMappings = await db.getTagMappingsForProfile(selectedProfile.id);
      rebuildSettings();
    }
  }

  function rebuildAll() {
    rebuildProfileSelector();
    rebuildSettings();
  }

  function rebuildProfileSelector() {
    if (!profileSelectorContainer) return;

    profileSelectorContainer.empty();

    new Setting(profileSelectorContainer)
      .setName("Select Profile")
      .setDesc("Choose a profile to view and edit")
      .addDropdown((dropdown) => {
        for (const profile of profiles) {
          const label = profile.isDefault
            ? `${profile.name} (DEFAULT)`
            : profile.name;
          dropdown.addOption(profile.id, label);
        }

        dropdown.setValue(selectedProfileId);

        dropdown.onChange((value) => {
          const now = Date.now();
          const eventId = `profile-selector-${value}`;
          if (now - lastEventTime < 100 && lastEventType === eventId) {
            return;
          }
          lastEventTime = now;
          lastEventType = eventId;

          selectProfile(value);
        });
      })
      .addButton((button) => {
        button
          .setButtonText("Create New Profile")
          .setTooltip("Create a new profile")
          .onClick(() => {
            handleCreateNewProfile();
          });
      });
  }

  function rebuildSettings() {
    if (!selectedProfile) return;

    // Profile name
    if (profileNameContainer) {
      profileNameContainer.empty();
      new Setting(profileNameContainer)
        .setName("Profile Name")
        .setDesc("Name for this profile")
        .addText((text) => {
          text
            .setValue(profileName)
            .setDisabled(selectedProfile.isDefault)
            .onChange((value) => {
              profileName = value;
            });
        });
    }

    // Enable new cards limit
    if (enableNewCardsContainer) {
      enableNewCardsContainer.empty();
      new Setting(enableNewCardsContainer)
        .setName("Limit new cards per day")
        .setDesc("Enable daily limit for new cards")
        .addToggle((toggle) => {
          toggle.setValue(enableNewCardsLimit).onChange((value) => {
            enableNewCardsLimit = value;
            rebuildSettings();
          });
        });
    }

    // New cards limit
    if (newCardsLimitContainer && enableNewCardsLimit) {
      newCardsLimitContainer.empty();
      new Setting(newCardsLimitContainer)
        .setName("New cards per day")
        .setDesc("Maximum new cards to introduce per day")
        .addText((text) => {
          text
            .setValue(newCardsLimit.toString())
            .setPlaceholder("20")
            .onChange((value) => {
              const num = parseInt(value);
              if (!isNaN(num) && num >= 0) {
                newCardsLimit = num;
              }
            });
        });
    } else if (newCardsLimitContainer) {
      newCardsLimitContainer.empty();
    }

    // Enable review cards limit
    if (enableReviewCardsContainer) {
      enableReviewCardsContainer.empty();
      new Setting(enableReviewCardsContainer)
        .setName("Limit review cards per day")
        .setDesc("Enable daily limit for review cards")
        .addToggle((toggle) => {
          toggle.setValue(enableReviewCardsLimit).onChange((value) => {
            enableReviewCardsLimit = value;
            rebuildSettings();
          });
        });
    }

    // Review cards limit
    if (reviewCardsLimitContainer && enableReviewCardsLimit) {
      reviewCardsLimitContainer.empty();
      new Setting(reviewCardsLimitContainer)
        .setName("Review cards per day")
        .setDesc("Maximum review cards per day")
        .addText((text) => {
          text
            .setValue(reviewCardsLimit.toString())
            .setPlaceholder("100")
            .onChange((value) => {
              const num = parseInt(value);
              if (!isNaN(num) && num >= 0) {
                reviewCardsLimit = num;
              }
            });
        });
    } else if (reviewCardsLimitContainer) {
      reviewCardsLimitContainer.empty();
    }

    // Header level
    if (headerLevelContainer) {
      headerLevelContainer.empty();
      new Setting(headerLevelContainer)
        .setName("Header Level")
        .setDesc("Header level for flashcard parsing")
        .addDropdown((dropdown) => {
          for (let i = 1; i <= 6; i++) {
            dropdown.addOption(i.toString(), `H${i}`);
          }
          dropdown.setValue(headerLevel.toString()).onChange((value) => {
            headerLevel = parseInt(value);
          });
        });
    }

    // Review order
    if (reviewOrderContainer) {
      reviewOrderContainer.empty();
      new Setting(reviewOrderContainer)
        .setName("Review Order")
        .setDesc("Order in which cards are reviewed")
        .addDropdown((dropdown) => {
          dropdown.addOption("due-date", "Oldest Due First");
          dropdown.addOption("random", "Random");
          dropdown.setValue(reviewOrder).onChange((value) => {
            reviewOrder = value as ReviewOrder;
          });
        });
    }

    // Request retention
    if (requestRetentionContainer) {
      requestRetentionContainer.empty();
      new Setting(requestRetentionContainer)
        .setName("Request Retention")
        .setDesc("Target retention rate (0.5 - 0.995)")
        .addText((text) => {
          text
            .setValue(requestRetention.toString())
            .setPlaceholder("0.9")
            .onChange((value) => {
              const num = parseFloat(value);
              if (!isNaN(num) && num >= 0.5 && num <= 0.995) {
                requestRetention = num;
              }
            });
        });
    }

    // FSRS profile
    if (fsrsProfileContainer) {
      fsrsProfileContainer.empty();
      new Setting(fsrsProfileContainer)
        .setName("FSRS Profile")
        .setDesc("Learning intensity profile")
        .addDropdown((dropdown) => {
          dropdown.addOption("STANDARD", "Standard");
          dropdown.addOption("INTENSIVE", "Intensive");
          dropdown.setValue(fsrsProfile).onChange((value) => {
            fsrsProfile = value as FSRSProfile;
          });
        });
    }

    // Deck count
    if (deckCountContainer) {
      deckCountContainer.empty();
      new Setting(deckCountContainer)
        .setName("Decks Using Profile")
        .setDesc(`${deckCount} deck(s)`)
        .setClass("decks-config-readonly");
    }

    // Tag mappings
    if (tagMappingsContainer) {
      tagMappingsContainer.empty();
      if (tagMappings.length > 0) {
        const heading = tagMappingsContainer.createEl("h4", {
          text: "Tag Assignments",
        });
        heading.style.marginTop = "20px";
        heading.style.marginBottom = "10px";

        const mappingsDiv = tagMappingsContainer.createDiv(
          "decks-tag-mappings"
        );
        for (const mapping of tagMappings) {
          const item = mappingsDiv.createDiv("decks-tag-mapping-item");
          item.createSpan({ text: `🏷️ ${mapping.tag}` });
          const removeBtn = item.createEl("button", {
            text: "✕",
            cls: "decks-btn-remove-tag",
          });
          removeBtn.addEventListener("click", () => {
            handleRemoveTagMapping(mapping.id);
          });
        }
      }
    }
  }

  onMount(async () => {
    // Select DEFAULT profile by default
    const defaultProfile = profiles.find((p) => p.isDefault);
    if (defaultProfile) {
      await selectProfile(defaultProfile.id);
    }

    rebuildAll();
  });
</script>

<div class="decks-profiles-manager">
  <div bind:this={profileSelectorContainer}></div>

  {#if selectedProfile}
    <div class="decks-profile-settings">
      <h3>Profile Settings</h3>

      <div bind:this={profileNameContainer}></div>

      <div class="decks-settings-section">
        <h4>Daily Limits</h4>
        <div bind:this={enableNewCardsContainer}></div>
        <div bind:this={newCardsLimitContainer}></div>
        <div bind:this={enableReviewCardsContainer}></div>
        <div bind:this={reviewCardsLimitContainer}></div>
      </div>

      <div class="decks-settings-section">
        <h4>Card Parsing</h4>
        <div bind:this={headerLevelContainer}></div>
      </div>

      <div class="decks-settings-section">
        <h4>Review Settings</h4>
        <div bind:this={reviewOrderContainer}></div>
      </div>

      <div class="decks-settings-section">
        <h4>FSRS Algorithm</h4>
        <div bind:this={requestRetentionContainer}></div>
        <div bind:this={fsrsProfileContainer}></div>
      </div>

      <div class="decks-settings-section">
        <h4>Profile Info</h4>
        <div bind:this={deckCountContainer}></div>
        <div bind:this={tagMappingsContainer}></div>
      </div>

      <div class="decks-profile-actions">
        <button
          class="decks-btn-save"
          on:click={handleSaveProfile}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {#if !selectedProfile.isDefault}
          <button class="decks-btn-delete" on:click={handleDeleteProfile}>
            Delete Profile
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<div class="decks-modal-footer">
  <button on:click={onclose}>Close</button>
</div>

<style>
  .decks-profiles-manager {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 500px;
  }

  .decks-profile-settings {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .decks-profile-settings h3 {
    margin: 0;
    font-size: 1.2em;
    color: var(--text-normal);
  }

  .decks-settings-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .decks-settings-section h4 {
    margin: 0;
    font-size: 0.9em;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .decks-profile-actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .decks-btn-save {
    flex: 1;
    padding: 10px;
    background: var(--interactive-accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  .decks-btn-save:hover {
    background: var(--interactive-accent-hover);
  }

  .decks-btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-btn-delete {
    padding: 10px 20px;
    background: var(--text-error);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  .decks-btn-delete:hover {
    opacity: 0.8;
  }

  :global(.decks-config-readonly .setting-item-control) {
    display: none;
  }

  :global(.decks-config-readonly .setting-item-description) {
    font-weight: 500;
    color: var(--text-normal);
  }

  :global(.decks-tag-mappings) {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  :global(.decks-tag-mapping-item) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--background-modifier-hover);
    border-radius: 4px;
  }

  :global(.decks-btn-remove-tag) {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0 5px;
    font-size: 1.2em;
  }

  :global(.decks-btn-remove-tag:hover) {
    color: var(--text-error);
  }

  .decks-modal-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .decks-modal-footer button {
    padding: 8px 16px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    cursor: pointer;
  }

  .decks-modal-footer button:hover {
    background: var(--background-modifier-hover);
  }

  @media (max-width: 768px) {
    .decks-profiles-manager {
      padding: 15px;
    }

    .decks-profile-actions {
      flex-direction: column;
    }

    .decks-btn-save,
    .decks-btn-delete {
      width: 100%;
    }
  }
</style>
