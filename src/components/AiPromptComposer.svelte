<script lang="ts">
  // Reusable chat-style composer for the AI prompt area: an elevated rounded
  // box holding the prompt textarea, attached context as removable pills, and
  // add-context buttons + a send button. Presentational — all data and behavior
  // come from the parent via props/callbacks.
  import { tick } from "svelte";
  import { setIcon } from "obsidian";
  import { I18n } from "@decks/core";

  interface ComposerContext {
    id: string;
    kind: "note" | "image";
    label: string;
  }

  interface MentionItem {
    path: string;
    label: string;
  }

  export let prompt = "";
  export let contexts: ComposerContext[] = [];
  export let submitting = false;
  export let submitDisabled = false;
  export let splitOn = false;
  export let splitAvailable = false;
  export let mentionItems: MentionItem[] = [];
  export let mentionLabels: string[] = [];
  export let onAddNote: () => void = () => {};
  export let onAddImage: () => void = () => {};
  export let onRemoveContext: (id: string) => void = () => {};
  export let onToggleSplit: () => void = () => {};
  export let onMention: (item: MentionItem) => void = () => {};
  export let onPasteImages: (files: File[]) => void = () => {};
  export let onSubmit: () => void = () => {};
  // Optional label overrides so non-refactor callers (e.g. the generator) can
  // relabel the submit button. Default to the refactor wording.
  export let submitLabel: string | null = null;
  export let submittingLabel: string | null = null;
  // Optional prompt placeholder override (defaults to the refactor wording).
  export let placeholder: string | null = null;

  const t = I18n.t.modals.editFlashcard;

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
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      onPasteImages(files);
    }
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

<div class="decks-ai-composer">
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
        <span class="decks-ai-context-pill" class:is-image={ctx.kind === "image"}>
          <span
            class="decks-ai-context-pill-icon"
            use:icon={ctx.kind === "image" ? "image" : "file-text"}
          ></span>
          <span class="decks-ai-context-pill-label">{ctx.label}</span>
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
      on:blur={() => setTimeout(() => (mentionOpen = false), 120)}
    ></textarea>
  </div>

  <hr class="decks-ai-composer-sep" />

  <div class="decks-ai-composer-actions">
    <button
      type="button"
      class="clickable-icon decks-ai-composer-add"
      aria-label={t.aiAddNote}
      use:icon={"paperclip"}
      on:click={onAddNote}
    ></button>
    <button
      type="button"
      class="clickable-icon decks-ai-composer-add"
      aria-label={t.aiAddImage}
      use:icon={"image"}
      on:click={onAddImage}
    ></button>
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
    <button
      type="button"
      class="mod-cta decks-ai-composer-send"
      on:click={onSubmit}
      disabled={submitting || submitDisabled}
    >
      {submitting
        ? (submittingLabel ?? t.aiRefactoring)
        : splitOn
          ? t.aiSplit
          : (submitLabel ?? t.aiSend)}
    </button>
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
  .decks-ai-composer-actions {
    display: flex;
    align-items: center;
    gap: 4px;
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
  .decks-ai-composer-send {
    margin-left: auto;
  }
</style>
