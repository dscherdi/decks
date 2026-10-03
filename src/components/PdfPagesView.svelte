<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { setIcon } from "obsidian";
  import { I18n, type PassageText, type PdfPage } from "@decks/core";
  import {
    paintPage,
    readPanelSelection,
    releasePdfPage,
    type PagePaint,
    type PdfDoc,
  } from "../utils/pdf";
  import { canvasBudget, planWindow, renderScale } from "../utils/pdf-page-layout";

  /** Read once when mounted; key the view on the document to show another one. */
  export let doc: PdfDoc;
  export let cardsByPage: Record<number, number> = {};
  /** A page to scroll to once; `onFocusDone` reports it so a remount does not repeat it. */
  export let focus: { page: number; seq: number } | null = null;
  export let onFocusDone: (seq: number) => void = () => {};
  export let startPage = 1;
  export let onPageChange: (page: number) => void = () => {};
  export let compact = false;
  /** Other work is in flight, so the passage actions wait. */
  export let disabled = false;
  export let busy: "ask" | "cards" | null = null;
  export let askAvailable = true;
  export let onAsk: (passage: PassageText, question: string) => void = () => {};
  export let onMakeCards: (passage: PassageText) => void = () => {};

  const g = I18n.t.modals.aiGenerator;
  const r = g.reader;

  // Gap kept above a page scrolled into view, matching the scroller's padding.
  const TOP_GAP = 8;

  interface Painting {
    page: PdfPage | null;
    paint: PagePaint | null;
  }

  let ready = false;
  let pageNumbers: number[] = [];
  /** Width over height; page 1's stands in for each page until that page is fetched. */
  let defaultAspect = 0;
  let aspects: Record<number, number> = {};
  let textless = new Set<number>();
  let passage: PassageText | null = null;
  let question = "";

  let scroller: HTMLElement | undefined;
  const pageEls = new Map<number, HTMLElement>();
  const visible = new Set<number>();
  const painted = new Map<number, Painting>();
  let queue: number[] = [];
  let pumping = false;
  let destroyed = false;

  let intersection: IntersectionObserver | null = null;
  let resizer: ResizeObserver | null = null;
  let selectionDoc: Document | null = null;
  let windowTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWidth = 0;
  let resizing = false;
  /** Where the reader is: a page and how far into it the view starts, as a share of its height. */
  let anchor = { page: 1, fraction: 0 };
  let reported = 0;
  let appliedFocus: number | null = null;

  $: locked = disabled || busy !== null;
  $: if (ready && focus) applyFocus(focus);

  onMount(() => {
    void open();
  });

  async function open(): Promise<void> {
    try {
      const base = (await doc.getPage(1)).getViewport({ scale: 1 });
      if (base.width > 0 && base.height > 0) {
        defaultAspect = base.width / base.height;
        aspects = { 1: defaultAspect };
      }
    } catch (e) {
      console.debug("Decks: could not read the first PDF page", e);
    }
    if (destroyed) return;
    pageNumbers = Array.from({ length: doc.numPages }, (_, i) => i + 1);
    ready = true;
    await tick();
    if (destroyed || !scroller) return;
    watch(scroller);
    if (focus) applyFocus(focus);
    else goTo(startPage);
    scheduleWindow();
  }

  function watch(root: HTMLElement): void {
    intersection = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number(entry.target.getAttribute("data-page-number"));
          if (!Number.isInteger(n)) continue;
          if (entry.isIntersecting) visible.add(n);
          else visible.delete(n);
        }
        scheduleWindow();
      },
      // Half a view either way, so the next page is painted before it scrolls in.
      { root, rootMargin: "50% 0px" },
    );
    for (const el of pageEls.values()) intersection.observe(el);

    lastWidth = root.clientWidth;
    resizer = new ResizeObserver(() => {
      if (!scroller || Math.abs(scroller.clientWidth - lastWidth) < 2) return;
      resizing = true;
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onResize, 200);
    });
    resizer.observe(root);

    selectionDoc = root.doc;
    selectionDoc.addEventListener("selectionchange", onSelectionChange);
  }

  function track(node: HTMLElement, n: number) {
    pageEls.set(n, node);
    intersection?.observe(node);
    return {
      destroy() {
        pageEls.delete(n);
        intersection?.unobserve(node);
      },
    };
  }

  function aspect(node: HTMLElement, ratio: number) {
    const apply = (value: number): void => {
      if (value > 0) node.setCssProps({ "--decks-page-aspect": String(value) });
    };
    apply(ratio);
    return { update: apply };
  }

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
  }

  // --- Position ---------------------------------------------------------------

  function clampPage(n: number): number {
    return Math.min(Math.max(Math.round(n) || 1, 1), Math.max(pageNumbers.length, 1));
  }

  /** The page under a line a quarter of the way down the view, so a page scrolled to its top reads as current. */
  function pageInView(): number {
    if (!scroller) return anchor.page;
    const line = scroller.scrollTop + scroller.clientHeight / 4;
    let best = anchor.page;
    let bestTop = -Infinity;
    for (const n of visible) {
      const top = pageEls.get(n)?.offsetTop;
      if (top !== undefined && top <= line && top > bestTop) {
        best = n;
        bestTop = top;
      }
    }
    return best;
  }

  function goTo(n: number): void {
    const page = clampPage(n);
    const el = pageEls.get(page);
    if (!el || !scroller) return;
    scroller.scrollTo({ top: Math.max(0, el.offsetTop - TOP_GAP) });
    anchor = { page, fraction: (scroller.scrollTop - el.offsetTop) / Math.max(1, el.offsetHeight) };
  }

  function applyFocus(f: { page: number; seq: number }): void {
    if (f.seq === appliedFocus || !pageEls.has(clampPage(f.page))) return;
    appliedFocus = f.seq;
    goTo(f.page);
    onFocusDone(f.seq);
  }

  function restoreAnchor(): void {
    const el = pageEls.get(anchor.page);
    if (el && scroller) scroller.scrollTop = el.offsetTop + anchor.fraction * el.offsetHeight;
  }

  function onScroll(): void {
    if (scrollTimer !== null) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      // A resize moves the content under the view; the anchor from before it still holds.
      if (resizing || !scroller) return;
      const page = pageInView();
      const el = pageEls.get(page);
      if (el) {
        anchor = { page, fraction: (scroller.scrollTop - el.offsetTop) / Math.max(1, el.offsetHeight) };
      }
      if (page !== reported) {
        reported = page;
        onPageChange(page);
      }
    }, 150);
  }

  /** A new width repaints every page at it, and keeps the reader's place. */
  function onResize(): void {
    resizeTimer = null;
    resizing = false;
    if (!scroller) return;
    lastWidth = scroller.clientWidth;
    queue = [];
    for (const n of [...painted.keys()]) release(n);
    restoreAnchor();
    scheduleWindow();
  }

  // --- Painting ---------------------------------------------------------------

  // A timer rather than a frame: frames stop in a hidden window, timers only slow down.
  function scheduleWindow(): void {
    if (windowTimer !== null) return;
    windowTimer = setTimeout(() => {
      windowTimer = null;
      refreshWindow();
    }, 30);
  }

  function refreshWindow(): void {
    if (destroyed || !scroller) return;
    const plan = planWindow({
      visible: [...visible],
      painted: [...painted.keys()],
      budget: canvasBudget(compact),
      pinned: passage?.page ?? null,
      anchor: pageInView(),
    });
    for (const n of plan.evict) release(n);
    queue = plan.paint;
    if (!pumping) void pump();
  }

  async function pump(): Promise<void> {
    pumping = true;
    try {
      while (!destroyed && queue.length > 0) {
        const n = queue.shift();
        if (n === undefined || painted.has(n) || !visible.has(n)) continue;
        await paint(n);
      }
    } finally {
      pumping = false;
    }
  }

  async function paint(n: number): Promise<void> {
    const entry: Painting = { page: null, paint: null };
    painted.set(n, entry);
    const live = (): boolean => !destroyed && painted.get(n) === entry;
    try {
      const page = await doc.getPage(n);
      if (!live()) {
        releasePdfPage(page);
        return;
      }
      entry.page = page;
      const base = page.getViewport({ scale: 1 });
      if (base.width > 0 && base.height > 0) {
        const ratio = base.width / base.height;
        if (Math.abs(ratio - (aspects[n] ?? defaultAspect)) > 0.001) {
          await reshape(n, ratio);
          if (!live()) return;
        }
      }
      const el = pageEls.get(n);
      const scale = el ? renderScale(el.clientWidth, base, el.win.devicePixelRatio) : null;
      if (!el || !scale || scale.css <= 0) {
        // Not laid out yet (a hidden pane); the next resize or scroll tries again.
        painted.delete(n);
        releasePdfPage(page);
        return;
      }
      entry.paint = paintPage(page, el, scale);
      const hasText = await entry.paint.done;
      if (live()) markText(n, hasText);
    } catch (e) {
      if (live()) console.debug(`Decks: could not paint PDF page ${n}`, e);
    }
  }

  /** A page's own shape replaces the stand-in; one starting above the view keeps the view still. */
  async function reshape(n: number, ratio: number): Promise<void> {
    const el = pageEls.get(n);
    const before = el?.offsetHeight ?? 0;
    const above = Boolean(el && scroller && el.offsetTop < scroller.scrollTop);
    aspects = { ...aspects, [n]: ratio };
    await tick();
    if (above && el && scroller) scroller.scrollTop += el.offsetHeight - before;
  }

  function markText(n: number, hasText: boolean): void {
    if (hasText === !textless.has(n)) return;
    const next = new Set(textless);
    if (hasText) next.delete(n);
    else next.add(n);
    textless = next;
  }

  function release(n: number): void {
    const entry = painted.get(n);
    if (!entry) return;
    painted.delete(n);
    entry.paint?.release();
    if (entry.page) releasePdfPage(entry.page);
  }

  // --- Passage ----------------------------------------------------------------

  // Only a new selection replaces the passage: focusing the question box collapses it.
  function onSelectionChange(): void {
    if (selectionTimer !== null) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      selectionTimer = null;
      if (!scroller) return;
      const next = readPanelSelection(scroller);
      if (next) passage = next;
    }, 200);
  }

  function clearPassage(): void {
    passage = null;
    question = "";
    const selection = scroller?.doc.getSelection();
    const at = selection?.anchorNode;
    if (scroller && at && scroller.contains(at)) selection?.removeAllRanges();
  }

  function ask(): void {
    const q = question.trim();
    if (!passage || !q || locked || !askAvailable) return;
    onAsk(passage, q);
    question = "";
  }

  function makeCards(): void {
    if (!passage || locked) return;
    onMakeCards(passage);
  }

  function onQuestionKey(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    ask();
  }

  onDestroy(() => {
    destroyed = true;
    intersection?.disconnect();
    resizer?.disconnect();
    selectionDoc?.removeEventListener("selectionchange", onSelectionChange);
    for (const timer of [windowTimer, scrollTimer, selectionTimer, resizeTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    queue = [];
    for (const n of [...painted.keys()]) release(n);
  });
</script>

<div class="decks-pdf-pages-view" class:is-compact={compact}>
  <div class="decks-pdf-pages" bind:this={scroller} on:scroll={onScroll}>
    {#if ready}
      {#each pageNumbers as n (n)}
        <div
          class="decks-pdf-page"
          data-page-number={n}
          use:track={n}
          use:aspect={aspects[n] ?? defaultAspect}
        >
          <div class="decks-pdf-page-meta">
            <span class="decks-pdf-page-label">{I18n.format(r.selectionPage, { page: n })}</span>
            {#if (cardsByPage[n] ?? 0) > 0}
              <span
                class="decks-pdf-page-badge"
                title={I18n.format(g.pdfPageCards, { page: n, count: cardsByPage[n] })}
                >{cardsByPage[n]}</span
              >
            {/if}
            {#if textless.has(n)}
              <span class="decks-pdf-page-note">{g.pdfPanel.noText}</span>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="decks-pdf-passage">
    {#if passage}
      <div class="decks-pdf-passage-head">
        <span class="decks-pdf-passage-label">{r.selectionOn}</span>
        {#if passage.page}
          {@const page = passage.page}
          <button type="button" class="decks-pdf-passage-page" on:click={() => goTo(page)}>
            {I18n.format(r.selectionPage, { page })}
          </button>
        {/if}
        <button
          type="button"
          class="clickable-icon decks-pdf-passage-clear"
          aria-label={g.pdfPanel.clearPassage}
          use:icon={"x"}
          on:click={clearPassage}
        ></button>
      </div>
      <blockquote class="decks-pdf-passage-text">{passage.text}</blockquote>
      <div class="decks-pdf-passage-actions">
        {#if askAvailable}
          <input
            type="text"
            class="decks-pdf-passage-input"
            placeholder={r.askPlaceholder}
            aria-label={r.askPlaceholder}
            bind:value={question}
            on:keydown={onQuestionKey}
          />
          <button type="button" disabled={locked || question.trim() === ""} on:click={ask}>
            {busy === "ask" ? r.asking : r.ask}
          </button>
        {/if}
        <button type="button" class="mod-cta" disabled={locked} on:click={makeCards}>
          {busy === "cards" ? r.making : r.makeCards}
        </button>
      </div>
    {:else}
      <div class="decks-pdf-passage-empty">{r.noSelection}</div>
    {/if}
  </div>
</div>

<style>
  .decks-pdf-pages-view {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .decks-pdf-pages {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* The view keeps its place itself, the same way in every engine. */
    overflow-anchor: none;
    padding: 8px;
    background: var(--background-secondary);
  }
  .decks-pdf-page {
    position: relative;
    width: 100%;
    aspect-ratio: var(--decks-page-aspect, 0.773);
    margin-bottom: 12px;
    background: #fff;
    box-shadow: var(--shadow-s);
  }
  .decks-pdf-page:last-child {
    margin-bottom: 0;
  }

  /* The canvas and text layer are added at paint time, outside the component's markup. */
  .decks-pdf-page :global(canvas.decks-pdf-canvas) {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }
  .decks-pdf-page :global(.decks-pdf-text-layer) {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: clip;
    line-height: 1;
    text-align: initial;
    text-size-adjust: none;
    -webkit-text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    caret-color: CanvasText;
    user-select: text;
    -webkit-user-select: text;
  }
  .decks-pdf-page :global(.decks-pdf-text-layer span),
  .decks-pdf-page :global(.decks-pdf-text-layer br) {
    position: absolute;
    color: transparent;
    white-space: pre;
    cursor: text;
    transform-origin: 0 0;
  }
  .decks-pdf-page :global(.decks-pdf-text-layer span.markedContent) {
    top: 0;
    height: 0;
  }
  .decks-pdf-page :global(.decks-pdf-text-layer ::selection) {
    background: color-mix(in srgb, var(--interactive-accent) 35%, transparent);
  }
  .decks-pdf-page :global(.decks-pdf-text-layer br::selection) {
    background: transparent;
  }

  .decks-pdf-page-meta {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 2;
    max-width: calc(100% - 8px);
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .decks-pdf-page-label,
  .decks-pdf-page-note {
    padding: 0 5px;
    border-radius: var(--radius-s);
    background: var(--background-primary);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.6;
  }
  .decks-pdf-page-label {
    opacity: 0.85;
  }
  .decks-pdf-page-badge {
    pointer-events: auto;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: var(--font-ui-smaller);
    line-height: 1.6;
    font-variant-numeric: tabular-nums;
  }
  .decks-pdf-page-note {
    flex-basis: 100%;
    text-align: right;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .decks-pdf-page:hover .decks-pdf-page-note {
    opacity: 1;
  }
  @media (hover: none) {
    .decks-pdf-page-note {
      opacity: 0.9;
    }
  }

  .decks-pdf-passage {
    flex: 0 0 auto;
    max-height: 45%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
  }
  .decks-pdf-passage-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }
  .decks-pdf-passage-page {
    height: auto;
    padding: 0 6px;
    font-size: var(--font-ui-smaller);
    box-shadow: none;
  }
  .decks-pdf-passage-clear {
    margin-left: auto;
  }
  .decks-pdf-passage-text {
    margin: 0;
    padding: 0 0 0 8px;
    border-left: 2px solid var(--interactive-accent);
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    line-height: 1.4;
    overflow: hidden;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }
  .decks-pdf-passage-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .decks-pdf-passage-input {
    flex: 1 1 160px;
    min-width: 0;
  }
  .decks-pdf-pages-view.is-compact .decks-pdf-passage-input {
    flex-basis: 100%;
  }
  .decks-pdf-passage-empty {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }
</style>
