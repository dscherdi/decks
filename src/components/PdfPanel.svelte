<script lang="ts">
  import { setIcon } from "obsidian";
  import { I18n } from "@decks/core";
  import type { PdfTab } from "./ai-generator-types";
  import type { PdfPanelView } from "./pdf-panel";

  export let title: string;
  // One entry per attached PDF; the picker shows only when there is more than one.
  export let tabs: PdfTab[] = [];
  export let activeTabId: string | null = null;
  export let views: Array<{ id: PdfPanelView; label: string }> = [];
  export let view: PdfPanelView = "chapters";
  export let onView: (view: PdfPanelView) => void = () => {};
  export let onSelectTab: (id: string) => void = () => {};
  export let onRemoveTab: (id: string) => void = () => {};
  export let onClose: () => void = () => {};
  /** Absent when the PDF cannot be opened in Obsidian's viewer. */
  export let onOpenInViewer: (() => void) | null = null;

  const g = I18n.t.modals.aiGenerator;
  const p = g.pdfPanel;

  // The tab that takes keyboard focus, even if the caller's view is not offered.
  $: focusView = views.some((v) => v.id === view) ? view : (views[0]?.id ?? view);
  $: viewLabel = views.find((v) => v.id === view)?.label ?? "";

  function onPdfSelect(e: Event & { currentTarget: EventTarget & HTMLSelectElement }): void {
    onSelectTab(e.currentTarget.value);
  }

  function removeActive(): void {
    if (activeTabId) onRemoveTab(activeTabId);
  }

  // Arrow keys move between views, as a tab list expects.
  function onTabKey(e: KeyboardEvent & { currentTarget: EventTarget & HTMLButtonElement }): void {
    const at = views.findIndex((v) => v.id === focusView);
    let next = -1;
    if (e.key === "ArrowRight") next = (at + 1) % views.length;
    else if (e.key === "ArrowLeft") next = (at - 1 + views.length) % views.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = views.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onView(views[next].id);
    e.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
  }

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
  }
</script>

<section class="decks-pdf-panel">
  <div class="decks-pdf-panel-header">
    {#if tabs.length > 1}
      <select
        class="decks-pdf-select"
        value={activeTabId}
        on:change={onPdfSelect}
        aria-label={g.pdfPanel.pick}
      >
        {#each tabs as tab (tab.id)}
          <option value={tab.id}>{tab.label}</option>
        {/each}
      </select>
      <button
        type="button"
        class="clickable-icon"
        aria-label={g.pdfCloseTab}
        title={g.pdfCloseTab}
        use:icon={"file-x"}
        on:click={removeActive}
      ></button>
    {:else}
      <span class="decks-pdf-panel-title" {title}>{title}</span>
    {/if}
    {#if onOpenInViewer}
      <button
        type="button"
        class="clickable-icon"
        aria-label={p.openInViewer}
        title={p.openInViewer}
        use:icon={"external-link"}
        on:click={onOpenInViewer}
      ></button>
    {/if}
    <button
      type="button"
      class="clickable-icon"
      aria-label={p.close}
      title={p.close}
      use:icon={"x"}
      on:click={onClose}
    ></button>
  </div>

  {#if views.length > 1}
    <div class="decks-seg decks-pdf-panel-views" role="tablist" aria-label={p.views}>
      {#each views as v (v.id)}
        <button
          type="button"
          class="decks-seg-btn"
          class:is-active={v.id === view}
          role="tab"
          aria-selected={v.id === view}
          tabindex={v.id === focusView ? 0 : -1}
          title={v.label}
          on:click={() => onView(v.id)}
          on:keydown={onTabKey}
        >
          {v.label}
        </button>
      {/each}
    </div>
  {/if}

  <div
    class="decks-pdf-panel-body"
    role={views.length > 1 ? "tabpanel" : undefined}
    aria-label={views.length > 1 ? viewLabel : undefined}
  >
    <slot />
  </div>
</section>

<style>
  .decks-pdf-panel {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 12px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .decks-pdf-panel-header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    margin-bottom: 8px;
  }
  .decks-pdf-panel-header .clickable-icon {
    flex: 0 0 auto;
  }
  .decks-pdf-panel-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-pdf-select {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
  }
  .decks-pdf-panel-views {
    flex: 0 0 auto;
    margin-bottom: 8px;
  }
  /* Four views share a narrow column, so labels shrink and clip rather than overflow. */
  .decks-pdf-panel-views .decks-seg-btn {
    min-width: 0;
    padding: 4px 6px;
    font-size: var(--font-ui-smaller);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-pdf-panel-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
