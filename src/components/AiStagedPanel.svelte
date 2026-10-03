<script lang="ts">
  // The staged pile beside the thread: the same cards as a filterable working
  // list. Two views of one array, never two arrays.
  import { I18n } from "@decks/core";
  import StagedCardRow from "./StagedCardRow.svelte";
  import type { GenRow } from "./ai-generator-types";
  import type { FixAction, GeneratedCard } from "@decks/core";

  export let rows: GenRow[] = [];
  export let isQuestion = false;
  export let selectedId: string | null = null;
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  export let resolveCardPage: (
    card: GeneratedCard,
  ) => { page: number; pdfHash: string } | null = () => null;
  export let canJumpTo: (s: { pdfHash: string } | null) => boolean = () => false;
  export let onJump: (s: { page: number; pdfHash: string }) => void = () => {};
  export let onSelect: (id: string) => void = () => {};
  export let onFix: (row: GenRow, action?: FixAction) => void = () => {};
  export let onUndo: (row: GenRow) => void = () => {};
  export let onToggleKeep: (id: string) => void = () => {};

  const g = I18n.t.modals.aiGenerator;

  type Filter = "all" | "flagged" | "kept";
  let filter: Filter = "all";

  // Saved cards leave the working list: they are in the vault, and nothing here
  // acts on them any more.
  $: live = rows.filter((r) => !r.saved);
  $: flaggedRows = live.filter((r) => r.verdict?.verdict === "flagged");
  $: keptRows = live.filter((r) => r.keep);
  $: shown =
    filter === "flagged" ? flaggedRows : filter === "kept" ? keptRows : live;

  // A filter that empties itself is a dead end — fall back rather than showing
  // an empty list the user has to work out how to escape.
  $: if (filter === "flagged" && flaggedRows.length === 0) filter = "all";
</script>

<div class="decks-ai-staged">
  <div class="decks-ai-staged-head">{g.stagedTitle}</div>
  <div class="decks-ai-staged-filters">
    <button
      type="button"
      class:is-active={filter === "all"}
      on:click={() => (filter = "all")}
      >{I18n.format(g.stagedAll, { count: live.length })}</button
    >
    {#if flaggedRows.length > 0}
      <button
        type="button"
        class="is-warn"
        class:is-active={filter === "flagged"}
        on:click={() => (filter = "flagged")}
        >{I18n.format(g.stagedFlagged, { count: flaggedRows.length })}</button
      >
    {/if}
    <button
      type="button"
      class:is-active={filter === "kept"}
      on:click={() => (filter = "kept")}
      >{I18n.format(g.stagedKept, { count: keptRows.length })}</button
    >
  </div>

  <div class="decks-ai-staged-list">
    {#each shown as row (row.id)}
      <StagedCardRow
        {row}
        {isQuestion}
        selected={row.id === selectedId}
        {renderMarkdown}
        source={resolveCardPage(row.card)}
        canJump={canJumpTo(resolveCardPage(row.card))}
        onSelect={() => onSelect(row.id)}
        onJump={() => {
          const s = resolveCardPage(row.card);
          if (s) onJump(s);
        }}
        onFix={(action) => onFix(row, action)}
        onUndo={() => onUndo(row)}
        onToggleKeep={() => onToggleKeep(row.id)}
      />
    {/each}
    {#if shown.length === 0}
      <div class="decks-ai-staged-empty">{g.stagedEmpty}</div>
    {/if}
  </div>
  {#if $$slots.footer}
    <div class="decks-ai-staged-foot"><slot name="footer" /></div>
  {/if}
</div>

<style>
  .decks-ai-staged {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 6px 6px;
    background: var(--background-secondary);
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-staged-head {
    padding: 0 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .decks-ai-staged-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 6px;
  }
  .decks-ai-staged-filters button {
    font-size: 10px;
    padding: 2px 8px;
    height: auto;
    border-radius: 999px;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
  }
  .decks-ai-staged-filters button.is-active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }
  .decks-ai-staged-filters button.is-warn:not(.is-active) {
    color: var(--color-yellow);
  }
  .decks-ai-staged-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .decks-ai-staged-foot {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 6px 2px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-staged-empty {
    padding: 12px 6px;
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
