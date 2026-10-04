<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { type App, type TFile, setIcon } from "obsidian";
  import { I18n, ThinkingBuffer, planChunks, chunkLabel, shouldChunk, ESTIMATED_PAGE_CHARS, type SourceChunk, type SelectedSection, type GenerationStage, type AiProviderId, type AiSessionTurn, type AiStagedCard, type AnswerGap, type BlueprintSection, type ChatRequest, type ChatResult, type ChatTurn, type ConceptCard, type ConceptRow, type OverlapCard, type ExamSettings, type QuestionMix, type SourceConcept, type CardVerdict, type CritiqueCard, type GeneratedCard, type GenerateHandlers, type GenerateResult, type RefactorImage, type ThreadBlock, type GeneratedCardType, type McqProblem, EXAMS_PROFILE_ID, DEFAULT_EXAM_SETTINGS, buildConceptRows, generatedCardId, cardsForConcepts, fixInstructionFor, isQuestionShaped, type FixAction, chapterIdsForPages, checkGeneratedMcq, continuationCards, offersContinue, conceptsByPage, isCrammed, isPlannable, sectionHasNothingToLearn, sessionName, getExamDeckTag, fixActionFor, formatPageList, insertAfter, isRefinement, lastResultBlock, localRowId, nextRowCounter, ocrSentinelForTier, pruneBlocks, roundsByTurn, supersededIds, threadFromTurns, unmatchedCards, passageSource, type PassageText } from "@decks/core";
  import AiPromptComposer from "./AiPromptComposer.svelte";
  import ChapterPanel from "./ChapterPanel.svelte";
  import PdfPanel from "./PdfPanel.svelte";
  import PdfPagesView from "./PdfPagesView.svelte";
  import {
    PDF_PANE_DEFAULT_WIDTH,
    PDF_PANE_MIN_WIDTH,
    chipToggle,
    clampPaneWidth,
    paneMaxWidth,
    pdfPanelViews,
    shownPdfView,
    type PdfPanelView,
  } from "./pdf-panel";
  import AiCoveragePanel from "./AiCoveragePanel.svelte";
  import ExamBlueprintPanel from "./ExamBlueprintPanel.svelte";
  import { buildModelOptions } from "../utils/ai-model-options";
  import { openVaultPdf } from "../utils/pdf-open";
  import AiThread from "./AiThread.svelte";
  import AiStageLine from "./AiStageLine.svelte";
  import AiStagedPanel from "./AiStagedPanel.svelte";
  import ExamDraftPanel from "./ExamDraftPanel.svelte";
  import DocInfoButton from "./DocInfoButton.svelte";
