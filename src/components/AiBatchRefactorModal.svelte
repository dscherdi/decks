<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { App } from "obsidian";
  import type { Flashcard } from "../database/types";
  import { acceptAllStates, type AiProviderId, applyBatch, type BatchCardState, cardResultPatch, discardAllStates, effectiveSplit, I18n, type RefactorFieldSet, type RefactorImage, type RefactorProposal, type RefactorResult, setCardStatus } from "@decks/core";
  import AiPromptComposer from "./AiPromptComposer.svelte";
  import { buildModelOptions } from "../utils/ai-model-options";
  import RefactorCardView from "./RefactorCardView.svelte";
  import BatchCardRow from "./BatchCardRow.svelte";
  import { cardToRefactorFieldSet } from "../services/AiRefactorController";
  import {
    type ContextItem,
    buildComposerRequest,
    savePastedImage,
    IMAGE_EXTENSIONS,
  } from "../utils/attachments";
  import { FilePickerModal } from "../utils/file-picker";

  interface BatchRunOptions {
    instructions?: string;
    sourceContext?: string;
    images?: RefactorImage[];
    split?: boolean;
    model?: string;
  }

  export let app: App;
  export let cards: Flashcard[];
  export let run: (
    card: Flashcard,
    options?: BatchRunOptions,
    signal?: AbortSignal,
  ) => Promise<RefactorResult>;
  export let apply: (
    card: Flashcard,
    accepted: RefactorProposal[],
  ) => Promise<{ ok: boolean; error?: string }>;
  export let applySplit: (
    card: Flashcard,
    cards: RefactorFieldSet[],
  ) => Promise<{ ok: boolean; error?: string }>;
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  export let onClose: () => void;
  export let aiProvider: AiProviderId;
  export let defaultModel = "";

  const b = I18n.t.modals.aiBatch;
  const ef = I18n.t.modals.editFlashcard;

  // Per-prompt model picker: defaults to the global model, overrides this run only.
  const modelOptions = buildModelOptions(aiProvider, defaultModel);
  let selectedModel = defaultModel;

  function freshStates(): BatchCardState<Flashcard>[] {
    return cards.map((card) => ({
      card,
      status: "pending",
      mode: "refactor",
      proposals: [],
    }));
  }

  let states: BatchCardState<Flashcard>[] = freshStates();
  let phase: "idle" | "running" | "review" | "applying" | "summary" = "idle";
  let processed = 0;
  let applyResult = { applied: 0, skipped: 0, failed: 0 };
  let cancelled = false;
  let selectedId: string | null = null;
  let abortController: AbortController | null = null;
  // Inputs of the last Generate, reused by per-card Retry.
  let lastReq: BatchRunOptions = {};
  let lastSplitOn = false;

  $: selected = states.find((s) => s.card.id === selectedId) ?? null;
  $: acceptedCount = states.filter((s) => s.status === "accepted").length;
  $: readyCount = states.filter((s) => s.status === "ready").length;

  // Mobile: show either the list or the detail (with a back button).
  let mobile = false;
  function updateMobile() {
    mobile = window.innerWidth <= 768;
  }
  onMount(() => {
    updateMobile();
    window.addEventListener("resize", updateMobile);
  });
  onDestroy(() => window.removeEventListener("resize", updateMobile));

  // --- Shared AI input box (one prompt/context applied to every card) ---
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
      ef.aiAddNote,
    ).open();
  }
  function addImage() {
    const images = app.vault
      .getFiles()
      .filter((f) => IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()));
    new FilePickerModal(
      app,
      images,
      (f) => addContext("image", f.path, f.name),
      ef.aiAddImage,
    ).open();
  }
  async function pasteImages(files: File[]) {
    for (const file of files) {
      const saved = await savePastedImage(app, cards[0].sourceFile, file);
      if (saved) addContext("image", saved.path, saved.name);
    }
  }

  let splitOn = false;
  function toggleSplit() {
    splitOn = !splitOn;
  }

  function setResult(st: BatchCardState<Flashcard>, res: RefactorResult, isSplit: boolean) {
    Object.assign(st, cardResultPatch(res, isSplit));
  }

  async function startBatch() {
    if (phase === "running") return;
    const req = await buildComposerRequest(
      app,
      cards[0],
      prompt,
      contexts,
      activeMentions,
    );
    lastReq = req;
    lastSplitOn = splitOn;
    processed = 0;
    cancelled = false;
    selectedId = null;
    states = freshStates();
    abortController = new AbortController();
    await processAll(req, splitOn, abortController.signal);
  }

  async function processAll(
    options: BatchRunOptions,
    split: boolean,
    signal: AbortSignal,
  ) {
    phase = "running";
    for (let i = 0; i < states.length; i++) {
      if (cancelled) break;
      states[i].status = "running";
      states = [...states];
      const cardSplit = effectiveSplit(split, states[i].card.type);
      try {
        const res = await run(
          states[i].card,
          { ...options, split: cardSplit, model: selectedModel },
          signal,
        );
        setResult(states[i], res, cardSplit);
      } catch (e) {
        if (cancelled) {
          // Interrupted mid-request — leave this card unprocessed and stop.
          states[i].status = "pending";
          states = [...states];
          break;
        }
        states[i].status = "error";
        states[i].error = e instanceof Error ? e.message : String(e);
      }
      processed = i + 1;
      states = [...states];
    }
    phase = "review";
    // Jump to the first card with a suggestion for review.
    selectedId =
      selectedId ?? states.find((s) => s.status === "ready")?.card.id ?? null;
  }

  function interrupt() {
    cancelled = true;
    abortController?.abort();
  }

  async function retryCard(id: string) {
    const idx = states.findIndex((s) => s.card.id === id);
    if (idx === -1 || phase === "running") return;
    const card = states[idx].card;
    states[idx].status = "running";
    states[idx].error = undefined;
    states = [...states];
    const cardSplit = effectiveSplit(lastSplitOn, card.type);
    try {
      const res = await run(
        card,
        { ...lastReq, split: cardSplit },
        new AbortController().signal,
      );
      setResult(states[idx], res, cardSplit);
    } catch (e) {
      states[idx].status = "error";
      states[idx].error = e instanceof Error ? e.message : String(e);
    }
    states = [...states];
  }

  function select(id: string) {
    selectedId = selectedId === id ? null : id;
  }
  function acceptCard(id: string) {
    states = setCardStatus(states, id, "ready", "accepted");
  }
  function dismissCard(id: string) {
    states = setCardStatus(states, id, "accepted", "ready");
  }
  function acceptAll() {
    states = acceptAllStates(states);
  }
  function discardAll() {
    states = discardAllStates(states);
  }

  async function applyAll() {
    phase = "applying";
    const result = await applyBatch(states, { apply, applySplit });
    states = result.states;
    applyResult = {
      applied: result.applied,
      skipped: result.skipped,
      failed: result.failed,
    };
    phase = "summary";
  }
