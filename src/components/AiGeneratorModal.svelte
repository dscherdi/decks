<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { type App, type TFile, Menu, setIcon } from "obsidian";
  import { I18n, type AiProviderId, type GeneratedCard, type GenerateHandlers, type GenerateResult, type RefactorImage, ocrSentinelForTier } from "@decks/core";
  import AiPromptComposer from "./AiPromptComposer.svelte";
  import ChapterPanel from "./ChapterPanel.svelte";
  import { buildModelOptions } from "../utils/ai-model-options";
  import BatchCardRow from "./BatchCardRow.svelte";
  import { FilePickerModal } from "../utils/file-picker";
  import { FolderPickerModal } from "../utils/folder-picker";
  import {
    type ContextItem,
    buildGenerationComposerRequest,
    savePastedImage,
    IMAGE_EXTENSIONS,
    PDF_MAX_BYTES,
  } from "../utils/attachments";
  import {
    type ChapterNode,
    type PdfDoc,
    loadPdf,
    extractOutline,
    buildSectionContent,
    pagesForSelection,
    hashPdf,
  } from "../utils/pdf";
  import type { OcrDebugEntry, OcrProgress, PdfOcrCache } from "@decks/core";
  import type { SaveFormat } from "../services/FlashcardComposer";
  import type { GeneratorSaveRequest, ProfileOpt } from "./generator-save";
  import type {
    GenRow,
    MentionItem,
    PdfAttachment,
    PdfTab,
  } from "./ai-generator-types";

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
  export let pdfAvailable = false;
  export let pdfOcr: PdfOcrCache | null = null;

  const g = I18n.t.modals.aiGenerator;

  // Last generation's request payload + raw response, shown in the debug panel.
  let lastDebug: GenerateResult["debug"] | null = null;
  // Per-page OCR exchanges (image + transcription) for the debug panel; capped.
  let ocrDebug: OcrDebugEntry[] = [];
  const OCR_DEBUG_MAX = 12;
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

  // One generation round per click. Continuation is manual: after a round the
  // Generate button switches to "Continue generating" (see canContinue) until a
  // round adds nothing new and isn't truncated.
  const MAX_BATCHES = 1;
  // Caps on attached context (bounds payload size / token cost / memory).
  const MAX_CONTEXT_NOTES = 10;
  const MAX_CONTEXT_IMAGES = 10;
  // True after a round that may have more to produce (cards were added, or the
  // response was cut off by the output-token limit) → offer "Continue generating".
  let canContinue = false;

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
  const mentionItems: MentionItem[] = app.vault
    .getMarkdownFiles()
    .map((f) => ({ path: f.path, label: f.basename }));
  let mentionedAll: ContextItem[] = [];
  $: activeMentions = mentionedAll.filter((m) => prompt.includes(`@${m.label}`));
  $: mentionLabels = activeMentions.map((m) => m.label);

  function addContext(kind: "note" | "image" | "pdf", path: string, label: string) {
    const id = `${kind}:${path}`;
    if (contexts.some((c) => c.id === id)) return;
    if (kind === "note" && contexts.filter((c) => c.kind === "note").length >= MAX_CONTEXT_NOTES) {
      genError = I18n.format(g.tooManyNotes, { max: MAX_CONTEXT_NOTES });
      return;
    }
    if (kind === "image" && contexts.filter((c) => c.kind === "image").length >= MAX_CONTEXT_IMAGES) {
      genError = I18n.format(g.tooManyImages, { max: MAX_CONTEXT_IMAGES });
      return;
    }
    contexts = [...contexts, { id, kind, path, label }];
  }
  function removeContext(id: string) {
    contexts = contexts.filter((c) => c.id !== id);
    if (pdfs.some((p) => p.contextId === id)) {
      pdfs = pdfs.filter((p) => p.contextId !== id);
      if (activePdfId === id) activePdfId = pdfs[0]?.contextId ?? null;
      if (pdfs.length === 0) showChapters = false;
    }
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

  // --- PDF attachment (Decks Pro) ---
  // Multiple PDFs can be attached; the chapter panel shows one at a time via
  // tabs. Each carries its own chapter selection + parse mode.
  let pdfs: PdfAttachment[] = [];
  let activePdfId: string | null = null;
  let showChapters = false;
  let ocrProgress: OcrProgress | null = null;
  // Unified per-page progress while PDFs are resolved to text (text reads + OCR).
  let pdfProgress: { done: number; total: number } | null = null;
  let pdfInputEl: HTMLInputElement;

  $: activePdf = pdfs.find((p) => p.contextId === activePdfId) ?? pdfs[0] ?? null;
  $: pdfTabs = pdfs.map((p): PdfTab => ({ id: p.contextId, label: p.label }));
  $: pdfPct = pdfProgress
    ? Math.round((pdfProgress.done / Math.max(1, pdfProgress.total)) * 100)
    : 0;

  // Patch the active PDF's selection/mode immutably (so reactivity fires).
  function updateActivePdf(patch: Partial<PdfAttachment>): void {
    pdfs = pdfs.map((p) =>
      p.contextId === activePdfId ? { ...p, ...patch } : p,
    );
  }

  function collectAllChapterIds(nodes: ChapterNode[], acc: string[] = []): string[] {
    for (const n of nodes) {
      acc.push(n.id);
      collectAllChapterIds(n.children, acc);
    }
    return acc;
  }

  // Offer both attach sources: a vault PDF or one from the user's computer.
  function addPdf(e?: MouseEvent) {
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle(g.pdfFromVault)
        .setIcon("folder")
        .onClick(() => pickVaultPdf()),
    );
    menu.addItem((i) =>
      i
        .setTitle(g.pdfFromComputer)
        .setIcon("monitor")
        .onClick(() => pdfInputEl?.click()),
    );
    if (e) menu.showAtMouseEvent(e);
    else menu.showAtPosition({ x: 0, y: 0 });
  }

  function pickVaultPdf() {
    const pdfs = app.vault
      .getFiles()
      .filter((f) => f.extension.toLowerCase() === "pdf");
    new FilePickerModal(
      app,
      pdfs,
      (f) => {
        void app.vault
          .readBinary(f)
          .then((bytes) => attachPdf(bytes, f.name))
          .catch((err) => (genError = String(err)));
      },
      g.addPdf,
    ).open();
  }

  function onPdfInputChange() {
    const file = pdfInputEl?.files?.[0];
    if (file) {
      void file
        .arrayBuffer()
        .then((bytes) => attachPdf(bytes, file.name))
        .catch((err) => (genError = String(err)));
    }
    if (pdfInputEl) pdfInputEl.value = "";
  }

  function pastePdfs(files: File[]) {
    const file = files[0];
    if (!file) return;
    void file
      .arrayBuffer()
      .then((bytes) => attachPdf(bytes, file.name))
      .catch((err) => (genError = String(err)));
  }

  async function attachPdf(bytes: ArrayBuffer, label: string) {
    genError = null;
    if (bytes.byteLength > PDF_MAX_BYTES) {
      genError = I18n.format(g.pdfTooLarge, {
        max: Math.round(PDF_MAX_BYTES / (1024 * 1024)),
      });
      return;
    }
    try {
      // Hash before loadPdf: pdf.js detaches the buffer it's given, so hashing
      // must happen while `bytes` is still intact.
      const hash = hashPdf(bytes);
      const contextId = `pdf:${hash}`;
      // Already attached → just activate its tab and reopen the panel.
      if (pdfs.some((p) => p.contextId === contextId)) {
        activePdfId = contextId;
        showChapters = true;
        return;
      }
      const doc = await loadPdf(bytes);
      const chapters = await extractOutline(doc);
      const attachment: PdfAttachment = {
        contextId,
        label,
        doc,
        hash,
        chapters,
        selectedIds: new Set(collectAllChapterIds(chapters)),
      };
      pdfs = [...pdfs, attachment];
      activePdfId = contextId;
      // Use the attachment's contextId as the pill id (don't go through
      // addContext, which would prefix it again) so the composer pill and the
      // chapter panel remove the same PDF.
      contexts = [...contexts, { id: contextId, kind: "pdf", path: label, label }];
      showChapters = true;
    } catch (e) {
      genError = e instanceof Error ? e.message : String(e);
    }
  }

  // Resolve every attached PDF's selected chapters into source text. The parse
  // path is provider-determined: Decks Pro renders pages and OCRs them (the
  // selected tier's OCR model); any other provider uses free pdf.js text
  // extraction. Each PDF's text is prefixed with a `# <label>` heading. Progress
  // is a single counter spanning all PDFs' pages.
  async function resolvePdfSource(signal: AbortSignal): Promise<string> {
    const plans = pdfs
      .map((p) => ({ pdf: p, pages: pagesForSelection(p.chapters, p.selectedIds) }))
      .filter((x) => x.pages.length > 0);
    const total = plans.reduce((sum, x) => sum + x.pages.length, 0);
    if (total === 0) return "";

    // OCR is the Decks Pro path; everyone else gets free text extraction.
    const mode = aiProvider === "decks-pro" ? "ocr" : "text";
    const ocrModel = ocrSentinelForTier(selectedModel);

    pdfProgress = { done: 0, total };
    let done = 0;
    const tick = () => (pdfProgress = { done: ++done, total });
    const parts: string[] = [];
    try {
      for (const { pdf: p, pages } of plans) {
        const ocrRunner = (ocrPages: number[], onEach?: () => void) => {
          if (!pdfOcr) return Promise.resolve(new Map<number, string>());
          return pdfOcr.runOcr(
            p.doc,
            p.hash,
            ocrModel,
            ocrPages,
            (prog) => {
              ocrProgress = prog;
              onEach?.();
            },
            signal,
            debugEnabled
              ? (entry) => {
                  ocrDebug = [...ocrDebug, entry].slice(-OCR_DEBUG_MAX);
                }
              : undefined,
          );
        };
        const text = await buildSectionContent(
          p.doc,
          pages,
          mode,
          ocrRunner,
          () => tick(),
        );
        if (text) parts.push(`# ${p.label}\n${text}`);
      }
      return parts.join("\n\n---\n\n");
    } finally {
      ocrProgress = null;
      pdfProgress = null;
    }
  }

  // OCR attached images to text (Decks Pro) so they feed classification and the
  // routed text model. Each image is cached by content, so re-runs don't re-OCR.
  async function resolveImageSource(
    images: RefactorImage[],
    signal: AbortSignal,
  ): Promise<string> {
    if (!pdfOcr || images.length === 0) return "";
    const ocrModel = ocrSentinelForTier(selectedModel);
    const onDebug = debugEnabled
      ? (entry: OcrDebugEntry) => {
          ocrDebug = [...ocrDebug, entry].slice(-OCR_DEBUG_MAX);
        }
      : undefined;
    pdfProgress = { done: 0, total: images.length };
    const parts: string[] = [];
    try {
      for (let i = 0; i < images.length; i++) {
        const text = await pdfOcr.ocrImageToText(images[i], ocrModel, signal, onDebug);
        if (text) parts.push(`# Image ${i + 1}\n${text}`);
        pdfProgress = { done: i + 1, total: images.length };
      }
      return parts.join("\n\n---\n\n");
    } finally {
      pdfProgress = null;
    }
  }

  // --- Generation ---
  async function startGenerate() {
    if (phase === "streaming") return;
    // Continue rounds may run without a prompt (source + prior cards drive them);
    // a fresh run still needs one.
    const continuing = canContinue;
    if (!continuing && !prompt.trim()) return;
    const req = await buildGenerationComposerRequest(
      app,
      prompt,
      contexts,
      activeMentions,
    );
    // Continue always feeds prior cards back (dedup + context); a fresh run does
    // so only when the include toggle is on. The controller skips re-emitting them.
    const existingCards =
      continuing || includeGenerated ? rows.map((r) => r.card) : undefined;
    partial = null;
    genError = null;
    if (debugEnabled) {
      lastDebug = null;
      ocrDebug = [];
    }
    phase = "streaming";
    abortController = new AbortController();

    // Resolve any attached PDF into source text first (OCR'ing scanned pages),
    // then merge it with the note/image-derived source context.
    let sourceContext = req.sourceContext;
    let images = req.images;
    try {
      const pdfText = await resolvePdfSource(abortController.signal);
      if (pdfText) {
        sourceContext = [sourceContext, pdfText].filter(Boolean).join("\n\n---\n\n");
      }
      // Decks Pro: OCR attached images to text and drop the raw image blocks, so
      // they feed classification and the routed (possibly text-only) model.
      if (aiProvider === "decks-pro" && pdfOcr && images.length > 0) {
        const imageText = await resolveImageSource(images, abortController.signal);
        if (imageText) {
          sourceContext = [sourceContext, imageText].filter(Boolean).join("\n\n---\n\n");
        }
        images = [];
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        genError = e instanceof Error ? e.message : String(e);
      }
      phase = rows.length > 0 ? "review" : "idle";
      return;
    }

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
          sourceContext,
          images,
          maxBatches: MAX_BATCHES,
          existingCards,
          model: selectedModel,
          debug: debugEnabled,
        },
        handlers,
        abortController.signal,
      );
      if (debugEnabled) lastDebug = result.debug ?? lastDebug;
      // Offer "Continue generating" when this round produced cards or was cut off
      // by the output-token limit; otherwise the model is done.
      canContinue = (result.cards?.length ?? 0) > 0 || (result.truncated ?? false);
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
    <div class="decks-ai-gen-header-actions">
      {#if pdfs.length}
        <button
          type="button"
          class="clickable-icon decks-ai-gen-debug-toggle"
          class:is-active={showChapters}
          aria-pressed={showChapters}
          aria-label={g.pdfChapters}
          title={g.pdfChapters}
          use:icon={"list-tree"}
          on:click={() => (showChapters = !showChapters)}
        ></button>
      {/if}
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
  </div>
  <input
    class="decks-pdf-file-input"
    type="file"
    accept="application/pdf"
    bind:this={pdfInputEl}
    on:change={onPdfInputChange}
  />

  {#if genError?.trim()}
    <div class="decks-edit-error">{genError}</div>
  {/if}

  {#if pdfProgress}
    <div class="decks-ai-gen-pdf-progress" role="status" aria-live="polite">
      <div class="decks-ai-gen-pdf-progress-label">
        <span
          >{I18n.format(g.pdfOcrProgress, {
            done: pdfProgress.done,
            total: pdfProgress.total,
          })}</span
        >
        {#if ocrProgress && !ocrProgress.fromCache}
          <span class="decks-ai-gen-pdf-ocr-tag">{g.pdfModeOcr}</span>
        {:else if ocrProgress?.fromCache}
          <span class="decks-pdf-cached-badge">{g.pdfCached}</span>
        {/if}
      </div>
      <div class="decks-ai-gen-pdf-progress-track">
        <div
          class="decks-ai-gen-pdf-progress-fill"
          style:width={`${pdfPct}%`}
        ></div>
      </div>
    </div>
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
        {#if phase === "streaming" && rows.length === 0 && !partial && !pdfProgress}
          <div class="decks-ai-gen-loading">
            <span class="decks-ai-gen-spinner" aria-hidden="true"></span>
            <span>{g.generating}</span>
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
        submitLabel={canContinue ? g.continueGenerating : g.generate}
        submittingLabel={g.generating}
        placeholder={g.promptPlaceholder}
        onAddNote={addNote}
        onAddImage={addImage}
        {pdfAvailable}
        onAddPdf={addPdf}
        onAddPdfFiles={pastePdfs}
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
        {#if pdfProgress}
          {I18n.format(g.pdfOcrProgress, {
            done: pdfProgress.done,
            total: pdfProgress.total,
          })}
        {:else}
          {I18n.format(g.streaming, { count: rows.length })}
        {/if}
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
{#if activePdf && showChapters}
  {#key activePdf.contextId}
    <ChapterPanel
      title={activePdf.label}
      chapters={activePdf.chapters}
      selectedIds={activePdf.selectedIds}
      {ocrProgress}
      tabs={pdfTabs}
      activeTabId={activePdfId}
      onSelectTab={(id) => (activePdfId = id)}
      onCloseTab={removeContext}
      onSelectionChange={(ids) => updateActivePdf({ selectedIds: ids })}
      onClose={() => (showChapters = false)}
    />
  {/key}
{/if}
{#if debugEnabled && showDebug}
  <aside class="decks-ai-gen-debug">
    <div class="decks-ai-gen-debug-title">{g.debugTitle}</div>
    {#if ocrDebug.length > 0}
      <div class="decks-ai-debug-label">{g.debugOcr}</div>
      <div class="decks-ai-gen-debug-meta">{ocrDebug[0].model}</div>
      <div class="decks-ai-debug-label">{g.debugSystem}</div>
      <pre class="decks-ai-debug-pre">{ocrDebug[0].system}</pre>
      <div class="decks-ai-debug-label">{g.debugUser}</div>
      <pre class="decks-ai-debug-pre">{ocrDebug[0].user}</pre>
      {#each ocrDebug as entry (entry.page)}
        <div class="decks-ai-debug-label">
          {I18n.format(g.debugOcrPage, { page: entry.page })}
        </div>
        <img class="decks-ai-debug-img" src={entry.imageDataUrl} alt="" />
        <pre class="decks-ai-debug-pre">{entry.raw}</pre>
      {/each}
    {/if}
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
    {:else if ocrDebug.length === 0}
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
  .decks-ai-debug-img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 2px 0 0 0;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
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
  .decks-ai-gen-header-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
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
  .decks-ai-gen-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 13px;
    padding: 12px 4px;
  }
  .decks-ai-gen-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: decks-ai-gen-spin 0.7s linear infinite;
  }
  @keyframes decks-ai-gen-spin {
    to {
      transform: rotate(360deg);
    }
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
  .decks-pdf-file-input {
    display: none;
  }
  .decks-ai-gen-pdf-progress {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    margin-bottom: 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }
  .decks-ai-gen-pdf-progress-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-ai-gen-pdf-ocr-tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-accent);
    font-weight: 600;
  }
  .decks-pdf-cached-badge {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-green, var(--text-success));
    font-weight: 600;
  }
  .decks-ai-gen-pdf-progress-track {
    height: 4px;
    border-radius: 2px;
    background: var(--background-modifier-border);
    overflow: hidden;
  }
  .decks-ai-gen-pdf-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.2s ease;
  }
</style>
