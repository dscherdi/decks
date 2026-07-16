<script lang="ts">
  import { onMount } from "svelte";
  import { Setting, Notice } from "obsidian";
  import type { Deck, DeckProfile } from "../../database/types";
  import type { IDatabaseService } from "../../database/DatabaseFactory";
  import { I18n } from "@decks/core";

  const t = I18n.t;

  export let db: IDatabaseService;
  export let initialDeck: Deck;
  export let initialProfiles: DeckProfile[];
  export let allDecks: Deck[];
  export let onsave:
    | ((data: {
        profileId: string;
        profileUpdates: Partial<DeckProfile>;
        selectedTag: string;
      }) => void)
    | undefined = undefined;
  export let oncancel: (() => void) | undefined = undefined;

  const profiles = initialProfiles;
  let selectedProfileId = initialDeck.profileId;
  let selectedProfile: DeckProfile | null = null;
  let allTags: string[] = [];
  let selectedTag = initialDeck.tag;

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
          selectedTag,
        });
      }
    } catch (error) {
      console.error("Error saving deck configuration:", error);
      new Notice(t.config.errorSavingConfig);
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
      .setName(t.config.applyProfileToTag)
      .setDesc(t.config.applyProfileDesc)
      .addDropdown((dropdown) => {
        for (const tag of allTags) {
          dropdown.addOption(tag, tag);
        }

        dropdown.setValue(selectedTag);

        dropdown.onChange(async (value) => {
          const now = Date.now();
          const eventId = `tag-selector-${value}`;
          if (now - lastEventTime < 100 && lastEventType === eventId) {
            return;
          }
          lastEventTime = now;
          lastEventType = eventId;

          selectedTag = value;

          const mappedProfileId = await db.getProfileIdForTag(value);
          if (mappedProfileId) {
            selectedProfileId = mappedProfileId;
            const profile = profiles.find((p) => p.id === mappedProfileId);
            if (profile) loadProfileSettings(profile);
          }

          rebuildSelectors();
        });
      });
  }

  function buildProfileSelector() {
    if (!profileSelectorContainer) return;

    profileSelectorContainer.empty();

    new Setting(profileSelectorContainer)
      .setName(t.config.profileLabel)
      .setDesc(t.config.profileSelectDesc)
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
      .setName(t.config.profileNameLabel)
      .setDesc(selectedProfile.name)
      .setClass("decks-config-readonly");

    // Daily limits
    const newCardsDesc = selectedProfile.hasNewCardsLimitEnabled
      ? I18n.format(t.config.perDay, { count: selectedProfile.newCardsPerDay })
      : t.config.unlimited;
    new Setting(profileDetailsContainer)
      .setName(t.config.newCardsLimitLabel)
      .setDesc(newCardsDesc)
      .setClass("decks-config-readonly");

    const reviewCardsDesc = selectedProfile.hasReviewCardsLimitEnabled
      ? I18n.format(t.config.perDay, { count: selectedProfile.reviewCardsPerDay })
      : t.config.unlimited;
    new Setting(profileDetailsContainer)
      .setName(t.config.reviewCardsLimitLabel)
      .setDesc(reviewCardsDesc)
      .setClass("decks-config-readonly");

    // Header level (primary, plus any additional levels also parsed as cards)
    let headerLevelDesc: string;
    if (selectedProfile.headerLevel === 0) {
      headerLevelDesc = t.config.headerTitle;
    } else {
      const primaryLevel = selectedProfile.headerLevel;
      const primary = I18n.format(t.config.headerH, { level: primaryLevel });
      const extras = (selectedProfile.extraHeaderLevels ?? [])
        .filter((l) => l !== primaryLevel)
        .sort((a, b) => a - b)
        .map((l) => I18n.format(t.config.headerH, { level: l }));
      headerLevelDesc = extras.length > 0 ? `${primary} (+ ${extras.join(", ")})` : primary;
    }
    new Setting(profileDetailsContainer)
      .setName(t.config.headerLevelLabel)
      .setDesc(headerLevelDesc)
      .setClass("decks-config-readonly");

    // Review order
    const reviewOrderLabel =
      selectedProfile.reviewOrder === "due-date"
        ? t.config.reviewOrderOldestDue
        : t.config.reviewOrderRandomLabel;
    new Setting(profileDetailsContainer)
      .setName(t.config.reviewOrderLabel)
      .setDesc(reviewOrderLabel)
      .setClass("decks-config-readonly");

    // Cloze deletions
    new Setting(profileDetailsContainer)
      .setName(t.config.clozeDeletions)
      .setDesc(selectedProfile.clozeEnabled
        ? I18n.format(t.config.clozeEnabled, {
            mode: selectedProfile.clozeShowContext === "open"
              ? t.config.clozeShowOthers
              : t.config.clozeHideAll,
          })
        : t.config.clozeDisabled)
      .setClass("decks-config-readonly");

    // Exam questions
    if (selectedProfile.examEnabled) {
      new Setting(profileDetailsContainer)
        .setName(t.exam.examEnabledSetting)
        .setDesc(t.exam.examEnabledDesc)
        .setClass("decks-config-readonly");
    }

    // FSRS settings
    new Setting(profileDetailsContainer)
      .setName(t.config.fsrsSettings)
      .setDesc(
        I18n.format(t.config.fsrsSettingsDesc, {
          retention: selectedProfile.fsrs.requestRetention,
          profile: selectedProfile.fsrs.profile,
        })
      )
      .setClass("decks-config-readonly");

    // Deck count
    db.getDeckCountForProfile(selectedProfile.id).then((count) => {
      new Setting(profileDetailsContainer)
        .setName(t.config.decksUsingProfile)
        .setDesc(I18n.format(t.config.deckCount, { count }))
        .setClass("decks-config-readonly");
    });

    // Note about editing
    const noteEl = profileDetailsContainer.createDiv("decks-config-note");
    const p = noteEl.createEl("p");
    p.createEl("strong", { text: t.config.editNoteIntro });
    p.appendText(t.config.editNoteBody);
  }

  onMount(async () => {
    // Load all tags from decks, including parent levels
    const uniqueTags = new Set<string>();
    for (const deck of allDecks) {
      if (!deck.tag) continue;
      const parts = deck.tag.split("/");
      for (let i = 1; i <= parts.length; i++) {
        uniqueTags.add(parts.slice(0, i).join("/"));
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
  <div class="decks-config-content">
    <div class="decks-config-section">
      <h3>{t.config.sectionTagSelection}</h3>
      <div bind:this={deckSelectorContainer}></div>
    </div>

    <div class="decks-config-section">
      <h3>{t.config.sectionProfileSelection}</h3>
      <div bind:this={profileSelectorContainer}></div>
    </div>

    <div class="decks-config-section">
      <h3>{t.config.sectionCurrentSettings}</h3>
      <div bind:this={profileDetailsContainer}></div>
    </div>
  </div>

  <div class="decks-config-actions">
    <button
      class="decks-btn-secondary"
      on:click={handleCancel}
      disabled={saving}
    >
      {t.config.cancel}
    </button>
    <button class="decks-btn-primary" on:click={handleSave} disabled={saving}>
      {saving ? t.config.saving : t.config.save}
    </button>
  </div>
</div>

<style>
  .decks-deck-config-modal {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .decks-config-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 20px;
    min-height: 0;
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
    flex-shrink: 0;
    padding: 15px 20px;
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
    color: var(--text-on-accent);
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
    .decks-config-content {
      padding: 15px;
    }

    .decks-config-actions {
      flex-direction: column-reverse;
      padding: 15px;
    }

    .decks-btn-primary,
    .decks-btn-secondary {
      width: 100%;
    }
  }
</style>
