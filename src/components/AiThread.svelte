<script lang="ts">
  // The session thread: prompts and the rounds they produced, oldest first.
  // Append-only.
  import { I18n, isKeptOverFlag, supersededIds } from "@decks/core";
  import StagedCardRow from "./StagedCardRow.svelte";
  import BatchCardRow from "./BatchCardRow.svelte";
  import type { GenRow } from "./ai-generator-types";
  import type { FixAction, ThreadBlock } from "@decks/core";
  import type { GeneratedCard } from "@decks/core";

  export let blocks: ThreadBlock[] = [];
  export let rows: GenRow[] = [];
  export let isQuestion = false;
  /** Show only the rounds and cards that need attention. */
  export let flaggedOnly = false;
  /** Rows whose rubric pass did not run. */
  export let unchecked: Set<string> = new Set();
  export let selectedId: string | null = null;
  export let partial: GeneratedCard | null = null;
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  export let resolveCardPage: (
    card: GeneratedCard,
  ) => { page: number; pdfHash: string } | null = () => null;
  export let canJumpTo: (s: { pdfHash: string } | null) => boolean = () => false;
  export let onJump: (s: { page: number; pdfHash: string }) => void = () => {};
  export let onSelect: (id: string) => void = () => {};
  export let onFix: (row: GenRow, action?: FixAction) => void = () => {};
  export let onUndo: (row: GenRow) => void = () => {};
  export let onKeepAll: (blockId: string) => void = () => {};
  export let onDiscardAll: (blockId: string) => void = () => {};
  /** The round whose discard can still be undone, and how many it discarded. */
  export let undoable: { blockId: string; count: number } | null = null;
  export let onUndoDiscard: () => void = () => {};
  /** Turn an answer into a staged card. Absent when chat is unavailable. */
  export let onAnswerToCard: (blockId: string) => void = () => {};
  /** Aim a round at the gaps an answer named. */
  export let onAnswerGaps: (
    gaps: Array<{ term: string; page: number | null }>,
  ) => void = () => {};
  export let onJumpPage: (page: number) => void = () => {};
  export let canJumpPage = false;
  export let onToggleKeep: (id: string) => void = () => {};
  /** The round still streaming, whose rows are drawn dimmed. */
  export let streamingBlockId: string | null = null;

  const g = I18n.t.modals.aiGenerator;

  $: byId = new Map(rows.map((r) => [r.id, r]));
  // A fixed card's dropped original collapses behind its first replacement.
  $: firstChild = rows.reduce((acc, r) => {
    if (r.parentId && !acc.has(r.parentId)) acc.set(r.parentId, r.id);
    return acc;
  }, new Map<string, string>());
  let openOriginals: Record<string, boolean> = {};
  // Blocks superseded by a later refinement collapse; the set is derived rather
  // than stored so a block cannot be marked collapsed and then orphaned.
  $: superseded = supersededIds(blocks);

  let expanded: Record<string, boolean> = {};

  /** A round's card count for its header, singular for one. */
  function roundCount(count: number, replacing: boolean): string {
    if (replacing) return count === 1 ? g.threadReplacementsOne : I18n.format(g.threadReplacements, { count });
    if (isQuestion) return count === 1 ? g.threadQuestionsOne : I18n.format(g.threadQuestions, { count });
    return count === 1 ? g.threadCardsOne : I18n.format(g.threadCards, { count });
  }

  function blockRows(block: ThreadBlock, only = false): GenRow[] {
    if (block.kind !== "result") return [];
    const rows = block.rowIds
      .map((id) => byId.get(id))
      .filter((r): r is GenRow => r !== undefined);
    if (!only) return rows;
    if (superseded.has(block.id)) return [];
    return rows.filter((r) => needsAttention(r));
  }

  function needsAttention(r: GenRow): boolean {
    return r.keep && !r.saved && (r.verdict?.verdict === "flagged" || Boolean(r.invalid));
  }

  /** Under the filter, a prompt shows only when its round still has something to show. */
  function promptShown(at: number, only: boolean): boolean {
    if (!only) return true;
    const next = blocks.slice(at + 1).find((b) => b.kind !== "prompt");
    return next?.kind === "result" && blockRows(next, true).length > 0;
  }

  /** The page span a round drew on, for the block header. */
  function pageSpan(items: GenRow[]): string {
    const pages = items
      .map((r) => resolveCardPage(r.card)?.page)
      .filter((p): p is number => typeof p === "number");
    if (pages.length === 0) return "";
    const min = Math.min(...pages);
    const max = Math.max(...pages);
    return min === max
      ? I18n.format(g.pageChip, { page: min })
      : I18n.format(g.hub.pages, { range: `${min}–${max}` });
  }

  function rubricScore(items: GenRow[]): { passed: number; judged: number } {
    const judged = items.filter((r) => r.verdict);
    // A card kept over its flag was not passed by the rubric, only by the user.
    return {
      passed: judged.filter((r) => r.verdict?.verdict === "pass" && !isKeptOverFlag(r.verdict)).length,
      judged: judged.length,
    };
  }
