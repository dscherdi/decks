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
  let clozeSep = ";;";
  let profileId = "";
  let format: MigrationFormat = "smart";
  let deleteMode = false;

  let profiles: DeckProfile[] = [];
  let scanning = false;
  let migrating = false;
  let scanned: { files: number; cards: number; history: number } | null = null;
  let summary: SrMigrateSummary | null = null;
  let progressPct = 0;
  let progressLabel = "";

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
    clozeSep = seps.clozeSep;
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
      .setName(t.clozeSepName)
      .setDesc(t.clozeSepDesc)
      .addText((text) =>
        text.setValue(clozeSep).onChange((v) => {
          clozeSep = v;
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
        clozeSep,
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
    progressPct = 0;
    progressLabel = "";
    try {
      summary = await controller.migrate(
        {
          sourceFolder,
          targetFolder,
          srBaseTag,
          srReviewTag,
          inlineSep,
          multiSep,
          clozeSep,
          profileId,
          format,
          deleteMode,
        },
        (done, total, phase, detail) => {
          progressPct = total > 0 ? (done / total) * 100 : 0;
          progressLabel =
            phase === "write"
              ? I18n.format(t.progressWriting, { file: detail ?? "" })
              : phase === "sync"
                ? t.progressSyncing
                : t.progressRestoring;
        }
      );
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
  <div class="decks-sr-migration-body">
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
  </div>

  <div class="decks-modal-footer">
    {#if migrating}
      <div class="decks-sr-migration-progress-row">
        <div class="decks-sr-migration-progress">
          <div class="decks-progress-fill" style="width: {progressPct}%"></div>
        </div>
        <span class="decks-sr-migration-progress-label">{progressLabel}</span>
      </div>
    {/if}
    <div class="decks-sr-migration-actions">
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
</div>

<style>
  :global(.decks-sr-migration-container) {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    padding: 0;
  }
  .decks-sr-migration-ui {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .decks-sr-migration-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
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
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
    padding: 15px 20px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-sr-migration-progress-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .decks-sr-migration-progress {
    height: 4px;
    background: var(--background-modifier-border);
    border-radius: 2px;
    overflow: hidden;
  }
  .decks-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.2s ease;
  }
  .decks-sr-migration-progress-label {
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-sr-migration-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .decks-sr-migration-actions button {
    padding: 8px 16px;
  }

  @media (max-width: 768px) {
    .decks-sr-migration-body {
      padding: 16px;
    }
    .decks-modal-footer {
      padding: 15px;
    }
    .decks-sr-migration-actions {
      flex-direction: column-reverse;
    }
    .decks-sr-migration-actions button {
      width: 100%;
    }
  }

  @media (max-width: 480px) {
    .decks-sr-migration-body {
      padding: 12px;
    }
  }
</style>
