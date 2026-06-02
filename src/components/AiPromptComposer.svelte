<script lang="ts">
  // Reusable chat-style composer for the AI prompt area: an elevated rounded
  // box holding the prompt textarea, attached context as removable pills, and
  // add-context buttons + a send button. Presentational — all data and behavior
  // come from the parent via props/callbacks.
  import { tick } from "svelte";
  import { setIcon } from "obsidian";
  import { I18n } from "@decks/core";

  interface ComposerContext {
    id: string;
    kind: "note" | "image";
    label: string;
  }

  export let prompt = "";
  export let contexts: ComposerContext[] = [];
  export let submitting = false;
  export let submitDisabled = false;
  export let onAddNote: () => void = () => {};
  export let onAddImage: () => void = () => {};
  export let onRemoveContext: (id: string) => void = () => {};
  export let onSubmit: () => void = () => {};

  const t = I18n.t.modals.editFlashcard;

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return {
      update(next: string) {
        setIcon(node, next);
      },
    };
  }

  // Grow the prompt textarea downward to fit its content (no manual handle).
  function autoResize(node: HTMLTextAreaElement, _value: string) {
    const resize = () => {
      node.setCssProps({ height: "auto" });
      node.setCssProps({ height: `${node.scrollHeight}px` });
    };
    void tick().then(resize);
    node.addEventListener("input", resize);
    return {
      update() {
        void tick().then(resize);
      },
      destroy() {
        node.removeEventListener("input", resize);
      },
    };
  }
</script>

<div class="decks-ai-composer">
  {#if contexts.length > 0}
    <div class="decks-ai-composer-pills">
      {#each contexts as ctx (ctx.id)}
        <span class="decks-ai-context-pill" class:is-image={ctx.kind === "image"}>
          <span
            class="decks-ai-context-pill-icon"
            use:icon={ctx.kind === "image" ? "image" : "file-text"}
          ></span>
          <span class="decks-ai-context-pill-label">{ctx.label}</span>
          <button
            type="button"
            class="decks-ai-context-pill-remove"
            aria-label={t.aiRemoveContext}
            on:click={() => onRemoveContext(ctx.id)}>×</button
          >
        </span>
      {/each}
    </div>
    <hr class="decks-ai-composer-sep" />
  {/if}

  <textarea
    class="decks-ai-composer-input"
    rows="3"
    placeholder={t.aiPromptPlaceholder}
    bind:value={prompt}
    use:autoResize={prompt}
  ></textarea>

  <hr class="decks-ai-composer-sep" />

  <div class="decks-ai-composer-actions">
    <button
      type="button"
      class="clickable-icon decks-ai-composer-add"
      aria-label={t.aiAddNote}
      use:icon={"paperclip"}
      on:click={onAddNote}
    ></button>
    <button
      type="button"
      class="clickable-icon decks-ai-composer-add"
      aria-label={t.aiAddImage}
      use:icon={"image"}
      on:click={onAddImage}
    ></button>
    <button
      type="button"
      class="mod-cta decks-ai-composer-send"
      on:click={onSubmit}
      disabled={submitting || submitDisabled}
    >
      {submitting ? t.aiRefactoring : t.aiSend}
    </button>
  </div>
</div>

<style>
  .decks-ai-composer {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
    padding: 12px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-l, 12px);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.08),
      0 2px 8px rgba(0, 0, 0, 0.12);
  }
  .decks-ai-composer-input {
    width: 100%;
    box-sizing: border-box;
    resize: none;
    overflow: hidden;
    min-height: 48px;
    border: none;
    background: transparent;
    padding: 0;
    font-size: 14px;
    line-height: 1.5;
    box-shadow: none;
  }
  .decks-ai-composer-input:focus {
    box-shadow: none;
    outline: none;
  }
  /* Edge-to-edge dividers across the box's 12px padding. */
  .decks-ai-composer-sep {
    border: none;
    border-top: 1px solid var(--background-modifier-border);
    margin: 0 -12px;
  }
  .decks-ai-composer-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }
  .decks-ai-context-pill {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    padding: 0 2px 0 3px;
    border-radius: var(--radius-s);
    font-size: 8px;
    line-height: 1;
    background: var(--background-modifier-hover);
    border: 1px solid var(--background-modifier-border);
  }
  .decks-ai-context-pill.is-image {
    background: var(--background-modifier-success-hover, var(--background-modifier-hover));
  }
  .decks-ai-context-pill-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
  }
  .decks-ai-context-pill-icon :global(svg) {
    width: 8px;
    height: 8px;
  }
  .decks-ai-context-pill-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }
  .decks-ai-context-pill-remove {
    flex: 0 0 auto;
    padding: 0 1px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 9px;
    line-height: 1;
    box-shadow: none;
  }
  .decks-ai-context-pill-remove:hover {
    color: var(--text-normal);
  }
  .decks-ai-composer-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .decks-ai-composer-send {
    margin-left: auto;
  }
</style>
