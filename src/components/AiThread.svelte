<script lang="ts">
  // The session thread: prompts and the rounds they produced, oldest first.
  // Append-only.
  import { I18n, roundSummary, supersededIds } from "@decks/core";
  import BatchCardRow from "./BatchCardRow.svelte";
  import AiRoundPreview from "./AiRoundPreview.svelte";
  import type { GenRow } from "./ai-generator-types";
  import type { ThreadBlock } from "@decks/core";
  import type { GeneratedCard } from "@decks/core";

  export let blocks: ThreadBlock[] = [];
  export let rows: GenRow[] = [];
  export let isQuestion = false;
  /** Rows whose rubric pass did not run. */
  export let unchecked: Set<string> = new Set();
  export let partial: GeneratedCard | null = null;
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  export let resolveCardPage: (
    card: GeneratedCard,
  ) => { page: number; pdfHash: string } | null = () => null;
  /** Show a round's cards in the side panel. */
  export let onOpenRound: (blockId: string) => void = () => {};
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
  /** The round still streaming, whose preview says so. */
  export let streamingBlockId: string | null = null;

  const g = I18n.t.modals.aiGenerator;

  $: byId = new Map(rows.map((r) => [r.id, r]));
  // Rounds a later refinement replaced show faded; derived, so one cannot be orphaned.
  $: superseded = supersededIds(blocks);

  /** A round's card count for its header, singular for one. */
  function roundCount(count: number, replacing: boolean): string {
    if (replacing) return count === 1 ? g.threadReplacementsOne : I18n.format(g.threadReplacements, { count });
    if (isQuestion) return count === 1 ? g.threadQuestionsOne : I18n.format(g.threadQuestions, { count });
    return count === 1 ? g.threadCardsOne : I18n.format(g.threadCards, { count });
  }

  function blockRows(block: ThreadBlock): GenRow[] {
    if (block.kind !== "result") return [];
    return block.rowIds.map((id) => byId.get(id)).filter((r): r is GenRow => r !== undefined);
  }

  /** A front as one line of plain text, for the preview. */
  function plainLine(text: string): string {
    return text.replace(/[*_`#>]|==/g, "").replace(/\s+/g, " ").trim();
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
</script>

<div class="decks-ai-thread">
  {#each blocks as block (block.id)}
    {#if block.kind === "prompt"}
      <div class="decks-ai-turn">{block.text}</div>
    {:else if block.kind === "answer"}
      <div class="decks-ai-answer">
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
      {@const items = blockRows(block)}
      {@const running = streamingBlockId === block.id}
      {#if items.length > 0 || running}
        <AiRoundPreview
          title={running && items.length === 0 ? g.generating : roundCount(items.length, !!block.replacesId)}
          span={pageSpan(items)}
          summary={roundSummary(items)}
          fronts={items.slice(0, 2).map((r) => plainLine(r.card.front))}
          old={superseded.has(block.id)}
          unchecked={items.some((r) => unchecked.has(r.id))}
          {running}
          undoable={undoable?.blockId === block.id ? { count: undoable.count } : null}
          onOpen={() => onOpenRound(block.id)}
          onKeepAll={() => onKeepAll(block.id)}
          onDiscardAll={() => onDiscardAll(block.id)}
          onUndo={onUndoDiscard}
        />
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
  .decks-ai-gen-rowwrap.is-streaming {
    opacity: 0.8;
  }
</style>
