<script lang="ts">
  // A minimized flashcard view for the batch sidebar: status badge + the card's
  // front and back rendered as markdown, clamped so it stays compact.
  import type { Flashcard } from "../database/types";

  type RowStatus =
    | "pending"
    | "running"
    | "ready"
    | "accepted"
    | "empty"
    | "error";

  export let card: Flashcard;
  export let status: RowStatus;
  export let selected = false;
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  export let onSelect: () => void = () => {};

  function renderMd(node: HTMLElement, content: string) {
    node.empty();
    renderMarkdown(content, node);
    return {
      update(next: string) {
        node.empty();
        renderMarkdown(next, node);
      },
    };
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  }
</script>

<!-- A div (not a button): the row holds rendered markdown block content, which
     is invalid inside a <button> and breaks layout. -->
<div
  class="decks-batch-row"
  class:is-selected={selected}
  role="button"
  tabindex="0"
  on:click={onSelect}
  on:keydown={onKeydown}
>
  <span class="decks-batch-row-badge decks-batch-status-{status}">
    {#if status === "running"}
      <span class="decks-batch-row-spinner"></span>
    {:else if status === "accepted"}✓{/if}
  </span>
  <div class="decks-batch-row-body">
    <div class="decks-batch-row-front" use:renderMd={card.front}></div>
    {#if card.back?.trim()}
      <div class="decks-batch-row-back" use:renderMd={card.back}></div>
    {/if}
  </div>
</div>

<style>
  .decks-batch-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    text-align: left;
    padding: 14px 16px;
    border: none;
    border-left: 4px solid transparent;
    border-radius: 0 var(--radius-m) var(--radius-m) 0;
    background: transparent;
    color: var(--text-normal);
    cursor: pointer;
    box-shadow: none;
  }
  .decks-batch-row:not(.is-selected):hover {
    background: var(--background-modifier-hover);
  }
  .decks-batch-row.is-selected {
    background: var(--background-primary);
    border-left-color: var(--interactive-accent);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  }

  .decks-batch-row-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .decks-batch-row-front,
  .decks-batch-row-back {
    display: block;
    min-width: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .decks-batch-row-front {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.5;
    max-height: 3em; /* ~2 lines */
    color: var(--text-normal);
  }
  .decks-batch-row-back {
    font-size: 12px;
    line-height: 1.5;
    max-height: 4.5em; /* ~3 lines */
    color: var(--text-muted);
  }
  .decks-batch-row-front :global(p),
  .decks-batch-row-back :global(p) {
    margin: 0;
  }
  .decks-batch-row-front :global(img),
  .decks-batch-row-back :global(img) {
    max-width: 100%;
    max-height: 64px;
  }

  /* Status micro-badge: colored dot (✓ when accepted) or spinner. */
  .decks-batch-row-badge {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    margin-top: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 9px;
    line-height: 1;
    color: var(--text-on-accent);
    background: var(--text-muted);
    box-shadow: 0 0 0 1px var(--background-primary);
  }
  .decks-batch-row-badge.decks-batch-status-ready {
    background: var(--interactive-accent);
  }
  .decks-batch-row-badge.decks-batch-status-accepted {
    background: var(--color-green, var(--text-success));
  }
  .decks-batch-row-badge.decks-batch-status-error {
    background: var(--text-error);
  }
  .decks-batch-row-badge.decks-batch-status-running {
    background: transparent;
    box-shadow: none;
  }
  .decks-batch-row-spinner {
    width: 11px;
    height: 11px;
    border: 2px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: decks-batch-row-spin 0.7s linear infinite;
  }
  @keyframes decks-batch-row-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
