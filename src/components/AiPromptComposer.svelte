<script lang="ts">
  // Reusable chat-style composer for the AI prompt area: an elevated rounded
  // box holding the prompt textarea, attached context as removable pills, and
  // add-context buttons + a send button. Presentational — all data and behavior
  // come from the parent via props/callbacks.
  import { tick } from "svelte";
  import { Menu, setIcon } from "obsidian";
  import { DECKS_TIER_FAST, I18n, type AiModelOption } from "@decks/core";
  import type { ContextItem } from "../utils/attachments";
  import type { MentionItem, PdfSource } from "./ai-generator-types";

  export let prompt = "";
  export let contexts: ContextItem[] = [];
  export let submitting = false;
  export let submitDisabled = false;
  export let splitOn = false;
  export let splitAvailable = false;
  export let mentionItems: MentionItem[] = [];
  export let mentionLabels: string[] = [];
  export let onAddNote: () => void = () => {};
  export let onAddImage: () => void = () => {};
  export let onRemoveContext: (id: string) => void = () => {};
  // Optional: a PDF pill opens the caller's PDF panel; the open one is marked active.
  export let onOpenContext: ((id: string) => void) | null = null;
  export let activeContextId: string | null = null;
  export let onToggleSplit: () => void = () => {};
  export let onMention: (item: MentionItem) => void = () => {};
  export let onPasteImages: (files: File[]) => void = () => {};
  export let onSubmit: () => void = () => {};
  // Optional PDF attachment: the attach menu lists `pdfSources`, and dropped or
  // pasted PDFs go to `onAddPdfFiles`.
  export let pdfAvailable = false;
  export let pdfSources: PdfSource[] = [];
  export let onAddPdfFiles: (files: File[]) => void = () => {};
  // Optional include-context toggle (used by the generator), kept in the options menu.
  export let includeAvailable = false;
  export let includeOn = false;
  export let includeLabel: string | null = null;
  export let onToggleInclude: () => void = () => {};
  // Optional label overrides so non-refactor callers (e.g. the generator) can
  // relabel the submit button. Default to the refactor wording.
  export let submitLabel: string | null = null;
  export let submittingLabel: string | null = null;
  // When given, the send button turns into Stop while a run is in flight.
  export let onStop: (() => void) | null = null;
  export let stopLabel: string | null = null;
  // Optional prompt placeholder override (defaults to the refactor wording).
  export let placeholder: string | null = null;
  // Model and card type are chosen in the options menu, each only when the caller
  // offers more than one. Both are bound by the parent.
  export let cardTypeOptions: Array<{ id: string; name: string }> = [];
  export let selectedCardType = "";
  export let modelOptions: AiModelOption[] = [];
  export let selectedModel = "";
  // Optional secondary action: the same input either asks about the source or
  // generates from it. Rendered only when the caller offers it.
  export let askAvailable = false;
  export let askLabel: string | null = null;
  export let asking = false;
  export let onAsk: () => void = () => {};

  const t = I18n.t.modals.editFlashcard;

  $: sendLabel = submitting
    ? (submittingLabel ?? t.aiRefactoring)
    : splitOn
      ? t.aiSplit
      : (submitLabel ?? t.aiSend);
  $: hasOptions = modelOptions.length > 1 || cardTypeOptions.length > 1 || includeAvailable;
  $: modelName = modelOptions.find((m) => m.id === selectedModel)?.name ?? "";
  $: cardTypeName = cardTypeOptions.find((o) => o.id === selectedCardType)?.name ?? "";
  // Name the choices in force; the card type only once it differs from the first, unless there is no model to name.
  $: optionsLabel = [
    modelOptions.length > 1 ? modelName : "",
    cardTypeOptions.length > 1 && (selectedCardType !== cardTypeOptions[0].id || modelOptions.length <= 1)
      ? cardTypeName
      : "",
  ]
    .filter(Boolean)
    .join(" · ") || t.aiOptions;
  $: optionsIcon =
    modelOptions.length > 1 ? (selectedModel === DECKS_TIER_FAST ? "zap" : "wand-2") : "layers";

  // A keyboard click has no pointer position, so the menu opens under the button instead.
  function showMenu(menu: Menu, e: MouseEvent) {
    const el = e.currentTarget;
    if (e.detail === 0 && el instanceof HTMLElement) {
      const r = el.getBoundingClientRect();
      menu.showAtPosition({ x: r.left, y: r.bottom });
    } else {
      menu.showAtMouseEvent(e);
    }
  }

  function openAttachMenu(e: MouseEvent) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t.aiAddNote).setIcon("file-text").onClick(() => onAddNote()));
    menu.addItem((i) => i.setTitle(t.aiAddImage).setIcon("image").onClick(() => onAddImage()));
    if (pdfAvailable && pdfSources.length > 0) {
      menu.addSeparator();
      menu.addItem((i) => i.setTitle(t.aiAddPdf).setIsLabel(true));
      for (const source of pdfSources) {
        menu.addItem((i) => i.setTitle(source.label).setIcon(source.icon).onClick(() => source.onPick()));
      }
    }
    showMenu(menu, e);
  }

  function openOptionsMenu(e: MouseEvent) {
    const menu = new Menu();
    if (modelOptions.length > 1) {
      menu.addItem((i) => i.setTitle(t.aiModel).setIsLabel(true));
      for (const opt of modelOptions) {
        menu.addItem((i) =>
          i
            .setTitle(opt.name)
            .setChecked(opt.id === selectedModel)
            .onClick(() => (selectedModel = opt.id)),
        );
      }
    }
    if (cardTypeOptions.length > 1) {
      if (modelOptions.length > 1) menu.addSeparator();
      menu.addItem((i) => i.setTitle(t.aiCardType).setIsLabel(true));
      for (const opt of cardTypeOptions) {
        menu.addItem((i) =>
          i
            .setTitle(opt.name)
            .setChecked(opt.id === selectedCardType)
            .onClick(() => (selectedCardType = opt.id)),
        );
      }
    }
    if (includeAvailable) {
      menu.addSeparator();
      menu.addItem((i) =>
        i
          .setTitle(includeLabel ?? "")
          .setChecked(includeOn)
          .onClick(() => onToggleInclude()),
      );
    }
    showMenu(menu, e);
  }

  let highlightEl: HTMLElement;

  // --- Highlight overlay: split the prompt into plain text + @mention tokens so
  // mentions render as accent chips behind the (transparent-text) textarea. ---
  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  interface Segment {
    text: string;
    mention: boolean;
  }
  $: highlightSegments = buildSegments(prompt, mentionLabels);
  function buildSegments(text: string, labels: string[]): Segment[] {
    if (labels.length === 0) return [{ text, mention: false }];
    // Longest labels first so a prefix label doesn't shadow a longer one.
    const sorted = [...labels].sort((a, b) => b.length - a.length).map(escapeRegExp);
    const re = new RegExp(`@(?:${sorted.join("|")})`, "g");
    const out: Segment[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), mention: false });
      out.push({ text: m[0], mention: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last), mention: false });
    return out;
  }

  // --- @-mention inline autocomplete (notes) ---
  let textareaEl: HTMLTextAreaElement;
  let mentionOpen = false;
  let mentionStart = -1;
  let mentionQuery = "";
  let mentionIndex = 0;
  const MENTION_LIMIT = 8;

  $: mentionMatches = mentionOpen
    ? mentionItems
        .filter((m) => m.label.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, MENTION_LIMIT)
    : [];

  function refreshMention() {
    if (!textareaEl) return;
    const pos = textareaEl.selectionStart ?? prompt.length;
    const before = prompt.slice(0, pos);
    const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (m) {
      const query = m[1];
      // Only reset the highlighted row when the menu opens or the query text
      // changes — otherwise arrow-key navigation (which fires keyup) would
      // snap back to the first item.
      if (!mentionOpen || query !== mentionQuery) mentionIndex = 0;
      mentionQuery = query;
      mentionStart = pos - query.length - 1;
      mentionOpen = true;
    } else {
      mentionOpen = false;
    }
  }

  function selectMention(item: MentionItem) {
    const pos = textareaEl?.selectionStart ?? prompt.length;
    const insert = `@${item.label} `;
    prompt = prompt.slice(0, mentionStart) + insert + prompt.slice(pos);
    const caret = mentionStart + insert.length;
    mentionOpen = false;
    onMention(item);
    void tick().then(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      textareaEl.setSelectionRange(caret, caret);
    });
  }

  function onPromptKeydown(e: KeyboardEvent) {
    if (!mentionOpen || mentionMatches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionIndex = (mentionIndex + 1) % mentionMatches.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionIndex =
        (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length;
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectMention(mentionMatches[mentionIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      mentionOpen = false;
    }
  }

  // Keep the highlight overlay aligned when a very long prompt scrolls the textarea.
  function syncHighlightScroll() {
    if (!highlightEl || !textareaEl) return;
    highlightEl.scrollTop = textareaEl.scrollTop;
    highlightEl.scrollLeft = textareaEl.scrollLeft;
  }

  function onPromptPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    const pdfs: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (item.type.startsWith("image/")) images.push(file);
      else if (pdfAvailable && item.type === "application/pdf") pdfs.push(file);
    }
    if (images.length === 0 && pdfs.length === 0) return;
    e.preventDefault();
    if (images.length > 0) onPasteImages(images);
    if (pdfs.length > 0) onAddPdfFiles(pdfs);
  }

  // Drag/drop onto the composer: route images and (when enabled) PDFs.
  let dragActive = false;
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer) return;
    e.preventDefault();
    dragActive = true;
  }
  function onDragLeave() {
    dragActive = false;
  }
  function onDrop(e: DragEvent) {
    dragActive = false;
    const list = e.dataTransfer?.files;
    if (!list || list.length === 0) return;
    const images: File[] = [];
    const pdfs: File[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (file.type.startsWith("image/")) images.push(file);
      else if (pdfAvailable && file.type === "application/pdf") pdfs.push(file);
    }
    if (images.length === 0 && pdfs.length === 0) return;
    e.preventDefault();
    if (images.length > 0) onPasteImages(images);
    if (pdfs.length > 0) onAddPdfFiles(pdfs);
  }

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return {
      update(next: string) {
        setIcon(node, next);
      },
    };
  }

  // Grow the prompt textarea downward to fit its content (no manual handle).
  function autoResize(node: HTMLTextAreaElement, _value: string) {
    const resize = () => {
      node.setCssProps({ height: "auto" });
      node.setCssProps({ height: `${node.scrollHeight}px` });
    };
    void tick().then(resize);
    node.addEventListener("input", resize);
    return {
      update() {
        void tick().then(resize);
      },
      destroy() {
        node.removeEventListener("input", resize);
      },
    };
  }