import { FilePickerModal } from "../utils/file-picker";
  import { FolderPickerModal } from "../utils/folder-picker";
  import {
    type ContextItem,
    buildGenerationComposerRequest,
    savePastedImage,
    IMAGE_EXTENSIONS,
    PDF_MAX_BYTES,
  } from "../utils/attachments";
  import {
    type ChapterNode,
    type PdfDoc,
    loadPdf,
    extractOutline,
    buildSectionContent,
    pagesForSelection,
    sectionsForSelection,
    hashPdf,
  } from "../utils/pdf";
  import type { OcrDebugEntry, OcrProgress, PdfOcrCache } from "@decks/core";
  import type { PdfReading } from "../settings";
  import type { SaveFormat } from "../services/FlashcardComposer";
  import type { GeneratorSaveRequest, ProfileOpt } from "./generator-save";
  import type {
    AiGeneratorOptions,
    AiSessionRestore,
    AiSessionSnapshot,
    GenRow,
    MentionItem,
    PdfAttachment,
    PdfSource,
    PdfTab,
    ConceptLedgerOps,
  } from "./ai-generator-types";

  export let app: App;
  export let generate: (
    options: {
      prompt: string;
      sourceContext?: string;
      images?: unknown[];
      maxBatches?: number;
      existingCards?: GeneratedCard[];
      refining?: GeneratedCard[];
      model?: string;
      cardType?: GeneratedCardType;
      debug?: boolean;
    },
    handlers: GenerateHandlers,
    signal: AbortSignal,
  ) => Promise<GenerateResult>;
  export let generateChunked: AiGeneratorOptions["generateChunked"] = undefined;
  export let save: (
    cards: GeneratedCard[],
    request: GeneratorSaveRequest,
  ) => Promise<{
    ok: boolean;
    error?: string;
    /** Cards actually written — kept minus any the deck already held. */
    count?: number;
    /** Kept cards the destination deck already held. */
    skipped?: number;
    /** Kept cards another deck already held, so they were not written. */
    elsewhere?: number;
    deckId?: string;
    filePath?: string;
  }>;
  export let critique: (
    cards: CritiqueCard[],
    model?: string,
    signal?: AbortSignal,
    cardType?: GeneratedCardType,
  ) => Promise<CardVerdict[] | null> = () => Promise.resolve(null);
  export let refine: (
    card: GeneratedCard,
    options: {
      instructions?: string;
      split?: boolean;
      cloze?: boolean;
      sourceContext?: string;
      model?: string;
    },
    signal?: AbortSignal,
  ) => Promise<GeneratedCard[]> = () => Promise.resolve([]);
  export let persistSession: (
    snapshot: AiSessionSnapshot,
  ) => Promise<string | null> = () => Promise.resolve(null);
  export let restoreSession: (() => Promise<AiSessionRestore | null>) | undefined =
    undefined;
  export let loadProfiles: () => Promise<ProfileOpt[]>;
  export let defaultFolder = "";
  export let canvasFolder = "";
  export let deckTag = "#decks";
  export let renderMarkdown: (source: string, el: HTMLElement) => void;
  export let aiProvider: AiProviderId;
  export let pdfReading: PdfReading = "auto";
  export let defaultModel = "";
  /** Remember the tier chosen here; there is no settings control for it. */
  export let onModelChange: (id: string) => void = () => {};
  export let keepSourcePdf: ((hash: string, bytes: ArrayBuffer) => Promise<void>) | undefined = undefined;
  export let readSourcePdf: ((hash: string) => Promise<ArrayBuffer | null>) | undefined = undefined;
  export let pdfPaneWidth: number | undefined = undefined;
  export let onPdfPaneWidth: (width: number) => void = () => {};
  export let debugEnabled = false;
  export let pdfAvailable = false;
  export let pdfOcr: PdfOcrCache | null = null;
  /** The concept ledger's five operations, or null when there is no AI to run
   *  the extraction with. Absent, the coverage panel is never offered. */
  export let conceptLedger: ConceptLedgerOps | null = null;
  /** Reads what the destination deck can already contribute to an attempt and
   *  stores the attempt defaults; null when no exam profile is configured. */
  export let examPlanner: {
    mix: (
      filePath: string,
      typedGrading: ExamSettings["typedGrading"],
    ) => Promise<QuestionMix>;
    defaults: (profileId: string) => Promise<ExamSettings | null>;
    saveDefaults: (profileId: string, settings: ExamSettings) => Promise<void>;
  } | null = null;
  /** Answer a question about the attached source. Absent when AI is off, and
   *  then the composer offers no Ask. */
  export let ask:
    | ((req: ChatRequest, signal?: AbortSignal) => Promise<ChatResult>)
    | undefined = undefined;
  /** Fronts of the cards a deck note holds, for asking what the pile misses. */
  export let deckFronts: ((filePath: string) => Promise<string[]>) | undefined = undefined;
  /** Cards in a destination file that test the same fact; absent when unavailable. */
  export let similar:
    | ((filePath: string, staged: OverlapCard[], signal?: AbortSignal) => Promise<Map<string, string[]>>)
    | undefined = undefined;
  /** Rework saved cards in place, by flashcard id; `split` offers each as several. */
  export let repairCards: ((flashcardIds: string[], split: boolean) => void) | undefined =
    undefined;
  /** Open the session already aimed at something: the ask written, and the
   *  source narrowed to the pages it came from. */
  export let seed: {
    prompt: string;
    pdfPath?: string;
    pages?: number[];
  } | null = null;
  /** Open on this card with the flagged filter on, once the pile is restored. */
  export let focus: { rowId: string } | undefined = undefined;

  // Settles once the stored pile is back, so an outside action never works on an empty one.
  let restored: Promise<void> = Promise.resolve();

  /** Keep a flagged card over its flag, or discard it, from outside the session. */
  export async function applyTriage(rowId: string, action: "keep" | "discard"): Promise<boolean> {
    await restored;
    const row = rows.find((r) => r.id === rowId);
    if (!row || row.saved || !row.keep || row.verdict?.verdict !== "flagged") return false;
    rows = rows.map((r) =>
      r.id !== rowId
        ? r
        : action === "discard"
          ? { ...r, keep: false }
          : { ...r, verdict: r.verdict ? { ...r.verdict, verdict: "pass" as const } : r.verdict },
    );
    await persistNow();
    return true;
  }

  /** Show the thread narrowed to what needs attention, with this card open. */
  export async function focusRow(rowId: string): Promise<void> {
    await restored;
    if (!rows.some((r) => r.id === rowId)) return;
    flaggedOnly = true;
    selectedId = rowId;
    await tick();
    document
      .querySelector(`.decks-ai-gen-rowwrap[data-row-id="${CSS.escape(rowId)}"]`)
      ?.scrollIntoView({ block: "center" });
  }

  const g = I18n.t.modals.aiGenerator;

  // Last generation's request payload + raw response, shown in the debug panel.
  let lastDebug: GenerateResult["debug"] | null = null;
  // Per-page OCR exchanges (image + transcription) for the debug panel; capped.
  let ocrDebug: OcrDebugEntry[] = [];
  const OCR_DEBUG_MAX = 12;
  // Debug panel is collapsed by default; toggled from the header button.
  let showDebug = false;

  function toggleDebug() {
    // The modal widens itself from the panels present in the DOM — see styles.css.
    showDebug = !showDebug;
  }

  // Per-prompt model picker: defaults to the global model, overrides this run only.
  const modelOptions = buildModelOptions(aiProvider, defaultModel);
  let selectedModel = defaultModel;
  $: if (selectedModel && selectedModel !== defaultModel) onModelChange(selectedModel);

  // One generation round per click. Continuation is manual: after a round the
  // Generate button switches to "Continue generating" (see canContinue) until a
  // round adds nothing new and isn't truncated.
  const MAX_BATCHES = 1;
  // Caps on attached context (bounds payload size / token cost / memory).
  const MAX_CONTEXT_NOTES = 10;
  const MAX_CONTEXT_IMAGES = 10;
  // True after a round that may have more to produce (cards were added, or the
  // response was cut off by the output-token limit) → offer "Continue generating".
  let canContinue = false;

  let phase: "idle" | "streaming" | "review" | "saving" = "idle";
  let rows: GenRow[] = [];
  // The thread: what was asked and what came back, in order. Holds row ids, not
  // rows, so the thread and the staged panel stay two views of one list.
  let blocks: ThreadBlock[] = [];
  // When each prompt and answer was said, so a save does not restamp the whole log.
  const saidAt = new Map<string, string>();
  // What this session generates. Persisted with the session, so Resume reopens
  // an exam draft as an exam draft.
  let cardType: GeneratedCardType = "basic";
  $: cardTypeOptions = [
    { id: "basic", name: g.typeBasic },
    { id: "mcq", name: g.typeMcq },
  ];
  let blockCounter = 0;
  let partial: GeneratedCard | null = null;
  /** Where the running round is, and its thinking so far; neither outlives the round. */
  let stage: GenerationStage | null = null;
  /** When the round started or last produced a card, for the slow hint. */
  let progressAt = 0;
  let thinkingText = "";
  const thinking = new ThinkingBuffer((text) => (thinkingText = text));
  /** The round still streaming, so its cards read as not yet settled. */
  let streamingBlockId: string | null = null;
  let selectedId: string | null = null;
  let genError: string | null = null;
  let abortController: AbortController | null = null;
  let rowCounter = 0;
  let includeGenerated = false;
  let hasSaved = false;
  let sourceCovered = false;

  // Counts what this session wrote to the vault, not what is on screen — those
  // cards survive Clear, so the tally has to as well.
  let savedTotal = 0;
  // Proposed cards the destination deck already held, so the tally explains the
  // gap between "Save 9" and nine cards appearing.
  let skippedTotal = 0;
  let elsewhereTotal = 0;
  // True while the second pass is scoring a round. The cards are already usable,
  // so this only annotates — it never blocks the list.
  let critiquing = false;
  // The source text of the last run, so "add the missing context" can go back to
  // the page the card came from rather than guessing at it.
  let lastSourceContext = "";

  $: superseded = supersededIds(blocks);
  // What the session is about: its PDFs and notes, else the first thing asked.
  $: sourceChips = [
    ...pdfs.map((p) => ({ id: p.contextId, kind: "pdf" as const, label: p.label, path: p.vaultPath ?? p.label })),
    ...contexts
      .filter((c) => c.kind === "note")
      .map((c) => ({ id: c.id, kind: "note" as const, label: c.label, path: c.path })),
  ];
  $: sessionTitle =
    sessionName({
      sourceRef: sourceChips[0]?.path ?? "",
      turns: blocks.flatMap((b) =>
        b.kind === "prompt" ? [{ role: "user" as const, text: b.text, at: "" }] : [],
      ),
    }) ?? g.hub.newSession;
  // Rows a refinement replaced: collapsed, never saved, and not counted as coverage.
  $: supersededRows = new Set(
    blocks.flatMap((b) => (b.kind === "result" && superseded.has(b.id) ? b.rowIds : [])),
  );
  $: keptCount = rows.filter((r) => r.keep && !r.saved).length;
  // What Save writes: kept, not in a replaced round, and in question mode only
  // questions that parse; the rest stay on the table.
  $: saveable = rows.filter(
    (r) =>
      r.keep &&
      !r.saved &&
      !supersededRows.has(r.id) &&
      !(cardType === "mcq" && r.invalid),
  );
  // What the exam setup dialog would count. Shown before anything is written,
  // so a question is never saved only to be skipped later.
  $: eligibleCount = rows.filter(
    (r) => r.keep && !r.saved && !supersededRows.has(r.id) && !r.invalid,
  ).length;
  $: skippedCount = rows.filter(
    (r) => r.keep && !r.saved && !supersededRows.has(r.id) && r.invalid,
  ).length;

  // Flagged cards still on the table. Counted over kept rows only: a card the
  // user already discarded needs no attention, whatever the rubric thought.
  $: flaggedCount = rows.filter(
    (r) =>
      r.keep &&
      !r.saved &&
      !supersededRows.has(r.id) &&
      (r.verdict?.verdict === "flagged" || Boolean(r.invalid)),
  ).length;
  /** The thread narrowed to the cards that need attention. */
  let flaggedOnly = false;
  $: if (flaggedCount === 0) flaggedOnly = false;
  /** Rows whose rubric pass did not run, so their round can say so. */
  let unchecked = new Set<string>();

  // Cards per chapter, so an empty section is visible in the tree rather than
  // inferred from the inbox. Keyed by chapter id; unattributed cards fall out.
  // The notice refers to the source it was produced from, so a changed prompt,
  // a different PDF tab or a new chapter selection invalidates it — otherwise it
  // keeps asserting "nothing more to add" about material no longer selected.
  $: if (prompt || activePdfId || contexts) sourceCovered = false;

  $: cardsByChapter = rows.reduce<Record<string, number>>((acc, r) => {
    const n = r.card.section;
    const resolved = n ? null : resolveCardPage(r.card);
    const entry =
      n && n >= 1
        ? sectionIndex[n - 1]
        : resolved
          ? sectionIndex.find((e) => e.pdfHash === resolved.pdfHash && e.pages.includes(resolved.page))
          : undefined;
    if (entry) acc[entry.chapterId] = (acc[entry.chapterId] ?? 0) + 1;
    return acc;
  }, {});

  // Where a card's page came from, or null when it was never in the source.
  // A wrong page is worse than none.
  function resolveCardPage(
    card: GeneratedCard,
  ): { page: number; pdfHash: string } | null {
    const page = card.page;
    if (!page) return null;
    const own = passageCardPdf.get(card);
    if (own) return { page, pdfHash: own };
    const n = card.section;
    const claimed = n && n >= 1 ? sectionIndex[n - 1] : undefined;
    if (claimed) {
      return claimed.pages.includes(page)
        ? { page, pdfHash: claimed.pdfHash }
        : null;
    }
    // No section claimed. Accept the page only when one PDF holds it, so two
    // attached PDFs sharing a page number never resolve to the wrong document.
    const holders = sectionIndex.filter((e) => e.pages.includes(page));
    const hashes = new Set(holders.map((h) => h.pdfHash));
    return holders.length > 0 && hashes.size === 1
      ? { page, pdfHash: holders[0].pdfHash }
      : null;
  }

  // Recomputed locally on every stage, discard and save — no model call, and
  // nothing the model can misreport, unlike the section index it assigns itself.
  $: cardsByPage = countByPage(rows, supersededRows, activePdf?.hash, sectionIndex);

  // `index` is passed so the count follows the section index, which resolving reads.
  function countByPage(
    current: GenRow[],
    replaced: Set<string>,
    hash: string | undefined,
    index: typeof sectionIndex,
  ): Record<number, number> {
    const acc: Record<number, number> = {};
    if (!hash || (index.length === 0 && !current.some((r) => passageCardPdf.has(r.card)))) return acc;
    for (const r of current) {
      if ((!r.keep && !r.saved) || replaced.has(r.id)) continue;
      const resolved = resolveCardPage(r.card);
      if (resolved && resolved.pdfHash === hash) {
        acc[resolved.page] = (acc[resolved.page] ?? 0) + 1;
      }
    }
    return acc;
  }

  /** Open the card's source page in the panel's Pages view. */
  function jumpToSourcePage(resolved: { page: number; pdfHash: string }): void {
    const pdf = pdfs.find((p) => p.hash === resolved.pdfHash);
    if (!pdf) return;
    openPdfPanel(pdf.contextId, "pages");
    pagesFocus = { hash: pdf.hash, page: resolved.page, seq: ++focusSeq };
  }

  function canJumpTo(resolved: { pdfHash: string } | null): boolean {
    if (!resolved) return false;
    return pdfs.some((p) => p.hash === resolved.pdfHash);
  }

  function pdfViewLabel(view: PdfPanelView): string {
    if (view === "chapters") return g.pdfChapters;
    if (view === "pages") return g.pdfPanel.pages;
    if (view === "concepts") return g.pdfPanel.concepts;
    return g.pdfPanel.blueprint;
  }

  // A preference: the open PDF panel takes the column without clearing it.
  let showStaged = true;
  $: stagedVisible = showStaged && !(activePdf && panelOpen);
  function toggleStaged(): void {
    if (stagedVisible) {
      showStaged = false;
      return;
    }
    showStaged = true;
    panelOpen = false;
  }

  function openPdfPanel(id: string, view?: PdfPanelView): void {
    activePdfId = id;
    panelOpen = true;
    if (view) panelView = view;
  }

  function togglePdfPanel(id: string): void {
    const next = chipToggle({ open: panelOpen, activeId: activePdfId }, id);
    activePdfId = next.activeId;
    panelOpen = next.open;
  }

  function openActivePdfInViewer(): void {
    if (!activePdf?.vaultPath) return;
    void openVaultPdf(app, activePdf.vaultPath, pagesAt.get(activePdf.hash) ?? null);
  }

  async function askPassage(passage: PassageText, question: string): Promise<void> {
    if (!activePdf) return;
    passageBusy = "ask";
    try {
      await askQuestion(question, { passage, pdfHash: activePdf.hash });
    } finally {
      passageBusy = null;
    }
    if (mobile) panelOpen = false;
  }

  async function cardsFromPassage(passage: PassageText): Promise<void> {
    if (!activePdf) return;
    passageBusy = "cards";
    try {
      await startGenerate({ passage, passagePdf: activePdf.hash, keepIndex: true }, true);
    } finally {
      passageBusy = null;
    }
    if (mobile) panelOpen = false;
  }

  // Drag the pane's inner edge; the width is kept once the drag ends.
  let sideEl: HTMLElement | null = null;
  function startPaneResize(e: PointerEvent): void {
    const host = sideEl?.parentElement;
    if (!sideEl || !host) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sideEl.getBoundingClientRect().width;
    const total = host.getBoundingClientRect().width;
    const win = sideEl.win;
    const onMove = (ev: PointerEvent) => {
      paneWidth = clampPaneWidth(startWidth + (startX - ev.clientX), total);
    };
    const onUp = () => {
      win.removeEventListener("pointermove", onMove);
      win.removeEventListener("pointerup", onUp);
      win.removeEventListener("pointercancel", onUp);
      onPdfPaneWidth(paneWidth);
    };
    win.addEventListener("pointermove", onMove);
    win.addEventListener("pointerup", onUp);
    win.addEventListener("pointercancel", onUp);
  }

  function nudgePane(e: KeyboardEvent): void {
    const host = sideEl?.parentElement;
    if (!host || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? 24 : -24;
    paneWidth = clampPaneWidth(paneWidth + step, host.getBoundingClientRect().width);
    onPdfPaneWidth(paneWidth);
  }
  $: if (sideEl) sideEl.setCssProps({ "--decks-pane-pdf": `${paneWidth}px` });

  /** Aim the next round at uncited pages. Names them in the prompt rather than
   *  narrowing the user's chapter selection behind their back. */
  function generateForGaps(pages: number[]): void {
    if (pages.length === 0 || phase === "streaming") return;
    prompt = I18n.format(g.pdfGapPrompt, { pages: formatPageList(pages) });
    void startGenerate(undefined, true);
  }

  // The pages actually sent for the active PDF — the coverage denominator.
  $: coveredPageSet = new Set(
    sectionIndex
      .filter((e) => e.pdfHash === activePdf?.hash)
      .flatMap((e) => e.pages),
  );

  // --- Concept ledger -----------------------------------------------------

  // What the ledger scores against: this session's live pile, plus what earlier
  // sessions over the same source left behind.
  $: conceptCards = [
    ...rows
      .filter((r) => r.keep || r.saved)
      .map((r): ConceptCard => ({
        id: `row:${r.id}`,
        front: r.card.front,
        back: r.card.back,
        page: r.card.page ?? null,
        conceptId: r.conceptId ?? null,
        lapses: ownLedger.get(r.id)?.lapses ?? 0,
        examMisses: ownLedger.get(r.id)?.examMisses ?? 0,
        crammed: isCrammed(r.verdict?.codes),
        flashcardId: r.saved ? generatedCardId(r.card) : null,
        text: [r.card.front, r.card.back, r.card.notes]
          .filter(Boolean)
          .join("\n"),
      })),
    ...ledgerCards.map((c) => (c.id && conceptMatches.has(c.id) ? { ...c, conceptId: conceptMatches.get(c.id) } : c)),
  ];
  // Cards the term match missed are mapped once each while the coverage panel is open.
  $: if (panelOpen && shownView === "concepts") void mapUnmatched(ledgerConcepts, conceptCards);
  $: conceptRows = buildConceptRows(ledgerConcepts, conceptCards);
  $: conceptsPerPage = conceptsByPage(ledgerConcepts);
  $: void loadLedger(activePdf?.hash ?? null);

  let conceptMatches = new Map<string, string>();
  let mapTried = new Set<string>();
  let mapping = false;

  async function mapUnmatched(
    concepts: Array<SourceConcept & { id: string }>,
    cards: ConceptCard[],
  ): Promise<void> {
    if (!conceptLedger?.map || mapping || concepts.length === 0) return;
    const pending = unmatchedCards(concepts, cards).filter((c) => !mapTried.has(c.id));
    if (pending.length === 0) return;
    for (const c of pending) mapTried.add(c.id);
    mapping = true;
    try {
      const found = await conceptLedger.map(concepts, pending);
      const next = new Map(conceptMatches);
      const rowConcepts = new Map<string, string>();
      for (const [id, concept] of found) {
        if (!concept) continue;
        if (id.startsWith("row:")) {
          rowConcepts.set(id.slice(4), concept);
        } else {
          next.set(id, concept);
          void conceptLedger.remember?.(id, concept).catch(() => undefined);
        }
      }
      conceptMatches = next;
      if (rowConcepts.size > 0) {
        rows = rows.map((r) => (rowConcepts.has(r.id) ? { ...r, conceptId: rowConcepts.get(r.id) } : r));
      }
    } finally {
      mapping = false;
    }
  }

  // Near-duplicates against the append destination, checked once per card and file.
  let similarFile: string | null = null;
  let similarChecked = new Set<string>();
  $: void checkSimilar(saveMode === "append" ? (appendFile?.path ?? null) : null, rows, phase);

  async function checkSimilar(path: string | null, current: GenRow[], currentPhase: string): Promise<void> {
    if (!similar || currentPhase === "streaming") return;
    if (path !== similarFile) {
      similarFile = path;
      similarChecked = new Set();
      if (current.some((r) => r.similarTo)) {
        rows = rows.map((r) => (r.similarTo ? { ...r, similarTo: undefined } : r));
      }
    }
    if (!path) return;
    const pending = current.filter((r) => r.keep && !r.saved && !similarChecked.has(r.id));
    if (pending.length === 0) return;
    for (const r of pending) similarChecked.add(r.id);
    const found = await similar(
      path,
      pending.map((r) => ({ id: r.id, front: r.card.front, back: r.card.back })),
    );
    if (similarFile !== path || found.size === 0) return;
    rows = rows.map((r) => (found.has(r.id) ? { ...r, similarTo: found.get(r.id) } : r));
  }

  async function loadLedger(hash: string | null, force = false): Promise<void> {
    if (hash === ledgerHash && !force) return;
    ledgerHash = hash;
    conceptMatches = new Map();
    mapTried = new Set();
    ledgerConcepts = [];
    ledgerExtracted = new Set();
    sourceLedgerCards = [];
    if (!hash || !conceptLedger) return;
    try {
      const [ledger, cards] = await Promise.all([
        conceptLedger.load(hash),
        conceptLedger.cards(hash),
      ]);
      // A second switch while this one was in flight owns the panel now.
      if (ledgerHash !== hash) return;
      ledgerConcepts = ledger.concepts;
      ledgerExtracted = new Set(ledger.extracted);
      sourceLedgerCards = cards;
    } catch (e) {
      console.debug("Decks: could not load the concept ledger", e);
    }
  }

  /** One read of the selected pages, stored against the document so the pass
   *  runs once per source rather than once per round. */
  async function extractConcepts(): Promise<void> {
    const pdf = activePdf;
    if (!pdf || !conceptLedger || conceptBusy) return;
    const pages = pagesForSelection(pdf.chapters, pdf.selectedIds);
    if (pages.length === 0) return;
    conceptBusy = true;
    conceptError = null;
    const controller = new AbortController();
    try {
      const source = await resolvePdfSource(controller.signal, { only: pdf });
      const found = await conceptLedger.extract(
        source,
        new Set(pages),
        controller.signal,
      );
      await conceptLedger.save(pdf.hash, pages, found);
      await loadLedger(pdf.hash, true);
    } catch (e) {
      conceptError = e instanceof Error ? e.message : String(e);
    } finally {
      conceptBusy = false;
    }
  }

  // --- Exam blueprint -----------------------------------------------------

  // Cards earlier sessions left on each page, so the blueprint's card column
  // reports the whole source rather than only this session.
  $: poolCardsByPage = ledgerCards.reduce<Record<number, number>>((acc, c) => {
    if (c.page) acc[c.page] = (acc[c.page] ?? 0) + 1;
    return acc;
  }, {});

  // The grid reads the whole source, as the ledger beside it does.
  $: sourceCardsByPage = Object.entries(poolCardsByPage).reduce<Record<number, number>>(
    (acc, [page, n]) => ({ ...acc, [page]: (acc[Number(page)] ?? 0) + n }),
    { ...cardsByPage },
  );

  $: blueprintSections = buildBlueprint(
    activePdf,
    cardsByPage,
    poolCardsByPage,
    ledgerExtracted,
    conceptsPerPage,
    questionPlan,
  );

  function buildBlueprint(
    pdf: PdfAttachment | null,
    live: Record<number, number>,
    pool: Record<number, number>,
    extracted: Set<number>,
    concepts: Record<number, number>,
    plan: Record<string, number>,
  ): BlueprintSection[] {
    if (!pdf) return [];
    const row = (sec: { id: string; title: string; pages: number[] }, unselected: boolean): BlueprintSection => ({
      id: sec.id,
      title: sec.title,
      startPage: sec.pages[0] ?? 0,
      endPage: sec.pages[sec.pages.length - 1] ?? 0,
      pages: sec.pages.length,
      cards: sec.pages.reduce(
        (n, page) => n + (live[page] ?? 0) + (pool[page] ?? 0),
        0,
      ),
      questions: unselected ? 0 : (plan[sec.id] ?? 0),
      excluded: !unselected && sectionHasNothingToLearn(sec.pages, extracted, concepts),
      unselected,
    });
    const selected = sectionsForSelection(pdf.chapters, pdf.selectedIds);
    const taken = new Set(selected.flatMap((sec) => sec.pages));
    // Top-level chapters the selection does not touch, so the table shows the whole source.
    const others = sectionsForSelection(pdf.chapters, new Set(pdf.chapters.map((c) => c.id))).filter(
      (sec) => !sec.pages.some((p) => taken.has(p)),
    );
    return [...selected.map((sec) => row(sec, false)), ...others.map((sec) => row(sec, true))].sort(
      (a, b) => a.startPage - b.startPage,
    );
  }

  function setBlueprint(next: BlueprintSection[]): void {
    const plan: Record<string, number> = { ...questionPlan };
    for (const section of next) plan[section.id] = section.questions;
    questionPlan = plan;
  }

  // The destination's existing questions, which the attempt draws from
  // alongside what this run writes.
  $: void loadExamMix(
    saveMode === "append" ? (appendFile?.path ?? null) : null,
    examSettings.typedGrading,
  );

  async function loadExamMix(
    filePath: string | null,
    typedGrading: ExamSettings["typedGrading"],
  ): Promise<void> {
    if (!examPlanner || !filePath) {
      examMix = { generated: 0, mcq: 0, typeIn: 0, cloze: 0 };
      return;
    }
    try {
      examMix = await examPlanner.mix(filePath, typedGrading);
    } catch (e) {
      console.debug("Decks: could not read the destination's questions", e);
    }
  }

  $: void loadExamDefaults(profileId);

  async function loadExamDefaults(id: string): Promise<void> {
    if (!examPlanner || !id) return;
    try {
      const stored = await examPlanner.defaults(id);
      if (stored) examSettings = stored;
    } catch (e) {
      console.debug("Decks: could not read the exam defaults", e);
    }
  }

  async function saveExamDefaults(): Promise<void> {
    if (!examPlanner || !profileId) return;
    try {
      await examPlanner.saveDefaults(profileId, examSettings);
      examDefaultsSaved = true;
    } catch (e) {
      genError = e instanceof Error ? e.message : String(e);
    }
  }

  /**
   * One round per section, each scoped to that section's pages. A single round
   * over the whole selection would make the per-section counts a request the
   * model is free to ignore.
   */
  async function runBlueprint(): Promise<void> {
    const plan = blueprintSections.filter((s) => isPlannable(s) && s.questions > 0);
    if (plan.length === 0 || blueprintRunning) return;
    blueprintRunning = true;
    blueprintStop = false;
    try {
      for (let i = 0; i < plan.length; i++) {
        const section = plan[i];
        blueprintProgress = { index: i + 1, total: plan.length, title: section.title };
        prompt = I18n.format(g.blueprint.sectionPrompt, {
          count: section.questions,
          title: section.title,
          range: `${section.startPage}–${section.endPage}`,
        });
        await startGenerate(
          {
            selectedIds: new Set([section.id]),
            keepIndex: i > 0,
          },
          true,
        );
        if (genError || blueprintStop) break;
      }
    } finally {
      blueprintRunning = false;
      blueprintProgress = null;
    }
  }

  // --- Chat over the source -----------------------------------------------

  // Earlier exchanges, so a follow-up question means something. Paired from the
  // thread rather than stored twice: the thread is the conversation.
  function chatHistory(): ChatTurn[] {
    const turns: ChatTurn[] = [];
    let question = "";
    for (const block of blocks) {
      if (block.kind === "prompt") question = block.text;
      else if (block.kind === "answer" && question) {
        turns.push({ question, answer: block.text });
        question = "";
      }
    }
    return turns;
  }

  /**
   * Ask about the source rather than generate from it. The answer is grounded
   * in what this session already knows: the pages, the cards made from them and
   * the concepts the ledger found no card for.
   */
  async function askQuestion(
    fixed?: string,
    from?: { passage: PassageText; pdfHash: string },
  ): Promise<void> {
    const question = (fixed ?? prompt).trim();
    if (!ask || !question || asking || phase === "streaming" || phase === "saving") return;
    const passage = from?.passage;
    asking = true;
    genError = null;
    const controller = new AbortController();
    abortController = controller;
    try {
      let source: string;
      if (passage) {
        source = passageSource(passage);
      } else {
        // Attached and @-mentioned notes are read in full, as a generation reads them.
        const notes = await buildGenerationComposerRequest(
          app,
          question,
          [...contexts, ...activeMentions],
          [],
        );
        const fromPdf = await resolvePdfSource(controller.signal, {
          keepIndex: rows.length > 0,
        });
        source = [notes.sourceContext, fromPdf].filter(Boolean).join("\n\n---\n\n");
      }
      if (!source.trim()) {
        genError = g.chat.needsSource;
        return;
      }
      const promptId = `blk-${blockCounter++}`;
      saidAt.set(promptId, new Date().toISOString());
      blocks = [...blocks, { kind: "prompt", id: promptId, text: question }];
      if (fixed === undefined) prompt = "";
      const deck =
        deckFronts && saveMode === "append" && appendFile
          ? await deckFronts(appendFile.path).catch(() => [])
          : [];
      const result = await ask(
        {
          question,
          source,
          deck,
          // This session's pile and what earlier sessions over the source kept.
          staged: [
            ...rows.filter((r) => r.keep || r.saved).map((r) => r.card.front),
            ...ledgerCards.map((c) => c.front ?? "").filter(Boolean),
          ],
          uncovered: conceptRows
            .filter((r) => r.state === "no_card")
            .map((r) => r.term),
          history: chatHistory(),
        },
        controller.signal,
      );
      if (debugEnabled && result.debug) {
        lastDebug = { ...result.debug, imageCount: 0 };
      }
      const answerId = `blk-${blockCounter++}`;
      saidAt.set(answerId, new Date().toISOString());
      if (from) passageAnswerPdf.set(answerId, from.pdfHash);
      blocks = [
        ...blocks,
        {
          kind: "answer",
          id: answerId,
          text: result.answer.text,
          pages:
            result.answer.pages.length > 0 || !passage?.page ? result.answer.pages : [passage.page],
          gaps: result.answer.gaps,
        },
      ];
      schedulePersist();
    } catch (e) {
      if (!controller.signal.aborted) {
        const msg = e instanceof Error ? e.message : String(e);
        genError = msg.trim() ? msg : g.chat.failed;
      }
    } finally {
      asking = false;
      abortController = null;
    }
  }

  /**
   * Turn an answer into a staged card: the question is the front, the answer
   * the back. No second model call — the card then goes through the same
   * critique and fix path as any other, so a wordy answer gets flagged there.
   */
  function answerToCard(blockId: string): void {
    const at = blocks.findIndex((b) => b.id === blockId);
    const block = at === -1 ? undefined : blocks[at];
    if (!block || block.kind !== "answer" || block.cardRowId) return;
    const asked = blocks
      .slice(0, at)
      .reverse()
      .find((b) => b.kind === "prompt");
    if (!asked || asked.kind !== "prompt") return;
    const id = `gen-${rowCounter++}`;
    const card: GeneratedCard = {
      front: asked.text,
      back: block.text,
      notes: "",
      page: block.pages[0],
    };
    const fromPdf = passageAnswerPdf.get(blockId);
    if (fromPdf) passageCardPdf.set(card, fromPdf);
    rows = [
      ...rows,
      {
        id,
        card,
        keep: true,
        saved: false,
        origin: "chat_capture",
      },
    ];
    blocks = blocks.map((b) =>
      b.id === blockId && b.kind === "answer" ? { ...b, cardRowId: id } : b,
    );
    selectedId = id;
    schedulePersist();
  }

  /** Aim the next round at the gaps an answer named. */
  function generateForAnswerGaps(gaps: AnswerGap[]): void {
    if (gaps.length === 0 || phase === "streaming") return;
    prompt = I18n.format(g.coverage.conceptPrompt, {
      terms: gaps
        .map((gp) => (gp.page ? `${gp.term} (p. ${gp.page})` : gp.term))
        .join(", "),
    });
    void startGenerate(undefined, true);
  }

  /** The concepts' cards in the vault, by flashcard id. */
  function savedCardIds(concepts: ConceptRow[], failingOnly: boolean): string[] {
    const ids = cardsForConcepts(concepts, conceptCards, failingOnly)
      .map((card) => card.flashcardId)
      .filter((id): id is string => !!id);
    return [...new Set(ids)];
  }

  /** Cards that keep being missed want rewriting where they are, not more cards. */
  function repairConcepts(concepts: ConceptRow[]): void {
    const ids = savedCardIds(concepts, true);
    if (ids.length > 0) repairCards?.(ids, false);
  }

  /** Split the one card a thin concept has: in the pile here, in the vault through the repair modal. */
  function splitConcepts(concepts: ConceptRow[]): void {
    const pile = cardsForConcepts(concepts, conceptCards)
      .map((card) => rows.find((r) => `row:${r.id}` === card.id))
      .filter((row): row is GenRow => !!row && !row.saved && row.keep);
    for (const row of pile) void applyFix(row, "split");
    const ids = savedCardIds(concepts, false);
    if (ids.length > 0) repairCards?.(ids, true);
  }

  /** Aim the next round at named concepts, as the gap button aims it at pages. */
  function generateForConcepts(selected: ConceptRow[]): void {
    if (selected.length === 0 || phase === "streaming") return;
    prompt = I18n.format(g.coverage.conceptPrompt, {
      terms: selected.map((r) => `${r.term} (p. ${r.page})`).join(", "),
    });
    // Read only the chapters holding those concepts, not the whole selection.
    const pdf = activePdf;
    const ids = pdf
      ? chapterIdsForPages(pdf.chapters, [...new Set(selected.map((r) => r.page))])
      : new Set<string>();
    void startGenerate(
      ids.size > 0
        ? {
            selectedIds: ids,
            keepIndex: true,
            conceptId: selected.length === 1 ? selected[0].id : undefined,
          }
        : undefined,
      true,
    );
  }

  // Mobile: show either the list or the detail. Driven by the component's own
  // width (via ResizeObserver) so it reacts to the pane size in tab mode, not
  // just the window — and catches pane-splitter drags that fire no resize event.
  let mobile = false;
  let layoutWidth = 0;
  $: paneMax = paneMaxWidth(layoutWidth);
  // Measured on the whole layout: the main column's own width changes with the
  // side panel this flag shows, which made the flag flip back and forth.
  let layoutEl: HTMLElement;
  let resizeObserver: ResizeObserver | null = null;
  onMount(() => {
    layoutWidth = layoutEl.clientWidth;
    mobile = layoutWidth <= 768;
    resizeObserver = new ResizeObserver((entries) => {
      layoutWidth = entries[0].contentRect.width;
      mobile = layoutWidth <= 768;
    });
    resizeObserver.observe(layoutEl);
    const defaults = initSaveDefaults().catch((e) =>
      console.error("AI generator: failed to load decks/profiles", e),
    );
    restored = restore(defaults)
      .then(() => applySeed())
      .catch((e) => console.debug("Decks: could not open the session", e));
    if (focus) void focusRow(focus.rowId);
  });
  onDestroy(() => {
    resizeObserver?.disconnect();
    // A pending write would be lost when the leaf closes, which is exactly when
    // the pile most needs to survive.
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
      void persistSession(sessionSnapshot()).catch(() => {});
    }
  });

  // --- Composer state ---
  let prompt = "";
  let contexts: ContextItem[] = [];
  const mentionItems: MentionItem[] = app.vault
    .getMarkdownFiles()
    .map((f) => ({ path: f.path, label: f.basename }));
  let mentionedAll: ContextItem[] = [];
  $: activeMentions = mentionedAll.filter((m) => prompt.includes(`@${m.label}`));
  $: mentionLabels = activeMentions.map((m) => m.label);
  $: hasNoteSource =
    activeMentions.length > 0 || contexts.some((c) => c.kind === "note");

  function addContext(kind: "note" | "image" | "pdf", path: string, label: string) {
    const id = `${kind}:${path}`;
    if (contexts.some((c) => c.id === id)) return;
    if (kind === "note" && contexts.filter((c) => c.kind === "note").length >= MAX_CONTEXT_NOTES) {
      genError = I18n.format(g.tooManyNotes, { max: MAX_CONTEXT_NOTES });
      return;
    }
    if (kind === "image" && contexts.filter((c) => c.kind === "image").length >= MAX_CONTEXT_IMAGES) {
      genError = I18n.format(g.tooManyImages, { max: MAX_CONTEXT_IMAGES });
      return;
    }
    contexts = [...contexts, { id, kind, path, label }];
  }
  function removeContext(id: string) {
    contexts = contexts.filter((c) => c.id !== id);
    if (pdfs.some((p) => p.contextId === id)) {
      pdfs = pdfs.filter((p) => p.contextId !== id);
      if (activePdfId === id) activePdfId = pdfs[0]?.contextId ?? null;
      if (pdfs.length === 0) panelOpen = false;
    }
  }
  function addMention(item: { path: string; label: string }) {
    const id = `note:${item.path}`;
    if (mentionedAll.some((m) => m.id === id)) return;
    mentionedAll = [
      ...mentionedAll,
      { id, kind: "note", path: item.path, label: item.label },
    ];
  }
  function addNote() {
    new FilePickerModal(
      app,
      app.vault.getMarkdownFiles(),
      (f) => addContext("note", f.path, f.name),
      g.addNote,
    ).open();
  }
  function addImage() {
    const images = app.vault
      .getFiles()
      .filter((f) => IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()));
    new FilePickerModal(app, images, (f) => addContext("image", f.path, f.name), g.addImage).open();
  }
  async function pasteImages(files: File[]) {
    for (const file of files) {
      const saved = await savePastedImage(app, "", file);
      if (saved) addContext("image", saved.path, saved.name);
    }
  }

  // --- PDF attachment (Decks Pro) ---
  // Multiple PDFs can be attached; the chapter panel shows one at a time via
  // tabs. Each carries its own chapter selection + parse mode.
  let pdfs: PdfAttachment[] = [];
  let activePdfId: string | null = null;
  let panelOpen = false;
  // The last view used, kept while the panel is closed or the view is not offered.
  let panelView: PdfPanelView = "chapters";
  $: pdfViews = pdfPanelViews({
    concepts: Boolean(conceptLedger),
    blueprint: Boolean(examPlanner) && (cardType === "mcq" || blueprintRunning),
  });
  $: shownView = shownPdfView(panelView, pdfViews);
  $: pdfViewTabs = pdfViews.map((id) => ({ id, label: pdfViewLabel(id) }));
  // A page to scroll Pages to once; the view reports it consumed so a remount does not repeat it.
  let pagesFocus: { hash: string; page: number; seq: number } | null = null;
  let focusSeq = 0;
  const pagesAt = new Map<string, number>();
  // The PDF a passage card or answer came from, so its page resolves without the section index.
  const passageCardPdf = new WeakMap<GeneratedCard, string>();
  const passageAnswerPdf = new Map<string, string>();
  let passageBusy: "ask" | "cards" | null = null;
  let paneWidth = clampPaneWidth(pdfPaneWidth ?? PDF_PANE_DEFAULT_WIDTH, 1600);
  let ledgerConcepts: Array<SourceConcept & { id: string }> = [];
  let ledgerExtracted = new Set<number>();
  // Every stored card of this source. This session's pile is live in `rows`, so
  // its stored copies only lend the review record of cards already saved.
  let sourceLedgerCards: ConceptCard[] = [];
  $: ownPrefix = sessionId ? `${sessionId}:` : null;
  $: ledgerCards = sourceLedgerCards.filter((c) => !ownPrefix || !c.id?.startsWith(ownPrefix));
  $: ownLedger = new Map(
    ownPrefix
      ? sourceLedgerCards
          .filter((c) => c.id?.startsWith(ownPrefix))
          .map((c) => [c.id!.slice(ownPrefix.length), c] as const)
      : [],
  );
  let ledgerHash: string | null = null;
  let conceptBusy = false;
  let conceptError: string | null = null;
  // The blueprint's per-section allocation, keyed by chapter id so an edit
  // survives a change of selection rather than being recomputed away.
  let questionPlan: Record<string, number> = {};
  let examSettings: ExamSettings = { ...DEFAULT_EXAM_SETTINGS };
  let examMix: QuestionMix = { generated: 0, mcq: 0, typeIn: 0, cloze: 0 };
  let examDefaultsSaved = false;
  let blueprintRunning = false;
  let blueprintStop = false;
  let blueprintProgress: { index: number; total: number; title: string } | null =
    null;
  let asking = false;
  // Populated as the source is built; a card's SECTION index points in here.
  // `pages` is what the block actually contained, so a card's claimed PAGE can be
  // checked against it rather than trusted.
  let sectionIndex: Array<{
    pdfHash: string;
    chapterId: string;
    title: string;
    pages: number[];
  }> = [];
  let ocrProgress: OcrProgress | null = null;
  // Unified per-page progress while PDFs are resolved to text (text reads + OCR).
  let pdfProgress: { done: number; total: number } | null = null;
  let pdfInputEl: HTMLInputElement;

  $: activePdf = pdfs.find((p) => p.contextId === activePdfId) ?? pdfs[0] ?? null;
  $: pdfTabs = pdfs.map((p): PdfTab => ({ id: p.contextId, label: p.label }));
  $: pdfPct = pdfProgress
    ? Math.round((pdfProgress.done / Math.max(1, pdfProgress.total)) * 100)
    : 0;

  // Patch the active PDF's selection/mode immutably (so reactivity fires).
  function updateActivePdf(patch: Partial<PdfAttachment>): void {
    pdfs = pdfs.map((p) =>
      p.contextId === activePdfId ? { ...p, ...patch } : p,
    );
  }

  function collectAllChapterIds(nodes: ChapterNode[], acc: string[] = []): string[] {
    for (const n of nodes) {
      acc.push(n.id);
      collectAllChapterIds(n.children, acc);
    }
    return acc;
  }

  // Both attach sources: a vault PDF or one from the user's computer.
  const pdfSources: PdfSource[] = [
    { label: g.pdfFromVault, icon: "folder", onPick: () => pickVaultPdf() },
    { label: g.pdfFromComputer, icon: "monitor", onPick: () => pdfInputEl?.click() },
  ];

  function pickVaultPdf() {
    const pdfs = app.vault
      .getFiles()
      .filter((f) => f.extension.toLowerCase() === "pdf");
    new FilePickerModal(
      app,
      pdfs,
      (f) => {
        void app.vault
          .readBinary(f)
          .then((bytes) => attachPdf(bytes, f.name, f.path))
          .catch((err) => (genError = String(err)));
      },
      g.addPdf,
    ).open();
  }

  function onPdfInputChange() {
    const file = pdfInputEl?.files?.[0];
    if (file) {
      void file
        .arrayBuffer()
        .then((bytes) => attachPdf(bytes, file.name))
        .catch((err) => (genError = String(err)));
    }
    if (pdfInputEl) pdfInputEl.value = "";
  }

  function pastePdfs(files: File[]) {
    const file = files[0];
    if (!file) return;
    void file
      .arrayBuffer()
      .then((bytes) => attachPdf(bytes, file.name))
      .catch((err) => (genError = String(err)));
  }

  async function attachPdf(bytes: ArrayBuffer, label: string, vaultPath?: string, reveal = true) {
    genError = null;
    if (bytes.byteLength > PDF_MAX_BYTES) {
      genError = I18n.format(g.pdfTooLarge, {
        max: Math.round(PDF_MAX_BYTES / (1024 * 1024)),
      });
      return;
    }
    try {
      // Hash before loadPdf: pdf.js detaches the buffer it's given, so hashing
      // must happen while `bytes` is still intact.
      const hash = hashPdf(bytes);
      const contextId = `pdf:${hash}`;
      // Already attached → just activate its tab and reopen the panel.
      if (pdfs.some((p) => p.contextId === contextId)) {
        if (reveal) openPdfPanel(contextId);
        else activePdfId = contextId;
        return;
      }
      // A PDF from outside the vault has no path to reopen it by, so Resume reads a kept copy.
      if (!vaultPath && keepSourcePdf) {
        void keepSourcePdf(hash, bytes.slice(0)).catch((e) =>
          console.debug("Decks: could not keep a copy of the PDF", e),
        );
      }
      const doc = await loadPdf(bytes, layoutEl?.doc);
      const chapters = await extractOutline(doc);
      const attachment: PdfAttachment = {
        contextId,
        label,
        vaultPath,
        doc,
        hash,
        chapters,
        selectedIds: new Set(collectAllChapterIds(chapters)),
      };
      pdfs = [...pdfs, attachment];
      activePdfId = contextId;
      // Use the attachment's contextId as the pill id (don't go through
      // addContext, which would prefix it again) so the composer pill and the
      // chapter panel remove the same PDF.
      contexts = [...contexts, { id: contextId, kind: "pdf", path: label, label }];
      if (reveal) openPdfPanel(contextId);
    } catch (e) {
      genError = e instanceof Error ? e.message : String(e);
    }
  }

  // Resolve every attached PDF's selected chapters into source text. The parse
  // path is provider-determined: Decks Pro renders pages and OCRs them (the
  // selected tier's OCR model); any other provider uses free pdf.js text
  // extraction. Each PDF's text is prefixed with a `# <label>` heading. Progress
  // is a single counter spanning all PDFs' pages.
  /** Transcribes a PDF's pages through the cache, reporting each page. */
  function ocrRunnerFor(p: PdfAttachment, signal: AbortSignal) {
    const ocrModel = ocrSentinelForTier(selectedModel);
    return (ocrPages: number[], onEach?: () => void) => {
      if (!pdfOcr) return Promise.resolve(new Map<number, string>());
      return pdfOcr.runOcr(
        p.doc,
        p.hash,
        ocrModel,
        ocrPages,
        (prog) => {
          ocrProgress = prog;
          onEach?.();
        },
        signal,
        debugEnabled
          ? (entry) => {
              ocrDebug = [...ocrDebug, entry].slice(-OCR_DEBUG_MAX);
            }
          : undefined,
      );
    };
  }

  /** How PDF pages become text for the active provider. */
  function pdfParseMode(): "text" | "ocr" | "auto" {
    if (aiProvider !== "decks-pro") return "text";
    return pdfReading === "transcribe" ? "ocr" : "auto";
  }

  /** The section index entry a block cites, added on first use and widened by later pages. */
  function indexSection(pdfHash: string, section: SelectedSection, pages: number[]): number {
    const at = sectionIndex.findIndex((e) => e.pdfHash === pdfHash && e.chapterId === section.id);
    if (at >= 0) {
      const entry = sectionIndex[at];
      sectionIndex = sectionIndex.map((e, i) =>
        i === at ? { ...entry, pages: [...new Set([...entry.pages, ...pages])].sort((a, b) => a - b) } : e,
      );
      return at + 1;
    }
    sectionIndex = [...sectionIndex, { pdfHash, chapterId: section.id, title: section.title, pages }];
    return sectionIndex.length;
  }

  /**
   * The PDF selection as chunks generated one after another, or null when it is
   * small enough for one request. `loaded` collects each chunk's text as it is read.
   */
  function pdfChunks(
    signal: AbortSignal,
    loaded: string[],
    opts: { selectedIds?: Set<string>; keepIndex?: boolean } = {},
  ): SourceChunk[] | null {
    const plans = pdfs
      .map((p) => ({ pdf: p, sections: sectionsForSelection(p.chapters, opts.selectedIds ?? p.selectedIds) }))
      .filter((x) => x.sections.length > 0);
    const unitsOf = (sections: SelectedSection[]) =>
      sections.flatMap((sec) => sec.pages.map((page) => ({ page, chars: ESTIMATED_PAGE_CHARS, section: sec.title })));
    if (!shouldChunk(plans.flatMap((x) => unitsOf(x.sections)))) return null;
    if (!opts.keepIndex) sectionIndex = [];
    const mode = pdfParseMode();
    return plans.flatMap(({ pdf, sections }) => {
      const sectionOf = new Map<number, SelectedSection>();
      for (const sec of sections) for (const page of sec.pages) sectionOf.set(page, sec);
      return planChunks(unitsOf(sections)).map((chunk) => ({
        pages: chunk.pages,
        label: chunkLabel(chunk),
        load: async () => {
          // One labelled block per section the chunk touches, as a single read builds them.
          const groups: Array<{ section: SelectedSection; pages: number[] }> = [];
          for (const page of chunk.pages) {
            const section = sectionOf.get(page);
            if (!section) continue;
            const last = groups[groups.length - 1];
            if (last?.section === section) last.pages.push(page);
            else groups.push({ section, pages: [page] });
          }
          const parts: string[] = [];
          for (const group of groups) {
            const text = await buildSectionContent(pdf.doc, group.pages, mode, ocrRunnerFor(pdf, signal));
            if (!text) continue;
            const n = indexSection(pdf.hash, group.section, group.pages);
            parts.push(`# [${n}] ${group.section.title}\n${text}`);
          }
          const joined = parts.join("\n\n---\n\n");
          if (joined) loaded.push(joined);
          return joined;
        },
      }));
    });
  }

  async function resolvePdfSource(
    signal: AbortSignal,
    opts: {
      only?: PdfAttachment;
      /** Narrow this run to part of the selection without changing it. */
      selectedIds?: Set<string>;
      /** Number sections after the ones already indexed, for a run that is one
       *  of several over the same selection. */
      keepIndex?: boolean;
    } = {},
  ): Promise<string> {
    const { only, selectedIds, keepIndex } = opts;
    // One labelled block per selected chapter rather than one per PDF, so a card
    // can say which section it came from. Pages are cached individually, so
    // regrouping them re-transcribes nothing.
    const plans = (only ? [only] : pdfs)
      .map((p) => ({
        pdf: p,
        sections: sectionsForSelection(p.chapters, selectedIds ?? p.selectedIds),
      }))
      .filter((x) => x.sections.length > 0);
    // A scoped read serves the ledger, which is keyed to one document — it must
    // not rewrite the index the generator's coverage read-out derives from.
    if (!only && !keepIndex) sectionIndex = [];
    const total = plans.reduce(
      (sum, x) => sum + x.sections.reduce((n, sec) => n + sec.pages.length, 0),
      0,
    );
    if (total === 0) return "";

    // Transcription is the hosted path; everyone else gets free text extraction.
    const mode = pdfParseMode();

    pdfProgress = { done: 0, total };
    let done = 0;
    const advance = () => (pdfProgress = { done: ++done, total });
    const parts: string[] = [];
    try {
      for (const { pdf: p, sections } of plans) {
        for (const section of sections) {
          const pages = section.pages;
        const text = await buildSectionContent(
          p.doc,
          pages,
          mode,
          ocrRunnerFor(p, signal),
          () => advance(),
        );
        if (!text) continue;
        if (only) {
          parts.push(`# ${section.title}\n${text}`);
          continue;
        }
        // Numbered so a card references an index rather than echoing a title,
        // which the model would paraphrase and we could not match back.
        // Reassigned rather than pushed: the coverage read-out derives from this
        // list, and a mutated array would leave it showing the previous run.
        sectionIndex = [
          ...sectionIndex,
          {
            pdfHash: p.hash,
            chapterId: section.id,
            title: section.title,
            pages,
          },
        ];
        parts.push(`# [${sectionIndex.length}] ${section.title}\n${text}`);
        }
      }
      return parts.join("\n\n---\n\n");
    } finally {
      ocrProgress = null;
      pdfProgress = null;
    }
  }

  /** The parse fault in a generated question, or undefined when it is sound. */
  function mcqProblem(card: GeneratedCard): McqProblem | undefined {
    const check = checkGeneratedMcq(card);
    return check.valid ? undefined : check.reason;
  }

  /** Attach a row to its block, reassigning so the thread redraws. */
  function addToBlock(blockId: string, rowId: string): void {
    blocks = blocks.map((b) =>
      b.kind === "result" && b.id === blockId
        ? { ...b, rowIds: [...b.rowIds, rowId] }
        : b,
    );
  }

  /** Keep or discard every unsaved card a round produced; returns what changed. */
  function setRoundKeep(blockId: string, keep: boolean): Map<string, boolean> {
    const before = new Map<string, boolean>();
    const block = blocks.find((b) => b.id === blockId);
    if (!block || block.kind !== "result") return before;
    const ids = new Set(block.rowIds);
    rows = rows.map((r) => {
      if (!ids.has(r.id) || r.saved || r.keep === keep) return r;
      before.set(r.id, r.keep);
      return { ...r, keep };
    });
    schedulePersist();
    return before;
  }

  function keepAll(blockId: string): void {
    setRoundKeep(blockId, true);
    undoRound = null;
  }

  /** A round's last discard, which its header offers to undo for a few seconds. */
  let undoRound: { blockId: string; before: Map<string, boolean> } | null = null;
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  const UNDO_MS = 8_000;

  function discardAll(blockId: string): void {
    const before = setRoundKeep(blockId, false);
    if (before.size === 0) return;
    undoRound = { blockId, before };
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (undoRound = null), UNDO_MS);
  }

  function undoDiscard(): void {
    const before = undoRound?.before;
    if (!before) return;
    rows = rows.map((r) => {
      const keep = before.get(r.id);
      return keep === undefined || r.saved ? r : { ...r, keep };
    });
    undoRound = null;
    clearTimeout(undoTimer);
    schedulePersist();
  }

  /** A round that produced nothing leaves no block behind to explain itself. */
  function pruneEmptyBlocks(): void {
    blocks = pruneBlocks(blocks, new Set(rows.map((r) => r.id)));
  }

  // --- Persistence --------------------------------------------------------
  // Created lazily: opening and closing leaves no empty session in the hub.
  let sessionId: string | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Rows taken off the pile since the last write, so it can mark them discarded. */
  const droppedIds = new Set<string>();

  /** Why a stored question is not usable, recomputed rather than guessed from the flag. */
  function invalidReason(card: AiStagedCard): McqProblem | undefined {
    if (card.cardType !== "mcq" || !isQuestionShaped(card.origin)) return undefined;
    const check = checkGeneratedMcq({ front: card.front, back: card.back, notes: card.notes });
    return check.valid ? undefined : check.reason;
  }

  /** Reopen a persisted pile. A vault PDF is re-read from its path and one from the
   *  computer from its kept copy; without either the cards come back alone. */
  async function restore(defaults: Promise<void>): Promise<void> {
    if (!restoreSession) return;
    const data = await restoreSession();
    if (!data) return;

    sessionId = data.session.id;
    if (data.session.model) selectedModel = data.session.model;
    // Resume an exam draft as an exam draft.
    if (data.cards.some((c) => c.cardType === "mcq")) cardType = "mcq";

    // A row keeps the id it was stored under, so the next write replaces it
    // rather than copying it; new rows are numbered past every restored one.
    const restoredId = data.session.id;
    const ids = data.cards.map((card) => localRowId(restoredId, card.id));
    const restoredRows: GenRow[] = data.cards.map((card, i) => ({
      id: ids[i],
      card: {
        front: card.front,
        back: card.back,
        notes: card.notes,
        // The section number indexed a source build that is gone; the page is
        // checked against the index rebuilt from the restored selection instead.
        page: card.sourcePage ?? undefined,
      },
      keep: card.status === "kept" || card.status === "proposed" || card.status === "superseded",
      saved: card.status === "saved",
      invalid: invalidReason(card),
      verdict:
        card.rubricVerdict === null
          ? undefined
          : {
              id: ids[i],
              verdict: card.rubricVerdict,
              codes: card.rubricCodes,
              fix: card.fixProposal ?? "",
            },
      parentId: card.parentId ? localRowId(restoredId, card.parentId) : undefined,
      origin: card.origin,
      conceptId: card.conceptId,
    }));
    rowCounter = nextRowCounter(ids);
    // The thread comes back with its rounds, so a replaced round stays replaced
    // and a cleared card stays out of the pile.
    const loose = new Set(
      ids.filter((_, i) => data.cards[i].status !== "discarded"),
    );
    blocks = threadFromTurns(data.session.turns, ids, () => `blk-${blockCounter++}`, loose);
    saidAt.clear();
    blocks
      .filter((b) => b.kind !== "result")
      .forEach((b, i) => {
        const at = data.session.turns[i]?.at;
        if (at) saidAt.set(b.id, at);
      });
    const placed = new Set(blocks.flatMap((b) => (b.kind === "result" ? b.rowIds : [])));
    rows = restoredRows.filter((row) => placed.has(row.id));
    if (rows.length > 0) phase = "review";

    const path = data.session.sourceRef;
    const hash = data.session.sourceHash;
    if (
      data.session.sourceKind === "pdf" &&
      ((Boolean(path) && (await attachVaultPdf(path, false, hash ?? undefined))) ||
        (await attachKeptPdf(hash, path.slice(path.lastIndexOf("/") + 1))) ||
        (Boolean(path) && Boolean(hash) && (await attachVaultPdf(path))))
    ) {
      const selected = new Set(data.session.selectedIds);
      if (selected.size > 0) updateActivePdf({ selectedIds: selected });
      sectionIndex = selectedSections();
    }
    // Profiles load beside the restore; the remembered one is applied once they have.
    await defaults;
    prefillDestination(data.destinationPath ?? null, data.session.profileId);
  }

  /** Point the save row back at where this session saved before, without locking it. */
  function prefillDestination(path: string | null, savedProfile: string | null): void {
    if (savedProfile && profiles.some((p) => p.id === savedProfile)) profileId = savedProfile;
    const file = path ? app.vault.getAbstractFileByPath(path) : null;
    if (!file || !("extension" in file)) return;
    if ((file as TFile).extension === "canvas") appendFormat = "canvas";
    appendFile = file as TFile;
    saveMode = "append";
  }

  /** The index a run over the current selection would build, without reading any text. */
  function selectedSections(): typeof sectionIndex {
    return pdfs.flatMap((p) =>
      sectionsForSelection(p.chapters, p.selectedIds).map((sec) => ({
        pdfHash: p.hash,
        chapterId: sec.id,
        title: sec.title,
        pages: sec.pages,
      })),
    );
  }

  /** A computer PDF's kept copy; vault PDFs have none and reopen by path. */
  async function attachKeptPdf(hash: string | null, label: string): Promise<boolean> {
    if (!hash || !readSourcePdf) return false;
    const bytes = await readSourcePdf(hash).catch(() => null);
    if (!bytes) return false;
    await attachPdf(bytes, label || `${hash}.pdf`, undefined, false);
    return pdfs.some((p) => p.hash === hash);
  }

  /** Reopen a PDF that lives in the vault; with `expectHash`, only if it is still that document. */
  async function attachVaultPdf(path: string, reveal = false, expectHash?: string): Promise<boolean> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!file || !("extension" in file)) return false;
    try {
      const bytes = await app.vault.readBinary(file as TFile);
      if (expectHash && hashPdf(bytes) !== expectHash) return false;
      await attachPdf(bytes, (file as TFile).name, path, reveal);
      return true;
    } catch (e) {
      console.debug("Decks: could not reopen the PDF", e);
      return false;
    }
  }

  /** Narrow a seeded session to the chapters its pages fall in, so the round
   *  costs what those pages cost rather than what the document does. */
  async function applySeed(): Promise<void> {
    if (!seed) return;
    prompt = seed.prompt;
    if (!seed.pdfPath || !(await attachVaultPdf(seed.pdfPath, !mobile))) return;
    const pdf = pdfs[pdfs.length - 1];
    if (!pdf || !seed.pages?.length) return;
    const ids = chapterIdsForPages(pdf.chapters, seed.pages);
    if (ids.size > 0) updateActivePdf({ selectedIds: ids });
  }

  /** The conversation, flattened for storage. Derived from the thread rather
   *  than tracked beside it, so the two cannot drift. */
  function sessionTurns(): AiSessionTurn[] {
    const now = new Date().toISOString();
    const rounds = roundsByTurn(blocks);
    return blocks
      .filter((b) => b.kind === "prompt" || b.kind === "answer")
      .map((b, i) => ({
        role: b.kind === "prompt" ? ("user" as const) : ("assistant" as const),
        text: b.kind === "prompt" || b.kind === "answer" ? b.text : "",
        at: saidAt.get(b.id) ?? now,
        pages: b.kind === "answer" ? b.pages : undefined,
        gaps: b.kind === "answer" ? b.gaps : undefined,
        rounds: rounds[i],
      }));
  }

  function sessionSnapshot(): AiSessionSnapshot {
    const pdf = pdfs[0] ?? null;
    return {
      turns: sessionTurns(),
      sessionId,
      sourceKind: pdf ? "pdf" : "note",
      sourceRef: pdf?.vaultPath ?? pdf?.label ?? contexts[0]?.path ?? "",
      sourceHash: pdf?.hash ?? null,
      selectedIds: pdf ? [...pdf.selectedIds] : [],
      model: selectedModel || null,
      cardType,
      rows,
      supersededRowIds: blocks.flatMap((b) =>
        b.kind === "result" && superseded.has(b.id) ? b.rowIds : [],
      ),
      droppedIds: [...droppedIds],
      destinationPath: hasSaved && appendFile ? appendFile.path : null,
      profileId: hasSaved ? profileId || null : null,
    };
  }

  /** Write the pile, coalescing the burst of row changes streaming produces.
   *  Not load-bearing for the UI, so a failure is logged and dropped. */
  /** Write the pile now rather than after the debounce. */
  async function persistNow(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const snapshot = sessionSnapshot();
    const id = await persistSession(snapshot);
    if (id) sessionId = id;
    for (const dropped of snapshot.droppedIds) droppedIds.delete(dropped);
  }

  function schedulePersist(): void {
    if (rows.length === 0 && !sessionId) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const snapshot = sessionSnapshot();
      void persistSession(snapshot)
        .then((id) => {
          if (id) sessionId = id;
          for (const dropped of snapshot.droppedIds) droppedIds.delete(dropped);
        })
        .catch((e) => console.debug("Decks: could not persist the pile", e));
    }, 400);
  }

  // --- Critique -----------------------------------------------------------
  /** Score a finished round. Never surfaces an error: a pass that cannot run
   *  leaves cards unjudged, which is not the same as passing. */
  async function runCritique(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const batch: CritiqueCard[] = rows
      .filter((r) => ids.includes(r.id))
      .map((r) => ({ id: r.id, card: r.card }));
    if (batch.length === 0) return;

    critiquing = true;
    try {
      const verdicts = await critique(batch, selectedModel, undefined, cardType);
      if (!verdicts) {
        unchecked = new Set([...unchecked, ...ids]);
        return;
      }
      if (ids.some((id) => unchecked.has(id))) {
        unchecked = new Set([...unchecked].filter((id) => !ids.includes(id)));
      }
      const byId = new Map(verdicts.map((v) => [v.id, v]));
      rows = rows.map((r) => {
        const v = byId.get(r.id);
        return v ? { ...r, verdict: v } : r;
      });
      schedulePersist();
    } finally {
      critiquing = false;
    }
  }

  /** Apply a flagged card's fix. The parent is dropped, never removed. */
  async function applyFix(
    row: GenRow,
    action: FixAction | null = fixActionFor(row.verdict?.codes ?? [], cardType),
  ): Promise<void> {
    if (!action || row.fixing) return;

    rows = rows.map((r) => (r.id === row.id ? { ...r, fixing: true } : r));
    try {
      const replacements = await refine(row.card, {
        instructions: fixInstructionFor(action, row.verdict?.fix ?? ""),
        split: action === "split",
        cloze: action === "cloze",
        // add_context is the one fix that needs the source back: the card is
        // fine except that it left its context behind on the page.
        sourceContext:
          action === "add_context" ? lastSourceContext : undefined,
        model: selectedModel,
      });
      if (replacements.length === 0) return;

      const children: GenRow[] = replacements.map((card) => ({
        id: `gen-${rowCounter++}`,
        // The page is provenance, not content: a rewrite of a card from p. 70 is
        // still from p. 70, and the refactor path never sees the field.
        card: { ...card, page: row.card.page, section: row.card.section },
        keep: true,
        saved: false,
        parentId: row.id,
        origin: action,
        // A reworked question is checked again; a type-in is no longer a question.
        invalid:
          cardType === "mcq" && isQuestionShaped(action) ? mcqProblem(card) : undefined,
      }));

      // Looked up after the await: the parent may be gone (Clear). Appending
      // beats losing children the user already paid for.
      blocks = blocks.map((b) =>
        b.kind === "result"
          ? {
              ...b,
              rowIds: insertAfter(
                b.rowIds,
                row.id,
                children.map((c) => c.id),
              ),
            }
          : b,
      );

      const at = rows.findIndex((r) => r.id === row.id);
      rows =
        at === -1
          ? [...rows, ...children]
          : [
              ...rows.slice(0, at),
              { ...rows[at], keep: false, fixing: false },
              ...children,
              ...rows.slice(at + 1),
            ];
      selectedId = children[0].id;
      schedulePersist();
      void runCritique(children.map((c) => c.id));
    } catch (e) {
      genError = e instanceof Error ? e.message : String(e);
      rows = rows.map((r) => (r.id === row.id ? { ...r, fixing: false } : r));
    }
  }

  /** Undo a fix: keep the parent, drop what replaced it. A replacement already
   *  saved is dropped rather than removed — the card is in the vault. */
  function undoFix(row: GenRow): void {
    if (!row.parentId) return;
    const parentId = row.parentId;
    const gone = new Set(
      rows.filter((r) => r.parentId === parentId && !r.saved).map((r) => r.id),
    );
    for (const id of gone) droppedIds.add(id);
    rows = rows
      .filter((r) => r.parentId !== parentId || r.saved)
      .map((r) =>
        r.id === parentId
          ? { ...r, keep: true }
          : r.parentId === parentId
            ? { ...r, keep: false }
            : r,
      );
    blocks = blocks.map((b) =>
      b.kind === "result"
        ? { ...b, rowIds: b.rowIds.filter((id) => !gone.has(id)) }
        : b,
    );
    selectedId = parentId;
    schedulePersist();
  }

  // --- Generation ---
  /** `adds` marks a planned round (blueprint, gaps, concepts): it adds to the pile, never refines it. */
  async function startGenerate(
    scope?: {
      selectedIds?: Set<string>;
      keepIndex?: boolean;
      /** The concept this round was asked for, carried by every card it makes. */
      conceptId?: string;
      /** A passage selected in Pages: the round's whole source, its page on every card. */
      passage?: PassageText;
      /** The PDF the passage came from. */
      passagePdf?: string;
    },
    adds = false,
  ) {
    if (phase === "streaming" || phase === "saving") return;
    const passage = scope?.passage;
    const instruction = passage ? g.reader.cardsPrompt : prompt;
    // Continue rounds may run without a prompt (source + prior cards drive them);
    // a fresh run still needs one.
    //
    // Keyed on cards already produced, not on `canContinue`: the model saying the
    // source is exhausted clears that flag, and a user who disagrees and presses
    // Generate again would otherwise start from scratch — silently doing nothing
    // when the prompt box is empty, or re-generating the same cards when it isn't.
    const continuing = rows.length > 0;
    if (!continuing && !instruction.trim()) return;
    const req = passage
      ? { prompt: instruction, sourceContext: passageSource(passage), images: [] }
      : await buildGenerationComposerRequest(app, prompt, contexts, activeMentions);
    // An instruction over an existing pile refines, and the model is shown the
    // round it replaces; Continue and the include toggle feed prior cards back.
    const refining = !adds && isRefinement(continuing, instruction);
    // Saved, discarded and captured cards are not refined.
    const open = new Set(
      rows.filter((r) => r.keep && !r.saved && r.origin !== "chat_capture").map((r) => r.id),
    );
    const lastResult = lastResultBlock(blocks, (id) => open.has(id));
    const refiningCards =
      refining && lastResult
        ? rows.filter((r) => lastResult.rowIds.includes(r.id)).map((r) => r.card)
        : undefined;
    const existingCards = continuationCards(rows, Boolean(refiningCards));
    partial = null;
    genError = null;
    sourceCovered = false;
    if (debugEnabled) {
      lastDebug = null;
      ocrDebug = [];
    }
    phase = "streaming";
    stage = null;
    progressAt = Date.now();
    thinking.reset();
    abortController = new AbortController();

    // Resolve any attached PDF into source text first (OCR'ing scanned pages),
    // then merge it with the note/image-derived source context.
    let sourceContext = req.sourceContext;
    const images = req.images;
    // A long selection is generated a chunk at a time; a refinement answers as one round.
    const loadedChunks: string[] = [];
    const chunks =
      passage || refiningCards || !generateChunked
        ? null
        : pdfChunks(abortController.signal, loadedChunks, scope ?? {});
    try {
      const pdfText = passage || chunks ? "" : await resolvePdfSource(abortController.signal, scope ?? {});
      if (pdfText) {
        sourceContext = [sourceContext, pdfText].filter(Boolean).join("\n\n---\n\n");
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        genError = e instanceof Error ? e.message : String(e);
      }
      phase = rows.length > 0 ? "review" : "idle";
      return;
    }

    // This round's rows, so the critique judges the new cards rather than
    // re-paying for every card still on screen.
    const roundIds: string[] = [];
    lastSourceContext = sourceContext ?? "";

    if (instruction.trim()) {
      const promptId = `blk-${blockCounter++}`;
      saidAt.set(promptId, new Date().toISOString());
      blocks = [...blocks, { kind: "prompt", id: promptId, text: instruction.trim() }];
    }
    const resultBlockId = `blk-${blockCounter++}`;
    streamingBlockId = resultBlockId;
    blocks = [
      ...blocks,
      {
        kind: "result",
        id: resultBlockId,
        rowIds: [],
        replacesId: refining ? lastResult?.id : undefined,
      },
    ];

    const handlers: GenerateHandlers = {
      onCard: (raw) => {
        const card = passage ? { ...raw, page: passage.page ?? undefined, section: undefined } : raw;
        if (passage && scope?.passagePdf) passageCardPdf.set(card, scope.passagePdf);
        const id = `gen-${rowCounter++}`;
        roundIds.push(id);
        progressAt = Date.now();
        addToBlock(resultBlockId, id);
        rows = [
          ...rows,
          {
            id,
            card,
            keep: true,
            saved: false,
            origin: "generate",
            conceptId: scope?.conceptId,
            // Free and deterministic, so it runs per card as it lands rather
            // than waiting for the round to close.
            invalid:
              cardType === "mcq" ? mcqProblem(card) : undefined,
          },
        ];
      },
      onPartial: (card) => {
        partial = card;
      },
      onStage: (next) => (stage = next),
      onReasoning: (text) => thinking.push(text),
    };
    try {
      const result = chunks && generateChunked
        ? await generateChunked(
            {
              prompt: req.prompt,
              chunks,
              extraContext: sourceContext,
              images,
              existingCards,
              model: selectedModel,
              cardType,
              debug: debugEnabled,
            },
            handlers,
            abortController.signal,
          )
        : await generate(
            {
              prompt: req.prompt,
              sourceContext,
              images,
              maxBatches: MAX_BATCHES,
              existingCards,
              refining: refiningCards,
              model: selectedModel,
              cardType,
              debug: debugEnabled,
            },
            handlers,
            abortController.signal,
          );
      if (chunks) {
        lastSourceContext = [sourceContext, ...loadedChunks].filter(Boolean).join("\n\n---\n\n");
        // A chunk that failed after others worked keeps their cards and says why it stopped.
        if ("error" in result && result.error !== undefined && !abortController.signal.aborted) {
          genError = result.error instanceof Error ? result.error.message : String(result.error);
        }
      }
      if (debugEnabled) lastDebug = result.debug ?? lastDebug;
      // Offer "Continue generating" when this round produced cards or was cut off
      // by the output-token limit; otherwise the model is done.
      sourceCovered = passage ? false : (result.covered ?? false);
      // Continuing stays possible when the model says it is done — it is a hint,
      // not a verdict — but it stops being the suggested action. A passage round has nothing to continue.
      canContinue = passage ? false : offersContinue(result);
    } catch (e) {
      if (!abortController.signal.aborted) {
        const msg = e instanceof Error ? e.message : String(e);
        genError = msg.trim() ? msg : g.generateFailed;
      }
    } finally {
      partial = null;
      stage = null;
      streamingBlockId = null;
      phase = rows.length > 0 ? "review" : "idle";
    }
    // Every round, successful or not. Not awaited: the cards are usable, and
    // holding them back would make the pass feel like a gate.
    pruneEmptyBlocks();
    void runCritique(roundIds);
    schedulePersist();
  }

  function interrupt() {
    blueprintStop = true;
    abortController?.abort();
  }

  function select(id: string) {
    selectedId = selectedId === id ? null : id;
  }
  function toggleKeep(id: string) {
    rows = rows.map((r) => (r.id === id ? { ...r, keep: !r.keep } : r));
    schedulePersist();
  }

  // --- Save panel ---
  let saveMode: "new-file" | "append" = "new-file";
  let format: SaveFormat = "header-paragraph"; // new-file format (user choice)
  let appendFormat: SaveFormat = "header-paragraph"; // append format (target file kind)
  let fileName = "";
  let folder = "";
  let tag = "#decks";
  let profiles: ProfileOpt[] = [];
  let profileId = "";
  let appendFile: TFile | null = null; // vault file to append to
  let saveError: string | null = null;
  // Summarised by the panel's chips; the form opens from them, or when a save lacks a target.
  let showDestination = false;
  $: saveLabel =
    phase === "saving"
      ? g.saving
      : cardType === "mcq"
        ? saveable.length === 1
          ? g.examDraft.saveOne
          : I18n.format(g.examDraft.save, { count: saveable.length })
        : I18n.format(g.save, { count: saveable.length });
  $: destinationLabel =
    saveMode === "append"
      ? (appendFile?.basename ?? g.deckSearchPlaceholder)
      : fileName.trim() || g.modeNew;
  $: profileLabel = profiles.find((p) => p.id === profileId)?.name ?? "";

  async function initSaveDefaults() {
    folder = defaultFolder;
    tag = deckTag;
    profiles = await loadProfiles();
    profileId = profiles[0]?.id ?? "";
  }

  // Questions have one destination shape: the exam profile, its tag, and the
  // heading-plus-task-list body. Switching type retargets the save row rather
  // than leaving the user to discover the combination themselves.
  // What the save row held before questions took it over, so switching back
  // does not leave flashcards on the exam tag and profile.
  let beforeQuestions: { format: SaveFormat; appendFormat: SaveFormat; tag: string; profileId: string } | null = null;
  $: if (cardType === "mcq" && !hasSaved) {
    beforeQuestions ??= { format, appendFormat, tag, profileId };
    format = "mcq";
    appendFormat = "mcq";
    tag = examTag;
    if (profiles.some((p) => p.id === EXAMS_PROFILE_ID)) profileId = EXAMS_PROFILE_ID;
  }
  $: if (cardType !== "mcq" && beforeQuestions && !hasSaved) {
    ({ format, appendFormat, tag, profileId } = beforeQuestions);
    beforeQuestions = null;
  }
  $: examTag = getExamDeckTag(deckTag);

  // Drop the chosen file if it no longer matches the format's file kind
  // (canvas format ↔ .canvas file; markdown formats ↔ .md file).
  $: if (
    appendFile &&
    (appendFormat === "canvas") !== (appendFile.extension === "canvas")
  ) {
    appendFile = null;
  }
  // Human label for the append format (used in the read-only locked view).
  $: appendFormatLabel =
    appendFormat === "table"
      ? g.formatTable
      : appendFormat === "canvas"
        ? g.formatCanvas
        : g.formatHeader;

  // Render a native Obsidian icon into an element.
  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
  }

  // Pick the append target from the vault: any .md file for markdown formats,
  // any .canvas file for the canvas format.
  function openFilePicker() {
    const files =
      appendFormat === "canvas"
        ? app.vault.getFiles().filter((f) => f.extension === "canvas")
        : app.vault.getMarkdownFiles();
    new FilePickerModal(
      app,
      files,
      (file) => {
        appendFile = file;
      },
      g.deckSearchPlaceholder,
    ).open();
  }

  // Pick the destination folder for a new file ("" = vault root).
  function openFolderPicker() {
    const folders = Array.from(
      new Set(["", ...app.vault.getAllFolders().map((f) => f.path)]),
    );
    new FolderPickerModal(
      app,
      folders,
      (path) => {
        folder = path;
      },
      g.folder,
    ).open();
  }
  // Canvas new files must land in the canvas-decks folder; default it there.
  $: if (saveMode === "new-file" && format === "canvas" && folder === defaultFolder) {
    folder = canvasFolder || defaultFolder;
  }
  function buildRequest(): GeneratorSaveRequest | null {
    if (saveMode === "append") {
      if (!appendFile) {
        saveError = g.deckRequired;
        return null;
      }
      return { kind: "append", format: appendFormat, filePath: appendFile.path };
    }
    if (!fileName.trim()) {
      saveError = g.nameRequired;
      return null;
    }
    return {
      kind: "new-file",
      format,
      folder: folder.trim(),
      name: fileName.trim(),
      tag: tag.trim() || deckTag,
      profileId,
    };
  }

  async function doSave() {
    saveError = null;
    const request = buildRequest();
    if (!request) {
      showDestination = true;
      return;
    }
    const kept = saveable;
    const cards = kept.map((r) => r.card);
    if (cards.length === 0) {
      saveError = g.noKept;
      return;
    }
    const savedIds = new Set(kept.map((r) => r.id));
    phase = "saving";
    const result = await save(cards, request);
    if (result.ok) {
      rows = rows.map((r) =>
        savedIds.has(r.id) ? { ...r, saved: true } : r,
      );
      // The written count, not the kept count: duplicates of cards the deck
      // already holds are dropped on the way in.
      savedTotal += result.count ?? savedIds.size;
      skippedTotal += result.skipped ?? 0;
      elsewhereTotal += result.elsewhere ?? 0;
      const savedPath =
        result.filePath ??
        (request.kind === "append" ? request.filePath : undefined);
      // Further saves this session append to the file we just wrote, so lock the
      // target to it; a new note that had nothing to write was never created.
      if (savedPath) {
        hasSaved = true;
        const savedFile = app.vault.getAbstractFileByPath(savedPath);
        appendFile =
          savedFile && "extension" in savedFile ? (savedFile as TFile) : appendFile;
        appendFormat = request.format; // lock consecutive generations to this target
        saveMode = "append";
      }
      phase = "review";
      schedulePersist();
    } else {
      saveError = result.error?.trim() ? result.error : g.saveFailed;
      phase = "review";
    }
  }
