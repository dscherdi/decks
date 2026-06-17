<script lang="ts">
  import { setIcon } from "obsidian";
  import { I18n } from "@decks/core";
  import type { ChapterNode } from "../utils/pdf";
  import type { PdfTab } from "./ai-generator-types";

  export let title = "";
  export let chapters: ChapterNode[] = [];
  // Controlled: the set of selected chapter ids (drives which pages are sent).
  export let selectedIds: Set<string> = new Set();
  // Live OCR progress, or null when not transcribing.
  export let ocrProgress: { done: number; total: number; fromCache: boolean } | null =
    null;
  // One tab per attached PDF; the strip is shown only when there's more than one.
  export let tabs: PdfTab[] = [];
  export let activeTabId: string | null = null;
  export let onSelectTab: (id: string) => void = () => {};
  export let onCloseTab: (id: string) => void = () => {};
  export let onSelectionChange: (next: Set<string>) => void = () => {};
  export let onClose: () => void = () => {};

  const g = I18n.t.modals.aiGenerator;

  interface Row {
    node: ChapterNode;
    depth: number;
  }

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

  function onPdfSelect(e: Event): void {
    onSelectTab((e.currentTarget as HTMLSelectElement).value);
  }

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
  }
</script>

<aside class="decks-pdf-panel">
  <div class="decks-pdf-panel-header">
    <span class="decks-pdf-panel-title">{title || g.pdfChapters}</span>
    <button
      type="button"
      class="clickable-icon"
      aria-label={g.pdfClosePanel}
      use:icon={"x"}
      on:click={onClose}
    ></button>
  </div>

  {#if tabs.length > 1}
    <div class="decks-pdf-select-row">
      <select
        class="decks-pdf-select"
        value={activeTabId}
        on:change={onPdfSelect}
        aria-label={g.pdfChapters}
      >
        {#each tabs as tab (tab.id)}
          <option value={tab.id}>{tab.label}</option>
        {/each}
      </select>
      <button
        type="button"
        class="clickable-icon decks-pdf-select-close"
        aria-label={g.pdfCloseTab}
        title={g.pdfCloseTab}
        use:icon={"x"}
        on:click={() => activeTabId && onCloseTab(activeTabId)}
      ></button>
    </div>
  {/if}

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
        <span class="decks-pdf-chapter-pages">
          {row.node.startPage}–{row.node.endPage}
        </span>
      </label>
    {/each}
    {#if rows.length === 0}
      <div class="decks-pdf-panel-empty">{g.pdfNoChapters}</div>
    {/if}
  </div>
</aside>

<style>
  .decks-pdf-panel {
    flex: 0 0 280px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--background-modifier-border);
    padding: 12px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .decks-pdf-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .decks-pdf-panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-pdf-select-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
  }
  .decks-pdf-select {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
  }
  .decks-pdf-select-close {
    flex: 0 0 auto;
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
  .decks-pdf-panel-empty {
    font-size: 12px;
    color: var(--text-faint);
    padding: 8px 2px;
  }
</style>
