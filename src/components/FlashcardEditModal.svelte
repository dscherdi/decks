<script lang="ts">
  import { tick } from "svelte";
  import { setIcon } from "obsidian";
  import type { App } from "obsidian";
  import type { Flashcard } from "../database/types";
  import type { FlashcardEdits, EditResult } from "../services/FlashcardWriter";
  import { I18n, type RefactorDebugInfo, type RefactorFieldSet, type RefactorImage, type RefactorResult } from "@decks/core";
  import FieldStack from "./FieldStack.svelte";
  import AiPromptComposer from "./AiPromptComposer.svelte";
  import {
    type ContextItem,
    buildComposerRequest,
    savePastedImage,
    IMAGE_EXTENSIONS,
  } from "../utils/attachments";
  import { FilePickerModal } from "../utils/file-picker";

  export let card: Flashcard;
  export let app: App;
  export let onSave: (edits: FlashcardEdits) => Promise<EditResult>;
  export let onClose: () => void;
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  export let aiEnabled = false;
  export let onRefactor:
    | ((
        current: RefactorFieldSet,
        options: {
          instructions?: string;
          targetKeys?: string[];
          sourceContext?: string;
          images?: RefactorImage[];
          split?: boolean;
        },
        signal?: AbortSignal,
      ) => Promise<RefactorResult>)
    | undefined = undefined;
  export let onSplit:
    | ((cards: RefactorFieldSet[]) => Promise<EditResult>)
    | undefined = undefined;

  type Mode = "edit" | "preview";

  // Card types whose source format can be split into multiple cards.
  const SPLITTABLE = new Set(["header-paragraph", "table", "cloze"]);
  $: splitAvailable = SPLITTABLE.has(card.type);
  let splitOn = false;
  $: if (!splitAvailable) splitOn = false;

  let refactorState: "idle" | "running" | "error" = "idle";
  let refactorError = "";
  // A stream of AI suggestions: a normal refactor (one full proposed card) or a
  // split (the card broken into several new cards).
  type Suggestion =
    | { id: number; kind: "refactor"; proposed: RefactorFieldSet; changed: string[] }
    | { id: number; kind: "split"; cards: RefactorFieldSet[] };
  let suggestions: Suggestion[] = [];
  let suggestionSeq = 0;

  // --- AI input state ---
  // The AI input block is fixed above the footer and hidden until the user
  // toggles it with the wand button.
  let aiOpen = false;
  let prompt = "";

  function wand(node: HTMLElement) {
    setIcon(node, "wand-2");
  }
  // Captured prompt + raw response from the last Generate (only when debug
  // logging is enabled — core attaches it). Shown in a collapsible panel.
  let lastDebug: RefactorDebugInfo | null = null;
  const sourceFileName = card.sourceFile.split("/").pop() ?? card.sourceFile;

  // Attached context shown as removable pills. The card's own source note is
  // attached by default; the user can remove it or add notes/images.
  let contexts: ContextItem[] = [
    { id: "source", kind: "note", path: card.sourceFile, label: sourceFileName },
  ];

  function addContext(kind: "note" | "image", path: string, label: string) {
    const id = `${kind}:${path}`;
    if (contexts.some((c) => c.id === id)) return;
    contexts = [...contexts, { id, kind, path, label }];
  }

  function removeContext(id: string) {
    contexts = contexts.filter((c) => c.id !== id);
  }

  // @-mention: notes referenced inline in the prompt. `mentionedAll` only grows;
  // a mention counts only while its @token is still present in the text.
  const mentionItems = app.vault
    .getMarkdownFiles()
    .map((f) => ({ path: f.path, label: f.basename }));
  let mentionedAll: ContextItem[] = [];
  $: activeMentions = mentionedAll.filter((m) => prompt.includes(`@${m.label}`));
  $: mentionLabels = activeMentions.map((m) => m.label);

  function addMention(item: { path: string; label: string }) {
    const id = `note:${item.path}`;
    if (mentionedAll.some((m) => m.id === id)) return;
    mentionedAll = [
      ...mentionedAll,
      { id, kind: "note", path: item.path, label: item.label },
    ];
  }

  async function pasteImages(files: File[]) {
    for (const file of files) {
      const saved = await savePastedImage(app, card.sourceFile, file);
      if (saved) addContext("image", saved.path, saved.name);
    }
  }

  function addNote() {
    new FilePickerModal(
      app,
      app.vault.getMarkdownFiles(),
      (f) => addContext("note", f.path, f.name),
      I18n.t.modals.editFlashcard.aiAddNote,
    ).open();
  }

  function addImage() {
    const images = app.vault
      .getFiles()
      .filter((f) => IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()));
    new FilePickerModal(
      app,
      images,
      (f) => addContext("image", f.path, f.name),
      I18n.t.modals.editFlashcard.aiAddImage,
    ).open();
  }

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

  // One global mode for the whole modal: editable text vs rendered markdown.
  let mode: Mode = "edit";
  function toggleMode() {
    mode = mode === "edit" ? "preview" : "edit";
  }

  // Auto-grow a textarea to fit its content. `value` is passed so the action's
  // `update` re-runs when the field changes externally (e.g. accepting an AI
  // proposal). Uses setCssProps (not node.style) per the no-static-styles rule.
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

  // Render markdown content into a node (used for AI suggestion text). Re-renders
  // on update when the proposed content changes.
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

  // Reactive value map so the editor textareas re-render when a field var is
  // written programmatically (e.g. accepting an AI suggestion). A plain
  // currentValueFor() call in the template is not tracked by Svelte.
  $: fieldValues = {
    headerFront,
    headerBody,
    tableFront,
    tableBack,
    tableNotes,
    clozeFront,
    clozeSentence,
    itemText,
    spatialFront,
    spatialBack,
    spatialHint,
  } as Record<string, string>;

  // Reactive preview refresh: when in preview mode, re-render every zone's
  // markdown whenever any field value changes. Referencing `mode` makes Svelte
  // track it as a dependency.
  $: void tick().then(() => {
    if (mode !== "preview") return;
    for (const key of Object.keys(previewEls)) {
      const el = previewEls[key];
      if (!el) continue;
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
    // Corresponding key in the core RefactorFieldSet for this card type.
    refKey: string;
  }
  $: fields = computeFields(card);
  function computeFields(c: Flashcard): FieldDef[] {
    const ef = I18n.t.modals.editFlashcard;
    if (c.type === "header-paragraph") {
      return [
        { key: "headerFront", label: ef.fieldHeader, isFront: true, refKey: "front" },
        { key: "headerBody", label: ef.fieldBody, refKey: "back" },
      ];
    }
    if (c.type === "table") {
      return [
        { key: "tableFront", label: ef.fieldFront, isFront: true, refKey: "front" },
        { key: "tableBack", label: ef.fieldBack, refKey: "back" },
        { key: "tableNotes", label: ef.fieldNotes, refKey: "notes" },
      ];
    }
    if (c.type === "cloze") {
      return [
        { key: "clozeFront", label: ef.fieldHeader, isFront: true, refKey: "front" },
        { key: "clozeSentence", label: ef.fieldBody, refKey: "sentence" },
      ];
    }
    if (c.type === "spatial") {
      return [
        { key: "spatialFront", label: ef.fieldFront, isFront: true, refKey: "front" },
        { key: "spatialBack", label: ef.fieldBack, refKey: "back" },
        { key: "spatialHint", label: ef.fieldHint, refKey: "hint" },
      ];
    }
    return [{ key: "itemText", label: ef.fieldBody, refKey: "listItem" }];
  }

  function currentFieldSet(): RefactorFieldSet {
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

  async function handleRefactor() {
    if (!onRefactor || refactorState === "running") return;
    refactorState = "running";
    refactorError = "";
    try {
      const { instructions, sourceContext, images } = await buildComposerRequest(
        app,
        card,
        prompt,
        contexts,
        activeMentions,
      );
      const result = await onRefactor(currentFieldSet(), {
        instructions,
        sourceContext,
        images,
        split: splitOn,
      });
      lastDebug = result.debug ?? null;
      refactorState = "idle";
      if (splitOn) {
        const cards = result.splitCards ?? [];
        if (cards.length === 0) {
          refactorError = I18n.t.modals.editFlashcard.aiNoChanges;
          refactorState = "error";
          return;
        }
        suggestions = [
          ...suggestions,
          { id: ++suggestionSeq, kind: "split", cards },
        ];
        return;
      }
      if (result.proposals.length === 0) {
        refactorError = I18n.t.modals.editFlashcard.aiNoChanges;
        refactorState = "error";
        return;
      }
      suggestions = [
        ...suggestions,
        {
          id: ++suggestionSeq,
          kind: "refactor",
          proposed: result.proposed,
          changed: result.proposals.map((p) => p.key),
        },
      ];
    } catch (e) {
      lastDebug = (e as { debug?: RefactorDebugInfo }).debug ?? lastDebug;
      refactorState = "error";
      refactorError = e instanceof Error ? e.message : String(e);
    }
  }

  function dismissSuggestion(id: number) {
    suggestions = suggestions.filter((s) => s.id !== id);
  }

  function acceptSuggestion(
    suggestion: Extract<Suggestion, { kind: "refactor" }>,
  ) {
    for (const refKey of suggestion.changed) {
      const field = fields.find((f) => f.refKey === refKey);
      if (field) setFieldValue(field.key, proposedValueFor(suggestion.proposed, refKey));
    }
    dismissSuggestion(suggestion.id);
  }

  function toggleSplit() {
    splitOn = !splitOn;
  }

  async function acceptSplit(
    suggestion: Extract<Suggestion, { kind: "split" }>,
  ) {
    if (!onSplit || refactorState === "running") return;
    refactorState = "running";
    refactorError = "";
    try {
      const result = await onSplit(suggestion.cards);
      refactorState = "idle";
      if (result.ok) {
        onClose();
      } else {
        refactorState = "error";
        refactorError = result.failure.message;
      }
    } catch (e) {
      refactorState = "error";
      refactorError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Read a proposed field value by its refactor key, type-safely. */
  function proposedValueFor(p: RefactorFieldSet, refKey: string): string {
    switch (p.type) {
      case "header-paragraph":
        return refKey === "front" ? p.front : refKey === "back" ? p.back : "";
      case "table":
        return refKey === "front"
          ? p.front
          : refKey === "back"
            ? p.back
            : refKey === "notes"
              ? p.notes
              : "";
      case "cloze":
        return refKey === "front" ? p.front : refKey === "sentence" ? p.sentence : "";
      case "spatial":
        return refKey === "front"
          ? p.front
          : refKey === "back"
            ? p.back
            : refKey === "hint"
              ? p.hint
              : "";
      case "image-occlusion":
        return refKey === "listItem" ? p.listItem : "";
    }
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

  function onTextareaInput(e: Event, key: string, isFront?: boolean) {
    const target = e.target as HTMLTextAreaElement;
    let v = target.value;
    // Front fields must remain single-line (markdown headers and table
    // front cells both break on newlines). Collapse on input so paste of
    // multi-line content lands as a single line instead of being rejected.
    if (isFront && v.includes("\n")) {
      v = v.replace(/\n+/g, " ");
      target.value = v;
    }
    setFieldValue(key, v);
  }

  function onTextareaKeydown(e: KeyboardEvent, isFront?: boolean) {
    if (isFront && e.key === "Enter") {
      e.preventDefault();
    }
  }

  // Zones for the editor card: each field, plus an image preview zone first
  // for image-occlusion cards.
  $: editorZones = [
    ...(card.type === "image-occlusion"
      ? [{ key: "image", label: I18n.t.modals.editFlashcard.fieldImage }]
      : []),
    ...fields.map((f) => ({ key: f.key, label: f.label, isFront: f.isFront })),
  ];
  // Zones for one proposed card: its non-empty fields, keyed by refKey.
  function cardZones(p: RefactorFieldSet) {
    return fields
      .filter((f) => proposedValueFor(p, f.refKey).trim() !== "")
      .map((f) => ({ key: f.refKey, isFront: f.isFront }));
  }
</script>

<div class="decks-edit-modal">
  <div class="decks-edit-header">
    <div class="decks-edit-header-text">
      <h3>{I18n.t.modals.editFlashcard.title}</h3>
      <div class="decks-edit-breadcrumb">
        {typeLabel}{card.breadcrumb ? ` · ${card.breadcrumb}` : ""}
      </div>
    </div>
    <button
      class="decks-edit-mode-toggle clickable-icon"
      type="button"
      aria-label={mode === "edit" ? "Show rendered markdown" : "Edit text"}
      title={mode === "edit" ? "Show rendered markdown" : "Edit text"}
      on:click={toggleMode}
    >
      {#if mode === "edit"}
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
        </svg>
      {/if}
    </button>
  </div>

  <div class="decks-edit-content">
    <FieldStack zones={editorZones} let:z>
      {#if z.key === "image"}
        <div class="decks-edit-image-preview" use:bindImagePreview={card.front}></div>
      {:else if mode === "edit"}
        <textarea
          class="decks-edit-zone-input"
          class:decks-edit-front-card={z.isFront}
          wrap="soft"
          value={fieldValues[z.key] ?? ""}
          use:autoResize={fieldValues[z.key] ?? ""}
          on:input={(e) => onTextareaInput(e, z.key, z.isFront)}
          on:keydown={(e) => onTextareaKeydown(e, z.isFront)}
          disabled={saveState === "saving"}
        ></textarea>
      {:else}
        <div
          class="decks-edit-zone-preview"
          class:decks-edit-front-card={z.isFront}
          use:bindPreviewEl={z.key}
        ></div>
      {/if}
    </FieldStack>

    {#each suggestions as s (s.id)}
      {#if s.kind === "split"}
        <div class="decks-edit-suggestion">
          <div class="decks-edit-suggestion-header">
            <span class="decks-edit-suggestion-spark">✨</span>
            <span class="decks-edit-suggestion-title">
              {I18n.format(I18n.t.modals.editFlashcard.aiSplitTitle, { count: s.cards.length })}
            </span>
          </div>
          <div class="decks-edit-split-list">
            {#each s.cards as splitCard, i (i)}
              <div class="decks-edit-split-card">
                <FieldStack zones={cardZones(splitCard)} let:z>
                  <div
                    class="decks-edit-proposed"
                    class:is-front={z.isFront}
                    use:renderMd={proposedValueFor(splitCard, z.key)}
                  ></div>
                </FieldStack>
              </div>
            {/each}
          </div>
          <div class="decks-edit-suggestion-actions">
            <button type="button" on:click={() => dismissSuggestion(s.id)}>
              {I18n.t.modals.editFlashcard.aiDismiss}
            </button>
            <button type="button" class="mod-cta" on:click={() => acceptSplit(s)}>
              {I18n.t.modals.editFlashcard.aiAcceptSplit}
            </button>
          </div>
        </div>
      {:else}
        <div class="decks-edit-suggestion">
          <div class="decks-edit-suggestion-header">
            <span class="decks-edit-suggestion-spark">✨</span>
            <span class="decks-edit-suggestion-title">{I18n.t.modals.editFlashcard.aiSuggestion}</span>
          </div>
          <FieldStack zones={cardZones(s.proposed)} let:z>
            <div
              class="decks-edit-proposed"
              class:is-front={z.isFront}
              use:renderMd={proposedValueFor(s.proposed, z.key)}
            ></div>
          </FieldStack>
          <div class="decks-edit-suggestion-actions">
            <button type="button" on:click={() => dismissSuggestion(s.id)}>
              {I18n.t.modals.editFlashcard.aiDismiss}
            </button>
            <button type="button" class="mod-cta" on:click={() => acceptSuggestion(s)}>
              {I18n.t.modals.editFlashcard.aiAcceptVersion}
            </button>
          </div>
        </div>
      {/if}
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

  {#if aiEnabled && onRefactor && aiOpen}
    <div class="decks-ai-input">
      <AiPromptComposer
        bind:prompt
        {contexts}
        submitting={refactorState === "running"}
        {splitOn}
        {splitAvailable}
        {mentionItems}
        {mentionLabels}
        onAddNote={addNote}
        onAddImage={addImage}
        onRemoveContext={removeContext}
        onToggleSplit={toggleSplit}
        onMention={addMention}
        onPasteImages={pasteImages}
        onSubmit={handleRefactor}
      />

      {#if refactorState === "error"}
        <div class="decks-edit-error">{refactorError}</div>
      {/if}

      {#if lastDebug}
        <details class="decks-ai-debug">
          <summary>{I18n.t.modals.editFlashcard.aiDebugTitle}</summary>
          <div class="decks-ai-debug-label">{I18n.t.modals.editFlashcard.aiDebugSystem}</div>
          <pre class="decks-ai-debug-pre">{lastDebug.system}</pre>
          <div class="decks-ai-debug-label">{I18n.t.modals.editFlashcard.aiDebugPrompt}</div>
          <pre class="decks-ai-debug-pre">{lastDebug.user}</pre>
          <div class="decks-ai-debug-label">{I18n.t.modals.editFlashcard.aiDebugResponse}</div>
          <pre class="decks-ai-debug-pre">{lastDebug.raw}</pre>
        </details>
      {/if}
    </div>
  {/if}

  <div class="decks-edit-footer">
    {#if aiEnabled && onRefactor}
      <button
        type="button"
        class="clickable-icon decks-ai-wand-button"
        class:is-active={aiOpen}
        aria-label={aiOpen
          ? I18n.t.modals.editFlashcard.aiHide
          : I18n.t.modals.editFlashcard.aiShow}
        title={aiOpen
          ? I18n.t.modals.editFlashcard.aiHide
          : I18n.t.modals.editFlashcard.aiShow}
        use:wand
        on:click={() => (aiOpen = !aiOpen)}
        disabled={saveState === "saving"}
      ></button>
      <span class="decks-edit-footer-spacer"></span>
    {/if}
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
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .decks-edit-header h3 {
    margin: 0 0 4px 0;
  }
  .decks-edit-mode-toggle {
    flex: 0 0 auto;
    cursor: pointer;
  }
  .decks-edit-breadcrumb {
    font-size: 12px;
    color: var(--text-muted);
  }
  /* Single scrollable column holding, top to bottom: the original card, the
   * AI suggestion stream, and the AI input block. min-width: 0 is
   * non-negotiable — without it, textarea content's intrinsic width overflows
   * the flex parent horizontally. */
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
  /* Field bodies inside the shared FieldStack card are transparent/borderless
   * so the whole stack reads as one activeDocument. */
  .decks-edit-zone-input {
    width: 100%;
    box-sizing: border-box;
    background: transparent;
    border: none;
    outline: none;
    box-shadow: none;
    padding: 0;
    margin: 0;
    resize: none;
    overflow: hidden;
    min-height: 1.65em;
    font-family: var(--font-text);
    font-size: 16px;
    line-height: 1.65;
    color: var(--text-normal);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .decks-edit-zone-input:focus {
    outline: none;
    box-shadow: none;
  }
  .decks-edit-zone-preview {
    font-size: 16px;
    line-height: 1.65;
    min-height: 1.65em;
  }
  /* Front fields (Header / table Front): emphasized but left-aligned so they
   * sit naturally at the top of the single activeDocument. */
  .decks-edit-front-card {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.3;
  }
  .decks-edit-image-preview {
    display: flex;
    justify-content: center;
    align-items: center;
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
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-edit-footer-spacer {
    flex: 1 1 auto;
  }
  .decks-ai-wand-button {
    cursor: pointer;
  }
  .decks-ai-wand-button.is-active {
    color: var(--text-accent);
  }
  /* AI input block: a fixed band above the footer (not part of the scroll
   * area), shown only when toggled on via the wand. */
  .decks-ai-input {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    /* No overflow clip here: the textarea is height-capped instead, so the
     * @-mention dropdown can float above the box without being clipped. */
    overflow: visible;
    padding: 12px 0;
    border-top: 1px solid var(--background-modifier-border);
  }
  /* AI suggestion: a self-contained card. The header and action footer live
   * inside the card border; the inner FieldStack is stripped of its own chrome
   * so it reads as one widget. */
  .decks-edit-suggestion {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
    background: var(--background-primary);
    border: 2px solid var(--background-modifier-border-hover);
    border-left: 4px solid var(--interactive-accent);
    border-radius: var(--radius-m);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.08),
      0 2px 8px rgba(0, 0, 0, 0.12);
  }
  .decks-edit-suggestion :global(.decks-field-stack) {
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }
  .decks-edit-suggestion-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 18px 24px 0;
  }
  .decks-edit-suggestion-spark {
    font-size: 12px;
  }
  .decks-edit-suggestion-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-accent);
    font-weight: 600;
  }
  .decks-edit-proposed {
    font-family: var(--font-text);
    font-size: 16px;
    line-height: 1.65;
    overflow-wrap: anywhere;
    word-break: break-word;
    color: var(--text-normal);
  }
  .decks-edit-proposed :global(p:first-child) {
    margin-top: 0;
  }
  .decks-edit-proposed :global(p:last-child) {
    margin-bottom: 0;
  }
  /* The FRONT prompt is emphasized; two-class selector beats the base size. */
  .decks-edit-proposed.is-front {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
  }
  .decks-edit-suggestion-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 24px;
    border-top: 1px solid var(--background-modifier-border-hover);
    background: var(--background-secondary);
  }
  /* Split preview: each resulting card as its own bordered mini-stack. */
  .decks-edit-split-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
  }
  .decks-edit-split-card {
    border: 1px solid var(--background-modifier-border-hover);
    border-radius: var(--radius-s);
    overflow: hidden;
  }
  .decks-edit-split-card :global(.decks-field-stack) {
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }
  .decks-edit-split-card :global(.decks-field-zone) {
    padding: 12px 16px;
  }
  .decks-ai-debug {
    margin-top: 6px;
    font-size: 12px;
  }
  .decks-ai-debug summary {
    cursor: pointer;
    color: var(--text-muted);
    user-select: none;
  }
  .decks-ai-debug-label {
    margin-top: 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
    font-weight: 600;
  }
  .decks-ai-debug-pre {
    margin: 2px 0 0 0;
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    user-select: text;
    font-family: var(--font-monospace);
    font-size: 11px;
    line-height: 1.45;
    background: var(--background-primary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    padding: 6px 8px;
  }
</style>
