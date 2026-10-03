<script lang="ts">
  import {
    I18n,
    gapPages,
    heatTone,
    pageHeat,
    summarizeHeat,
  } from "@decks/core";
  import type { ChapterNode } from "../utils/pdf";

  export let chapters: ChapterNode[] = [];
  // Controlled: the set of selected chapter ids (drives which pages are sent).
  export let selectedIds: Set<string> = new Set();
  /** Cards generated per chapter id, so an empty section is visible at a glance. */
  export let cardsByChapter: Record<string, number> = {};
  /** Staged cards citing each page, counted locally from what the cards
   *  report. */
  export let cardsByPage: Record<number, number> = {};
  /** The pages actually sent. A page outside this set is not a gap. */
  export let sourcedPages: Set<number> = new Set();
  export let onGenerateForGaps: (pages: number[]) => void = () => {};
  // Live OCR progress, or null when not transcribing.
  export let ocrProgress: { done: number; total: number; fromCache: boolean } | null =
    null;
  export let onSelectionChange: (next: Set<string>) => void = () => {};

  const g = I18n.t.modals.aiGenerator;

  interface Row {
    node: ChapterNode;
    depth: number;
  }

  // Coverage across everything selected, and the pages with nothing on them —
  // the gap list the footer offers to generate for.
  $: gaps = gapPages(sourcedPages, cardsByPage);
  $: sourcedTotal = sourcedPages.size;
  $: coveredTotal = sourcedTotal - gaps.length;

  // Flatten the outline tree into indented rows for rendering.
  $: rows = flatten(chapters, 0);
  function flatten(nodes: ChapterNode[], depth: number): Row[] {
    const out: Row[] = [];
    for (const node of nodes) {
      out.push({ node, depth });
      if (node.children.length) out.push(...flatten(node.children, depth + 1));
    }
    return out;
  }

  function collectIds(node: ChapterNode, acc: string[]): void {
    acc.push(node.id);
    for (const c of node.children) collectIds(c, acc);
  }

  // Toggling a node cascades to its descendants so selecting a chapter selects
  // its subchapters too.
  function toggle(node: ChapterNode): void {
    const ids: string[] = [];
    collectIds(node, ids);
    const next = new Set(selectedIds);
    const turnOn = !selectedIds.has(node.id);
    for (const id of ids) {
      if (turnOn) next.add(id);
      else next.delete(id);
    }
    onSelectionChange(next);
  }

  function selectAll(): void {
    const ids: string[] = [];
    for (const n of chapters) collectIds(n, ids);
    onSelectionChange(new Set(ids));
  }
  function clearAll(): void {
    onSelectionChange(new Set());
  }
</script>