</script>

<div class="decks-ai-batch">
  <div class="decks-ai-batch-header">
    <h3>{b.title}</h3>
    <div class="decks-ai-batch-sub">
      {I18n.format(b.intro, { count: cards.length })}
    </div>
  </div>

  <div class="decks-ai-batch-body" class:has-detail={!!selectedId}>
    {#if !(mobile && selectedId)}
      <div class="decks-ai-batch-sidebar">
        {#each states as st (st.card.id)}
          <BatchCardRow
            card={st.card}
            status={st.status}
            selected={st.card.id === selectedId}
            {renderMarkdown}
            onSelect={() => select(st.card.id)}
          />
        {/each}
      </div>
    {/if}

    {#if selectedId}
      <div class="decks-ai-batch-detail">
        {#if mobile && selectedId}
          <button
            type="button"
            class="decks-ai-batch-back"
            on:click={() => (selectedId = null)}>← {b.backToList}</button
          >
        {/if}
        {#if selected}
          <div class="decks-ai-batch-detail-toolbar">
            <button
              type="button"
              class="decks-ai-batch-retry"
              on:click={() => retryCard(selected.card.id)}
              disabled={phase === "running" || selected.status === "running"}
            >
              ↻ {b.retry}
            </button>
          </div>
          <RefactorCardView
            cardType={selected.card.type}
            fieldset={cardToRefactorFieldSet(selected.card)}
            {renderMarkdown}
          />

          {#if selected.status === "running"}
            <div class="decks-ai-batch-note">{b.waiting}</div>
          {:else if (selected.status === "ready" || selected.status === "accepted") && (selected.mode === "split" ? (selected.splitCards?.length ?? 0) > 0 : !!selected.proposed)}
            <div class="decks-ai-batch-suggestion">
              <div class="decks-ai-batch-suggestion-header">
                <span class="decks-ai-batch-suggestion-spark">✨</span>
                <span class="decks-ai-batch-suggestion-title">
                  {selected.mode === "split"
                    ? I18n.format(ef.aiSplitTitle, { count: selected.splitCards?.length ?? 0 })
                    : ef.aiSuggestion}
                </span>
              </div>
              {#if selected.mode === "split" && selected.splitCards}
                <div class="decks-ai-batch-split-list">
                  {#each selected.splitCards as splitCard, i (i)}
                    <div class="decks-ai-batch-split-card">
                      <RefactorCardView
                        cardType={selected.card.type}
                        fieldset={splitCard}
                        {renderMarkdown}
                      />
                    </div>
                  {/each}
                </div>
              {:else if selected.proposed}
                <RefactorCardView
                  cardType={selected.card.type}
                  fieldset={selected.proposed}
                  {renderMarkdown}
                />
              {/if}
              <div class="decks-ai-batch-suggestion-actions">
                {#if selected.status === "accepted"}
                  <span class="decks-ai-batch-accepted-badge">✓ {b.statusAccepted}</span>
                  <span class="decks-ai-batch-footer-spacer"></span>
                  <button type="button" on:click={() => dismissCard(selected.card.id)}>
                    {ef.aiDismiss}
                  </button>
                {:else}
                  <button type="button" on:click={() => dismissCard(selected.card.id)}>
                    {ef.aiDismiss}
                  </button>
                  <button
                    type="button"
                    class="mod-cta"
                    on:click={() => acceptCard(selected.card.id)}
                  >
                    {ef.aiAcceptVersion}
                  </button>
                {/if}
              </div>
            </div>
          {:else if selected.status === "empty"}
            <div class="decks-ai-batch-note">{b.noProposals}</div>
          {:else if selected.status === "error"}
            <div class="decks-edit-error">{selected.error ?? b.failed}</div>
          {/if}
        {:else}
          <div class="decks-ai-batch-note">{b.selectPrompt}</div>
        {/if}
      </div>
    {/if}
  </div>

  {#if phase === "running"}
    <div class="decks-ai-batch-progress">
      <div class="decks-ai-batch-progress-text">
        {I18n.format(b.processing, { current: processed, total: cards.length })}
      </div>
      <div class="decks-ai-batch-bar">
        <div
          class="decks-ai-batch-bar-fill"
          style="width: {(processed / cards.length) * 100}%"
        ></div>
      </div>
    </div>
  {/if}

  <div class="decks-ai-batch-composer">
    <AiPromptComposer
      bind:prompt
      {contexts}
      {mentionItems}
      {mentionLabels}
      {splitOn}
      splitAvailable={true}
      {modelOptions}
      bind:selectedModel
      submitting={phase === "running"}
      onAddNote={addNote}
      onAddImage={addImage}
      onRemoveContext={removeContext}
      onMention={addMention}
      onToggleSplit={toggleSplit}
      onPasteImages={pasteImages}
      onSubmit={startBatch}
    />
  </div>

  <div class="decks-ai-batch-footer">
    {#if phase === "running"}
      <span class="decks-ai-batch-footer-info">
        {I18n.format(b.processing, { current: processed, total: cards.length })}
      </span>
      <span class="decks-ai-batch-footer-spacer"></span>
      <button type="button" class="mod-warning" on:click={interrupt}>{b.stop}</button>
    {:else if phase === "applying"}
      <span class="decks-ai-batch-footer-info">{b.processing}</span>
    {:else if phase === "summary"}
      <span class="decks-ai-batch-footer-info">
        {I18n.format(b.summary, {
          applied: applyResult.applied,
          skipped: applyResult.skipped,
          failed: applyResult.failed,
        })}
      </span>
      <span class="decks-ai-batch-footer-spacer"></span>
      <button type="button" class="mod-cta" on:click={onClose}>{b.close}</button>
    {:else}
      <button type="button" on:click={onClose}>{b.cancel}</button>
      <button type="button" on:click={discardAll} disabled={acceptedCount === 0}>
        {b.discardAll}
      </button>
      <button type="button" on:click={acceptAll} disabled={readyCount === 0}>
        {b.acceptAll}
      </button>
      <span class="decks-ai-batch-footer-spacer"></span>
      <button
        type="button"
        class="mod-cta"
        on:click={applyAll}
        disabled={acceptedCount === 0}
      >
        {I18n.format(b.apply, { count: acceptedCount })}
      </button>
    {/if}
  </div>
</div>

<style>
  .decks-ai-batch {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-height: 0;
    padding: 16px 20px;
    box-sizing: border-box;
  }
  .decks-ai-batch-header {
    flex: 0 0 auto;
    padding-bottom: 10px;
  }
  .decks-ai-batch-header h3 {
    margin: 0 0 4px 0;
  }
  .decks-ai-batch-sub {
    font-size: 12px;
    color: var(--text-muted);
  }
  /* Split-pane body: list (left) + detail (right). */
  .decks-ai-batch-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  /* Tinted sidebar panel with a full-height divider. */
  .decks-ai-batch-sidebar {
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
  .decks-ai-batch-body.has-detail .decks-ai-batch-sidebar {
    flex: 0 0 30%;
  }
  .decks-ai-batch-detail {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 2px 4px 14px;
  }
  /* Children (esp. the overflow:hidden suggestion card) must not be shrunk by
   * the flex column — otherwise they'd be clipped instead of letting the pane
   * scroll. */
  .decks-ai-batch-detail > * {
    flex-shrink: 0;
  }
  .decks-ai-batch-back {
    align-self: flex-start;
    background: transparent;
    border: none;
    box-shadow: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 0;
  }
  .decks-ai-batch-note {
    color: var(--text-muted);
    font-size: 13px;
    padding: 8px 2px;
  }
  .decks-ai-batch-detail-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-top: -4px;
  }
  .decks-ai-batch-retry {
    font-size: 12px;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    color: var(--text-muted);
    cursor: pointer;
    box-shadow: none;
  }
  .decks-ai-batch-retry:hover:not(:disabled) {
    color: var(--text-normal);
  }
  /* Split preview: each resulting card as its own mini-stack. */
  .decks-ai-batch-split-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
  }
  .decks-ai-batch-split-card {
    border: 1px solid var(--background-modifier-border-hover);
    border-radius: var(--radius-s);
    overflow: hidden;
  }
  .decks-ai-batch-split-card :global(.decks-field-stack) {
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }
  /* AI suggestion card (mirrors the single-card editor's suggestion). */
  .decks-ai-batch-suggestion {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
    background: var(--background-primary);
    border: 2px solid var(--background-modifier-border-hover);
    border-left: 4px solid var(--interactive-accent);
    border-radius: var(--radius-m);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.08),
      0 2px 8px rgba(0, 0, 0, 0.12);
  }
  .decks-ai-batch-suggestion :global(.decks-field-stack) {
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }
  .decks-ai-batch-suggestion-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 18px 24px 0;
  }
  .decks-ai-batch-suggestion-spark {
    font-size: 12px;
  }
  .decks-ai-batch-suggestion-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-accent);
    font-weight: 600;
  }
  .decks-ai-batch-suggestion-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 24px;
    border-top: 1px solid var(--background-modifier-border-hover);
    background: var(--background-secondary);
  }
  .decks-ai-batch-accepted-badge {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-green, var(--text-success));
  }
  .decks-ai-batch-progress {
    flex: 0 0 auto;
    padding: 6px 0 4px;
  }
  .decks-ai-batch-progress-text {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .decks-ai-batch-bar {
    height: 6px;
    background: var(--background-modifier-border);
    border-radius: 3px;
    overflow: hidden;
  }
  .decks-ai-batch-bar-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.2s ease;
  }
  .decks-ai-batch-composer {
    flex: 0 0 auto;
    padding: 12px 0;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-batch-footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-batch-footer-info {
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-ai-batch-footer-spacer {
    flex: 1 1 auto;
  }
  .decks-edit-error {
    color: var(--text-normal);
    background: var(--background-modifier-error);
    padding: 6px 10px;
    border-radius: var(--radius-s);
    font-size: 12px;
  }
  /* Mobile: the single visible pane (list or detail) fills the width. */
  :global(.decks-modal-mobile) .decks-ai-batch-sidebar {
    flex: 1 1 auto;
    border-right: none;
    padding-right: 0;
  }
</style>
