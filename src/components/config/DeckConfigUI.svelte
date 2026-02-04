<script lang="ts">
  import { onMount } from "svelte";
  import { Setting, Notice } from "obsidian";
  import type { Deck, DeckProfile } from "../../database/types";
  import type { IDatabaseService } from "../../database/DatabaseFactory";

  export let db: IDatabaseService;
  export let initialDeck: Deck;
  export let initialProfiles: DeckProfile[];
  export let allDecks: Deck[];
  export let onsave:
    | ((data: {
        profileId: string;
        profileUpdates: Partial<DeckProfile>;
        selectionMode: "deck" | "tag";
        selectedDeckId?: string;
        selectedTag?: string;
      }) => void)
    | undefined = undefined;
  export let oncancel: (() => void) | undefined = undefined;

  const profiles = initialProfiles;
  let selectedDeckId = initialDeck.id;
  let selectedProfileId = initialDeck.profileId;
  let selectedProfile: DeckProfile | null = null;
  let allTags: string[] = [];
  let selectionMode: "deck" | "tag" = "deck";
  let selectedTag = "";

  let deckSelectorContainer: HTMLElement;
  let profileSelectorContainer: HTMLElement;
  let profileDetailsContainer: HTMLElement;

  let saving = false;

  // Track last event to prevent double execution
  let lastEventTime = 0;
  let lastEventType = "";

  function loadProfileSettings(profile: DeckProfile) {
    selectedProfile = profile;
  }

  async function handleSave() {
    if (saving) return;
    saving = true;

    try {
      if (onsave) {
        onsave({
          profileId: selectedProfileId,
          profileUpdates: {},
          selectionMode,
          selectedDeckId: selectionMode === "deck" ? selectedDeckId : undefined,
          selectedTag: selectionMode === "tag" ? selectedTag : undefined,
        });
      }
    } catch (error) {
      console.error("Error saving deck configuration:", error);
      new Notice("Error saving configuration");
    } finally {
      saving = false;
    }
  }

  function handleCancel() {
    if (oncancel) {
      oncancel();
    }
  }

  function rebuildSelectors() {
    buildDeckSelector();
    buildProfileSelector();
    buildProfileDetails();
  }

  function buildDeckSelector() {
    if (!deckSelectorContainer) return;

    deckSelectorContainer.empty();

    new Setting(deckSelectorContainer)
      .setName("Apply profile to")
      .setDesc("Select deck or tag to apply profile")
      .addDropdown((dropdown) => {
        // Add decks
        for (const deck of allDecks) {
          dropdown.addOption(`deck:${deck.id}`, `📄 ${deck.name}`);
        }

        // Add tags
        for (const tag of allTags) {
          dropdown.addOption(`tag:${tag}`, `🏷️ ${tag}`);
        }

        // Set initial value
        dropdown.setValue(
          selectionMode === "deck" ? `deck:${selectedDeckId}` : `tag:${selectedTag}`
        );

        dropdown.onChange((value) => {
          const now = Date.now();
          const eventId = `deck-selector-${value}`;
          if (now - lastEventTime < 100 && lastEventType === eventId) {
            return;
          }
          lastEventTime = now;
          lastEventType = eventId;

          if (value.startsWith("deck:")) {
            selectionMode = "deck";
            selectedDeckId = value.substring(5);
            const deck = allDecks.find((d) => d.id === selectedDeckId);
            if (deck) {
              selectedProfileId = deck.profileId;
              const profile = profiles.find((p) => p.id === selectedProfileId);
              if (profile) {
                loadProfileSettings(profile);
              }
            }
          } else if (value.startsWith("tag:")) {
            selectionMode = "tag";
            selectedTag = value.substring(4);
          }

          rebuildSelectors();
        });
      });
  }

  function buildProfileSelector() {
    if (!profileSelectorContainer) return;

    profileSelectorContainer.empty();

    new Setting(profileSelectorContainer)
      .setName("Profile")
      .setDesc("Select a profile for this deck/tag")
      .addDropdown((dropdown) => {
        // Add all profiles
        for (const profile of profiles) {
          dropdown.addOption(profile.id, profile.name);
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

          selectedProfileId = value;
          const profile = profiles.find((p) => p.id === value);
          if (profile) {
            loadProfileSettings(profile);
          }

          rebuildSelectors();
        });
      });
  }

  function buildProfileDetails() {
    if (!profileDetailsContainer) return;

    profileDetailsContainer.empty();

    if (!selectedProfile) return;

    // Profile name (read-only)
    new Setting(profileDetailsContainer)
      .setName("Profile Name")
      .setDesc(selectedProfile.name)
      .setClass("decks-config-readonly");

    // Daily limits
    const newCardsDesc = selectedProfile.hasNewCardsLimitEnabled
      ? `${selectedProfile.newCardsPerDay} per day`
      : "Unlimited";
    new Setting(profileDetailsContainer)
      .setName("New cards limit")
      .setDesc(newCardsDesc)
      .setClass("decks-config-readonly");

    const reviewCardsDesc = selectedProfile.hasReviewCardsLimitEnabled
      ? `${selectedProfile.reviewCardsPerDay} per day`
      : "Unlimited";
    new Setting(profileDetailsContainer)
      .setName("Review Cards Limit")
      .setDesc(reviewCardsDesc)
      .setClass("decks-config-readonly");

    // Header level
    new Setting(profileDetailsContainer)
      .setName("Header level")
      .setDesc(`H${selectedProfile.headerLevel}`)
      .setClass("decks-config-readonly");

    // Review order
    const reviewOrderLabel =
      selectedProfile.reviewOrder === "due-date" ? "Oldest Due First" : "Random";
    new Setting(profileDetailsContainer)
      .setName("Review order")
      .setDesc(reviewOrderLabel)
      .setClass("decks-config-readonly");

    // FSRS settings
    new Setting(profileDetailsContainer)
      .setName("FSRS Settings")
      .setDesc(
        `Retention: ${selectedProfile.fsrs.requestRetention}, Profile: ${selectedProfile.fsrs.profile}`
      )
      .setClass("decks-config-readonly");

    // Deck count
    db.getDeckCountForProfile(selectedProfile.id).then((count) => {
      new Setting(profileDetailsContainer)
        .setName("Decks Using Profile")
        .setDesc(`${count} deck(s)`)
        .setClass("decks-config-readonly");
    });

    // Note about editing
    const noteEl = profileDetailsContainer.createDiv("decks-config-note");
    const p = noteEl.createEl("p");
    p.createEl("strong", { text: "Note:" });
    p.appendText(
      ' To edit profile settings, use the "Manage Profiles" button in the main Decks panel.'
    );
  }

  onMount(async () => {
    // Load all tags from decks
    const uniqueTags = new Set<string>();
    for (const deck of allDecks) {
      if (deck.tag) {
        uniqueTags.add(deck.tag);
      }
    }
    allTags = Array.from(uniqueTags).sort();

    // Load initial profile
    const profile = profiles.find((p) => p.id === selectedProfileId);
    if (profile) {
      loadProfileSettings(profile);
    }

    rebuildSelectors();
  });
