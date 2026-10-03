<script lang="ts">
  // The workbench hub: every session's pile and one triage queue across them.
  // Presentational; data and actions come from the parent.
  import { onMount } from "svelte";
  import { setIcon } from "obsidian";
  import {
    I18n,
    flagTally,
    hubTotals,
    keepRate,
    relativeAge,
    sessionName,
    type AiModelOption,
    type AiSession,
    type AiStagedCard,
    type RelativeUnit,
    type SessionCounts,
  } from "@decks/core";
  import type { AiWorkbenchData, AiWorkbenchGap, TriageAction } from "./ai-workbench-types";

  export let sessions: AiSession[] = [];
  export let counts: Record<string, SessionCounts> = {};
  export let flagged: AiStagedCard[] = [];
  export let outcome: { saved: number; discarded: number } = {
    saved: 0,
    discarded: 0,
  };
  /** The session the generator leaf is showing, tinted in the table. */
  export let activeSessionId: string | null = null;
  export let gap: AiWorkbenchGap | null = null;
  export let modelOptions: AiModelOption[] = [];
  export let model = "";
  export let onOpenSession: (id: string) => void = () => {};
  export let onNewSession: () => void = () => {};
  export let onSetArchived: (id: string, archived: boolean) => void = () => {};
  export let onTriage: (card: AiStagedCard, action: TriageAction) => void = () => {};
  export let onGenerateGap: (gap: AiWorkbenchGap) => void = () => {};
  export let onSetModel: (id: string) => void = () => {};

  /** New data without remounting, so an open triage queue stays open. */
  export function setData(data: AiWorkbenchData): void {
    sessions = data.sessions;
    counts = data.counts;
    flagged = data.flagged;
    outcome = data.outcome;
    activeSessionId = data.activeSessionId;
    gap = data.gap;
    modelOptions = data.model?.options ?? [];
    model = data.model?.selected ?? "";
  }

  /** Act on a queued card at once; the parent re-reads the hub after. */
  function triage(card: AiStagedCard, action: TriageAction): void {
    if (action !== "fix") flagged = flagged.filter((c) => c.id !== card.id);
    onTriage(card, action);
  }
  const g = I18n.t.modals.aiGenerator;
  const h = g.hub;

  // A disclosure rather than its own surface: a separate view would put the
  // flagged cards back behind navigation.
  let showTriage = false;

  // A phone has no room for six columns. Driven by the component's own width,
  // never the window's — the hub is a leaf and can be split.
  const NARROW_PX = 620;
  let narrow = false;
  let rootEl: HTMLElement;
  let resizeObserver: ResizeObserver | null = null;

  const emptyCounts: SessionCounts = { staged: 0, flagged: 0, saved: 0 };
  const countsFor = (id: string): SessionCounts => counts[id] ?? emptyCounts;

  // Totals cover the live sessions only — an archived pile is not work waiting.
  $: live = sessions.filter((s) => !s.archived);
  $: totals = hubTotals(live.map((s) => countsFor(s.id)));
  $: tally = flagTally(flagged);
  $: sessionById = new Map(sessions.map((s) => [s.id, s]));
  // Grouped by session so the queue reads as "this source needs work", which is
  // how the fix is actually applied — one session at a time.
  $: triageGroups = [
    ...new Map(flagged.map((c) => [c.sessionId, [] as AiStagedCard[]])),
  ].map(([id]) => ({
    session: sessionById.get(id) ?? null,
    cards: flagged.filter((c) => c.sessionId === id),
  }));
  $: rate = keepRate(outcome.saved, outcome.discarded);

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return {
      update(next: string) {
        node.empty();
        setIcon(node, next);
      },
    };
  }

  const AGE_KEY: Record<RelativeUnit, string> = {
    now: h.ageNow,
    minute: h.ageMinute,
    hour: h.ageHour,
    day: h.ageDay,
    week: h.ageWeek,
  };

  function age(iso: string): string {
    const { unit, count } = relativeAge(iso);
    return I18n.format(AGE_KEY[unit], { count });
  }

  /** The file's own name — the path is the tooltip, not the label. */
  function sourceName(session: AiSession): string {
    return sessionName(session) ?? "—";
  }

  /** What was drawn from the source: the pages its cards cite, else the chapters chosen. */
  function sourceDetail(session: AiSession, c: SessionCounts): string {
    if (c.firstPage && c.lastPage) {
      return c.firstPage === c.lastPage
        ? I18n.format(g.pageChip, { page: c.firstPage })
        : I18n.format(h.pages, { range: `${c.firstPage}–${c.lastPage}` });
    }
    if (session.sourceKind === "pdf" && session.selectedIds.length > 0) {
      return I18n.format(h.chapters, { count: session.selectedIds.length });
    }
    return "";
  }

  function sourceIcon(session: AiSession): string {
    return session.sourceKind === "pdf" ? "book-open" : "file-text";
  }

  let mounted = false;
  onMount(() => {
    mounted = true;
    narrow = rootEl.clientWidth <= NARROW_PX;
    resizeObserver = new ResizeObserver((entries) => {
      narrow = entries[0].contentRect.width <= NARROW_PX;
    });
    resizeObserver.observe(rootEl);
    return () => resizeObserver?.disconnect();
  });
