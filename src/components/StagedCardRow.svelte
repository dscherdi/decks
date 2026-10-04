<script lang="ts">
  // One staged card, used by both the thread and the staged panel, so the two
  // cannot drift.
  import { I18n, INVALID_QUESTION_FIXES, checkCardFormat, checkGeneratedMcq, fixActionFor, type FixAction } from "@decks/core";
  import BatchCardRow from "./BatchCardRow.svelte";
  import type { GenRow } from "./ai-generator-types";

  export let row: GenRow;
  export let selected = false;
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  /** Where the card came from, or null when the page could not be trusted. */
  export let source: { page: number; pdfHash: string } | null = null;
  export let canJump = false;
  export let onSelect: () => void = () => {};
  export let onJump: () => void = () => {};
  /** The rubric's own fix when no action is named. */
  export let onFix: (action?: FixAction) => void = () => {};
  export let onUndo: () => void = () => {};
  /** Render the card as a question: stem, options, explanation. */
  export let isQuestion = false;
  /** Keep or drop the card; offered on the selected row. */
  export let onToggleKeep: () => void = () => {};
  /** The row's round is still streaming. */
  export let streaming = false;
  /** Show or hide the original this fix replaced, when it is collapsed. */
  export let originalToggle: "show" | "hide" | null = null;
  export let onToggleOriginal: () => void = () => {};

  const g = I18n.t.modals.aiGenerator;

  function fixLabel(fix: FixAction): string {
    if (fix === "add_context" && source) return I18n.format(g.fixAddContextPage, { page: source.page });
    return g.fixLabels[fix];
  }

  function md(node: HTMLElement, content: string) {
    node.empty();
    renderMarkdown(content, node);
    return {
      update(next: string) {
        node.empty();
        renderMarkdown(next, node);
      },
    };
  }

  $: flagged = row.verdict?.verdict === "flagged" && !row.saved;
  $: action = row.verdict
    ? fixActionFor(row.verdict.codes, isQuestion ? "mcq" : "basic")
    : null;
  $: formatIssues = row.saved ? [] : checkCardFormat(row.card);
  // A question renders its options rather than its raw task-list body.
  $: mcq = isQuestion ? checkGeneratedMcq(row.card) : null;
</script>

<div
  class="decks-ai-gen-rowwrap"
  class:is-dropped={!row.keep && !row.saved}
  class:is-saved={row.saved}
  class:is-streaming={streaming}
  class:is-flagged={flagged || (Boolean(row.invalid) && !row.saved) || formatIssues.length > 0}
  data-row-id={row.id}
