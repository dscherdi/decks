<script lang="ts">
  import {
    I18n,
    type ConceptFilter,
    type ConceptRow,
    type ConceptState,
    filterConceptRows,
    formatPageList,
    pageConceptTone,
  } from "@decks/core";

  /** The ledger, already scored against the cards this source has produced. */
  export let rows: ConceptRow[] = [];
  /** Pages that have been through extraction, whatever they yielded. */
  export let extracted: Set<number> = new Set();
  /** The pages currently selected — what an extraction would read. */
  export let sourcedPages: Set<number> = new Set();
  export let cardsByPage: Record<number, number> = {};
  export let conceptsPerPage: Record<number, number> = {};
  export let busy = false;
  export let error: string | null = null;
  export let onExtract: () => void = () => {};
  export let onGenerate: (rows: ConceptRow[]) => void = () => {};
  /** Rework the cards of concepts that keep being missed; absent when nothing can. */
  export let onRepair: ((rows: ConceptRow[]) => void) | undefined = undefined;
  /** Split the one card of concepts that have only one. */
  export let onSplit: ((rows: ConceptRow[]) => void) | undefined = undefined;

  const g = I18n.t.modals.aiGenerator;
  const c = g.coverage;
  const acts = I18n.t.exam.aiMisses;
  const PREVIEW = 6;

  let filter: ConceptFilter = "all";
  let selected = new Set<string>();
  let expanded = false;

  interface Band {
    state: ConceptState;
    label: string;
    body: string;
  }
  const QUADS: Band[] = [
    { state: "no_card", label: c.quadNoCard, body: c.quadNoCardBody },
    { state: "failing", label: c.quadFailing, body: c.quadFailingBody },
    { state: "thin", label: c.quadThin, body: c.quadThinBody },
    { state: "holding", label: c.quadHolding, body: c.quadHoldingBody },
  ];
  const CHIPS: Array<{ state: ConceptState; label: string }> = [
    { state: "no_card", label: c.filterUncovered },
    { state: "thin", label: c.filterThin },
    { state: "holding", label: c.filterHolding },
    { state: "failing", label: c.filterFailing },
  ];

  const STATE_LABELS: Record<ConceptState, string> = {
    no_card: c.stateNoCard,
    thin: c.stateThin,
    failing: c.stateFailing,
    holding: c.stateHolding,
  };

  $: tally = {
    no_card: rows.filter((r) => r.state === "no_card").length,
    thin: rows.filter((r) => r.state === "thin").length,
    failing: rows.filter((r) => r.state === "failing").length,
    holding: rows.filter((r) => r.state === "holding").length,
  };
  $: visible = filterConceptRows(rows, filter);
  $: shown = expanded ? visible : visible.slice(0, PREVIEW);
  // Selection survives a filter change, so counting it over the whole ledger
  // keeps the button honest about what it would generate for.
  $: selectedRows = rows.filter((r) => selected.has(r.id));
  $: pages = [...new Set([...extracted, ...sourcedPages])].sort((a, b) => a - b);
  $: extractedRange = formatPageList([...extracted]);

  function toggle(id: string): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectUncovered(): void {
    selected = new Set(rows.filter((r) => r.state === "no_card").map((r) => r.id));
    filter = "no_card";
  }

  function focus(state: ConceptState): void {
    filter = filter === state ? "all" : state;
    expanded = false;
  }

  /** The one action a state offers, or null for the state that needs none. */
  function actionFor(state: ConceptState): { label: string; run: () => void } | null {
    const those = rows.filter((r) => r.state === state);
    if (those.length === 0) return null;
    if (state === "no_card") return { label: acts.generate, run: () => onGenerate(those) };
    if (state === "failing" && onRepair) return { label: acts.repair, run: () => onRepair?.(those) };
    if (state === "thin" && onSplit) return { label: g.fixLabels.split, run: () => onSplit?.(those) };
    return null;
  }
</script>

