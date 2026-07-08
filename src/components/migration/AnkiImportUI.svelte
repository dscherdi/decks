<script lang="ts">
  import { onMount } from "svelte";
  import { Setting, Notice } from "obsidian";
  import { I18n, DEFAULT_ANKI_CARDS_PER_FILE } from "@decks/core";
  import type { DeckProfile } from "@decks/core";
  import type { IDatabaseService } from "@/database/DatabaseFactory";
  import type {
    AnkiImportController,
    AnkiImportSummary,
    AnkiScanResult,
  } from "@/services/AnkiImportController";

  const t = I18n.t.anki;

  // Above this many copied media files, warn that Obsidian indexes them in the
  // background (fast fs writes mean the vault watcher discovers them after).
  const LARGE_MEDIA_NOTICE_THRESHOLD = 2000;

  export let db: IDatabaseService;
  export let controller: AnkiImportController;
  export let onComplete: (() => void) | undefined = undefined;
  export let oncancel: (() => void) | undefined = undefined;

  let targetFolder = "Anki Import";
  let profileId = "";
  let split = true;
  let cardsPerFile = DEFAULT_ANKI_CARDS_PER_FILE;
  let profiles: DeckProfile[] = [];

  let fileBytes: Uint8Array | null = null;
  let fileName = "";

  let scanning = false;
  let importing = false;
  let scanned: AnkiScanResult | null = null;
  let summary: AnkiImportSummary | null = null;
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
    buildSettings();
  }

  function buildSettings(): void {
    if (!settingsContainer) return;
    settingsContainer.empty();

    new Setting(settingsContainer)
      .setName(t.targetFolderName)
      .setDesc(t.targetFolderDesc)
      .addText((text) => text.setValue(targetFolder).onChange((v) => (targetFolder = v)));

    new Setting(settingsContainer)
      .setName(t.profileName)
      .setDesc(t.profileDesc)
      .addDropdown((dropdown) => {
        for (const profile of profiles.filter((p) => p.headerLevel > 0)) {
          dropdown.addOption(profile.id, profile.name);
        }
        dropdown.setValue(profileId).onChange((v) => (profileId = v));
      });

    new Setting(settingsContainer)
      .setName(t.splitName)
      .setDesc(t.splitDesc)
      .addToggle((toggle) =>
        toggle.setValue(split).onChange((v) => {
          split = v;
          buildSettings();
        })
      );

    if (split) {
      new Setting(settingsContainer)
        .setName(t.chunkSizeName)
        .setDesc(t.chunkSizeDesc)
        .addText((text) =>
          text
            .setValue(String(cardsPerFile))
            .setPlaceholder(String(DEFAULT_ANKI_CARDS_PER_FILE))
            .onChange((v) => {
              const n = parseInt(v, 10);
              const ok = !isNaN(n) && n >= 50 && n <= 50000;
              if (ok) cardsPerFile = n;
              text.inputEl.toggleClass("decks-input-error", !ok);
            })
        );
    }
  }

  async function handleFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    scanned = null;
    summary = null;
    if (!file) {
      fileBytes = null;
      fileName = "";
      return;
    }
    fileName = file.name;
    fileBytes = new Uint8Array(await file.arrayBuffer());
  }

  async function handleScan(): Promise<void> {
    if (!fileBytes) {
      new Notice(t.selectFileFirst);
      return;
    }
    scanning = true;
    summary = null;
    try {
      scanned = await controller.scan(fileBytes);
    } catch (error) {
      console.error("Anki import scan failed", error);
      new Notice(error instanceof Error ? error.message : t.scanFailed);
    } finally {
      scanning = false;
    }
  }

  async function handleImport(): Promise<void> {
    if (!fileBytes) {
      new Notice(t.selectFileFirst);
      return;
    }
    if (!profileId) return;
    importing = true;
    progressPct = 0;
    progressLabel = "";
    try {
      summary = await controller.import(
        fileBytes,
        { targetFolder, profileId, split, cardsPerFile },
        (done, total, phase, detail) => {
          progressPct = total > 0 ? (done / total) * 100 : 0;
          progressLabel =
            phase === "read"
              ? t.progressReading
              : phase === "write"
                ? I18n.format(t.progressWriting, { deck: detail ?? "" })
                : phase === "media"
                  ? I18n.format(t.progressCopyingMedia, { done, total })
                  : phase === "sync"
                    ? t.progressSyncing
                    : t.progressImporting;
        }
      );
      new Notice(
        I18n.format(t.successNotice, {
          cards: summary.cardsImported,
          decks: summary.decksCreated,
          history: summary.withHistory,
        })
      );
      // Large imports write media straight to disk; Obsidian's watcher indexes
      // them in the background, so flag the brief catch-up to avoid confusion.
      if (summary.mediaCopied > LARGE_MEDIA_NOTICE_THRESHOLD) {
        new Notice(I18n.format(t.mediaIndexingNotice, { count: summary.mediaCopied }));
      }
      onComplete?.();
    } catch (error) {
      console.error("Anki import failed", error);
      new Notice(error instanceof Error ? error.message : t.importFailed);
    } finally {
      importing = false;
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
    <p class="decks-sr-migration-howto">{t.howItWorks}</p>

    <div class="decks-anki-file">
      <label class="decks-anki-file-label" for="decks-anki-file-input">{t.fileLabel}</label>
      <input
        id="decks-anki-file-input"
        class="decks-anki-file-input"
        type="file"
        accept=".apkg"
        on:change={(e) => void handleFileChange(e)}
      />
      <p class="decks-anki-file-desc">{fileName || t.noFileSelected}</p>
    </div>

    <div class="decks-sr-migration-settings" bind:this={settingsContainer}></div>

    {#if scanned}
      <p class="decks-sr-migration-scan">
        {I18n.format(t.scanSummary, {
          decks: scanned.deckCount,
          cards: scanned.cardCount,
          history: scanned.withHistory,
          media: scanned.mediaCount,
        })}
      </p>
    {/if}

    {#if summary}
      <p class="decks-sr-migration-done">
        {I18n.format(t.doneSummary, {
          decks: summary.decksCreated,
          cards: summary.cardsImported,
          media: summary.mediaCopied,
          history: summary.withHistory,
        })}
      </p>
    {/if}
  </div>

  <div class="decks-modal-footer">
    {#if importing}
      <div class="decks-sr-migration-progress-row">
        <div class="decks-sr-migration-progress">
          <div class="decks-progress-fill" style="width: {progressPct}%"></div>
        </div>
        <span class="decks-sr-migration-progress-label">{progressLabel}</span>
      </div>
    {/if}
    <div class="decks-sr-migration-actions">
      <button on:click={() => void handleScan()} disabled={scanning || importing || !fileBytes}>
        {scanning ? t.scanning : t.scanButton}
      </button>
      <button
        class="mod-cta"
        on:click={() => void handleImport()}
        disabled={importing || scanning || !profileId || !fileBytes}
      >
        {importing ? t.importing : t.importButton}
      </button>
      <button on:click={handleCancel} disabled={importing}>{t.cancel}</button>
    </div>
  </div>
</div>

<style>
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
    margin-bottom: 8px;
  }
  .decks-sr-migration-howto {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.5;
    background: var(--background-secondary);
    border-left: 3px solid var(--interactive-accent);
    border-radius: var(--radius-s);
    padding: 10px 12px;
    margin-bottom: 16px;
  }
  .decks-anki-file {
    margin-bottom: 16px;
  }
  .decks-anki-file-label {
    display: block;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .decks-anki-file-desc {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    margin-top: 6px;
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
</style>
