<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { type App, type TFile, setIcon } from "obsidian";
  import { I18n, type AiProviderId, type GeneratedCard, type GenerateHandlers, type GenerateResult } from "@decks/core";
  import AiPromptComposer from "./AiPromptComposer.svelte";
  import { buildModelOptions } from "../utils/ai-model-options";
  import BatchCardRow from "./BatchCardRow.svelte";
  import { FilePickerModal } from "../utils/file-picker";
  import { FolderPickerModal } from "../utils/folder-picker";
  import {
    type ContextItem,
    buildGenerationComposerRequest,
    savePastedImage,
    IMAGE_EXTENSIONS,
  } from "../utils/attachments";
  import type { SaveFormat } from "../services/FlashcardComposer";
  import type { GeneratorSaveRequest, ProfileOpt } from "./generator-save";

  export let app: App;
  export let generate: (
    options: {
      prompt: string;
      sourceContext?: string;
      images?: unknown[];
      maxBatches?: number;
      existingCards?: GeneratedCard[];
      model?: string;
      debug?: boolean;
    },
    handlers: GenerateHandlers,
    signal: AbortSignal,
  ) => Promise<GenerateResult>;
  export let save: (
    cards: GeneratedCard[],
    request: GeneratorSaveRequest,
  ) => Promise<{
    ok: boolean;
    error?: string;
    count?: number;
    deckId?: string;
    filePath?: string;
  }>;
  export let loadProfiles: () => Promise<ProfileOpt[]>;
  export let defaultFolder = "";
  export let canvasFolder = "";
  export let deckTag = "#decks";
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  export let onClose: () => void;
  export let aiProvider: AiProviderId;
  export let defaultModel = "";
  export let debugEnabled = false;

  const g = I18n.t.modals.aiGenerator;

  // Last generation's request payload + raw response, shown in the debug panel.
  let lastDebug: GenerateResult["debug"] | null = null;
  // Debug panel is collapsed by default; toggled from the header button.
  let showDebug = false;

  function toggleDebug() {
    showDebug = !showDebug;
    // Widen the modal only while the panel is open (no-op in tab mode).
    rootEl
      ?.closest(".modal")
      ?.classList.toggle("decks-ai-gen-has-debug", showDebug);
  }

  // Per-prompt model picker: defaults to the global model, overrides this run only.
  const modelOptions = buildModelOptions(aiProvider, defaultModel);
  let selectedModel = defaultModel;

  // Upper bound on generation rounds per Generate click. The controller feeds
  // each round's cards back to the model and stops early once a round adds
  // nothing new, so this is just a safety cap.
  const MAX_BATCHES = 5;

  // Markdown render action for the detail pane (mirrors BatchCardRow).
  function md(node: HTMLElement, content: string) {
    node.empty();
    renderMarkdown(content, node);
    return {
      update(next: string) {
        node.empty();
        renderMarkdown(next, node);
      },
    };
  }

  interface GenRow {
    id: string;
    card: GeneratedCard;
    keep: boolean;
    saved: boolean;
  }

  let phase: "idle" | "streaming" | "review" | "saving" = "idle";
  let rows: GenRow[] = [];
  let partial: GeneratedCard | null = null;
  let selectedId: string | null = null;
  let genError: string | null = null;
  let abortController: AbortController | null = null;
  let rowCounter = 0;
  let includeGenerated = false;
  let hasSaved = false;

  $: selected = rows.find((r) => r.id === selectedId) ?? null;
  $: keptCount = rows.filter((r) => r.keep && !r.saved).length;
  $: savedCount = rows.filter((r) => r.saved).length;

  // Mobile: show either the list or the detail. Driven by the component's own
  // width (via ResizeObserver) so it reacts to the pane size in tab mode, not
  // just the window — and catches pane-splitter drags that fire no resize event.
  let mobile = false;
  let rootEl: HTMLElement;
  let resizeObserver: ResizeObserver | null = null;
  onMount(() => {
    mobile = rootEl.clientWidth <= 768;
    resizeObserver = new ResizeObserver((entries) => {
      mobile = entries[0].contentRect.width <= 768;
    });
    resizeObserver.observe(rootEl);
    initSaveDefaults().catch((e) =>
      console.error("AI generator: failed to load decks/profiles", e),
    );
  });
  onDestroy(() => resizeObserver?.disconnect());

  // --- Composer state ---
  let prompt = "";
  let contexts: ContextItem[] = [];
  const mentionItems = app.vault
    .getMarkdownFiles()
    .map((f) => ({ path: f.path, label: f.basename }));
  let mentionedAll: ContextItem[] = [];
  $: activeMentions = mentionedAll.filter((m) => prompt.includes(`@${m.label}`));
  $: mentionLabels = activeMentions.map((m) => m.label);

  function addContext(kind: "note" | "image", path: string, label: string) {
    const id = `${kind}:${path}`;
    if (contexts.some((c) => c.id === id)) return;
    contexts = [...contexts, { id, kind, path, label }];
  }
  function removeContext(id: string) {
    contexts = contexts.filter((c) => c.id !== id);
  }
  function addMention(item: { path: string; label: string }) {
    const id = `note:${item.path}`;
    if (mentionedAll.some((m) => m.id === id)) return;
    mentionedAll = [
      ...mentionedAll,
      { id, kind: "note", path: item.path, label: item.label },
    ];
  }
  function addNote() {
    new FilePickerModal(
      app,
      app.vault.getMarkdownFiles(),
      (f) => addContext("note", f.path, f.name),
      g.addNote,
    ).open();
  }
  function addImage() {
    const images = app.vault
      .getFiles()
      .filter((f) => IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()));
    new FilePickerModal(app, images, (f) => addContext("image", f.path, f.name), g.addImage).open();
  }
  async function pasteImages(files: File[]) {
    for (const file of files) {
      const saved = await savePastedImage(app, "", file);
      if (saved) addContext("image", saved.path, saved.name);
    }
  }

  // --- Generation ---
  async function startGenerate() {
    if (phase === "streaming" || !prompt.trim()) return;
    const req = await buildGenerationComposerRequest(
      app,
      prompt,
      contexts,
      activeMentions,
    );
    // Cards from earlier runs to feed back (dedup + context) when the toggle is
    // on; the controller skips re-emitting them. Captured before streaming.
    const existingCards = includeGenerated ? rows.map((r) => r.card) : undefined;
    partial = null;
    genError = null;
    if (debugEnabled) lastDebug = null;
    phase = "streaming";
    abortController = new AbortController();
    const handlers: GenerateHandlers = {
      onCard: (card) => {
        const id = `gen-${rowCounter++}`;
        rows = [...rows, { id, card, keep: true, saved: false }];
        if (!selectedId) selectedId = id;
      },
      onPartial: (card) => {
        partial = card;
      },
    };
    try {
      const result = await generate(
        {
          prompt: req.prompt,
          sourceContext: req.sourceContext,
          images: req.images,
          maxBatches: MAX_BATCHES,
          existingCards,
          model: selectedModel,
          debug: debugEnabled,
        },
        handlers,
        abortController.signal,
      );
      if (debugEnabled) lastDebug = result.debug ?? lastDebug;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      genError = msg.trim() ? msg : g.generateFailed;
    } finally {
      partial = null;
      phase = rows.length > 0 ? "review" : "idle";
    }
  }

  function interrupt() {
    abortController?.abort();
  }

  function select(id: string) {
    selectedId = selectedId === id ? null : id;
  }
  function toggleKeep(id: string) {
    rows = rows.map((r) => (r.id === id ? { ...r, keep: !r.keep } : r));
  }

  // --- Save panel ---
  let saveMode: "new-file" | "append" = "new-file";
  let format: SaveFormat = "header-paragraph"; // new-file format (user choice)
  let appendFormat: SaveFormat = "header-paragraph"; // append format (target file kind)
  let fileName = "";
  let folder = "";
  let tag = "#decks";
  let profiles: ProfileOpt[] = [];
  let profileId = "";
  let appendFile: TFile | null = null; // vault file to append to
  let saveError: string | null = null;
  let showDestination = true;

  async function initSaveDefaults() {
    folder = defaultFolder;
    tag = deckTag;
    profiles = await loadProfiles();
    profileId = profiles[0]?.id ?? "";
  }

  // Drop the chosen file if it no longer matches the format's file kind
  // (canvas format ↔ .canvas file; markdown formats ↔ .md file).
  $: if (
    appendFile &&
    (appendFormat === "canvas") !== (appendFile.extension === "canvas")
  ) {
    appendFile = null;
  }
  // Human label for the append format (used in the read-only locked view).
  $: appendFormatLabel =
    appendFormat === "table"
      ? g.formatTable
      : appendFormat === "canvas"
        ? g.formatCanvas
        : g.formatHeader;

  // Render a native Obsidian icon into an element.
  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
  }

  // Pick the append target from the vault: any .md file for markdown formats,
  // any .canvas file for the canvas format.
  function openFilePicker() {
    const files =
      appendFormat === "canvas"
        ? app.vault.getFiles().filter((f) => f.extension === "canvas")
        : app.vault.getMarkdownFiles();
    new FilePickerModal(
      app,
      files,
      (file) => {
        appendFile = file;
      },
      g.deckSearchPlaceholder,
    ).open();
  }

  // Pick the destination folder for a new file ("" = vault root).
  function openFolderPicker() {
    const folders = Array.from(
      new Set(["", ...app.vault.getAllFolders().map((f) => f.path)]),
    );
    new FolderPickerModal(
      app,
      folders,
      (path) => {
        folder = path;
      },
      g.folder,
    ).open();
  }
  // Canvas new files must land in the canvas-decks folder; default it there.
  $: if (saveMode === "new-file" && format === "canvas" && folder === defaultFolder) {
    folder = canvasFolder || defaultFolder;
  }
  function buildRequest(): GeneratorSaveRequest | null {
    if (saveMode === "append") {
      if (!appendFile) {
        saveError = g.deckRequired;
        return null;
      }
      return { kind: "append", format: appendFormat, filePath: appendFile.path };
    }
    if (!fileName.trim()) {
      saveError = g.nameRequired;
      return null;
    }
    return {
      kind: "new-file",
      format,
      folder: folder.trim(),
      name: fileName.trim(),
      tag: tag.trim() || deckTag,
      profileId,
    };
  }

  async function doSave() {
    saveError = null;
    const request = buildRequest();
    if (!request) return;
    const kept = rows.filter((r) => r.keep && !r.saved);
    const cards = kept.map((r) => r.card);
    if (cards.length === 0) {
      saveError = g.noKept;
      return;
    }
    const savedIds = new Set(kept.map((r) => r.id));
    phase = "saving";
    const result = await save(cards, request);
    if (result.ok) {
      rows = rows.map((r) =>
        savedIds.has(r.id) ? { ...r, saved: true } : r,
      );
      // Further saves this session append to the file we just wrote, so lock the
      // target to it.
      hasSaved = true;
      const savedPath =
        result.filePath ??
        (request.kind === "append" ? request.filePath : undefined);
      const savedFile = savedPath
        ? app.vault.getAbstractFileByPath(savedPath)
        : null;
      appendFile =
        savedFile && "extension" in savedFile ? (savedFile as TFile) : appendFile;
      appendFormat = request.format; // lock consecutive generations to this target
      saveMode = "append";
      phase = "review";
    } else {
      saveError = result.error?.trim() ? result.error : g.saveFailed;
      phase = "review";
    }
  }