<div class="decks-ai-cov">
  <div class="decks-ai-cov-summary">
    {#if busy}
      <span class="decks-ai-cov-note">{c.extracting}</span>
    {:else if rows.length > 0}
      <span class="decks-ai-cov-note">
        {I18n.format(c.summary, { count: rows.length, pages: extractedRange })}
      </span>
    {:else if sourcedPages.size === 0}
      <span class="decks-ai-cov-note">{c.needsSelection}</span>
    {:else}
      <span class="decks-ai-cov-note">{c.empty}</span>
    {/if}
    <button
      type="button"
      class="decks-ai-cov-extract"
      disabled={busy || sourcedPages.size === 0}
      on:click={onExtract}
    >
      {rows.length > 0 ? c.reextract : c.extract}
    </button>
  </div>

  {#if error}
    <div class="decks-ai-cov-error">{error}</div>
  {/if}

  {#if rows.length > 0}
    <div class="decks-ai-cov-quadrants">
      {#each QUADS as quad (quad.state)}
        {@const act = actionFor(quad.state)}
        <div class="decks-ai-cov-quad-cell">
          <button
            type="button"
            class="decks-ai-cov-quad is-{quad.state}"
            class:is-active={filter === quad.state}
            aria-pressed={filter === quad.state}
            on:click={() => focus(quad.state)}
          >
            <span class="decks-ai-cov-quad-count">{tally[quad.state]}</span>
            <span class="decks-ai-cov-quad-label">{quad.label}</span>
            <span class="decks-ai-cov-quad-body">{quad.body}</span>
          </button>
          {#if act}
            <button
              type="button"
              class="decks-ai-cov-quad-act"
              disabled={busy}
              on:click={act.run}>{act.label}</button
            >
          {/if}
        </div>
      {/each}
    </div>

    <div class="decks-ai-cov-filters">
      <button
        type="button"
        class="decks-ai-cov-chip"
        class:is-active={filter === "all"}
        on:click={() => (filter = "all")}
      >
        {I18n.format(c.filterAll, { count: rows.length })}
      </button>
      {#each CHIPS as chip (chip.state)}
        <button
          type="button"
          class="decks-ai-cov-chip is-{chip.state}"
          class:is-active={filter === chip.state}
          on:click={() => focus(chip.state)}
        >
          {I18n.format(chip.label, { count: tally[chip.state] })}
        </button>
      {/each}
    </div>

    <div class="decks-ai-cov-table">
      <div class="decks-ai-cov-head">
        <span></span>
        <span class="decks-ai-cov-term">{c.colConcept}</span>
        <span class="decks-ai-cov-page">{c.colPage}</span>
        <span class="decks-ai-cov-cards">{c.colCards}</span>
        <span class="decks-ai-cov-state">{c.colState}</span>
      </div>
      {#each shown as row (row.id)}
        <label class="decks-ai-cov-row" class:is-uncovered={row.state === "no_card"}>
          <input
            type="checkbox"
            checked={selected.has(row.id)}
            on:change={() => toggle(row.id)}
          />
          <span class="decks-ai-cov-term" title={row.blurb || row.term}>{row.term}</span>
          <span class="decks-ai-cov-page">{row.page}</span>
          <span class="decks-ai-cov-cards">{row.cards}</span>
          <span class="decks-ai-cov-state is-{row.state}">{STATE_LABELS[row.state]}</span>
        </label>
      {/each}
      {#if visible.length > shown.length}
        <button
          type="button"
          class="decks-ai-cov-more"
          on:click={() => (expanded = true)}
        >
          {I18n.format(c.more, { count: visible.length - shown.length })}
        </button>
      {/if}
    </div>

    <div class="decks-ai-cov-actions">
      <button type="button" on:click={selectUncovered}>{c.selectUncovered}</button>
      <button
        type="button"
        class="mod-cta"
        disabled={selectedRows.length === 0}
        on:click={() => onGenerate(selectedRows)}
      >
        {I18n.format(c.generateSelected, { count: selectedRows.length })}
      </button>
    </div>
  {/if}

  {#if pages.length > 0}
    <div class="decks-ai-cov-grid-wrap">
      <div class="decks-ai-cov-grid-title">
        {I18n.format(c.gridPages, { range: formatPageList(pages) })}
      </div>
      <div class="decks-ai-cov-grid">
        {#each pages as page (page)}
          {@const tone = pageConceptTone(
            extracted.has(page),
            conceptsPerPage[page] ?? 0,
            cardsByPage[page] ?? 0,
          )}
          <span
            class="decks-ai-cov-cell is-{tone}"
            title={I18n.format(c.pageCell, {
              page,
              concepts: conceptsPerPage[page] ?? 0,
              cards: cardsByPage[page] ?? 0,
            })}
          ></span>
        {/each}
      </div>
      <div class="decks-ai-cov-legend">
        <span class="decks-ai-cov-legend-item"
          ><i class="decks-ai-cov-cell is-strong"></i>{c.legendStrong}</span
        >
        <span class="decks-ai-cov-legend-item"
          ><i class="decks-ai-cov-cell is-thin"></i>{c.legendThin}</span
        >
        <span class="decks-ai-cov-legend-item"
          ><i class="decks-ai-cov-cell is-uncovered"></i>{c.legendUncovered}</span
        >
        <span class="decks-ai-cov-legend-item"
          ><i class="decks-ai-cov-cell is-empty"></i>{c.legendEmpty}</span
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .decks-ai-cov {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .decks-ai-cov-summary {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .decks-ai-cov-note {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }
  .decks-ai-cov-extract {
    font-size: 11px;
    padding: 2px 8px;
  }
  .decks-ai-cov-error {
    font-size: 11px;
    color: var(--text-error);
  }

  /* Two axes: how many concepts have a card, and whether that card holds. */
  .decks-ai-cov-quadrants {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  .decks-ai-cov-quad {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 6px 8px;
    height: auto;
    text-align: left;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-secondary);
    cursor: pointer;
  }
  .decks-ai-cov-quad.is-active {
    border-color: var(--interactive-accent);
  }
  .decks-ai-cov-quad-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .decks-ai-cov-quad-cell .decks-ai-cov-quad {
    flex: 1 1 auto;
    width: 100%;
  }
  .decks-ai-cov-quad-act {
    align-self: flex-start;
    height: auto;
    padding: 2px 8px;
    font-size: 11px;
  }
  .decks-ai-cov-quad-count {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.1;
  }
  /* No card is the warning-tinted card and holding the success-tinted one, as the design has them. */
  .decks-ai-cov-quad.is-no_card {
    background: rgba(var(--callout-warning), 0.08);
  }
  .decks-ai-cov-quad.is-no_card .decks-ai-cov-quad-count,
  .decks-ai-cov-quad.is-thin .decks-ai-cov-quad-count {
    color: var(--color-yellow);
  }
  .decks-ai-cov-quad.is-failing .decks-ai-cov-quad-count {
    color: var(--text-normal);
  }
  .decks-ai-cov-quad.is-holding {
    background: var(--background-modifier-success-hover, var(--background-secondary));
  }
  .decks-ai-cov-quad.is-holding .decks-ai-cov-quad-count {
    color: var(--text-success);
  }
  .decks-ai-cov-quad-label {
    font-size: 11px;
    font-weight: 500;
  }
  .decks-ai-cov-quad-body {
    font-size: 10px;
    color: var(--text-muted);
    line-height: 1.3;
  }

  .decks-ai-cov-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .decks-ai-cov-chip {
    font-size: 10px;
    padding: 1px 7px;
    height: auto;
    border-radius: 10px;
  }
  .decks-ai-cov-chip.is-active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  /* The view scrolls as a whole; a shrinking table would collapse to nothing. */
  .decks-ai-cov-table {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
  }
  .decks-ai-cov-head,
  .decks-ai-cov-row {
    display: grid;
    grid-template-columns: 13px minmax(0, 1fr) 28px 24px auto;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 3px 0;
  }
  .decks-ai-cov-head {
    color: var(--text-faint);
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .decks-ai-cov-row {
    cursor: pointer;
  }
  .decks-ai-cov-row:hover {
    background: var(--background-modifier-hover);
  }
  .decks-ai-cov-row input {
    margin: 0;
  }
  .decks-ai-cov-term {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-cov-page,
  .decks-ai-cov-cards {
    color: var(--text-muted);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .decks-ai-cov-state {
    font-size: 9px;
    padding: 0 5px;
    border-radius: 8px;
    white-space: nowrap;
  }
  /* Warning for what wants cards, neutral for failing: its cards exist and want repair. */
  .decks-ai-cov-row .decks-ai-cov-state.is-no_card,
  .decks-ai-cov-row .decks-ai-cov-state.is-thin {
    background: rgba(var(--callout-warning), 0.18);
    color: var(--color-yellow);
  }
  .decks-ai-cov-row .decks-ai-cov-state.is-failing {
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }
  .decks-ai-cov-row.is-uncovered {
    background: rgba(var(--callout-warning), 0.08);
  }
  .decks-ai-cov-row .decks-ai-cov-state.is-holding {
    background: rgba(var(--color-green-rgb), 0.18);
    color: var(--text-success);
  }
  .decks-ai-cov-more {
    font-size: 10px;
    padding: 2px 0;
    background: none;
    border: none;
    box-shadow: none;
    color: var(--text-muted);
    text-align: left;
  }

  .decks-ai-cov-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .decks-ai-cov-actions button {
    font-size: 11px;
    padding: 2px 8px;
  }

  .decks-ai-cov-grid-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-cov-grid-title {
    font-size: 10px;
    color: var(--text-muted);
  }
  .decks-ai-cov-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .decks-ai-cov-cell {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: var(--background-modifier-border);
    flex: 0 0 auto;
  }
  /* The page-heat tones, plus warning for concepts nobody has a card for. */
  .decks-ai-cov-cell.is-strong {
    background: var(--interactive-accent);
  }
  .decks-ai-cov-cell.is-thin {
    background: hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.45);
  }
  .decks-ai-cov-cell.is-uncovered {
    background: rgba(var(--callout-warning), 0.55);
  }
  .decks-ai-cov-cell.is-empty {
    background: var(--background-modifier-border);
  }
  .decks-ai-cov-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 9px;
    color: var(--text-muted);
  }
  .decks-ai-cov-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .decks-ai-cov-legend-item i {
    display: inline-block;
  }
</style>
