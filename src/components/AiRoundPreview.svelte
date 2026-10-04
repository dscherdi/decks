<script lang="ts">
  // A round as the thread shows it: what it holds in a line, a taste of it, and the round's actions.
  import { I18n, type RoundSummary } from "@decks/core";

  export let title: string;
  export let span = "";
  export let summary: RoundSummary;
  /** The first fronts, as plain text. */
  export let fronts: string[] = [];
  /** A replaced round, shown faded. */
  export let old = false;
  /** The rubric did not run on some of its cards. */
  export let unchecked = false;
  /** The round is still being written. */
  export let running = false;
  /** The round's last discard, still undoable. */
  export let undoable: { count: number } | null = null;
  export let onOpen: () => void = () => {};
  export let onKeepAll: () => void = () => {};
  export let onDiscardAll: () => void = () => {};
  export let onUndo: () => void = () => {};

  const g = I18n.t.modals.aiGenerator;
  $: open = summary.kept + summary.discarded;
  $: more = Math.max(0, summary.count - fronts.length);
</script>

<div class="decks-ai-rp" class:is-old={old} class:is-running={running}>
  <button type="button" class="decks-ai-rp-main" aria-label={g.roundOpen} on:click={onOpen}>
    <span class="decks-ai-rp-head">
      <span class="decks-ai-rp-title">{title}</span>
      {#if span}<span class="decks-ai-rp-span">· {span}</span>{/if}
      <span class="decks-ai-rp-go" aria-hidden="true">›</span>
    </span>
    {#if summary.count > 0}
      <span class="decks-ai-rp-stats">
        <span>{I18n.format(g.roundClean, { clean: summary.clean, count: summary.count })}</span>
        {#if summary.flagged > 0}
          <span class="decks-ai-rp-chip">{I18n.format(g.roundFlagged, { count: summary.flagged })}</span>
        {/if}
        {#if summary.misformatted > 0}
          <span class="decks-ai-rp-chip">{I18n.format(g.roundFormatting, { count: summary.misformatted })}</span>
        {/if}
        {#if unchecked}
          <span title={g.threadUncheckedHint}>{g.threadUnchecked}</span>
        {/if}
      </span>
      <span class="decks-ai-rp-fronts">
        {#each fronts as front, i (i)}
          <span class="decks-ai-rp-front">{front}</span>
        {/each}
        {#if more > 0}<span class="decks-ai-rp-more">{I18n.format(g.roundMore, { count: more })}</span>{/if}
      </span>
    {/if}
  </button>
  {#if !old && !running && open > 0}
    <div class="decks-ai-rp-actions">
      {#if undoable}
        <span class="decks-ai-rp-note">{I18n.format(g.threadDiscarded, { count: undoable.count })}</span>
        <button type="button" on:click={onUndo}>{g.threadUndoDiscard}</button>
      {:else}
        <button type="button" disabled={summary.discarded === 0} on:click={onKeepAll}>{g.threadKeepAll}</button>
        <button type="button" disabled={summary.kept === 0} on:click={onDiscardAll}>{g.threadDiscardAll}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .decks-ai-rp {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    background: var(--background-secondary);
    overflow: hidden;
  }
  .decks-ai-rp.is-old {
    opacity: 0.6;
  }
  .decks-ai-rp.is-running {
    border-color: var(--interactive-accent);
  }
  .decks-ai-rp-main {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: auto;
    padding: 10px 12px;
    text-align: start;
    white-space: normal;
    background: transparent;
    box-shadow: none;
    border-radius: 0;
  }
  .decks-ai-rp-main:hover {
    background: var(--background-modifier-hover);
  }
  .decks-ai-rp-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    min-width: 0;
  }
  .decks-ai-rp-title {
    font-size: 13px;
    font-weight: 600;
  }
  .decks-ai-rp-span {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-rp-go {
    margin-left: auto;
    color: var(--text-faint);
  }
  .decks-ai-rp-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .decks-ai-rp-chip {
    padding: 0 6px;
    color: var(--text-warning);
    border-radius: var(--radius-s);
    background: rgba(var(--color-orange-rgb), 0.12);
  }
  .decks-ai-rp-fronts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding-left: 8px;
    border-left: 2px solid var(--background-modifier-border);
  }
  .decks-ai-rp-front {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-rp-more {
    color: var(--text-faint);
    font-size: 11px;
  }
  .decks-ai-rp-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    border-top: 1px solid var(--background-modifier-border);
    font-size: 12px;
  }
  .decks-ai-rp-actions button {
    height: auto;
    padding: 0;
    color: var(--text-accent);
    background: transparent;
    box-shadow: none;
    font-size: 12px;
  }
  .decks-ai-rp-actions button:disabled {
    color: var(--text-faint);
  }
  .decks-ai-rp-note {
    color: var(--text-muted);
  }
</style>