</script>

<div class="decks-ai-gen-layout" bind:this={layoutEl}>
<div class="decks-ai-gen">
  <div class="decks-ai-gen-header">
    <div class="decks-ai-gen-header-text">
      <div class="decks-ai-gen-title-row">
        <span class="decks-ai-gen-session-title">{sessionTitle}</span>
        <DocInfoButton path="ai" />
      </div>
      {#if sourceChips.length > 0}
        <div class="decks-ai-gen-source-chips">
          {#each sourceChips as chip (chip.id)}
            {#if chip.kind === "pdf"}
              <button
                type="button"
                class="decks-ai-gen-source-chip is-button"
                class:is-active={panelOpen && activePdf?.contextId === chip.id}
                aria-pressed={panelOpen && activePdf?.contextId === chip.id}
                aria-label={I18n.format(g.pdfPanel.show, { name: chip.label })}
                title={chip.path}
                on:click={() => togglePdfPanel(chip.id)}
              >
                <span class="decks-ai-gen-source-icon" use:icon={"book-open"}></span>
                <span class="decks-ai-gen-source-label">{chip.label}</span>
              </button>
            {:else}
              <span class="decks-ai-gen-source-chip" title={chip.path}>
                <span class="decks-ai-gen-source-icon" use:icon={"file-text"}></span>
                <span class="decks-ai-gen-source-label">{chip.label}</span>
              </span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
    <div class="decks-ai-gen-header-actions">
      {#if debugEnabled}
        <button
          type="button"
          class="clickable-icon decks-ai-gen-head-btn"
          class:is-active={showDebug}
          aria-pressed={showDebug}
          aria-label={g.debugToggle}
          title={g.debugToggle}
          use:icon={"bug"}
          on:click={toggleDebug}
        ></button>
      {/if}
      {#if rows.length > 0}
        {#if !mobile}
          <button
            type="button"
            class="clickable-icon decks-ai-gen-head-btn"
            class:is-active={stagedVisible}
            aria-pressed={stagedVisible}
            aria-label={g.stagedTitle}
            title={g.stagedTitle}
            use:icon={"panel-right"}
            on:click={toggleStaged}
          ></button>
        {/if}
        {#if debugEnabled || !mobile}
          <span class="decks-ai-gen-head-sep" aria-hidden="true"></span>
        {/if}
        <button
          type="button"
          class="clickable-icon decks-ai-gen-head-btn"
          class:is-active={showDestination}
          aria-pressed={showDestination}
          aria-label={`${g.destination}: ${destinationLabel}`}
          title={`${g.destination}: ${destinationLabel}`}
          use:icon={saveMode === "new-file" ? "file-plus" : "file-input"}
          on:click={() => (showDestination = !showDestination)}
        ></button>
        <button
          type="button"
          class="mod-cta decks-ai-gen-save-btn"
          aria-label={saveLabel}
          title={saveLabel}
          on:click={doSave}
          disabled={saveable.length === 0 || phase !== "review"}
        >
          <span class="decks-ai-gen-save-btn-icon" use:icon={"save"}></span>
        </button>
      {/if}
    </div>
  </div>
  <input
    class="decks-pdf-file-input"
    type="file"
    accept="application/pdf"
    bind:this={pdfInputEl}
    on:change={onPdfInputChange}
  />

  {#if (phase === "review" || phase === "saving") && (showDestination || saveError?.trim())}
    <div class="decks-ai-gen-save">
      {#if showDestination}
      {#if !hasSaved}
        <div class="decks-seg" role="tablist">
          <button
            type="button"
            class="decks-seg-btn"
            class:is-active={saveMode === "new-file"}
            role="tab"
            aria-selected={saveMode === "new-file"}
            on:click={() => (saveMode = "new-file")}
          >
            {g.modeNew}
          </button>
          <button
            type="button"
            class="decks-seg-btn"
            class:is-active={saveMode === "append"}
            role="tab"
            aria-selected={saveMode === "append"}
            on:click={() => (saveMode = "append")}
          >
            {g.modeAppend}
          </button>
        </div>
      {/if}

      {#if saveMode === "new-file"}
        <div class="decks-ai-gen-save-grid">
          <label class="decks-ai-gen-save-row">
            <span>{g.format}</span>
            <select bind:value={format}>
              <option value="header-paragraph">{g.formatHeader}</option>
              <option value="table">{g.formatTable}</option>
              <option value="canvas">{g.formatCanvas}</option>
            </select>
          </label>
          <label class="decks-ai-gen-save-row">
            <span>{g.name}</span>
            <input type="text" bind:value={fileName} placeholder={g.namePlaceholder} />
          </label>
          <label class="decks-ai-gen-save-row">
            <span>{g.folder}</span>
            <button
              type="button"
              class="decks-ai-gen-deck-search"
              on:click={openFolderPicker}
            >
              <span class="decks-deck-search-icon" use:icon={"folder"}></span>
              <span class:is-placeholder={!folder}>
                {folder || g.folderPlaceholder}
              </span>
            </button>
          </label>
          {#if format !== "canvas"}
            <label class="decks-ai-gen-save-row">
              <span>{g.tag}</span>
              <input type="text" bind:value={tag} />
            </label>
          {/if}
          <label class="decks-ai-gen-save-row">
            <span>{g.profile}</span>
            <select bind:value={profileId}>
              {#each profiles as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          </label>
        </div>
      {:else}
        <div class="decks-ai-gen-save-grid">
          <label class="decks-ai-gen-save-row">
            <span>{g.format}</span>
            {#if hasSaved}
              <span class="decks-ai-gen-readonly">{appendFormatLabel}</span>
            {:else}
              <select bind:value={appendFormat}>
                <option value="header-paragraph">{g.formatHeader}</option>
                <option value="table">{g.formatTable}</option>
                <option value="canvas">{g.formatCanvas}</option>
              </select>
            {/if}
          </label>
          <label class="decks-ai-gen-save-row">
            <span>{g.deck}</span>
            {#if hasSaved}
              <span class="decks-ai-gen-readonly">{appendFile?.path ?? ""}</span>
            {:else}
              <button
                type="button"
                class="decks-ai-gen-deck-search"
                on:click={openFilePicker}
              >
                <span class="decks-deck-search-icon" use:icon={"search"}></span>
                <span class:is-placeholder={!appendFile}>
                  {appendFile ? appendFile.path : g.deckSearchPlaceholder}
                </span>
              </button>
            {/if}
          </label>
        </div>
      {/if}
      {/if}

      {#if saveError?.trim()}
        <div class="decks-edit-error">{saveError}</div>
      {/if}
    </div>
  {/if}

  {#if genError?.trim()}
    <div class="decks-edit-error">{genError}</div>
  {/if}

  {#if pdfProgress}
    <div class="decks-ai-gen-pdf-progress" role="status" aria-live="polite">
      <div class="decks-ai-gen-pdf-progress-label">
        <span
          >{I18n.format(g.pdfOcrProgress, {
            done: pdfProgress.done,
            total: pdfProgress.total,
          })}</span
        >
        {#if ocrProgress && !ocrProgress.fromCache}
          <span class="decks-ai-gen-pdf-ocr-tag">{g.pdfModeOcr}</span>
        {:else if ocrProgress?.fromCache}
          <span class="decks-pdf-cached-badge">{g.pdfCached}</span>
        {/if}
      </div>
      <div class="decks-ai-gen-pdf-progress-track">
        <div
          class="decks-ai-gen-pdf-progress-fill"
          style:width={`${pdfPct}%`}
        ></div>
      </div>
    </div>
  {/if}

  <div class="decks-ai-gen-body">
    <div class="decks-ai-gen-sidebar">
      <AiThread
        {blocks}
        {rows}
        isQuestion={cardType === "mcq"}
        {flaggedOnly}
        {unchecked}
        {selectedId}
        {partial}
        {renderMarkdown}
        {resolveCardPage}
        {canJumpTo}
        onJump={jumpToSourcePage}
        onSelect={select}
        onToggleKeep={toggleKeep}
        {streamingBlockId}
        onFix={(row, action) => void applyFix(row, action)}
        onUndo={undoFix}
        onKeepAll={keepAll}
        onDiscardAll={discardAll}
        undoable={undoRound ? { blockId: undoRound.blockId, count: undoRound.before.size } : null}
        onUndoDiscard={undoDiscard}
        onAnswerToCard={answerToCard}
        onAnswerGaps={generateForAnswerGaps}
        onJumpPage={(page) => {
          const pdf = activePdf;
          if (pdf) jumpToSourcePage({ page, pdfHash: pdf.hash });
        }}
        canJumpPage={Boolean(activePdf)}
      >
        {#if phase === "streaming" && !pdfProgress}
          <AiStageLine {stage} since={progressAt} thinking={thinkingText} onStop={interrupt} />
        {/if}
        {#if rows.length === 0 && !partial && phase !== "streaming"}
          <div class="decks-ai-gen-note">{g.noCards}</div>
        {/if}
      </AiThread>
    </div>
  </div>


  {#if phase === "idle" || phase === "streaming" || phase === "review"}
    <div class="decks-ai-gen-composer">
      {#if ask && (pdfs.length > 0 || hasNoteSource)}
        <div class="decks-ai-gen-quick">
          <button
            type="button"
            class="decks-ai-gen-quick-ask"
            disabled={asking || phase === "streaming"}
            on:click={() => void askQuestion(g.chat.whatDidIMiss)}>{g.chat.whatDidIMiss}</button
          >
        </div>
      {/if}
      <AiPromptComposer
        {cardTypeOptions}
        bind:selectedCardType={cardType}
        bind:prompt
        {contexts}
        {mentionItems}
        {mentionLabels}
        splitAvailable={false}
        {modelOptions}
        bind:selectedModel
        submitting={phase === "streaming"}
        onStop={interrupt}
        stopLabel={g.stop}
        submitLabel={canContinue ? g.continueGenerating : g.generate}
        submittingLabel={g.generating}
        placeholder={g.promptPlaceholder}
        onAddNote={addNote}
        onAddImage={addImage}
        {pdfAvailable}
        {pdfSources}
        onAddPdfFiles={pastePdfs}
        onRemoveContext={removeContext}
        onOpenContext={togglePdfPanel}
        activeContextId={panelOpen ? (activePdf?.contextId ?? null) : null}
        onMention={addMention}
        onPasteImages={pasteImages}
        onSubmit={() => void startGenerate()}
        askAvailable={Boolean(ask) && (pdfs.length > 0 || hasNoteSource)}
        askLabel={asking ? g.chat.asking : g.chat.ask}
        {asking}
        onAsk={() => void askQuestion()}
        includeAvailable={rows.length > 0}
        includeOn={includeGenerated}
        includeLabel={g.includeGenerated}
        onToggleInclude={() => (includeGenerated = !includeGenerated)}
      />
    </div>
  {/if}

  <div class="decks-ai-gen-footer">
    {#if phase === "streaming"}
      <span class="decks-ai-gen-footer-info">
        {#if pdfProgress}
          {I18n.format(g.pdfOcrProgress, {
            done: pdfProgress.done,
            total: pdfProgress.total,
          })}
        {:else}
          {I18n.format(g.streaming, { count: rows.length })}
        {/if}
      </span>
    {:else if phase === "saving"}
      <span class="decks-ai-gen-footer-info">{g.saving}</span>
    {:else}
      {#if critiquing}
        <span class="decks-ai-gen-skipped-notice">{g.critiqueRunning}</span>
      {/if}
      {#if cardType === "mcq" && (eligibleCount > 0 || skippedCount > 0)}
        <span class="decks-ai-gen-skipped-notice"
          >{I18n.format(g.eligiblePreview, { count: eligibleCount })}</span
        >
        {#if skippedCount > 0}
          <span class="decks-ai-gen-flag-summary"
            >{I18n.format(g.skippedPreview, { count: skippedCount })}</span
          >
        {/if}
      {/if}
      {#if flaggedCount > 0}
        <button
          type="button"
          class="decks-ai-gen-flag-summary decks-ai-gen-flag-toggle"
          class:is-active={flaggedOnly}
          aria-pressed={flaggedOnly}
          title={g.flaggedFilter}
          on:click={() => (flaggedOnly = !flaggedOnly)}
          >{I18n.format(g.flaggedNotice, { count: flaggedCount })}</button
        >
      {/if}
      {#if skippedTotal > 0}
        <span class="decks-ai-gen-skipped-notice"
          >{I18n.format(g.skippedNotice, { count: skippedTotal })}</span
        >
      {/if}
      {#if elsewhereTotal > 0}
        <span class="decks-ai-gen-skipped-notice"
          >{I18n.format(g.elsewhereNotice, { count: elsewhereTotal })}</span
        >
      {/if}
      {#if savedTotal > 0}
        <span class="decks-ai-gen-footer-info">
          {I18n.format(g.savedNotice, { count: savedTotal })}
        </span>
      {/if}
      {#if sourceCovered}
        <span class="decks-ai-gen-covered">
          <span class="decks-ai-gen-covered-icon" use:icon={"check-check"}></span>
          {g.sourceCovered}
        </span>
      {/if}
    {/if}
  </div>
</div>
{#if (rows.length > 0 && !mobile && stagedVisible) || (activePdf && panelOpen)}
  <aside
    class="decks-ai-gen-side"
    class:is-open={activePdf && panelOpen}
    class:is-sheet={mobile && activePdf && panelOpen}
    bind:this={sideEl}
  >
    {#if activePdf && panelOpen && !mobile}
      <!-- A focusable separator is the ARIA window-splitter pattern. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="decks-ai-gen-side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={g.pdfPanel.resize}
        aria-valuenow={paneWidth}
        aria-valuemin={PDF_PANE_MIN_WIDTH}
        aria-valuemax={paneMax}
        aria-valuetext={`${paneWidth} px`}
        tabindex="0"
        on:pointerdown={startPaneResize}
        on:keydown={nudgePane}
      ></div>
    {/if}
    {#if activePdf && panelOpen}
      <PdfPanel
        title={activePdf.label}
        tabs={pdfTabs}
        activeTabId={activePdfId}
        views={pdfViewTabs}
        view={shownView}
        onView={(v) => (panelView = v)}
        onSelectTab={(id) => (activePdfId = id)}
        onRemoveTab={removeContext}
        onClose={() => (panelOpen = false)}
        onOpenInViewer={activePdf.vaultPath ? openActivePdfInViewer : null}
      >
        {#key activePdf.contextId}
          {#if shownView === "pages"}
            <PdfPagesView
              doc={activePdf.doc}
              cardsByPage={sourceCardsByPage}
              focus={pagesFocus && pagesFocus.hash === activePdf.hash ? pagesFocus : null}
              onFocusDone={(seq) => {
                if (pagesFocus?.seq === seq) pagesFocus = null;
              }}
              startPage={pagesAt.get(activePdf.hash) ?? 1}
              onPageChange={(page) => {
                if (activePdf) pagesAt.set(activePdf.hash, page);
              }}
              compact={mobile}
              disabled={phase === "streaming" || phase === "saving" || blueprintRunning || asking}
              busy={passageBusy}
              askAvailable={Boolean(ask)}
              onAsk={(passage, question) => void askPassage(passage, question)}
              onMakeCards={(passage) => void cardsFromPassage(passage)}
            />
          {:else if shownView === "concepts"}
            <AiCoveragePanel
              rows={conceptRows}
              extracted={ledgerExtracted}
              sourcedPages={new Set(
                pagesForSelection(activePdf.chapters, activePdf.selectedIds),
              )}
              cardsByPage={sourceCardsByPage}
              {conceptsPerPage}
              busy={conceptBusy}
              error={conceptError}
              onExtract={() => void extractConcepts()}
              onGenerate={generateForConcepts}
              onRepair={repairCards ? repairConcepts : undefined}
              onSplit={splitConcepts}
            />
          {:else if shownView === "blueprint"}
            <ExamBlueprintPanel
              sections={blueprintSections}
              mix={examMix}
              settings={examSettings}
              hasProfile={Boolean(profileId)}
              meaningAvailable={aiProvider === "decks-pro"}
              savedDefaults={examDefaultsSaved}
              busy={phase === "streaming" || blueprintRunning}
              progress={blueprintProgress}
              onSections={setBlueprint}
              onSettings={(next) => {
                examSettings = next;
                examDefaultsSaved = false;
              }}
              onSaveDefaults={() => void saveExamDefaults()}
              onGenerate={() => void runBlueprint()}
            />
          {:else}
            <ChapterPanel
              chapters={activePdf.chapters}
              selectedIds={activePdf.selectedIds}
              {cardsByChapter}
              {cardsByPage}
              sourcedPages={coveredPageSet}
              onGenerateForGaps={generateForGaps}
              {ocrProgress}
              onSelectionChange={(ids) => updateActivePdf({ selectedIds: ids })}
            />
          {/if}
        {/key}
      </PdfPanel>
    {/if}
    {#if rows.length > 0 && !mobile && stagedVisible && cardType === "mcq"}
      <ExamDraftPanel
        mix={examMix}
        pending={eligibleCount}
        skipped={skippedCount}
        {destinationLabel}
        tag={examTag}
        onEditDestination={() => (showDestination = !showDestination)}
      />
    {:else if rows.length > 0 && !mobile && stagedVisible}
      <AiStagedPanel
        {rows}
        isQuestion={false}
        {selectedId}
        {renderMarkdown}
        {resolveCardPage}
        {canJumpTo}
        onJump={jumpToSourcePage}
        onSelect={select}
        onToggleKeep={toggleKeep}
        onFix={(row, action) => void applyFix(row, action)}
        onUndo={undoFix}
      />
    {/if}
  </aside>
{/if}
{#if debugEnabled && showDebug}
  <aside class="decks-ai-gen-debug">
    <div class="decks-ai-gen-debug-title">{g.debugTitle}</div>
    {#if ocrDebug.length > 0}
      <div class="decks-ai-debug-label">{g.debugOcr}</div>
      <div class="decks-ai-gen-debug-meta">{ocrDebug[0].model}</div>
      <div class="decks-ai-debug-label">{g.debugSystem}</div>
      <pre class="decks-ai-debug-pre">{ocrDebug[0].system}</pre>
      <div class="decks-ai-debug-label">{g.debugUser}</div>
      <pre class="decks-ai-debug-pre">{ocrDebug[0].user}</pre>
      {#each ocrDebug as entry (entry.page)}
        <div class="decks-ai-debug-label">
          {I18n.format(g.debugOcrPage, { page: entry.page })}
        </div>
        <img class="decks-ai-debug-img" src={entry.imageDataUrl} alt="" />
        <pre class="decks-ai-debug-pre">{entry.raw}</pre>
      {/each}
    {/if}
    {#if lastDebug}
      <div class="decks-ai-gen-debug-meta">
        {lastDebug.provider} · {lastDebug.model}
      </div>
      <div class="decks-ai-debug-label">{g.debugSystem}</div>
      <pre class="decks-ai-debug-pre">{lastDebug.system}</pre>
      <div class="decks-ai-debug-label">{g.debugUser}</div>
      <pre class="decks-ai-debug-pre">{lastDebug.user}</pre>
      {#if lastDebug.priorAssistant}
        <div class="decks-ai-debug-label">{g.debugPriorAssistant}</div>
        <pre class="decks-ai-debug-pre">{lastDebug.priorAssistant}</pre>
      {/if}
      {#if lastDebug.followupUser}
        <div class="decks-ai-debug-label">{g.debugFollowup}</div>
        <pre class="decks-ai-debug-pre">{lastDebug.followupUser}</pre>
      {/if}
      {#if lastDebug.imageCount > 0}
        <div class="decks-ai-gen-debug-meta">
          {g.debugImages}: {lastDebug.imageCount}
        </div>
      {/if}
      <div class="decks-ai-debug-label">{g.debugResponse}</div>
      <pre class="decks-ai-debug-pre">{lastDebug.raw}</pre>
    {:else if ocrDebug.length === 0}
      <div class="decks-ai-gen-debug-empty">{g.debugEmpty}</div>
    {/if}
  </aside>
{/if}
</div>

<style>
  /* One right-hand column: chapter tree above, staged pile below. */
  .decks-ai-gen-side {
    position: relative;
    flex: 0 0 var(--decks-pane-chapters, 280px);
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--background-modifier-border-hover);
    background: var(--background-secondary);
    box-sizing: border-box;
    overflow: hidden;
  }
  .decks-ai-gen-save-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
  }
  .decks-ai-gen-save-btn-icon {
    display: inline-flex;
    --icon-size: 16px;
  }
  /* With the PDF panel open the column takes the remembered width, dragged from its inner edge. */
  .decks-ai-gen-side.is-open:not(.is-sheet) {
    flex-basis: var(--decks-pane-pdf, 440px);
    min-width: 280px;
    max-width: 70%;
  }
  .decks-ai-gen-side-resize {
    touch-action: none;
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 5px;
    z-index: 2;
    cursor: col-resize;
  }
  .decks-ai-gen-side-resize:hover,
  .decks-ai-gen-side-resize:focus-visible {
    background: var(--interactive-accent);
    outline: none;
  }
  .decks-ai-gen-side :global(.decks-pdf-panel) {
    flex: 1 1 auto;
    min-height: 0;
    border-left: none;
    border-right: none;
  }
  /* Beside an open PDF the exam summary stays short and the PDF gets the height. */
  .decks-ai-gen-side.is-open :global(.decks-ai-draft) {
    flex: 0 1 auto;
    max-height: 40%;
  }

  .decks-ai-gen-layout {
    display: flex;
    height: 100%;
    width: 100%;
    min-height: 0;
    /* The mobile source panel is a sheet over this, not a column beside it. */
    position: relative;
  }
  /* A phone has no room for a column: the PDF panel takes the whole pane until dismissed. */
  .decks-ai-gen-side.is-sheet {
    position: absolute;
    inset: 0;
    z-index: 1;
    flex-basis: auto;
    border-left: none;
    background: var(--background-primary);
  }
  .decks-ai-gen-side.is-sheet :global(.decks-pdf-panel) {
    max-height: none;
    flex: 1 1 auto;
  }
  .decks-ai-gen {
    display: flex;
    flex-direction: column;
    height: 100%;
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 16px 20px;
    box-sizing: border-box;
  }
  .decks-ai-gen-debug {
    flex: 0 0 var(--decks-pane-debug, 340px);
    min-height: 0;
    overflow-y: auto;
    border-left: 1px solid var(--background-modifier-border);
    padding: 16px;
    box-sizing: border-box;
  }
  .decks-ai-gen-debug-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
    margin-bottom: 8px;
  }
  .decks-ai-gen-debug-meta {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 6px;
    font-family: var(--font-monospace);
  }
  .decks-ai-gen-debug-empty {
    font-size: 12px;
    color: var(--text-faint);
  }
  .decks-ai-debug-label {
    margin-top: 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
    font-weight: 600;
  }
  .decks-ai-debug-img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 2px 0 0 0;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }
  .decks-ai-debug-pre {
    margin: 2px 0 0 0;
    max-height: 200px;
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
  .decks-ai-gen-header {
    flex: 0 0 auto;
    padding: 0 0 9px;
    border-bottom: 1px solid var(--background-modifier-border);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .decks-ai-gen-session-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-gen-source-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .decks-ai-gen-source-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 220px;
    padding: 1px 6px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    font-size: 11px;
  }
  .decks-ai-gen-source-chip.is-button {
    height: auto;
    border: none;
    box-shadow: none;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .decks-ai-gen-source-chip.is-button:hover {
    color: var(--text-normal);
  }
  .decks-ai-gen-source-chip.is-button.is-active {
    color: var(--text-on-accent);
    background: var(--interactive-accent);
  }
  .decks-ai-gen-source-icon {
    display: inline-flex;
    --icon-size: 11px;
  }
  .decks-ai-gen-source-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-gen-header-text {
    min-width: 0;
  }
  .decks-ai-gen-header-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .decks-ai-gen-head-btn {
    flex: 0 0 auto;
  }
  .decks-ai-gen-head-btn.is-active {
    color: var(--text-on-accent);
    background: var(--interactive-accent);
  }
  /* A thin rule between the view toggles and the save pair. */
  .decks-ai-gen-head-sep {
    flex: none;
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--background-modifier-border);
  }
  /* Title and its (i) button sit together; the header's own actions column
     handles anything that belongs on the far right. */
  .decks-ai-gen-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    min-width: 0;
  }
  .decks-ai-gen-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  .decks-ai-gen-sidebar {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 6px;
    background: var(--background-secondary);
    border-right: 1px solid var(--background-modifier-border-hover);
    border-radius: var(--radius-s) 0 0 var(--radius-s);
  }
  /* A rubric violation. Warning-tinted rather than error-coloured: the card is
     still saveable, and the verdict annotates rather than rejects. */
  .decks-ai-gen-flag-summary {
    font-size: 11px;
    color: var(--color-yellow);
  }
  /* A chip that narrows the thread to what needs attention. */
  .decks-ai-gen-flag-toggle {
    height: auto;
    padding: 1px 8px;
    border: 1px solid rgba(var(--callout-warning), 0.35);
    border-radius: var(--radius-s);
    background: transparent;
    box-shadow: none;
    cursor: pointer;
  }
  .decks-ai-gen-flag-toggle.is-active {
    background: rgba(var(--callout-warning), 0.12);
  }
  .decks-ai-gen-skipped-notice {
    font-size: 11px;
    color: var(--text-muted);
  }

  .decks-ai-gen-note {
    color: var(--text-muted);
    font-size: 13px;
    padding: 8px 2px;
  }
  .decks-ai-gen-save {
    flex: 0 0 auto;
    padding: 10px 0;
    border-top: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .decks-ai-gen-save-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
  }
  .decks-ai-gen-save-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--font-ui-small);
    color: var(--text-normal);
  }
  .decks-ai-gen-save-row > span {
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  /* A locked, non-editable value (format/deck after the first save). */
  .decks-ai-gen-save-row > span.decks-ai-gen-readonly {
    font-size: 1em;
    text-transform: none;
    letter-spacing: normal;
    color: var(--text-normal);
    padding: var(--size-4-1) 0;
  }
  .decks-ai-gen-quick {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }
  .decks-ai-gen-quick-ask {
    height: auto;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .decks-ai-gen-composer {
    flex: 0 0 auto;
    padding: 10px 0 13px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-gen-footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-gen-footer:not(:has(> *)) {
    display: none;
  }
  .decks-ai-gen-covered {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-on-accent);
    background: var(--interactive-accent);
  }

  .decks-ai-gen-covered-icon {
    display: inline-flex;
  }

  .decks-ai-gen-covered-icon :global(svg) {
    width: 14px;
    height: 14px;
  }

  .decks-ai-gen-footer-info {
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-edit-error {
    color: var(--text-normal);
    background: var(--background-modifier-error);
    padding: 6px 10px;
    border-radius: var(--radius-s);
    font-size: 12px;
    white-space: pre-wrap;
    max-height: 8em;
    overflow-y: auto;
  }
  :global(.decks-modal-mobile) .decks-ai-gen-sidebar {
    flex: 1 1 auto;
    border-right: none;
  }
  .decks-pdf-file-input {
    display: none;
  }
  .decks-ai-gen-pdf-progress {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    margin-bottom: 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }
  .decks-ai-gen-pdf-progress-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-ai-gen-pdf-ocr-tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-accent);
    font-weight: 600;
  }
  .decks-pdf-cached-badge {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-green, var(--text-success));
    font-weight: 600;
  }
  .decks-ai-gen-pdf-progress-track {
    height: 4px;
    border-radius: 2px;
    background: var(--background-modifier-border);
    overflow: hidden;
  }
  .decks-ai-gen-pdf-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.2s ease;
  }
</style>
