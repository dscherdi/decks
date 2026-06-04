<script lang="ts">
  // Read-only display of a flashcard's fields as the seamless FieldStack card,
  // markdown-rendered. Used for both the current card and an AI proposal — it
  // shows the full card (no diff highlighting).
  import { cardFieldDefs, fieldSetValue, type RefactorCardType, type RefactorFieldSet } from "@decks/core";
  import FieldStack from "./FieldStack.svelte";

  export let cardType: RefactorCardType;
  export let fieldset: RefactorFieldSet;
  export let renderMarkdown: (source: string, el: HTMLElement) => void;

  // Only render fields that have content.
  $: zones = cardFieldDefs(cardType)
    .filter((f) => fieldSetValue(fieldset, f.refKey).trim() !== "")
    .map((f) => ({ key: f.refKey, label: f.label, isFront: f.isFront }));

  function renderMd(node: HTMLElement, content: string) {
    node.empty();
    renderMarkdown(content, node);
    return {
      update(next: string) {
        node.empty();
        renderMarkdown(next, node);
      },
    };
  }
</script>

<FieldStack {zones} let:z>
  <div
    class="decks-card-view-value"
    class:is-front={z.isFront}
    use:renderMd={fieldSetValue(fieldset, z.key)}
  ></div>
</FieldStack>

<style>
  .decks-card-view-value {
    font-family: var(--font-text);
    font-size: 16px;
    line-height: 1.65;
    overflow-wrap: anywhere;
    word-break: break-word;
    color: var(--text-normal);
  }
  .decks-card-view-value :global(p:first-child) {
    margin-top: 0;
  }
  .decks-card-view-value :global(p:last-child) {
    margin-bottom: 0;
  }
  .decks-card-view-value.is-front {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
  }
</style>
