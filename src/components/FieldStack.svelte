<script lang="ts">
  // Presentational "seamless stack" card: one elevated container on the main
  // background holding labeled zones separated by thin lines. The body of each
  // zone is supplied by the parent via the default slot (`let:z`), so the same
  // card serves the editor (textareas / preview) and AI suggestions (proposed
  // text). All behavior lives in the parent.
  interface FieldStackZone {
    key: string;
    label?: string;
    isFront?: boolean;
  }
  export let zones: FieldStackZone[] = [];
</script>

<div class="decks-field-stack">
  {#each zones as z (z.key)}
    <div class="decks-field-zone">
      {#if z.label}
        <span class="decks-field-zone-label">{z.label}</span>
      {/if}
      <slot {z} />
    </div>
  {/each}
</div>

<style>
  .decks-field-stack {
    display: flex;
    flex-direction: column;
    width: 100%;
    box-sizing: border-box;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border-hover);
    border-radius: var(--radius-m);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.08),
      0 2px 8px rgba(0, 0, 0, 0.12);
  }
  .decks-field-zone {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 20px 24px;
    min-width: 0;
    transition: border-color 0.15s ease;
  }
  /* Seamless dividers as per-zone borders, so the active field can tint the
   * lines directly above and below it on focus. */
  .decks-field-zone + .decks-field-zone {
    border-top: 1px solid var(--background-modifier-border-hover);
  }
  .decks-field-zone-label {
    font-size: 10px;
    color: var(--text-faint);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    transition: color 0.15s ease;
  }
  /* Focus illumination (edit mode only — read-only cards have no focusable
   * input, so they stay neutral). */
  .decks-field-zone:focus-within .decks-field-zone-label {
    color: var(--text-accent);
  }
  .decks-field-zone:focus-within {
    border-top-color: var(--text-accent);
  }
  .decks-field-zone:focus-within + .decks-field-zone {
    border-top-color: var(--text-accent);
  }
</style>
