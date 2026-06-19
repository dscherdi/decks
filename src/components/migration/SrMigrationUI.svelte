<script lang="ts">
  import { onMount } from "svelte";
  import { Setting, Notice } from "obsidian";
  import { I18n } from "@decks/core";
  import type { DeckProfile, MigrationFormat } from "@decks/core";
  import type { IDatabaseService } from "@/database/DatabaseFactory";
  import type {
    SrMigrationController,
    SrMigrateSummary,
  } from "@/services/SrMigrationController";

  const t = I18n.t.srMigration;

  export let db: IDatabaseService;
  export let controller: SrMigrationController;
  export let onComplete: (() => void) | undefined = undefined;
  export let oncancel: (() => void) | undefined = undefined;

  let sourceFolder = "";
  let targetFolder = "Decks";
  let srBaseTag = "#flashcards";
  let srReviewTag = "#review";
  let inlineSep = "::";
  let multiSep = "?";
  let profileId = "";
  let format: MigrationFormat = "smart";
  let deleteMode = false;

  let profiles: DeckProfile[] = [];
  let scanning = false;
  let migrating = false;
  let scanned: { files: number; cards: number; history: number } | null = null;
  let summary: SrMigrateSummary | null = null;

  let settingsContainer: HTMLElement;

  onMount(() => {
    void init();
  });

  async function init(): Promise<void> {
    profiles = await db.getAllProfiles();
    const def = profiles.find((p) => p.isDefault) ?? profiles[0];
    profileId = def ? def.id : "";
    const seps = await controller.readSrSeparators();
    inlineSep = seps.inlineSep;
    multiSep = seps.multiSep;
    buildSettings();
  }

  function buildSettings(): void {
    if (!settingsContainer) return;
    settingsContainer.empty();

    new Setting(settingsContainer)
      .setName(t.sourceFolderName)
      .setDesc(t.sourceFolderDesc)
      .addText((text) =>
        text.setValue(sourceFolder).onChange((v) => {
          sourceFolder = v;
          scanned = null;
        })
      );

    new Setting(settingsContainer)
      .setName(t.targetFolderName)
      .setDesc(t.targetFolderDesc)
      .addText((text) => text.setValue(targetFolder).onChange((v) => (targetFolder = v)));

    new Setting(settingsContainer)
      .setName(t.srTagName)
      .setDesc(t.srTagDesc)
      .addText((text) =>
        text.setValue(srBaseTag).onChange((v) => {
          srBaseTag = v;
          scanned = null;
        })
      );

    new Setting(settingsContainer)
      .setName(t.inlineSepName)
      .setDesc(t.inlineSepDesc)
      .addText((text) =>
        text.setValue(inlineSep).onChange((v) => {
          inlineSep = v;
          scanned = null;
        })
      );

    new Setting(settingsContainer)
      .setName(t.multiSepName)
      .setDesc(t.multiSepDesc)
      .addText((text) =>
        text.setValue(multiSep).onChange((v) => {
          multiSep = v;
          scanned = null;
        })
      );

    new Setting(settingsContainer)
      .setName(t.reviewTagName)
      .setDesc(t.reviewTagDesc)
      .addText((text) =>
        text.setValue(srReviewTag).onChange((v) => {
          srReviewTag = v;
          scanned = null;
        })
      );

    new Setting(settingsContainer)
      .setName(t.profileName)
      .setDesc(t.profileDesc)
      .addDropdown((dropdown) => {
        // Inline cards can't go into title mode (headerLevel 0), so hide those.
        for (const profile of profiles.filter((p) => p.headerLevel > 0)) {
          dropdown.addOption(profile.id, profile.name);
        }
        dropdown.setValue(profileId).onChange((v) => (profileId = v));
      });

    new Setting(settingsContainer)
      .setName(t.formatName)
      .setDesc(t.formatDesc)
      .addDropdown((dropdown) => {
        dropdown.addOption("smart", t.formatSmart);
        dropdown.addOption("headers", t.formatHeaders);
        dropdown.addOption("tables", t.formatTables);
        dropdown.setValue(format);
        dropdown.onChange((v) => (format = v as MigrationFormat));
      });

    new Setting(settingsContainer)
      .setName(t.deleteModeName)
      .setDesc(t.deleteModeDesc)
      .addToggle((toggle) =>
        toggle.setValue(deleteMode).onChange((v) => (deleteMode = v))
      );
  }

  async function handleScan(): Promise<void> {
    scanning = true;
    summary = null;
    try {
      const result = await controller.scan({
        sourceFolder,
        srBaseTag,
        srReviewTag,
        inlineSep,
        multiSep,
      });
      scanned = {
        files: result.fileCount,
        cards: result.cardCount,
        history: result.withHistory,
      };
    } catch (error) {
      console.error("SR migration scan failed", error);
      new Notice(t.scanFailed);
    } finally {
      scanning = false;
    }
  }

  async function handleMigrate(): Promise<void> {
    if (!profileId) return;
    migrating = true;
    try {
      summary = await controller.migrate({
        sourceFolder,
        targetFolder,
        srBaseTag,
        srReviewTag,
        inlineSep,
        multiSep,
        profileId,
        format,
        deleteMode,
      });
      new Notice(
        I18n.format(t.successNotice, {
          files: summary.filesCreated,
          cards: summary.cardsMigrated,
          history: summary.withHistory,
        })
      );
      onComplete?.();
    } catch (error) {
      console.error("SR migration failed", error);
      new Notice(t.migrateFailed);
    } finally {
      migrating = false;
    }
  }

  function handleCancel(): void {
    oncancel?.();
  }