>
  <BatchCardRow
    card={isQuestion ? { front: row.card.front } : row.card}
    status={row.saved ? "accepted" : row.invalid ? "pending" : row.keep ? "ready" : "empty"}
    {selected}
    expanded={selected}
    {renderMarkdown}
    {onSelect}
  >
    {#if mcq?.valid}
      <ol class="decks-ai-mcq-options">
        {#each mcq.mcq.options as opt, i (i)}
          <li class="decks-ai-mcq-option" class:is-correct={opt.correct}>
            <span class="decks-ai-mcq-box" class:is-checked={opt.correct}></span>
            <span class="decks-ai-mcq-text" use:md={opt.text}></span>
          </li>
        {/each}
      </ol>
      {#if mcq.mcq.explanation}
        <div class="decks-ai-mcq-explanation" use:md={mcq.mcq.explanation}></div>
      {/if}
      <span class="decks-ai-gen-mode-chip"
        >{mcq.mcq.correct.length > 1 ? g.answerMulti : g.answerSingle}</span
      >
    {/if}
    {#if selected && !isQuestion && row.card.notes.trim()}
      <div class="decks-ai-gen-row-notes" use:md={row.card.notes}></div>
    {/if}
    {#if row.invalid}
      <span class="decks-ai-gen-flag-chip"
        >⚠ {g.invalidReasons[row.invalid] ?? row.invalid}</span
      >
      {#if !row.saved}
        {#each INVALID_QUESTION_FIXES as fix (fix)}
          <button
            type="button"
            class="decks-ai-gen-fix"
            disabled={row.fixing}
            on:click|stopPropagation={() => onFix(fix)}
            >{row.fixing ? g.fixApplying : fixLabel(fix)}</button
          >
        {/each}
      {/if}
    {/if}
    {#if flagged && row.verdict}
      {#each row.verdict.codes as code (code)}
        <span class="decks-ai-gen-flag-chip">⚠ {g.rubricCodes[code] ?? code}</span>
      {/each}
      {#if action}
        <button
          type="button"
          class="decks-ai-gen-fix"
          disabled={row.fixing}
          title={row.verdict.fix}
          on:click|stopPropagation={() => onFix()}
          >{row.fixing ? g.fixApplying : fixLabel(action)}</button
        >
      {/if}
    {/if}
    {#if formatIssues.length > 0}
      <span class="decks-ai-gen-flag-chip"
        >⚠ {g.formatChip}: {[...new Set(formatIssues.map((i) => g.formatIssues[i.kind]))].join(", ")}</span
      >
      <button
        type="button"
        class="decks-ai-gen-fix"
        disabled={row.fixing}
        on:click|stopPropagation={() => onFix("fix_format")}
        >{row.fixing ? g.fixApplying : g.fixLabels.fix_format}</button
      >
    {/if}
    {#if row.similarTo?.length && !row.saved}
      <span class="decks-ai-gen-flag-chip decks-ai-gen-similar-chip" title={row.similarTo.join("\n")}
        >{g.similarTo.replace("{front}", row.similarTo[0])}</span
      >
    {/if}
    {#if row.parentId}
      <button
        type="button"
        class="decks-ai-gen-fix"
        on:click|stopPropagation={onUndo}>{g.fixUndo}</button
      >
    {/if}
    {#if originalToggle}
      <button
        type="button"
        class="decks-ai-gen-fix is-quiet"
        on:click|stopPropagation={onToggleOriginal}
        >{originalToggle === "show" ? g.showOriginal : g.hideOriginal}</button
      >
    {/if}
    {#if source}
      {#if canJump}
        <button
          type="button"
          class="decks-ai-gen-page-chip is-linked"
          title={I18n.format(g.pageJump, { page: source.page })}
          on:click|stopPropagation={onJump}
          >{I18n.format(g.pageChip, { page: source.page })}</button
        >
      {:else}
        <span class="decks-ai-gen-page-chip"
          >{I18n.format(g.pageChip, { page: source.page })}</span
        >
      {/if}
    {/if}
    {#if selected && !row.saved}
      <span class="decks-ai-gen-row-spacer"></span>
      <button
        type="button"
        class="decks-ai-gen-fix"
        on:click|stopPropagation={onToggleKeep}>{row.keep ? g.discard : g.keep}</button
      >
    {/if}
  </BatchCardRow>
</div>

<style>
  .decks-ai-gen-rowwrap.is-dropped {
    opacity: 0.45;
  }
  .decks-ai-gen-rowwrap.is-streaming {
    opacity: 0.8;
  }
  .decks-ai-gen-rowwrap.is-saved {
    background: var(--background-modifier-success-hover, transparent);
  }
  /* Warning-tinted, not error-coloured: the card is still saveable, and the
     verdict annotates rather than rejects. */
  .decks-ai-gen-rowwrap.is-flagged {
    background: rgba(var(--callout-warning), 0.08);
    border-radius: 0 var(--radius-m) var(--radius-m) 0;
  }
  /* The row's own 4px slot, so a selected flagged row shows one bar, not two. */
  .decks-ai-gen-rowwrap.is-flagged :global(.decks-batch-row:not(.is-selected)) {
    border-left-color: var(--color-yellow);
  }

  /* Options as the exam surface shows them: a filled box is the correct one. */
  .decks-ai-mcq-options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
  }
  .decks-ai-mcq-option {
    display: flex;
    gap: 7px;
    align-items: center;
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-ai-mcq-option.is-correct {
    color: var(--text-normal);
  }
  .decks-ai-mcq-box {
    flex: 0 0 auto;
    width: 11px;
    height: 11px;
    border-radius: 2px;
    border: 1px solid var(--background-modifier-border-hover);
    box-sizing: border-box;
  }
  .decks-ai-mcq-box.is-checked {
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
  }
  .decks-ai-mcq-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* Options and the explanation render as Markdown, so math shows; keep them on their line. */
  .decks-ai-mcq-text :global(p),
  .decks-ai-mcq-explanation :global(p) {
    margin: 0;
  }
  .decks-ai-mcq-explanation {
    font-size: 11px;
    font-style: italic;
    color: var(--text-faint);
  }

  .decks-ai-gen-flag-chip {
    font-size: 10px;
    line-height: 1.4;
    padding: 1px 6px 2px;
    border-radius: var(--radius-s);
    border: 1px solid rgba(var(--callout-warning), 0.35);
    color: var(--color-yellow);
    background: rgba(var(--callout-warning), 0.1);
    white-space: nowrap;
  }
  .decks-ai-gen-mode-chip {
    font-size: 10px;
    line-height: 1.4;
    padding: 1px 6px 2px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .decks-ai-gen-row-notes {
    width: 100%;
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-ai-gen-row-notes :global(p) {
    margin: 0;
  }
  .decks-ai-gen-row-spacer {
    flex: 1 1 auto;
  }
  /* Advisory, not a fault: muted, and cut short so a long front cannot widen the row. */
  .decks-ai-gen-similar-chip {
    border-color: var(--background-modifier-border);
    color: var(--text-muted);
    max-width: 24em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .decks-ai-gen-fix {
    font-size: 10px;
    padding: 2px 8px;
    height: auto;
    cursor: pointer;
  }
  .decks-ai-gen-fix.is-quiet {
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
  }
  .decks-ai-gen-fix:disabled {
    cursor: default;
    opacity: 0.6;
  }

  /* Muted, not faint: this is a data value, and faint fails contrast at 10px. */
  .decks-ai-gen-page-chip {
    font-family: var(--font-monospace);
    font-size: 10px;
    line-height: 1.4;
    padding: 1px 5px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    border: none;
    box-shadow: none;
    height: auto;
    white-space: nowrap;
  }
  button.decks-ai-gen-page-chip.is-linked {
    cursor: pointer;
  }
  button.decks-ai-gen-page-chip.is-linked:hover {
    color: var(--text-accent);
    background: var(--background-modifier-hover);
  }
</style>