</script>

<div class="decks-ai-gen-layout">
<div class="decks-ai-gen" bind:this={rootEl}>
  <div class="decks-ai-gen-header">
    <div class="decks-ai-gen-header-text">
      <h3>{g.title}</h3>
      <div class="decks-ai-gen-sub">{g.intro}</div>
    </div>
    {#if debugEnabled}
      <button
        type="button"
        class="clickable-icon decks-ai-gen-debug-toggle"
        class:is-active={showDebug}
        aria-pressed={showDebug}
        aria-label={g.debugToggle}
        title={g.debugToggle}
        use:icon={"bug"}
        on:click={toggleDebug}
      ></button>
    {/if}
  </div>

  {#if genError?.trim()}
    <div class="decks-edit-error">{genError}</div>
  {/if}

  <div class="decks-ai-gen-body" class:has-detail={!!selectedId}>
    {#if !(mobile && selectedId)}
      <div class="decks-ai-gen-sidebar">
        {#each rows as row (row.id)}
          <div
            class="decks-ai-gen-rowwrap"
            class:is-dropped={!row.keep && !row.saved}
            class:is-saved={row.saved}
          >
            <BatchCardRow
              card={row.card}
              status={row.saved ? "accepted" : row.keep ? "ready" : "empty"}
              selected={row.id === selectedId}
              {renderMarkdown}
              onSelect={() => select(row.id)}
            />
          </div>
        {/each}
        {#if partial}
          <div class="decks-ai-gen-rowwrap is-streaming">
            <BatchCardRow card={partial} status="running" {renderMarkdown} />
          </div>
        {/if}
        {#if rows.length === 0 && !partial && phase !== "streaming"}
          <div class="decks-ai-gen-note">{g.noCards}</div>
        {/if}
      </div>
    {/if}

    {#if selectedId}
      <div class="decks-ai-gen-detail">
        {#if mobile}
          <button
            type="button"
            class="decks-ai-gen-back"
            on:click={() => (selectedId = null)}>← {g.backToList}</button
          >
        {/if}
        {#if selected}
          <div class="decks-ai-gen-card">
            <div class="decks-ai-gen-field">
              <span class="decks-ai-gen-field-label">{g.fieldFront}</span>
              <div use:md={selected.card.front}></div>
            </div>
            <div class="decks-ai-gen-field">
              <span class="decks-ai-gen-field-label">{g.fieldBack}</span>
              <div use:md={selected.card.back}></div>
            </div>
            {#if selected.card.notes.trim()}
              <div class="decks-ai-gen-field">
                <span class="decks-ai-gen-field-label">{g.fieldNotes}</span>
                <div use:md={selected.card.notes}></div>
              </div>
            {/if}
          </div>
          <div class="decks-ai-gen-card-actions">
            {#if selected.saved}
              <span class="decks-ai-gen-saved-badge">{g.savedBadge}</span>
            {:else}
              <button type="button" on:click={() => toggleKeep(selected.id)}>
                {selected.keep ? g.discard : g.keep}
              </button>
            {/if}
          </div>
        {:else}
          <div class="decks-ai-gen-note">{g.selectPrompt}</div>
        {/if}
      </div>
    {/if}
  </div>

  {#if (phase === "review" || phase === "saving") && (showDestination || saveError?.trim())}
    <div class="decks-ai-gen-save">
      {#if showDestination}
      {#if !hasSaved}
        <div class="decks-seg" role="tablist">
          <button
            type="button"
            class="decks-seg-btn"
            class:is-active={saveMode === "new-file"}
            role="tab"
            aria-selected={saveMode === "new-file"}
            on:click={() => (saveMode = "new-file")}
          >
            {g.modeNew}
          </button>
          <button
            type="button"
            class="decks-seg-btn"
            class:is-active={saveMode === "append"}
            role="tab"
            aria-selected={saveMode === "append"}
            on:click={() => (saveMode = "append")}
          >
            {g.modeAppend}
          </button>
        </div>
      {/if}

      {#if saveMode === "new-file"}
        <div class="decks-ai-gen-save-grid">
          <label class="decks-ai-gen-save-row">
            <span>{g.format}</span>
            <select bind:value={format}>
              <option value="header-paragraph">{g.formatHeader}</option>
              <option value="table">{g.formatTable}</option>
              <option value="canvas">{g.formatCanvas}</option>
            </select>
          </label>
          <label class="decks-ai-gen-save-row">
            <span>{g.name}</span>
            <input type="text" bind:value={fileName} placeholder={g.namePlaceholder} />
          </label>
          <label class="decks-ai-gen-save-row">
            <span>{g.folder}</span>
            <button
              type="button"
              class="decks-ai-gen-deck-search"
              on:click={openFolderPicker}
            >
              <span class="decks-deck-search-icon" use:icon={"folder"}></span>
              <span class:is-placeholder={!folder}>
                {folder || g.folderPlaceholder}
              </span>
            </button>
          </label>
          {#if format !== "canvas"}
            <label class="decks-ai-gen-save-row">
              <span>{g.tag}</span>
              <input type="text" bind:value={tag} />
            </label>
          {/if}
          <label class="decks-ai-gen-save-row">
            <span>{g.profile}</span>
            <select bind:value={profileId}>
              {#each profiles as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          </label>
        </div>
      {:else}
        <div class="decks-ai-gen-save-grid">
          <label class="decks-ai-gen-save-row">
            <span>{g.format}</span>
            {#if hasSaved}
              <span class="decks-ai-gen-readonly">{appendFormatLabel}</span>
            {:else}
              <select bind:value={appendFormat}>
                <option value="header-paragraph">{g.formatHeader}</option>
                <option value="table">{g.formatTable}</option>
                <option value="canvas">{g.formatCanvas}</option>
              </select>
            {/if}
          </label>
          <label class="decks-ai-gen-save-row">
            <span>{g.deck}</span>
            {#if hasSaved}
              <span class="decks-ai-gen-readonly">{appendFile?.path ?? ""}</span>
            {:else}
              <button
                type="button"
                class="decks-ai-gen-deck-search"
                on:click={openFilePicker}
              >
                <span class="decks-deck-search-icon" use:icon={"search"}></span>
                <span class:is-placeholder={!appendFile}>
                  {appendFile ? appendFile.path : g.deckSearchPlaceholder}
                </span>
              </button>
            {/if}
          </label>
        </div>
      {/if}
      {/if}

      {#if saveError?.trim()}
        <div class="decks-edit-error">{saveError}</div>
      {/if}
    </div>
  {/if}

  {#if phase === "idle" || phase === "streaming" || phase === "review"}
    <div class="decks-ai-gen-composer">
      <AiPromptComposer
        bind:prompt
        {contexts}
        {mentionItems}
        {mentionLabels}
        splitAvailable={false}
        {modelOptions}
        bind:selectedModel
        submitting={phase === "streaming"}
        submitLabel={g.generate}
        submittingLabel={g.generating}
        placeholder={g.promptPlaceholder}
        onAddNote={addNote}
        onAddImage={addImage}
        onRemoveContext={removeContext}
        onMention={addMention}
        onPasteImages={pasteImages}
        onSubmit={startGenerate}
        includeAvailable={rows.length > 0}
        includeOn={includeGenerated}
        includeLabel={g.includeGenerated}
        onToggleInclude={() => (includeGenerated = !includeGenerated)}
      />
    </div>
  {/if}

  <div class="decks-ai-gen-footer">
    {#if phase === "streaming"}
      <span class="decks-ai-gen-footer-info">
        {I18n.format(g.streaming, { count: rows.length })}
      </span>
      <span class="decks-ai-gen-footer-spacer"></span>
      <button type="button" class="mod-warning" on:click={interrupt}>{g.stop}</button>
    {:else if phase === "saving"}
      <span class="decks-ai-gen-footer-info">{g.saving}</span>
    {:else}
      <button type="button" on:click={onClose}>{savedCount > 0 ? g.close : g.cancel}</button>
      {#if savedCount > 0}
        <span class="decks-ai-gen-footer-info">
          {I18n.format(g.savedNotice, { count: savedCount })}
        </span>
      {/if}
      <span class="decks-ai-gen-footer-spacer"></span>
      {#if phase === "review"}
        <button
          type="button"
          class="decks-ai-gen-dest-toggle"
          class:is-active={showDestination}
          aria-pressed={showDestination}
          aria-label={g.destination}
          on:click={() => (showDestination = !showDestination)}
        >
          <span class="decks-ai-gen-dest-toggle-icon" use:icon={"sliders-horizontal"}></span>
          {g.destination}
        </button>
        <button
          type="button"
          class="mod-cta"
          on:click={doSave}
          disabled={keptCount === 0}
        >
          {I18n.format(g.save, { count: keptCount })}
        </button>
      {/if}
    {/if}
  </div>
</div>
{#if debugEnabled && showDebug}
  <aside class="decks-ai-gen-debug">
    <div class="decks-ai-gen-debug-title">{g.debugTitle}</div>
    {#if lastDebug}
      <div class="decks-ai-gen-debug-meta">
        {lastDebug.provider} · {lastDebug.model}
      </div>
      <div class="decks-ai-debug-label">{g.debugSystem}</div>
      <pre class="decks-ai-debug-pre">{lastDebug.system}</pre>
      <div class="decks-ai-debug-label">{g.debugUser}</div>
      <pre class="decks-ai-debug-pre">{lastDebug.user}</pre>
      {#if lastDebug.priorAssistant}
        <div class="decks-ai-debug-label">{g.debugPriorAssistant}</div>
        <pre class="decks-ai-debug-pre">{lastDebug.priorAssistant}</pre>
      {/if}
      {#if lastDebug.followupUser}
        <div class="decks-ai-debug-label">{g.debugFollowup}</div>
        <pre class="decks-ai-debug-pre">{lastDebug.followupUser}</pre>
      {/if}
      {#if lastDebug.imageCount > 0}
        <div class="decks-ai-gen-debug-meta">
          {g.debugImages}: {lastDebug.imageCount}
        </div>
      {/if}
      <div class="decks-ai-debug-label">{g.debugResponse}</div>
      <pre class="decks-ai-debug-pre">{lastDebug.raw}</pre>
    {:else}
      <div class="decks-ai-gen-debug-empty">{g.debugEmpty}</div>
    {/if}
  </aside>
{/if}
</div>

<style>
  .decks-ai-gen-layout {
    display: flex;
    height: 100%;
    width: 100%;
    min-height: 0;
  }
  .decks-ai-gen {
    display: flex;
    flex-direction: column;
    height: 100%;
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 16px 20px;
    box-sizing: border-box;
  }
  .decks-ai-gen-debug {
    flex: 0 0 340px;
    min-height: 0;
    overflow-y: auto;
    border-left: 1px solid var(--background-modifier-border);
    padding: 16px;
    box-sizing: border-box;
  }
  .decks-ai-gen-debug-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
    margin-bottom: 8px;
  }
  .decks-ai-gen-debug-meta {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 6px;
    font-family: var(--font-monospace);
  }
  .decks-ai-gen-debug-empty {
    font-size: 12px;
    color: var(--text-faint);
  }
  .decks-ai-debug-label {
    margin-top: 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
    font-weight: 600;
  }
  .decks-ai-debug-pre {
    margin: 2px 0 0 0;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    user-select: text;
    font-family: var(--font-monospace);
    font-size: 11px;
    line-height: 1.45;
    background: var(--background-primary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    padding: 6px 8px;
  }
  .decks-ai-gen-header {
    flex: 0 0 auto;
    padding-bottom: 10px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .decks-ai-gen-header-text {
    min-width: 0;
  }
  .decks-ai-gen-debug-toggle {
    flex: 0 0 auto;
  }
  .decks-ai-gen-debug-toggle.is-active {
    color: var(--text-on-accent);
    background: var(--interactive-accent);
  }
  .decks-ai-gen-header h3 {
    margin: 0 0 4px 0;
  }
  .decks-ai-gen-sub {
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-ai-gen-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  .decks-ai-gen-sidebar {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 6px;
    background: var(--background-secondary);
    border-right: 1px solid var(--background-modifier-border-hover);
    border-radius: var(--radius-s) 0 0 var(--radius-s);
  }
  .decks-ai-gen-body.has-detail .decks-ai-gen-sidebar {
    flex: 0 0 34%;
  }
  .decks-ai-gen-rowwrap.is-dropped {
    opacity: 0.45;
  }
  .decks-ai-gen-rowwrap.is-streaming {
    opacity: 0.8;
  }
  .decks-ai-gen-rowwrap.is-saved {
    background: var(--background-modifier-success-hover, transparent);
  }
  .decks-ai-gen-saved-badge {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-green, var(--text-success));
  }
  .decks-ai-gen-detail {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 2px 4px 14px;
  }
  .decks-ai-gen-detail > * {
    flex-shrink: 0;
  }
  .decks-ai-gen-back {
    align-self: flex-start;
    background: transparent;
    border: none;
    box-shadow: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 0;
  }
  .decks-ai-gen-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border-hover);
    border-radius: var(--radius-m);
    padding: 16px 18px;
  }
  .decks-ai-gen-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .decks-ai-gen-field-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-weight: 600;
  }
  .decks-ai-gen-card-actions {
    display: flex;
    justify-content: flex-end;
  }
  .decks-ai-gen-note {
    color: var(--text-muted);
    font-size: 13px;
    padding: 8px 2px;
  }
  .decks-ai-gen-save {
    flex: 0 0 auto;
    padding: 10px 0;
    border-top: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .decks-ai-gen-save-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
  }
  .decks-ai-gen-save-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--font-ui-small);
    color: var(--text-normal);
  }
  .decks-ai-gen-save-row > span {
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  /* A locked, non-editable value (format/deck after the first save). */
  .decks-ai-gen-save-row > span.decks-ai-gen-readonly {
    font-size: 1em;
    text-transform: none;
    letter-spacing: normal;
    color: var(--text-normal);
    padding: var(--size-4-1) 0;
  }
  .decks-ai-gen-composer {
    flex: 0 0 auto;
    padding: 12px 0;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-gen-footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-gen-footer-info {
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-ai-gen-footer-spacer {
    flex: 1 1 auto;
  }
  .decks-edit-error {
    color: var(--text-normal);
    background: var(--background-modifier-error);
    padding: 6px 10px;
    border-radius: var(--radius-s);
    font-size: 12px;
    white-space: pre-wrap;
    max-height: 8em;
    overflow-y: auto;
  }
  :global(.decks-modal-mobile) .decks-ai-gen-sidebar {
    flex: 1 1 auto;
    border-right: none;
  }
</style>