</script>

<div class="decks-ai-thread">
  {#each blocks as block, at (block.id)}
    {#if block.kind === "prompt"}
      {#if promptShown(at, flaggedOnly)}
        <div class="decks-ai-turn">{block.text}</div>
      {/if}
    {:else if block.kind === "answer"}
      <div class="decks-ai-answer" hidden={flaggedOnly}>
        <div class="decks-ai-answer-body">{block.text}</div>
        {#if block.gaps.length > 0}
          <ul class="decks-ai-answer-gaps">
            {#each block.gaps as gap, i (i)}
              <li>
                <span class="decks-ai-answer-gap-term">{gap.term}</span>
                {#if gap.page}
                  <span class="decks-ai-answer-page"
                    >{I18n.format(g.pageChip, { page: gap.page })}</span
                  >
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        <div class="decks-ai-answer-foot">
          {#each block.pages as page (page)}
            <button
              type="button"
              class="decks-ai-answer-page is-jump"
              disabled={!canJumpPage}
              on:click={() => onJumpPage(page)}
            >
              {I18n.format(g.pageChip, { page })}
            </button>
          {/each}
          <span class="decks-ai-answer-spacer"></span>
          {#if block.gaps.length > 0}
            <button type="button" on:click={() => onAnswerGaps(block.gaps)}>
              {block.gaps.length === 1
                ? g.chat.generateGapsOne
                : I18n.format(g.chat.generateGaps, { count: block.gaps.length })}
            </button>
          {/if}
          {#if block.cardRowId}
            <span class="decks-ai-answer-made">{g.chat.madeCard}</span>
          {:else if block.text && !isQuestion}
            <!-- An answer is a front and a back; it is no multiple-choice question. -->
            <button type="button" on:click={() => onAnswerToCard(block.id)}>
              {g.chat.makeCard}
            </button>
          {/if}
        </div>
      </div>
    {:else}
      {@const items = blockRows(block, flaggedOnly)}
      {@const collapsed = superseded.has(block.id) && !expanded[block.id]}
      {@const span = pageSpan(items)}
      {@const score = rubricScore(items)}
      {#if items.length > 0}
        <div class="decks-ai-block" class:is-collapsed={collapsed}>
          <div class="decks-ai-block-head">
            <span class="decks-ai-block-title">
              {roundCount(items.length, !!block.replacesId)}
              {#if span}· {span}{/if}
            </span>
            {#if score.judged > 0}
              <span class="decks-ai-block-rubric"
                >{I18n.format(g.threadRubric, {
                  passed: score.passed,
                  total: score.judged,
                })}</span
              >
            {:else if items.some((r) => unchecked.has(r.id))}
              <span class="decks-ai-block-rubric" title={g.threadUncheckedHint}
                >{g.threadUnchecked}</span
              >
            {/if}
            {#if superseded.has(block.id)}
              <button
                type="button"
                class="decks-ai-block-toggle"
                on:click={() => (expanded = { ...expanded, [block.id]: collapsed })}
                >{collapsed ? g.threadShowOriginals : g.threadHideOriginals}</button
              >
            {:else if undoable?.blockId === block.id}
              <span class="decks-ai-block-rubric"
                >{I18n.format(g.threadDiscarded, { count: undoable.count })}</span
              >
              <button type="button" on:click={onUndoDiscard}>{g.threadUndoDiscard}</button>
            {:else if items.some((r) => !r.saved)}
              <button
                type="button"
                disabled={!items.some((r) => !r.keep && !r.saved)}
                on:click={() => onKeepAll(block.id)}>{g.threadKeepAll}</button
              >
              <button
                type="button"
                disabled={!items.some((r) => r.keep && !r.saved)}
                on:click={() => onDiscardAll(block.id)}>{g.threadDiscardAll}</button
              >
            {/if}
          </div>
          {#if !collapsed}
            <div class="decks-ai-block-rows">
              {#each items as row (row.id)}
                {@const parent = row.parentId ? byId.get(row.parentId) : undefined}
                {@const collapsible = !!parent && !parent.keep && !parent.saved && firstChild.get(parent.id) === row.id}
                {#if !(firstChild.has(row.id) && !row.keep && !row.saved && !openOriginals[row.id])}
                  <StagedCardRow
                    {row}
                    {isQuestion}
                    selected={row.id === selectedId}
                    streaming={block.id === streamingBlockId}
                    {renderMarkdown}
                    source={resolveCardPage(row.card)}
                    canJump={canJumpTo(resolveCardPage(row.card))}
                    onSelect={() => onSelect(row.id)}
                    onToggleKeep={() => onToggleKeep(row.id)}
                    onJump={() => {
                      const s = resolveCardPage(row.card);
                      if (s) onJump(s);
                    }}
                    onFix={(action) => onFix(row, action)}
                    onUndo={() => onUndo(row)}
                    originalToggle={collapsible && parent
                      ? openOriginals[parent.id]
                        ? "hide"
                        : "show"
                      : null}
                    onToggleOriginal={() => {
                      if (parent) openOriginals = { ...openOriginals, [parent.id]: !openOriginals[parent.id] };
                    }}
                  />
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  {/each}

  {#if partial}
    <div class="decks-ai-block">
      <div class="decks-ai-gen-rowwrap is-streaming">
        <BatchCardRow card={partial} status="running" {renderMarkdown} />
      </div>
    </div>
  {/if}

  <slot />
</div>

<style>
  .decks-ai-thread {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
  }

  /* What the user asked, as their own turn — right-aligned and accent-tinted so
     the thread reads as a conversation rather than a log. */
  .decks-ai-turn {
    align-self: flex-end;
    max-width: 60%;
    padding: 6px 10px;
    border-radius: 8px 8px 3px 8px;
    background: hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.16);
    border: 1px solid
      hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.32);
    color: var(--text-normal);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* An answer is a result like a round: the same card, holding prose and citations. */
  .decks-ai-answer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 7px 8px;
    border-radius: var(--radius-m);
    background: var(--background-primary-alt);
    border: 1px solid var(--background-modifier-border);
    font-size: 12px;
  }
  .decks-ai-answer-body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .decks-ai-answer-gaps {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .decks-ai-answer-gap-term {
    margin-right: 5px;
  }
  .decks-ai-answer-foot {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .decks-ai-answer-spacer {
    flex: 1 1 auto;
  }
  .decks-ai-answer-page {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }
  .decks-ai-answer-page.is-jump {
    border: none;
    box-shadow: none;
    height: auto;
    cursor: pointer;
  }
  .decks-ai-answer-page.is-jump:disabled {
    cursor: default;
  }
  .decks-ai-answer-foot button:not(.is-jump) {
    font-size: 10px;
    padding: 2px 8px;
    height: auto;
  }
  .decks-ai-answer-made {
    font-size: 10px;
    color: var(--text-success);
  }

  .decks-ai-block {
    background: var(--background-primary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    padding: 7px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .decks-ai-block.is-collapsed {
    opacity: 0.7;
  }
  .decks-ai-block-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .decks-ai-block-title {
    flex: 1 1 auto;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .decks-ai-block-rubric {
    font-size: 10px;
    padding: 1px 6px 2px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-success-hover, transparent);
    color: var(--color-green, var(--text-success));
  }
  .decks-ai-block-head button {
    font-size: 10px;
    padding: 2px 8px;
    height: auto;
  }
  .decks-ai-block-toggle {
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
  }
  .decks-ai-block-rows {
    display: flex;
    flex-direction: column;
  }
  .decks-ai-gen-rowwrap.is-streaming {
    opacity: 0.8;
  }
</style>