</script>

<div class="decks-deck-config-modal">
  <div class="decks-config-section">
    <h3>Deck Selection</h3>
    <div bind:this={deckSelectorContainer}></div>
  </div>

  <div class="decks-config-section">
    <h3>Profile Selection</h3>
    <div bind:this={profileSelectorContainer}></div>
  </div>

  <div class="decks-config-section">
    <h3>Current Profile Settings</h3>
    <div bind:this={profileDetailsContainer}></div>
  </div>

  <div class="decks-config-actions">
    <button
      class="decks-btn-secondary"
      on:click={handleCancel}
      disabled={saving}
    >
      Cancel
    </button>
    <button class="decks-btn-primary" on:click={handleSave} disabled={saving}>
      {saving ? "Saving..." : "Save"}
    </button>
  </div>
</div>

<style>
  .decks-deck-config-modal {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .decks-config-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .decks-config-section h3 {
    margin: 0;
    font-size: 1.1em;
    color: var(--text-muted);
  }

  .decks-config-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .decks-btn-primary,
  .decks-btn-secondary {
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  .decks-btn-primary {
    background: var(--interactive-accent);
    color: white;
    border: none;
  }

  .decks-btn-primary:hover {
    background: var(--interactive-accent-hover);
  }

  .decks-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-btn-secondary {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
  }

  .decks-btn-secondary:hover {
    background: var(--background-modifier-hover);
  }

  .decks-btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.decks-config-readonly .setting-item-control) {
    display: none;
  }

  :global(.decks-config-readonly .setting-item-description) {
    font-weight: 500;
    color: var(--text-normal);
  }

  :global(.decks-config-note) {
    padding: 12px;
    background: var(--background-secondary);
    border-left: 3px solid var(--interactive-accent);
    border-radius: 4px;
    margin-top: 10px;
  }

  :global(.decks-config-note p) {
    margin: 0;
    font-size: 0.9em;
    color: var(--text-muted);
  }

  :global(.decks-config-note strong) {
    color: var(--text-normal);
  }

  @media (max-width: 768px) {
    .decks-deck-config-modal {
      padding: 15px;
    }

    .decks-config-actions {
      flex-direction: column-reverse;
    }

    .decks-btn-primary,
    .decks-btn-secondary {
      width: 100%;
    }
  }
</style>