</script>

<div
  class="decks-ai-composer"
  class:is-drag-active={dragActive}
  on:dragover={onDragOver}
  on:dragleave={onDragLeave}
  on:drop={onDrop}
  role="group"
>
  {#if mentionOpen && mentionMatches.length > 0}
    <ul class="decks-ai-mention-list">
      {#each mentionMatches as item, i (item.path)}
        <li>
          <button
            type="button"
            class="decks-ai-mention-item"
            class:is-active={i === mentionIndex}
            on:mousedown|preventDefault={() => selectMention(item)}
          >
            <span class="decks-ai-mention-icon" use:icon={"file-text"}></span>
            <span class="decks-ai-mention-label">{item.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if contexts.length > 0}
    <div class="decks-ai-composer-pills">
      {#each contexts as ctx (ctx.id)}
        <span
          class="decks-ai-context-pill"
          class:is-image={ctx.kind === "image"}
          class:is-pdf={ctx.kind === "pdf"}
        >
          {#if onOpenContext && ctx.kind === "pdf"}
            <button
              type="button"
              class="decks-ai-context-pill-open"
              class:is-active={activeContextId === ctx.id}
              aria-pressed={activeContextId === ctx.id}
              aria-label={I18n.format(I18n.t.modals.aiGenerator.pdfPanel.show, { name: ctx.label })}
              title={I18n.format(I18n.t.modals.aiGenerator.pdfPanel.show, { name: ctx.label })}
              on:click={() => onOpenContext?.(ctx.id)}
            >
              <span class="decks-ai-context-pill-icon" use:icon={"book-open"}></span>
              <span class="decks-ai-context-pill-label">{ctx.label}</span>
            </button>
          {:else}
            <span
              class="decks-ai-context-pill-icon"
              use:icon={ctx.kind === "image"
                ? "image"
                : ctx.kind === "pdf"
                  ? "book-open"
                  : "file-text"}
            ></span>
            <span class="decks-ai-context-pill-label">{ctx.label}</span>
          {/if}
          <button
            type="button"
            class="decks-ai-context-pill-remove"
            aria-label={t.aiRemoveContext}
            on:click={() => onRemoveContext(ctx.id)}>×</button
          >
        </span>
      {/each}
    </div>
    <hr class="decks-ai-composer-sep" />
  {/if}

  <div class="decks-ai-composer-input-wrap">
    <!-- Mirror layer: shows the prompt text with @mentions as accent chips,
         behind the transparent-text textarea so tokens are distinguishable. -->
    <div class="decks-ai-input-highlight" aria-hidden="true" bind:this={highlightEl}>
      {#each highlightSegments as seg}
        {#if seg.mention}<span class="decks-ai-mention-token">{seg.text}</span>{:else}{seg.text}{/if}
      {/each}
      {#if prompt.endsWith("\n")}{" "}{/if}
    </div>
    <textarea
      class="decks-ai-composer-input"
      rows="3"
      placeholder={placeholder ?? t.aiPromptPlaceholder}
      bind:value={prompt}
      bind:this={textareaEl}
      use:autoResize={prompt}
      on:input={refreshMention}
      on:keyup={refreshMention}
      on:click={refreshMention}
      on:keydown={onPromptKeydown}
      on:paste={onPromptPaste}
      on:scroll={syncHighlightScroll}
      on:blur={() => window.setTimeout(() => (mentionOpen = false), 120)}
    ></textarea>
  </div>

  <hr class="decks-ai-composer-sep" />

  <div class="decks-ai-composer-actions">
    <button
      type="button"
      class="clickable-icon decks-ai-composer-attach"
      aria-label={t.aiAttach}
      title={t.aiAttach}
      aria-haspopup="menu"
      use:icon={"plus"}
      on:click={openAttachMenu}
    ></button>
    {#if hasOptions}
      <button
        type="button"
        class="decks-ai-composer-options"
        aria-label={t.aiOptions}
        title={t.aiOptions}
        aria-haspopup="menu"
        on:click={openOptionsMenu}
      >
        <span class="decks-ai-composer-options-icon" use:icon={optionsIcon}></span>
        <span class="decks-ai-composer-options-label">{optionsLabel}</span>
        <span class="decks-ai-composer-options-icon" use:icon={"chevron-down"}></span>
      </button>
    {/if}
    {#if splitAvailable}
      <button
        type="button"
        class="decks-ai-composer-split"
        class:is-active={splitOn}
        aria-pressed={splitOn}
        title={t.aiSplitToggle}
        on:click={onToggleSplit}
      >
        <span class="decks-ai-composer-split-icon" use:icon={"split"}></span>
        {t.aiSplit}
      </button>
    {/if}
    {#if askAvailable}
      <button
        type="button"
        class="decks-ai-composer-ask"
        on:click={onAsk}
        disabled={asking || submitting || submitDisabled}
      >
        {#if asking}
          <span class="decks-ai-composer-spinner" aria-hidden="true"></span>
        {/if}
        {askLabel ?? ""}
      </button>
    {/if}
    {#if submitting && onStop}
      <button
        type="button"
        class="mod-cta decks-ai-composer-send is-busy"
        aria-label={stopLabel ?? ""}
        title={stopLabel ?? ""}
        on:click={() => onStop?.()}
      >
        <span class="decks-ai-composer-send-icon" use:icon={"square"}></span>
      </button>
    {:else}
      <button
        type="button"
        class="mod-cta decks-ai-composer-send"
        aria-label={sendLabel}
        title={sendLabel}
        on:click={onSubmit}
        disabled={submitting || submitDisabled}
      >
        {#if submitting}
          <span class="decks-ai-composer-spinner" aria-hidden="true"></span>
        {:else}
          <span class="decks-ai-composer-send-icon" use:icon={"sparkles"}></span>
        {/if}
      </button>
    {/if}
  </div>
</div>

<style>
  .decks-ai-composer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
    padding: 12px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-l, 12px);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.08),
      0 2px 8px rgba(0, 0, 0, 0.12);
  }
  .decks-ai-composer-input-wrap {
    position: relative;
  }
  /* Overlay mirror behind the textarea; must match its text metrics exactly. */
  .decks-ai-input-highlight {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    margin: 0;
    padding: 0;
    border: none;
    font-family: var(--font-text);
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-normal);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    overflow: hidden;
  }
  .decks-ai-mention-token {
    color: var(--text-accent);
    background: var(--background-modifier-hover);
    border-radius: 3px;
    padding: 0 1px;
  }
  .decks-ai-mention-list {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 6px);
    z-index: 50;
    margin: 0;
    padding: 4px;
    list-style: none;
    max-height: 220px;
    overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border-hover);
    border-radius: var(--radius-m);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }
  .decks-ai-mention-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-normal);
    cursor: pointer;
    box-shadow: none;
    font-size: 13px;
  }
  .decks-ai-mention-item.is-active,
  .decks-ai-mention-item:hover {
    background: var(--background-modifier-hover);
  }
  .decks-ai-mention-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
    flex: 0 0 auto;
  }
  .decks-ai-mention-icon :global(svg) {
    width: 13px;
    height: 13px;
  }
  .decks-ai-mention-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-composer-input {
    position: relative;
    z-index: 1;
    width: 100%;
    box-sizing: border-box;
    resize: none;
    overflow-y: auto;
    max-height: 38vh;
    min-height: 48px;
    border: none;
    background: transparent;
    /* Text is shown by the highlight overlay; keep only the caret visible. */
    color: transparent;
    caret-color: var(--text-normal);
    padding: 0;
    font-family: var(--font-text);
    font-size: 14px;
    line-height: 1.5;
    box-shadow: none;
  }
  /*
   * Obsidian styles form fields by element, and its hover rule
   * (`textarea:where(:not(:disabled)):hover`) scores 0-1-1 because `:where()`
   * adds no specificity — which beats a single class. It paints an opaque
   * `--background-modifier-form-field-hover`, and since this textarea sits above
   * the highlight overlay, that background covered the only layer drawing the
   * text: hovering the composer blanked the prompt. Repeating the selector with
   * each state lifts these to 0-2-0 so the transparent field survives all of
   * them. The same applies to the focus ring, which would otherwise draw inside
   * the composer's own border.
   */
  .decks-ai-composer-input:hover,
  .decks-ai-composer-input:focus,
  .decks-ai-composer-input:focus-visible,
  .decks-ai-composer-input:active {
    background: transparent;
    border: none;
    box-shadow: none;
  }
  .decks-ai-composer-input::placeholder {
    color: var(--text-faint);
  }
  .decks-ai-composer-input:focus {
    box-shadow: none;
    outline: none;
  }
  /* Edge-to-edge dividers across the box's 12px padding. */
  .decks-ai-composer-sep {
    border: none;
    border-top: 1px solid var(--background-modifier-border);
    margin: 0 -12px;
  }
  .decks-ai-composer-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }
  .decks-ai-context-pill {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    padding: 0 2px 0 3px;
    border-radius: var(--radius-s);
    font-size: 8px;
    line-height: 1;
    background: var(--background-modifier-hover);
    border: 1px solid var(--background-modifier-border);
  }
  .decks-ai-context-pill.is-image {
    background: var(--background-modifier-success-hover, var(--background-modifier-hover));
  }
  .decks-ai-context-pill.is-pdf {
    background: var(--background-modifier-active-hover, var(--background-modifier-hover));
  }
  .decks-ai-composer.is-drag-active {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px var(--interactive-accent);
  }
  .decks-ai-context-pill-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
  }
  .decks-ai-context-pill-icon :global(svg) {
    width: 8px;
    height: 8px;
  }
  .decks-ai-context-pill-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }
  .decks-ai-context-pill-open {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    height: auto;
    padding: 0;
    border: none;
    background: transparent;
    box-shadow: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .decks-ai-context-pill-open:hover .decks-ai-context-pill-label,
  .decks-ai-context-pill-open.is-active .decks-ai-context-pill-label {
    color: var(--text-accent);
  }
  .decks-ai-context-pill-remove {
    flex: 0 0 auto;
    padding: 0 1px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 9px;
    line-height: 1;
    box-shadow: none;
  }
  .decks-ai-context-pill-remove:hover {
    color: var(--text-normal);
  }
  /* One row on every width: the options label gives way first. */
  .decks-ai-composer-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .decks-ai-composer-actions > * {
    flex: none;
  }
  .decks-ai-composer-actions > .decks-ai-composer-options {
    flex: 0 1 auto;
  }
  .decks-ai-composer-options {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-modifier-hover);
    color: var(--text-normal);
    font-size: 12px;
    box-shadow: none;
    cursor: pointer;
  }
  .decks-ai-composer-options-label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .decks-ai-composer-options-icon {
    display: inline-flex;
    align-items: center;
    flex: none;
    color: var(--text-muted);
  }
  .decks-ai-composer-options-icon :global(svg) {
    width: 14px;
    height: 14px;
  }
  .decks-ai-composer-split {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    cursor: pointer;
    box-shadow: none;
  }
  .decks-ai-composer-split.is-active {
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
    color: var(--text-on-accent);
  }
  .decks-ai-composer-split-icon {
    display: inline-flex;
    align-items: center;
  }
  .decks-ai-composer-split-icon :global(svg) {
    width: 13px;
    height: 13px;
  }
  .decks-ai-composer-ask {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .decks-ai-composer-send {
    position: relative;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border-radius: 50%;
  }
  .decks-ai-composer-send-icon {
    display: inline-flex;
    align-items: center;
  }
  .decks-ai-composer-send-icon :global(svg) {
    width: 17px;
    height: 17px;
  }
  .decks-ai-composer-send.is-busy .decks-ai-composer-send-icon :global(svg) {
    width: 13px;
    height: 13px;
    fill: currentColor;
  }
  /* A ring turns round the stop button while the run is in flight. */
  .decks-ai-composer-send.is-busy::after {
    content: "";
    position: absolute;
    inset: -4px;
    border: 2px solid var(--interactive-accent);
    border-top-color: transparent;
    border-radius: 50%;
    animation: decks-ai-composer-spin 0.9s linear infinite;
  }
  .decks-ai-composer-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--text-on-accent);
    border-top-color: transparent;
    border-radius: 50%;
    animation: decks-ai-composer-spin 0.7s linear infinite;
    flex: 0 0 auto;
  }
  @keyframes decks-ai-composer-spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Ask sits immediately before send, as the secondary of the pair. */
  .decks-ai-composer-ask + .decks-ai-composer-send {
    margin-left: 8px;
  }
</style>
