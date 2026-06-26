<script lang="ts">
  import { onMount } from "svelte";
  import { I18n, type OcclusionMask } from "@decks/core";

  const o = I18n.t.occlusion;

  export let imageSrc: string | null = null;
  export let imageLabel = "";
  export let initialMasks: OcclusionMask[] = [];
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  export let onSave: (masks: OcclusionMask[]) => void;
  export let onClose: () => void;

  const MIN_SIZE = 1;

  let masks: OcclusionMask[] = initialMasks.map((m) => ({ ...m }));
  let selectedId: string | null = masks.length > 0 ? masks[0].id : null;
  let stageEl: HTMLDivElement;
  let previewEl: HTMLDivElement | undefined;

  type DragMode = "draw" | "move" | "resize";
  interface DragState {
    mode: DragMode;
    id: string;
    startX: number;
    startY: number;
    origin: OcclusionMask;
  }
  let drag: DragState | null = null;

  function nextMaskId(): string {
    let max = 0;
    for (const m of masks) {
      const match = /^m(\d+)$/.exec(m.id);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    let candidate = `m${max + 1}`;
    const used = new Set(masks.map((m) => m.id));
    let n = max + 1;
    while (used.has(candidate)) candidate = `m${++n}`;
    return candidate;
  }

  function clamp(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
  }

  function pointerPercent(e: PointerEvent): { x: number; y: number } {
    const rect = stageEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
  }

  function onStagePointerDown(e: PointerEvent) {
    if (!stageEl) return;
    // Begin drawing a new mask on empty-stage press.
    const { x, y } = pointerPercent(e);
    const id = nextMaskId();
    const mask: OcclusionMask = { id, x, y, w: MIN_SIZE, h: MIN_SIZE, answer: "" };
    masks = [...masks, mask];
    selectedId = id;
    drag = { mode: "draw", id, startX: x, startY: y, origin: { ...mask } };
    stageEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onMaskPointerDown(e: PointerEvent, mask: OcclusionMask) {
    e.stopPropagation();
    selectedId = mask.id;
    const { x, y } = pointerPercent(e);
    drag = { mode: "move", id: mask.id, startX: x, startY: y, origin: { ...mask } };
    stageEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onHandlePointerDown(e: PointerEvent, mask: OcclusionMask) {
    e.stopPropagation();
    selectedId = mask.id;
    const { x, y } = pointerPercent(e);
    drag = { mode: "resize", id: mask.id, startX: x, startY: y, origin: { ...mask } };
    stageEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onStagePointerMove(e: PointerEvent) {
    if (!drag) return;
    const { x, y } = pointerPercent(e);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    masks = masks.map((m) => {
      if (m.id !== drag!.id) return m;
      const o = drag!.origin;
      if (drag!.mode === "move") {
        return {
          ...m,
          x: clamp(o.x + dx, 0, 100 - o.w),
          y: clamp(o.y + dy, 0, 100 - o.h),
        };
      }
      // draw + resize both grow the box from its origin corner.
      const nx = drag!.mode === "draw" ? Math.min(drag!.startX, x) : o.x;
      const ny = drag!.mode === "draw" ? Math.min(drag!.startY, y) : o.y;
      const nw =
        drag!.mode === "draw"
          ? Math.abs(x - drag!.startX)
          : clamp(o.w + dx, MIN_SIZE, 100 - o.x);
      const nh =
        drag!.mode === "draw"
          ? Math.abs(y - drag!.startY)
          : clamp(o.h + dy, MIN_SIZE, 100 - o.y);
      return {
        ...m,
        x: clamp(nx, 0, 100),
        y: clamp(ny, 0, 100),
        w: clamp(nw, MIN_SIZE, 100 - clamp(nx, 0, 100)),
        h: clamp(nh, MIN_SIZE, 100 - clamp(ny, 0, 100)),
      };
    });
  }

  function endDrag(e: PointerEvent) {
    if (!drag) return;
    try {
      stageEl.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
    drag = null;
  }

  function deleteMask(id: string) {
    masks = masks.filter((m) => m.id !== id);
    if (selectedId === id) selectedId = masks.length > 0 ? masks[0].id : null;
  }

  function selectMask(id: string) {
    selectedId = id;
  }

  let hoverId: string | null = null;

  // Keep the selected box's list row scrolled into view (e.g. when it's
  // selected by clicking the mask on the canvas).
  function revealIfActive(node: HTMLElement, active: boolean) {
    if (active) node.scrollIntoView({ block: "nearest" });
    return {
      update(next: boolean) {
        if (next) node.scrollIntoView({ block: "nearest" });
      },
    };
  }

  // Auto-grow the textarea to its content. Re-runs on input and when the bound
  // value changes (switching boxes). Uses setCssProps per plugin lint rules.
  function autogrow(node: HTMLTextAreaElement, _value: string) {
    const fit = () => {
      node.setCssProps({ height: "auto" });
      node.setCssProps({ height: `${node.scrollHeight}px` });
    };
    fit();
    node.addEventListener("input", fit);
    return {
      update() {
        fit();
      },
      destroy() {
        node.removeEventListener("input", fit);
      },
    };
  }

  $: selected = masks.find((m) => m.id === selectedId) ?? null;

  $: if (previewEl && selected) {
    previewEl.empty();
    if (selected.answer.trim().length > 0) {
      renderMarkdown(selected.answer, previewEl);
    }
  }

  function save() {
    // Round to keep the written YAML tidy.
    const rounded = masks.map((m) => ({
      ...m,
      x: Math.round(m.x * 10) / 10,
      y: Math.round(m.y * 10) / 10,
      w: Math.round(m.w * 10) / 10,
      h: Math.round(m.h * 10) / 10,
    }));
    onSave(rounded);
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<div class="decks-occlusion-studio">
  <div class="decks-occlusion-studio-header">
    <span class="decks-occlusion-studio-title">{o.studioTitle}</span>
    <span class="decks-occlusion-studio-hint">{o.drawHint}</span>
  </div>

  <div class="decks-occlusion-studio-body">
    <div class="decks-occlusion-studio-canvas">
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="decks-occlusion-stage decks-occlusion-studio-stage"
        bind:this={stageEl}
        on:pointerdown={onStagePointerDown}
        on:pointermove={onStagePointerMove}
        on:pointerup={endDrag}
        on:pointercancel={endDrag}
      >
        {#if imageSrc}
          <img class="decks-occlusion-image" src={imageSrc} alt={imageLabel} draggable="false" />
        {:else}
          <div class="decks-occlusion-missing">{I18n.format(o.imageNotFound, { name: imageLabel })}</div>
        {/if}

        {#each masks as mask (mask.id)}
          <div
            class="decks-occlusion-mask decks-occlusion-studio-mask"
            class:decks-occlusion-mask-selected={mask.id === selectedId || mask.id === hoverId}
            style:left={`${mask.x}%`}
            style:top={`${mask.y}%`}
            style:width={`${mask.w}%`}
            style:height={`${mask.h}%`}
            on:pointerdown={(e) => onMaskPointerDown(e, mask)}
            role="button"
            tabindex="0"
          >
            <button
              type="button"
              class="decks-occlusion-mask-delete"
              aria-label={o.deleteBox}
              on:pointerdown|stopPropagation
              on:click|stopPropagation={() => deleteMask(mask.id)}
            >×</button>
            <div
              class="decks-occlusion-resize-handle"
              on:pointerdown={(e) => onHandlePointerDown(e, mask)}
              role="button"
              tabindex="-1"
              aria-label={o.resize}
            ></div>
          </div>
        {/each}
      </div>
    </div>

    <div class="decks-occlusion-inspector">
      <div class="decks-occlusion-inspector-scroll">
        <div class="decks-occlusion-list-label">{o.boxes}</div>
        {#if masks.length === 0}
          <div class="decks-occlusion-empty">{o.noBoxes}</div>
        {:else}
          <div class="decks-occlusion-box-list">
            {#each masks as mask, i (mask.id)}
              <button
                type="button"
                class="decks-occlusion-box-item"
                class:decks-occlusion-box-item-active={mask.id === selectedId}
                use:revealIfActive={mask.id === selectedId}
                on:click={() => selectMask(mask.id)}
                on:mouseenter={() => (hoverId = mask.id)}
                on:mouseleave={() => (hoverId = null)}
              >
                <span class="decks-occlusion-box-item-index">{i + 1}</span>
                <span
                  class="decks-occlusion-box-item-answer"
                  class:decks-occlusion-box-item-empty={mask.answer.trim().length === 0}
                >
                  {mask.answer.trim() || o.emptyAnswer}
                </span>
              </button>
            {/each}
          </div>
        {/if}

        {#if selected}
          <div class="decks-occlusion-editor">
            <label class="decks-occlusion-editor-label" for="decks-occ-answer">
              {o.answerLabel}
            </label>
            <textarea
              id="decks-occ-answer"
              class="decks-occlusion-answer-input"
              use:autogrow={selected.answer}
              bind:value={selected.answer}
              placeholder={o.answerPlaceholder}
            ></textarea>
            {#if selected.answer.trim().length > 0}
              <div class="decks-occlusion-preview markdown-rendered" bind:this={previewEl}></div>
            {/if}
          </div>
        {:else if masks.length > 0}
          <div class="decks-occlusion-empty">{o.selectBox}</div>
        {/if}
      </div>

      <div class="decks-occlusion-studio-actions">
        <button type="button" on:click={onClose}>{o.cancel}</button>
        <button type="button" class="mod-cta" on:click={save}>{o.save}</button>
      </div>
    </div>
  </div>
</div>