<div class="decks-pdf-chapters">
  <div class="decks-pdf-panel-controls">
    <div class="decks-pdf-panel-bulk">
      <button type="button" on:click={selectAll}>{g.pdfSelectAll}</button>
      <button type="button" on:click={clearAll}>{g.pdfClear}</button>
    </div>
  </div>

  {#if ocrProgress}
    <div class="decks-pdf-ocr-progress">
      {I18n.format(g.pdfOcrProgress, {
        done: ocrProgress.done,
        total: ocrProgress.total,
      })}
      {#if ocrProgress.fromCache}
        <span class="decks-pdf-cached-badge">{g.pdfCached}</span>
      {/if}
    </div>
  {/if}

  <div class="decks-pdf-panel-tree">
    {#each rows as row (row.node.id)}
      {@const cells = pageHeat(
        row.node.startPage,
        row.node.endPage,
        sourcedPages,
        cardsByPage,
      )}
      {@const heat = summarizeHeat(cells)}
      <div class="decks-pdf-chapter-group" class:is-empty={heat.total > 0 && heat.covered === 0}>
        <label
          class="decks-pdf-chapter"
          class:is-sub={row.depth > 0}
          style:--decks-pdf-indent={`${row.depth * 14}px`}
        >
          <input
            type="checkbox"
            checked={selectedIds.has(row.node.id)}
            on:change={() => toggle(row.node)}
          />
          <span class="decks-pdf-chapter-title">{row.node.title}</span>
          {#if cardsByChapter[row.node.id]}
            <span class="decks-pdf-chapter-cards">{cardsByChapter[row.node.id]}</span>
          {/if}
          <span class="decks-pdf-chapter-pages">
            {row.node.startPage}–{row.node.endPage}
          </span>
        </label>
        {#if cells.length > 0}
          <div
            class="decks-pdf-heat"
            style:--decks-pdf-indent={`${row.depth * 14}px`}
          >
            <div class="decks-pdf-heat-strip">
              {#each cells as cell (cell.page)}
                <span
                  class="decks-pdf-heat-cell is-{heatTone(cell.count)}"
                  title={I18n.format(g.pdfPageCards, {
                    page: cell.page,
                    count: cell.count,
                  })}
                ></span>
              {/each}
            </div>
            <div class="decks-pdf-heat-caption" class:is-empty={heat.covered === 0}>
              {#if heat.covered === 0}
                {g.pdfNoCardsYet}
              {:else}
                {[
                  I18n.format(g.pdfPageCoverage, {
                    covered: heat.covered,
                    total: heat.total,
                  }),
                  heat.thin > 0 ? I18n.format(g.pdfPagesThin, { count: heat.thin }) : "",
                  heat.untouched > 0
                    ? I18n.format(g.pdfPagesUntouched, { count: heat.untouched })
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/each}
    {#if rows.length === 0}
      <div class="decks-pdf-panel-empty">{g.pdfNoChapters}</div>
    {/if}
  </div>

  {#if sourcedTotal > 0}
    <div class="decks-pdf-coverage">
      <div class="decks-pdf-coverage-row">
        <span class="decks-pdf-coverage-label">{g.pdfSelectionCoverage}</span>
        <span class="decks-pdf-coverage-value"
          >{I18n.format(g.pdfCoverageRatio, {
            covered: coveredTotal,
            total: sourcedTotal,
          })}</span
        >
      </div>
      {#if gaps.length > 0}
        <button type="button" on:click={() => onGenerateForGaps(gaps)}>
          {I18n.format(g.pdfGenerateGaps, { count: gaps.length })}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .decks-pdf-chapters {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .decks-pdf-panel-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 8px;
  }
  .decks-pdf-panel-bulk {
    display: flex;
    gap: 6px;
  }
  .decks-pdf-panel-bulk button {
    font-size: 11px;
    padding: 2px 8px;
  }
  .decks-pdf-ocr-progress {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .decks-pdf-cached-badge {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-green, var(--text-success));
    font-weight: 600;
  }
  .decks-pdf-panel-tree {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .decks-pdf-chapter {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    padding-left: calc(4px + var(--decks-pdf-indent, 0px));
    border-radius: var(--radius-s);
    cursor: pointer;
    font-size: 12px;
  }
  .decks-pdf-chapter:hover {
    background: var(--background-modifier-hover);
  }
  .decks-pdf-chapter.is-sub {
    color: var(--text-muted);
  }
  .decks-pdf-chapter-cards {
    flex: 0 0 auto;
    padding: 0 6px;
    border-radius: 8px;
    font-size: 0.7rem;
    font-weight: 600;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .decks-pdf-chapter-title {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-pdf-chapter-pages {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--text-faint);
    font-family: var(--font-monospace);
  }
  /* --- Page heat -------------------------------------------------------- */
  /* One cell per sent page of the chapter; the count is local and
     deterministic. */
  .decks-pdf-chapter-group.is-empty {
    background: rgba(var(--callout-warning), 0.08);
    border-radius: var(--radius-s);
  }
  .decks-pdf-heat {
    padding: 2px 4px 5px;
    padding-left: calc(4px + var(--decks-pdf-indent, 0px) + 18px);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .decks-pdf-heat-strip {
    display: flex;
    gap: 1px;
  }
  .decks-pdf-heat-cell {
    flex: 1 1 0;
    height: 5px;
    min-width: 2px;
    background: var(--interactive-accent);
  }
  .decks-pdf-heat-cell:first-child {
    border-radius: 1px 0 0 1px;
  }
  .decks-pdf-heat-cell:last-child {
    border-radius: 0 1px 1px 0;
  }
  .decks-pdf-heat-cell.is-thin {
    opacity: 0.45;
  }
  .decks-pdf-heat-cell.is-none {
    background: var(--background-modifier-border-hover);
  }
  /* Muted, not faint: this is a data value, and faint fails contrast at 10px. */
  .decks-pdf-heat-caption {
    font-size: 10px;
    color: var(--text-muted);
  }
  .decks-pdf-heat-caption.is-empty {
    color: var(--color-yellow);
  }

  .decks-pdf-coverage {
    flex: 0 0 auto;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .decks-pdf-coverage-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .decks-pdf-coverage-label {
    flex: 1 1 auto;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .decks-pdf-coverage-value {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-monospace);
  }
  .decks-pdf-coverage button {
    font-size: 11px;
    padding: 2px 8px;
  }

  .decks-pdf-panel-empty {
    font-size: 12px;
    color: var(--text-faint);
    padding: 8px 2px;
  }
</style>
