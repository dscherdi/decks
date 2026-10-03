<script lang="ts">
  // The side panel of a questions session: what an attempt could draw, what
  // would be skipped, and where the questions go.
  import { I18n, type QuestionMix } from "@decks/core";

  /** Questions the destination already holds. */
  export let mix: QuestionMix;
  /** Questions in this pile that parse and are waiting to be saved. */
  export let pending = 0;
  export let skipped = 0;
  export let destinationLabel = "";
  export let tag = "";
  export let headingLevel = 2;
  export let onEditDestination: () => void = () => {};

  const g = I18n.t.modals.aiGenerator;
  const d = g.examDraft;

  $: types = [
    { label: d.mcq, count: pending + mix.mcq },
    { label: d.typeIn, count: mix.typeIn },
    { label: d.cloze, count: mix.cloze },
  ];
</script>

<div class="decks-ai-draft">
  <div class="decks-ai-draft-head">{d.title}</div>

  <div class="decks-ai-draft-types">
    {#each types as type (type.label)}
      <div class="decks-ai-draft-type">
        <span>{type.label}</span>
        <span class="decks-ai-draft-count">{type.count}</span>
      </div>
    {/each}
    <div class="decks-ai-draft-type is-muted">
      <span>{I18n.t.filterBuilder.typeImageOcclusion}</span>
      <span>{d.notApplicable}</span>
    </div>
  </div>

  <div class="decks-ai-draft-chips">
    <span class="decks-ai-draft-chip is-ok">{I18n.format(g.eligiblePreview, { count: pending })}</span>
    {#if skipped > 0}
      <span class="decks-ai-draft-chip is-warn">{I18n.format(g.skippedPreview, { count: skipped })}</span>
    {/if}
  </div>

  <div class="decks-ai-draft-dest">
    <div class="decks-ai-draft-label">{g.destination}</div>
    <div class="decks-ai-draft-chips">
      <button type="button" class="decks-ai-draft-chip is-button" on:click={onEditDestination}
        >{destinationLabel}</button
      >
      {#if tag}<span class="decks-ai-draft-chip">{tag}</span>{/if}
      <span class="decks-ai-draft-chip">H{headingLevel}</span>
    </div>
    <div class="decks-ai-draft-note">{d.profileNote}</div>
  </div>
</div>

<style>
  .decks-ai-draft {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    background: var(--background-secondary);
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-draft-head,
  .decks-ai-draft-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .decks-ai-draft-types {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .decks-ai-draft-type {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-normal);
  }
  .decks-ai-draft-type.is-muted {
    color: var(--text-muted);
  }
  /* The accent count badge the chapter panel uses. */
  .decks-ai-draft-count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 10px;
    line-height: 16px;
    text-align: center;
  }
  .decks-ai-draft-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .decks-ai-draft-chip {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    border: none;
    box-shadow: none;
    height: auto;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-draft-chip.is-button {
    cursor: pointer;
  }
  .decks-ai-draft-chip.is-ok {
    background: var(--background-modifier-success-hover, var(--background-modifier-hover));
    color: var(--text-success);
  }
  .decks-ai-draft-chip.is-warn {
    background: rgba(var(--callout-warning), 0.1);
    color: var(--color-yellow);
  }
  .decks-ai-draft-dest {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .decks-ai-draft-note {
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
