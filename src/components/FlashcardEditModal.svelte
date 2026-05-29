<script lang="ts">
  import { tick } from "svelte";
  import type { Flashcard } from "../database/types";
  import type { FlashcardEdits, EditResult } from "../services/FlashcardWriter";
  import { I18n } from "@/i18n/I18n";

  export let card: Flashcard;
  export let onSave: (edits: FlashcardEdits) => Promise<EditResult>;
  export let onClose: () => void;
  export let renderMarkdown: (source: string, el: HTMLElement) => void;

  type Mode = "edit" | "preview";

  let saveState: "idle" | "saving" | "error" = "idle";
  let errorMessage = "";

  let headerFront = card.type === "header-paragraph" ? card.front : "";
  let headerBody = card.type === "header-paragraph" ? card.back : "";
  let tableFront = card.type === "table" ? card.front : "";
  let tableBack = card.type === "table" ? card.back : "";
  let tableNotes = card.type === "table" ? (card.notes ?? "") : "";
  let clozeFront = card.type === "cloze" ? card.front : "";
  let clozeSentence = card.type === "cloze" ? card.back : "";
  let itemText =
    card.type === "image-occlusion" ? extractImageOcclusionItem(card) : "";
  let spatialFront = card.type === "spatial" ? card.front : "";
  let spatialBack = card.type === "spatial" ? card.back : "";
  let spatialHint = card.type === "spatial" ? (card.hint ?? "") : "";

  // Per-field mode (edit vs preview). Default: edit. Reassigned (not mutated)
  // on toggle so Svelte tracks it as a reactive dependency in the template.
  let modes: Record<string, Mode> = {};
  function getMode(key: string): Mode {
    return modes[key] ?? "edit";
  }
  function toggle(key: string) {
    modes = { ...modes, [key]: getMode(key) === "edit" ? "preview" : "edit" };
  }

  // Preview DOM nodes
  const previewEls: Record<string, HTMLElement | null> = {};

  function bindPreviewEl(node: HTMLElement, key: string) {
    previewEls[key] = node;
    void tick().then(() => {
      const content = currentValueFor(key);
      if (content !== null) {
        node.empty();
        renderMarkdown(content, node);
      }
    });
    return {
      destroy() {
        previewEls[key] = null;
      },
    };
  }

  function bindImagePreview(node: HTMLElement, source: string) {
    void tick().then(() => {
      node.empty();
      renderMarkdown(source, node);
    });
    return { destroy() {} };
  }

  function extractImageOcclusionItem(c: Flashcard): string {
    if (c.type !== "image-occlusion" || c.clozeOrder === null) return "";
    const lines = c.back.split("\n");
    const items: string[] = [];
    for (const line of lines) {
      const m = /^\s*\d+\.\s+(.+)$/.exec(line);
      if (m) items.push(m[1]);
    }
    return items[c.clozeOrder] ?? c.clozeText ?? "";
  }

  $: typeLabel = labelFor(card.type);
  function labelFor(type: Flashcard["type"]): string {
    switch (type) {
      case "header-paragraph":
        return "Header-paragraph";
      case "table":
        return "Table";
      case "cloze":
        return "Cloze";
      case "image-occlusion":
        return "Image occlusion";
      case "spatial":
        return "Spatial";
    }
  }

  $: clozeValid =
    card.type !== "cloze" || /==((?:(?!==).)+)==/.test(clozeSentence);
  $: headerValid =
    card.type !== "header-paragraph" || headerFront.trim().length > 0;
  $: itemValid =
    card.type !== "image-occlusion" || itemText.trim().length > 0;
  $: spatialValid =
    card.type !== "spatial" ||
    (spatialFront.trim().length > 0 && spatialBack.trim().length > 0);
  $: canSave =
    saveState !== "saving" && clozeValid && headerValid && itemValid && spatialValid;

  function currentValueFor(key: string): string | null {
    switch (key) {
      case "headerFront": return headerFront;
      case "headerBody": return headerBody;
      case "tableFront": return tableFront;
      case "tableBack": return tableBack;
      case "tableNotes": return tableNotes;
      case "clozeFront": return clozeFront;
      case "clozeSentence": return clozeSentence;
      case "itemText": return itemText;
      case "spatialFront": return spatialFront;
      case "spatialBack": return spatialBack;
      case "spatialHint": return spatialHint;
      default: return null;
    }
  }

  // Reactive preview refresh: re-render any field currently in preview mode
  // whenever its value or its mode changes. Referencing `modes` makes Svelte
  // track it as a dependency.
  $: void tick().then(() => {
    void modes;
    for (const key of Object.keys(previewEls)) {
      const el = previewEls[key];
      if (!el) continue;
      if (getMode(key) !== "preview") continue;
      const content = currentValueFor(key);
      if (content === null) continue;
      el.empty();
      renderMarkdown(content, el);
    }
  });
  // Reactive dependency wiring so the block above re-runs on content edits.
  $: void headerFront;
  $: void headerBody;
  $: void tableFront;
  $: void tableBack;
  $: void tableNotes;
  $: void clozeFront;
  $: void clozeSentence;
  $: void itemText;
  $: void spatialFront;
  $: void spatialBack;
  $: void spatialHint;


  async function handleSave() {
    if (!canSave) return;
    saveState = "saving";
    errorMessage = "";
    try {
      const edits = buildEdits();
      const result = await onSave(edits);
      if (result.ok) {
        onClose();
        return;
      }
      saveState = "error";
      errorMessage = result.failure.message;
    } catch (e) {
      saveState = "error";
      errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  function buildEdits(): FlashcardEdits {
    if (card.type === "header-paragraph") {
      return { type: "header-paragraph", front: headerFront, back: headerBody };
    }
    if (card.type === "table") {
      return { type: "table", front: tableFront, back: tableBack, notes: tableNotes };
    }
    if (card.type === "cloze") {
      return { type: "cloze", front: clozeFront, sentence: clozeSentence };
    }
    if (card.type === "spatial") {
      return { type: "spatial", front: spatialFront, back: spatialBack, hint: spatialHint };
    }
    return { type: "image-occlusion", listItem: itemText };
  }

  interface FieldDef {
    key: string;
    label: string;
    isFront?: boolean;
  }
  $: fields = computeFields(card);
  function computeFields(c: Flashcard): FieldDef[] {
    const ef = I18n.t.modals.editFlashcard;
    if (c.type === "header-paragraph") {
      return [
        { key: "headerFront", label: ef.fieldHeader, isFront: true },
        { key: "headerBody", label: ef.fieldBody },
      ];
    }
    if (c.type === "table") {
      return [
        { key: "tableFront", label: ef.fieldFront, isFront: true },
        { key: "tableBack", label: ef.fieldBack },
        { key: "tableNotes", label: ef.fieldNotes },
      ];
    }
    if (c.type === "cloze") {
      return [
        { key: "clozeFront", label: ef.fieldHeader, isFront: true },
        { key: "clozeSentence", label: ef.fieldBody },
      ];
    }
    if (c.type === "spatial") {
      return [
        { key: "spatialFront", label: ef.fieldFront, isFront: true },
        { key: "spatialBack", label: ef.fieldBack },
        { key: "spatialHint", label: ef.fieldHint },
      ];
    }
    return [{ key: "itemText", label: ef.fieldBody }];
  }

  function setFieldValue(key: string, value: string) {
    switch (key) {
      case "headerFront": headerFront = value; break;
      case "headerBody": headerBody = value; break;
      case "tableFront": tableFront = value; break;
      case "tableBack": tableBack = value; break;
      case "tableNotes": tableNotes = value; break;
      case "clozeFront": clozeFront = value; break;
      case "clozeSentence": clozeSentence = value; break;
      case "itemText": itemText = value; break;
      case "spatialFront": spatialFront = value; break;
      case "spatialBack": spatialBack = value; break;
      case "spatialHint": spatialHint = value; break;
    }
  }

  function onTextareaInput(e: Event, field: FieldDef) {
    const target = e.target as HTMLTextAreaElement;
    let v = target.value;
    // Front fields must remain single-line (markdown headers and table
    // front cells both break on newlines). Collapse on input so paste of
    // multi-line content lands as a single line instead of being rejected.
    if (field.isFront && v.includes("\n")) {
      v = v.replace(/\n+/g, " ");
      target.value = v;
    }
    setFieldValue(field.key, v);
  }

  function onTextareaKeydown(e: KeyboardEvent, field: FieldDef) {
    if (field.isFront && e.key === "Enter") {
      e.preventDefault();
    }
  }
</script>

<div class="decks-edit-modal">
  <div class="decks-edit-header">
    <h3>{I18n.t.modals.editFlashcard.title}</h3>
    <div class="decks-edit-breadcrumb">
      {typeLabel}{card.breadcrumb ? ` · ${card.breadcrumb}` : ""}
    </div>
  </div>

  <div class="decks-edit-content">
    {#if card.type === "image-occlusion"}
      <div class="decks-edit-field">
        <span class="decks-edit-label">{I18n.t.modals.editFlashcard.fieldImage}</span>
        <div class="decks-edit-wrap">
          <div
            class="decks-edit-box decks-edit-image-preview"
            use:bindImagePreview={card.front}
          ></div>
        </div>
      </div>
    {/if}

    {#each fields as field (field.key)}
      <div class="decks-edit-field">
        <span class="decks-edit-label">{field.label}</span>
        <div class="decks-edit-wrap">
          <button
            class="decks-edit-toggle-button clickable-icon"
            type="button"
            tabindex="-1"
            aria-label={(modes[field.key] ?? "edit") === "edit" ? "Show preview" : "Edit markdown"}
            title={(modes[field.key] ?? "edit") === "edit" ? "Show preview" : "Edit markdown"}
            on:click={() => toggle(field.key)}
          >
            {#if (modes[field.key] ?? "edit") === "edit"}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
              </svg>
            {/if}
          </button>
          {#if (modes[field.key] ?? "edit") === "edit"}
            <textarea
              class="decks-edit-box decks-edit-textarea"
              class:decks-edit-front-card={field.isFront}
              wrap="soft"
              value={currentValueFor(field.key) ?? ""}
              on:input={(e) => onTextareaInput(e, field)}
              on:keydown={(e) => onTextareaKeydown(e, field)}
              disabled={saveState === "saving"}
            ></textarea>
          {:else}
            <div
              class="decks-edit-box decks-edit-preview-pane"
              class:decks-edit-front-card={field.isFront}
              use:bindPreviewEl={field.key}
            ></div>
          {/if}
        </div>
      </div>
    {/each}

    {#if card.type === "cloze"}
      <div class="decks-edit-hint">
        At least one <code>==span==</code> is required. Changing the header, or
        reordering / replacing spans, will reset FSRS progress for affected cards.
      </div>
    {/if}
    {#if card.type === "image-occlusion"}
      <div class="decks-edit-hint">Editing the item resets FSRS progress for this card.</div>
    {/if}

    {#if saveState === "error"}
      <div class="decks-edit-error">{errorMessage}</div>
    {/if}
  </div>

  <div class="decks-edit-footer">
    <button
      type="button"
      on:click={onClose}
      disabled={saveState === "saving"}>{I18n.t.modals.editFlashcard.cancel}</button
    >
    <button
      type="button"
      class="mod-cta"
      on:click={handleSave}
      disabled={!canSave}
    >
      {saveState === "saving" ? I18n.t.modals.editFlashcard.saving : I18n.t.modals.editFlashcard.save}
    </button>
  </div>
</div>

<style>
  /* All edit-modal styles are self-contained under .decks-edit-modal. We
   * deliberately do NOT depend on .decks-card-side / .decks-review-modal
   * from the review modal — duplicated so the two components evolve
   * independently. */
  .decks-edit-modal {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-height: 0;
    min-width: 0;
    padding: 16px 20px;
    box-sizing: border-box;
    background: var(--background-primary);
    overflow: hidden;
  }
  .decks-edit-header {
    flex: 0 0 auto;
    padding-bottom: 12px;
  }
  .decks-edit-header h3 {
    margin: 0 0 4px 0;
  }
  .decks-edit-breadcrumb {
    font-size: 12px;
    color: var(--text-muted);
  }
  /* Scrollable middle area. Vertical flex with evenly-split fields.
   * min-width: 0 is non-negotiable — without it, textarea content's
   * intrinsic width overflows the flex parent horizontally. */
  .decks-edit-content {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 0;
    min-height: 0;
    min-width: 0;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .decks-edit-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    width: 100%;
  }
  .decks-edit-label {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .decks-edit-wrap {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    width: 100%;
  }
  /* Card-box look (background, border, radius, padding, wrapping). Used by
   * both the textarea and the preview pane so the toggle visually swaps the
   * mode of the same box. */
  .decks-edit-box {
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    width: 100%;
    height: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 16px 20px;
    box-sizing: border-box;
    overflow-y: auto;
    overflow-x: hidden;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  /* Front fields (Header / table Front) mirror the review modal's
   * .decks-card-side.decks-front look: centered horizontally + vertically,
   * larger, semibold. */
  .decks-edit-front-card {
    text-align: center;
    font-size: 20px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .decks-edit-front-card.decks-edit-textarea {
    /* Textareas don't behave as flex containers for their text content,
     * but `align-content: center` (supported in modern Chromium) vertically
     * centers the lines within the textarea box. */
    display: block;
    text-align: center;
    align-content: center;
  }
  .decks-edit-textarea {
    font-family: var(--font-text);
    font-size: 16px;
    line-height: 1.6;
    color: var(--text-normal);
    resize: none;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    display: block;
  }
  .decks-edit-textarea:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }
  .decks-edit-preview-pane {
    font-size: 16px;
    line-height: 1.6;
  }
  .decks-edit-image-preview {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
  }
  /* 24x24 corner toggle, modeled on the review modal's go-to-file button
   * but defined locally so the edit modal doesn't depend on it. */
  .decks-edit-toggle-button {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 10;
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .decks-edit-hint {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-edit-error {
    flex: 0 0 auto;
    color: var(--text-error);
    background: var(--background-modifier-error);
    padding: 6px 10px;
    border-radius: var(--radius-s);
    font-size: 12px;
  }
  .decks-edit-footer {
    flex: 0 0 auto;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
  }
</style>
