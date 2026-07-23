<script lang="ts">
  import { onMount, tick, createEventDispatcher } from "svelte";
  import { I18n } from "@decks/core";

  const r = I18n.t.review;
  const dispatch = createEventDispatcher<{ close: void }>();

  // Visibility is driven by the parent; the component stays mounted so a
  // drawing survives being toggled off/on within the same card.
  export let open = false;

  type Point = { x: number; y: number };
  type Tool = "pen" | "eraser";
  interface Stroke {
    tool: Tool;
    color: string;
    size: number;
    points: Point[];
  }

  const PEN_SIZE = 2.5;
  const ERASER_SIZE = 22;

  let surfaceEl: HTMLElement;
  let canvasEl: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;

  // Ephemeral: strokes/text live only in this instance and are discarded when
  // the parent remounts the component on card change.
  let strokes: Stroke[] = [];
  let activeStroke: Stroke | null = null;

  let tool: Tool = "pen";
  let showText = false;
  let text = "";
  let inkColor = "currentColor";
  let wasOpen = false;

  function scaleForDpr() {
    const dpr = window.devicePixelRatio || 1;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Size the bitmap to the surface at device-pixel resolution so ink stays crisp.
  function resize() {
    if (!canvasEl || !surfaceEl) return;
    const rect = surfaceEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(rect.width * dpr);
    canvasEl.height = Math.round(rect.height * dpr);
    ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    scaleForDpr();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    inkColor = getComputedStyle(surfaceEl).color || inkColor;
    redraw();
  }

  function clearBitmap() {
    if (!ctx || !canvasEl) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    scaleForDpr();
  }

  function drawStroke(s: Stroke) {
    if (!ctx || s.points.length === 0) return;
    ctx.globalCompositeOperation =
      s.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    const first = s.points[0];
    ctx.moveTo(first.x, first.y);
    if (s.points.length === 1) {
      ctx.lineTo(first.x + 0.1, first.y + 0.1);
    } else {
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x, s.points[i].y);
      }
    }
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  function redraw() {
    if (!ctx) return;
    clearBitmap();
    for (const s of strokes) drawStroke(s);
    if (activeStroke) drawStroke(activeStroke);
  }

  function pointFrom(e: PointerEvent): Point {
    const rect = canvasEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // One pointer path covers finger, mouse, and pen via pointer capture.
  function onPointerDown(e: PointerEvent) {
    if (!ctx) resize();
    if (!ctx) return;
    canvasEl.setPointerCapture(e.pointerId);
    activeStroke = {
      tool,
      color: inkColor,
      size: tool === "eraser" ? ERASER_SIZE : PEN_SIZE,
      points: [pointFrom(e)],
    };
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!activeStroke || !ctx) return;
    const pts = activeStroke.points;
    const to = pointFrom(e);
    const from = pts[pts.length - 1];
    pts.push(to);
    // Draw just the new segment for responsiveness; redraw() rebuilds the rest.
    ctx.globalCompositeOperation =
      activeStroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = activeStroke.color;
    ctx.lineWidth = activeStroke.size;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    e.preventDefault();
  }

  function onPointerUp(e: PointerEvent) {
    if (!activeStroke) return;
    strokes = [...strokes, activeStroke];
    activeStroke = null;
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
  }

  function selectTool(next: Tool) {
    tool = next;
  }

  function toggleText() {
    showText = !showText;
    if (showText) tick().then(resize);
  }

  function undo() {
    if (strokes.length === 0) return;
    strokes = strokes.slice(0, -1);
    redraw();
  }

  function clearAll() {
    strokes = [];
    text = "";
    redraw();
  }

  // Grow the text box to its content; re-fit re-sizes the canvas above it.
  function autogrow(node: HTMLTextAreaElement, _value: string) {
    const fit = () => {
      node.setCssProps({ height: "auto" });
      node.setCssProps({ height: `${node.scrollHeight}px` });
      if (open) resize();
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

  // The surface has no size while hidden, so (re)size when it becomes visible.
  $: if (open && !wasOpen) {
    wasOpen = true;
    tick().then(resize);
  } else if (!open && wasOpen) {
    wasOpen = false;
  }

  onMount(() => {
    const onWindowResize = () => {
      if (open) resize();
    };
    window.addEventListener("resize", onWindowResize);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && surfaceEl) {
      ro = new ResizeObserver(() => {
        if (open) resize();
      });
      ro.observe(surfaceEl);
    }
    if (open) tick().then(resize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      ro?.disconnect();
    };
  });

  $: hasContent = strokes.length > 0 || text.trim().length > 0;
</script>

<div class="decks-scratchpad-panel" class:decks-scratchpad-open={open}>
  <div class="decks-scratchpad-toolbar">
    <button
      class="decks-icon-btn clickable-icon decks-scratchpad-tool"
      class:decks-scratchpad-tool-active={tool === "pen"}
      on:click={() => selectTool("pen")}
      title={r.scratchpadPen}
      aria-label={r.scratchpadPen}
      type="button"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
      </svg>
    </button>
    <button
      class="decks-icon-btn clickable-icon decks-scratchpad-tool"
      class:decks-scratchpad-tool-active={tool === "eraser"}
      on:click={() => selectTool("eraser")}
      title={r.scratchpadEraser}
      aria-label={r.scratchpadEraser}
      type="button"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"></path>
        <path d="M22 21H7"></path>
        <path d="m5 11 9 9"></path>
      </svg>
    </button>
    <button
      class="decks-icon-btn clickable-icon decks-scratchpad-tool"
      class:decks-scratchpad-tool-active={showText}
      on:click={toggleText}
      title={r.scratchpadText}
      aria-label={r.scratchpadText}
      type="button"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 7 4 4 20 4 20 7"></polyline>
        <line x1="9" y1="20" x2="15" y2="20"></line>
        <line x1="12" y1="4" x2="12" y2="20"></line>
      </svg>
    </button>

    <span class="decks-scratchpad-spacer"></span>

    <button
      class="decks-icon-btn clickable-icon decks-scratchpad-tool"
      on:click={undo}
      disabled={strokes.length === 0}
      title={r.undo}
      aria-label={r.undo}
      type="button"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7v6h6"></path>
        <path d="M21 17a9 9 0 0 0-15-6.7L3 13"></path>
      </svg>
    </button>
    <button
      class="decks-icon-btn clickable-icon decks-scratchpad-tool"
      on:click={clearAll}
      disabled={!hasContent}
      title={r.scratchpadClear}
      aria-label={r.scratchpadClear}
      type="button"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    </button>
    <button
      class="decks-icon-btn clickable-icon decks-scratchpad-tool"
      on:click={() => dispatch("close")}
      title={r.close}
      aria-label={r.close}
      type="button"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  </div>

  <div class="decks-scratchpad-surface" bind:this={surfaceEl}>
    <canvas
      class="decks-scratchpad-canvas"
      bind:this={canvasEl}
      on:pointerdown={onPointerDown}
      on:pointermove={onPointerMove}
      on:pointerup={onPointerUp}
      on:pointercancel={onPointerUp}
    ></canvas>
  </div>

  {#if showText}
    <div class="decks-scratchpad-textwrap">
      <textarea
        class="decks-scratchpad-textarea"
        use:autogrow={text}
        bind:value={text}
        placeholder={r.scratchpadTextPlaceholder}
      ></textarea>
    </div>
  {/if}
</div>

<style>
  .decks-scratchpad-panel {
    display: none;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    box-sizing: border-box;
  }

  .decks-scratchpad-panel.decks-scratchpad-open {
    display: flex;
    flex: 1;
  }

  .decks-scratchpad-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
  }

  .decks-scratchpad-spacer {
    flex: 1;
  }

  .decks-scratchpad-tool-active {
    color: var(--text-on-accent);
    background: var(--interactive-accent);
  }

  .decks-scratchpad-tool-active:hover {
    background: var(--interactive-accent-hover);
  }

  .decks-scratchpad-surface {
    position: relative;
    flex: 1;
    min-height: 0;
    color: var(--text-normal);
    background: var(--background-primary);
    touch-action: none;
  }

  .decks-scratchpad-canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
    cursor: crosshair;
  }

  .decks-scratchpad-textwrap {
    flex-shrink: 0;
    padding: 8px 12px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .decks-scratchpad-textarea {
    width: 100%;
    min-height: 140px;
    max-height: 45vh;
    resize: none;
    overflow-y: auto;
    box-sizing: border-box;
    font-family: var(--font-text);
    color: var(--text-normal);
    background: var(--background-primary);
  }

  :global(.decks-modal-mobile) .decks-scratchpad-tool {
    width: 40px;
    height: 40px;
  }
</style>