</script>

<div class="decks-sr-migration-ui">
  <h2>{t.title}</h2>
  <p class="decks-sr-migration-intro">{t.description}</p>

  <div class="decks-sr-migration-settings" bind:this={settingsContainer}></div>

  {#if deleteMode}
    <p class="decks-sr-migration-warning">{t.deleteWarning}</p>
  {:else if format === "tables"}
    <p class="decks-sr-migration-warning">{t.formatTablesWarning}</p>
  {/if}

  {#if scanned}
    <p class="decks-sr-migration-scan">
      {I18n.format(t.scanSummary, {
        files: scanned.files,
        cards: scanned.cards,
        history: scanned.history,
      })}
    </p>
  {/if}

  {#if summary}
    <p class="decks-sr-migration-done">
      {I18n.format(t.doneSummary, {
        files: summary.filesCreated,
        cards: summary.cardsMigrated,
        history: summary.withHistory,
      })}
    </p>
  {/if}

  <div class="decks-modal-footer">
    <button on:click={() => void handleScan()} disabled={scanning || migrating}>
      {scanning ? t.scanning : t.scanButton}
    </button>
    <button
      class="mod-cta"
      on:click={() => void handleMigrate()}
      disabled={migrating || scanning || !profileId || (scanned !== null && scanned.files === 0)}
    >
      {migrating ? t.migrating : t.migrateButton}
    </button>
    <button on:click={handleCancel} disabled={migrating}>{t.cancel}</button>
  </div>
</div>

<style>
  .decks-sr-migration-ui {
    padding: 20px;
  }
  .decks-sr-migration-intro {
    color: var(--text-muted);
    margin-bottom: 16px;
  }
  .decks-sr-migration-warning {
    color: var(--text-error);
    font-weight: 600;
    margin-top: 12px;
  }
  .decks-sr-migration-scan,
  .decks-sr-migration-done {
    margin-top: 12px;
    color: var(--text-normal);
  }
  .decks-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }
  .decks-modal-footer button {
    padding: 8px 16px;
  }

  @media (max-width: 768px) {
    .decks-sr-migration-ui {
      padding: 16px;
    }
    .decks-modal-footer {
      flex-direction: column-reverse;
    }
    .decks-modal-footer button {
      width: 100%;
    }
  }

  @media (max-width: 480px) {
    .decks-sr-migration-ui {
      padding: 12px;
    }
  }

  @media (max-width: 390px) {
    .decks-sr-migration-ui {
      padding: 10px;
    }
  }
</style>
