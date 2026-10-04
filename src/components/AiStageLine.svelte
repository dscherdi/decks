<script lang="ts">
  // Where a running round is, and its thinking folded away, so a wait never looks idle.
  import { onDestroy } from "svelte";
  import { I18n, stageLabel, type GenerationStage } from "@decks/core";

  export let stage: GenerationStage | null = null;
  /** When the round started, for the slow hint. */
  export let startedAt = 0;
  export let thinking = "";
  export let onStop: () => void = () => {};

  const g = I18n.t.modals.aiGenerator;
  const SLOW_MS = 45_000;
  let now = Date.now();
  const timer = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(timer));

  let open = false;
  let box: HTMLPreElement | null = null;

  $: label = stageLabel(stage ?? { kind: "sending" }, now);
  // Once cards are arriving the round is moving, however long it has run.
  $: slow = stage?.kind !== "writing" && now - startedAt > SLOW_MS;
  $: if (open && box && thinking) box.scrollTop = box.scrollHeight;
</script>

<div class="decks-ai-stage">
  <div class="decks-ai-stage-line">
    <span class="decks-ai-stage-dot" aria-hidden="true"></span>
    <span class="decks-ai-stage-label">{label}</span>
    {#if thinking}
      <button
        type="button"
        class="decks-ai-stage-toggle"
        aria-expanded={open}
        on:click={() => (open = !open)}>{open ? g.hideThinking : g.showThinking}</button
      >
    {/if}
  </div>
  {#if slow}
    <div class="decks-ai-stage-slow">
      <span>{g.slowHint}</span>
      <button type="button" on:click={onStop}>{g.stop}</button>
    </div>
  {/if}
  {#if open && thinking}
    <pre class="decks-ai-stage-thinking" bind:this={box}>{thinking}</pre>
  {/if}
</div>

<style>
  .decks-ai-stage {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 4px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .decks-ai-stage-line {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .decks-ai-stage-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--interactive-accent);
    animation: decks-ai-stage-pulse 1.2s ease-in-out infinite;
  }

  .decks-ai-stage-label {
    font-variant-numeric: tabular-nums;
  }

  .decks-ai-stage-toggle {
    margin-left: auto;
    padding: 0 6px;
    color: var(--text-accent);
    background: none;
    box-shadow: none;
    font-size: 12px;
  }

  .decks-ai-stage-slow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-left: 16px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .decks-ai-stage-thinking {
    max-height: 220px;
    margin: 0;
    padding: 8px 10px;
    overflow-y: auto;
    color: var(--text-muted);
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    font-family: var(--font-monospace);
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  @keyframes decks-ai-stage-pulse {
    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .decks-ai-stage-dot {
      animation: none;
    }
  }
</style>