</script>

<div class="decks-aiw-hub" bind:this={rootEl}>
  <div class="decks-aiw-title-row" class:is-narrow={narrow}>
    <h2 class="decks-aiw-title">{h.title}</h2>
    <span class="decks-aiw-subtitle"
      >{I18n.format(totals.sessions === 1 ? h.subtitleOne : h.subtitle, {
        staged: totals.staged,
        sessions: totals.sessions,
      })}</span
    >
    <span class="decks-aiw-spacer"></span>
    {#if modelOptions.length > 1}
      <select
        class="decks-aiw-model"
        aria-label={I18n.t.modals.editFlashcard.aiModel}
        value={model}
        on:change={(e) => {
          model = e.currentTarget.value;
          onSetModel(model);
        }}
      >
        {#each modelOptions as opt (opt.id)}
          <option value={opt.id}>{opt.name}</option>
        {/each}
      </select>
    {/if}
    {#if !narrow}
      <button type="button" class="mod-cta" on:click={onNewSession}
        >{h.newSession}</button
      >
    {/if}
  </div>

  {#if totals.flagged > 0}
    <div class="decks-aiw-callout">
      <div class="decks-aiw-callout-head">
        <span class="decks-aiw-callout-title">⚠ {h.needsAttention}</span>
        <span class="decks-aiw-callout-text"
          >{I18n.format(
            totals.flagged === 1 ? h.failedRubricOne : h.failedRubric,
            { count: totals.flagged }
          )}</span
        >
        <button type="button" on:click={() => (showTriage = !showTriage)}
          >{h.triageAll}
          {showTriage ? "▴" : "▾"}</button
        >
      </div>
      {#if tally.length > 0}
        <div class="decks-aiw-callout-chips">
          {#each tally as item (item.code)}
            <span class="decks-aiw-code-chip"
              >{g.rubricCodes[item.code] ?? item.code}
              <b>{item.count}</b></span
            >
          {/each}
        </div>
      {/if}
      {#if showTriage}
        <div class="decks-aiw-triage">
          {#each triageGroups as group (group.session?.id ?? "unknown")}
            <div class="decks-aiw-triage-group">
              <div class="decks-aiw-triage-head">
                <span class="decks-aiw-triage-source"
                  >{group.session ? sourceName(group.session) : "—"}</span
                >
                {#if group.session}
                  {@const target = group.session.id}
                  <button type="button" on:click={() => onOpenSession(target)}
                    >{h.resume}</button
                  >
                {/if}
              </div>
              {#each group.cards as card (card.id)}
                <div class="decks-aiw-triage-card">
                  <span class="decks-aiw-triage-front" title={card.front}>{card.front}</span>
                  {#each card.rubricCodes as code (code)}
                    <span class="decks-aiw-flag-chip"
                      >⚠ {g.rubricCodes[code] ?? code}</span
                    >
                  {/each}
                  {#if card.sourcePage}
                    <span class="decks-aiw-triage-page"
                      >{I18n.format(g.pageChip, {
                        page: card.sourcePage,
                      })}</span
                    >
                  {/if}
                  <span class="decks-aiw-triage-acts">
                    <button
                      type="button"
                      class="clickable-icon"
                      aria-label={g.keep}
                      title={g.keep}
                      use:icon={"check"}
                      on:click={() => triage(card, "keep")}
                    ></button>
                    <button
                      type="button"
                      class="clickable-icon"
                      aria-label={g.discard}
                      title={g.discard}
                      use:icon={"x"}
                      on:click={() => triage(card, "discard")}
                    ></button>
                    <button
                      type="button"
                      class="clickable-icon"
                      aria-label={h.fixInSession}
                      title={h.fixInSession}
                      use:icon={"wrench"}
                      on:click={() => triage(card, "fix")}
                    ></button>
                  </span>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if sessions.length === 0}
    <div class="decks-aiw-empty">{h.empty}</div>
  {:else if narrow}
    <div class="decks-aiw-list">
      {#each sessions as session (session.id)}
        {@const c = countsFor(session.id)}
        <div
          class="decks-aiw-item"
          class:is-archived={session.archived}
          class:is-active={session.id === activeSessionId}
        >
          <button
            type="button"
            class="decks-aiw-item-open"
            on:click={() =>
              session.archived
                ? onSetArchived(session.id, false)
                : onOpenSession(session.id)}
          >
            <span class="decks-aiw-item-top">
              <span
                class="decks-aiw-row-icon"
                use:icon={sourceIcon(session)}
                aria-hidden="true"
              ></span>
              <span class="decks-aiw-row-name">{sourceName(session)}</span>
            </span>
            <span class="decks-aiw-item-meta">
              {#if session.archived}
                {h.archived}
              {:else}
                {I18n.format(h.rowStaged, { count: c.staged })}
              {/if}
              {#if c.flagged > 0}
                <span class="decks-aiw-item-warn"
                  >· {I18n.format(g.stagedFlagged, { count: c.flagged })}</span
                >
              {/if}
              · {age(session.touchedAt)}
            </span>
          </button>
          {#if !session.archived}
            <button
              type="button"
              class="clickable-icon decks-aiw-archive"
              aria-label={h.archive}
              title={h.archive}
              use:icon={"archive"}
              on:click={() => onSetArchived(session.id, true)}
            ></button>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="decks-aiw-table">
      <div class="decks-aiw-head">
        <span class="decks-aiw-col-source">{h.colSession}</span>
        <span class="decks-aiw-col-n">{h.colStaged}</span>
        <span class="decks-aiw-col-n">{h.colFlagged}</span>
        <span class="decks-aiw-col-n">{h.colSaved}</span>
        <span class="decks-aiw-col-touched">{h.colTouched}</span>
        <span class="decks-aiw-col-action"></span>
      </div>
      {#each sessions as session (session.id)}
        {@const c = countsFor(session.id)}
        <div
          class="decks-aiw-row"
          class:is-archived={session.archived}
          class:is-active={session.id === activeSessionId}
        >
          <span class="decks-aiw-col-source" title={session.sourceRef}>
            <span
              class="decks-aiw-row-icon"
              use:icon={sourceIcon(session)}
              aria-hidden="true"
            ></span>
            <span class="decks-aiw-row-name">{sourceName(session)}</span>
            {#if sourceDetail(session, c)}
              <span class="decks-aiw-row-detail">· {sourceDetail(session, c)}</span
              >
            {/if}
          </span>
          <span class="decks-aiw-col-n">{c.staged}</span>
          <span class="decks-aiw-col-n" class:is-warn={c.flagged > 0}
            >{c.flagged}</span
          >
          <span class="decks-aiw-col-n">{c.saved}</span>
          <span class="decks-aiw-col-touched">{age(session.touchedAt)}</span>
          <span class="decks-aiw-col-action">
            {#if session.archived}
              <span class="decks-aiw-archived-chip">{h.archived}</span>
              <button
                type="button"
                class="clickable-icon decks-aiw-archive"
                aria-label={h.unarchive}
                title={h.unarchive}
                use:icon={"archive-restore"}
                on:click={() => onSetArchived(session.id, false)}
              ></button>
            {:else}
              <button type="button" on:click={() => onOpenSession(session.id)}
                >{h.resume}</button
              >
              <button
                type="button"
                class="clickable-icon decks-aiw-archive"
                aria-label={h.archive}
                title={h.archive}
                use:icon={"archive"}
                on:click={() => onSetArchived(session.id, true)}
              ></button>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="decks-aiw-footer">
    <div class="decks-aiw-card">
      <div class="decks-aiw-card-title">{h.thisWeek}</div>
      <div class="decks-aiw-figures">
        <div class="decks-aiw-figure">
          <span class="decks-aiw-figure-n">{outcome.saved}</span>
          <span class="decks-aiw-figure-label">{h.savedLabel}</span>
        </div>
        <div class="decks-aiw-figure">
          <span class="decks-aiw-figure-n">{outcome.discarded}</span>
          <span class="decks-aiw-figure-label">{h.discardedLabel}</span>
        </div>
      </div>
      <div class="decks-aiw-card-note">
        {rate === null ? h.noDecisions : I18n.format(h.keepRate, { rate })}
      </div>
    </div>
    {#if gap && gap.concepts.length > 0}
      {@const current = gap}
      <div class="decks-aiw-card decks-aiw-gap">
        <div class="decks-aiw-card-title">{h.gapTitle}</div>
        <div class="decks-aiw-card-note">
          {I18n.format(current.concepts.length === 1 ? h.gapSentenceOne : h.gapSentence, {
            count: current.concepts.length,
            source: current.source,
          })}
        </div>
        <button type="button" class="decks-aiw-gap-go" on:click={() => onGenerateGap(current)}
          >{h.gapGenerate}</button
        >
      </div>
    {/if}
  </div>

  {#if narrow}
    <button type="button" class="mod-cta decks-aiw-new-pinned" on:click={onNewSession}
      >{h.newSession}</button
    >
  {/if}
</div>

<style>
  .decks-aiw-hub {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 15px 17px;
    box-sizing: border-box;
  }

  .decks-aiw-title-row {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }
  /* Narrow: the title keeps its line and the subtitle moves under it, rather
     than three things fighting over one row. */
  .decks-aiw-title-row.is-narrow {
    flex-wrap: wrap;
  }
  .decks-aiw-title-row.is-narrow .decks-aiw-title {
    flex: 1 1 auto;
    font-size: 17px;
    white-space: nowrap;
  }
  .decks-aiw-title-row.is-narrow .decks-aiw-subtitle {
    order: 3;
    flex: 1 0 100%;
  }
  .decks-aiw-title-row.is-narrow .decks-aiw-spacer {
    display: none;
  }
  .decks-aiw-title {
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-normal);
    margin: 0;
  }
  /* Faint is legible here because it is an uppercase label, not a data value. */
  .decks-aiw-subtitle {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .decks-aiw-spacer {
    flex: 1 1 auto;
  }

  /* Obsidian's callout treatment, without the left accent bar: the bar reads as
     a quote, and this is a summary of work waiting. */
  .decks-aiw-callout {
    background: rgba(var(--callout-warning), 0.08);
    border: 1px solid rgba(var(--callout-warning), 0.2);
    border-radius: var(--radius-m);
    padding: 9px 11px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .decks-aiw-callout-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .decks-aiw-callout-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-yellow);
  }
  .decks-aiw-callout-text {
    flex: 1 1 auto;
    font-size: 11px;
    color: var(--text-muted);
  }
  .decks-aiw-callout-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .decks-aiw-code-chip {
    font-size: 10px;
    padding: 1px 6px 2px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-hover);
    color: var(--text-muted);
  }
  .decks-aiw-code-chip b {
    color: var(--text-normal);
  }

  .decks-aiw-triage {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid rgba(var(--callout-warning), 0.2);
  }
  .decks-aiw-triage-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .decks-aiw-triage-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .decks-aiw-triage-source {
    flex: 1 1 auto;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-aiw-triage-head button {
    font-size: 10px;
    padding: 1px 7px;
  }
  .decks-aiw-triage-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 8px;
  }
  .decks-aiw-triage-front {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-aiw-flag-chip {
    flex: 0 0 auto;
    font-size: 10px;
    padding: 1px 6px 2px;
    border-radius: var(--radius-s);
    border: 1px solid rgba(var(--callout-warning), 0.35);
    background: rgba(var(--callout-warning), 0.1);
    color: var(--color-yellow);
  }
  .decks-aiw-triage-acts {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 1px;
  }
  .decks-aiw-triage-acts .clickable-icon {
    padding: 3px;
  }
  .decks-aiw-triage-page {
    flex: 0 0 auto;
    font-family: var(--font-monospace);
    font-size: 10px;
    color: var(--text-muted);
  }

  .decks-aiw-table {
    display: flex;
    flex-direction: column;
  }
  .decks-aiw-head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 7px 6px;
    border-bottom: 1px solid var(--background-modifier-border);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .decks-aiw-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 7px;
    border-bottom: 1px solid var(--background-modifier-border);
    font-size: 12px;
  }
  .decks-aiw-row.is-archived {
    opacity: 0.55;
  }
  .decks-aiw-row.is-active,
  .decks-aiw-item.is-active {
    background: var(--background-modifier-hover);
  }
  .decks-aiw-archived-chip {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-hover);
    color: var(--text-muted);
  }

  .decks-aiw-col-source {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .decks-aiw-row-icon {
    flex: 0 0 auto;
    display: inline-flex;
    color: var(--text-muted);
  }
  .decks-aiw-row-icon :global(svg) {
    width: 14px;
    height: 14px;
  }
  .decks-aiw-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-normal);
  }
  .decks-aiw-row-detail {
    flex: 0 0 auto;
    color: var(--text-muted);
  }

  /* Every data value is muted, never faint: faint is ~3:1 at this size. */
  .decks-aiw-col-n {
    flex: 0 0 56px;
    text-align: right;
    color: var(--text-muted);
  }
  /* Staged 52, flagged 56, saved 46, as the design sizes them. */
  .decks-aiw-col-n:nth-child(2) {
    flex-basis: 52px;
  }
  .decks-aiw-col-n:nth-child(4) {
    flex-basis: 46px;
  }
  .decks-aiw-col-n.is-warn {
    color: var(--color-yellow);
  }
  .decks-aiw-col-touched {
    flex: 0 0 66px;
    text-align: right;
    color: var(--text-muted);
  }
  .decks-aiw-col-action {
    flex: 0 0 104px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }
  .decks-aiw-col-action .decks-aiw-archive,
  .decks-aiw-item .decks-aiw-archive {
    padding: 4px;
  }
  .decks-aiw-col-action button {
    font-size: 11px;
    padding: 2px 8px;
  }
  .decks-aiw-link {
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
  }

  /* One line per session, for a pane too narrow to carry six columns. */
  .decks-aiw-list {
    display: flex;
    flex-direction: column;
  }
  .decks-aiw-item {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .decks-aiw-item-open {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 9px 7px;
    height: auto;
    text-align: left;
    background: transparent;
    box-shadow: none;
    border: none;
    border-radius: 0;
    cursor: pointer;
  }
  .decks-aiw-item:hover {
    background: var(--background-modifier-hover);
  }
  .decks-aiw-item.is-archived {
    opacity: 0.55;
  }
  .decks-aiw-item-top {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    font-size: 13px;
  }
  .decks-aiw-item-meta {
    font-size: 11px;
    color: var(--text-muted);
  }
  .decks-aiw-item-warn {
    color: var(--color-yellow);
  }

  .decks-aiw-empty {
    font-size: 12px;
    color: var(--text-muted);
    padding: 18px 7px;
  }

  .decks-aiw-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .decks-aiw-card {
    flex: 1 1 auto;
    background: var(--background-primary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .decks-aiw-card-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .decks-aiw-figures {
    display: flex;
    gap: 18px;
  }
  .decks-aiw-figure {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .decks-aiw-figure-n {
    font-size: 21px;
    font-weight: 600;
    color: var(--text-normal);
  }
  .decks-aiw-figure-label {
    font-size: 11px;
    color: var(--text-muted);
  }
  .decks-aiw-card-note {
    font-size: 11px;
    color: var(--text-muted);
  }
  .decks-aiw-gap {
    flex: 0 0 238px;
  }
  .decks-aiw-gap-go {
    align-self: flex-start;
    font-size: 11px;
    padding: 2px 8px;
    height: auto;
  }
  .decks-aiw-model {
    font-size: 12px;
    padding: 2px 6px;
    max-width: 40%;
  }
  /* A phone's primary action sits where the thumb is. */
  .decks-aiw-new-pinned {
    position: sticky;
    bottom: 0;
    width: 100%;
  }
</style>
