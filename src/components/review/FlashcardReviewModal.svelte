<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy, tick } from "svelte";
  import type {
    Flashcard,
    DeckOrGroup,
    ClozeShowContext,
    FlashcardType,
  } from "../../database/types";
  import { isDeckGroup, isCustomDeck } from "../../database/types";
  import type { DecksSettings } from "../../settings";
  import { type RatingLabel, type CramRating } from "@decks/core";
  import type {
    Scheduler,
    SchedulingPreview,
    SessionProgress,
  } from "@decks/core";
  import { I18n, isDirectoryDeckPath, wantsRepair, yieldToUI, toSpeechText, type ResolvedRender } from "@decks/core";
  import type { TtsService } from "../../services/TtsService";
  import { prepareFuzzySearch } from "obsidian";
  import { computeCardHealth } from "@decks/core";
  import {
    blankClozeDeletions,
    classifyExamBody,
    indexSetsEqual,
    shuffleInPlace,
    type ExamOption,
  } from "@decks/core";
  import { isOcclusionV2, parseOcclusionBack, activeMaskIdForCard, prepareClozeMath } from "@decks/core";
  import { clozeActiveOrders, clozeOrderRange, type ClozeStep } from "@decks/core";
  import { renderCardSide } from "../../utils/html-template-render";
  import { renderOcclusion } from "../../utils/occlusion-render";
  import { clozeMarkRange } from "../../utils/cloze-marks";
  import ReviewScratchpad from "./ReviewScratchpad.svelte";
  import DocInfoButton from "../DocInfoButton.svelte";
  import {
    DEFAULT_REVIEW_SHORTCUTS,
    matchesShortcut,
    isReviewShortcut,
    displayShortcutKey,
  } from "../../utils/shortcuts";

  const t = I18n.t;
  const r = t.review;

  // The five configurable review keys (four ratings + reveal/advance).
  $: shortcuts = settings.review.shortcuts ?? DEFAULT_REVIEW_SHORTCUTS;
  // Master switch: gates all review keyboard shortcuts (ratings + reveal + B/S/R).
  $: kbEnabled = settings.review.enableKeyboardShortcuts;

  export let deckOrGroup: DeckOrGroup;
  export let initialCard: Flashcard | null = null;
  export let onReview: (
    cards: Flashcard[],
    rating: RatingLabel,
    timeElapsed?: number,
    shownAt?: Date
  ) => Promise<void>;
  export let renderMarkdown: (
    content: string,
    el: HTMLElement,
    deckFilePath: string | undefined
  ) => void;
  // Resolves a card's tag-bound template (or null to render the default columns).
  export let resolveTemplate: (card: Flashcard) => ResolvedRender | null = () => null;
  // Resolves an Obsidian image linkpath to a renderable URL (for HTML template
  // faces, where ![[img]] embeds must become native <img> tags).
  export let resolveEmbed: (linkpath: string, sourcePath: string) => string | null = () => null;
  export let settings: DecksSettings;
  export let scheduler: Scheduler;
  export let tts: TtsService | undefined = undefined;
  export let onCardReviewed:
    | ((reviewedCard: Flashcard) => Promise<void>)
    | undefined = undefined;
  export let onComplete:
    | ((event: { reason: string; reviewed: number }) => void | Promise<void>)
    | undefined = undefined;
  export let onNavigateToSource:
    | ((card: Flashcard) => Promise<void>)
    | undefined = undefined;
  // Bury / Suspend / Reset action callback. Returns true if the action was
  // applied (so the modal advances to the next card), false if cancelled
  // (e.g. user dismissed the reset confirmation). The wrapper handles the
  // ConfirmModal, DB call, and user-facing Notice; the Svelte side just
  // calls this then advances.
  export let onCardStateAction:
    | ((
        cards: Flashcard[],
        action: "suspend" | "bury" | "reset"
      ) => Promise<boolean>)
    | undefined = undefined;
  export let browseMode = false;
  // Cram (drill) mode: two-button Again/Good drill over allCards. Isolated from
  // real scheduling — writes no review logs and does not mutate card state.
  export let cramMode = false;
  export let allCards: Flashcard[] = [];
  export let isActive: (() => boolean) | undefined = undefined;
  /** Re-read and repair for a card that keeps lapsing. Null when the workbench
   *  never wrote these cards, and then nothing is offered. */
  export let repair: {
    resolve: (card: Flashcard) => Promise<{ page: number; path: string } | null>;
    read: (source: { page: number; path: string }) => void;
    fix: (card: Flashcard, source: { page: number; path: string }) => void;
  } | null = null;

  const dispatch = createEventDispatcher();

  function handleNavigateToSource() {
    if (currentCard && onNavigateToSource) {
      onNavigateToSource(currentCard).catch(console.error);
    }
  }

  function isClozeType(type: FlashcardType): boolean {
    return type === "cloze" || type === "image-occlusion" || type === "image-occlusion-v2";
  }

  // A front-only cloze (bundled 1-column table) keeps the sentence in the front
  // with an empty back; fall back to the front so the blank/reveal logic works.
  function clozeContent(card: Flashcard): string {
    return card.back && card.back.trim().length > 0 ? card.back : card.front;
  }

  function isFrontOnlyCloze(card: Flashcard): boolean {
    return isClozeType(card.type) && !(card.back && card.back.trim().length > 0);
  }

  function prepareImageOcclusionBack(
    back: string,
    activeIndex: number
  ): { content: string; markStart: number; markEnd: number } {
    const lines = back.split("\n");
    const result: string[] = [];
    let listIndex = 0;
    let marksBefore = 0;
    let activeMarkCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const listMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
      if (listMatch) {
        const itemText = listMatch[1];
        const markMatches = itemText.match(/==((?:(?!==).)+)==/g);
        const hasCloze = markMatches && markMatches.length > 0;

        if (!hasCloze) {
          result.push(line.replace(listMatch[1], `==${listMatch[1]}==`));
          if (listIndex < activeIndex) marksBefore += 1;
          if (listIndex === activeIndex) activeMarkCount = 1;
        } else {
          result.push(line);
          const count = markMatches.length;
          if (listIndex < activeIndex) marksBefore += count;
          if (listIndex === activeIndex) activeMarkCount = count;
        }
        listIndex++;
      } else {
        result.push(line);
      }
    }

    return {
      content: result.join("\n"),
      markStart: marksBefore,
      markEnd: marksBefore + activeMarkCount,
    };
  }

  function handleCopyBack() {
    if (currentCard) {
      const text = isClozeType(currentCard.type)
        ? clozeContent(currentCard).replace(/==((?:(?!==).)+)==/g, "$1")
        : currentCard.back;
      navigator.clipboard.writeText(text).catch(console.error);
    }
  }

  // Read-aloud: voice config comes from the deck's profile; the button reads
  // whichever side is currently visible.
  let isSpeaking = false;
  $: ttsProfile = "profile" in deckOrGroup ? deckOrGroup.profile : undefined;
  $: ttsAvailable = tts ? tts.isAvailable() : false;

  // Plain text for the visible side. Cloze answers are masked on the front so
  // the play button never leaks them; the revealed side reads clean.
  function ttsTextForVisibleSide(card: Flashcard): string {
    if (showAnswer) {
      return isClozeType(card.type)
        ? toSpeechText(clozeContent(card))
        : toSpeechText(card.back);
    }
    return isClozeType(card.type)
      ? toSpeechText(clozeContent(card), { maskCloze: true })
      : toSpeechText(card.front);
  }

  function handleToggleSpeak() {
    if (!tts || !currentCard) return;
    if (isSpeaking) {
      tts.stop();
      isSpeaking = false;
      return;
    }
    const text = ttsTextForVisibleSide(currentCard);
    if (!text) return;
    tts.speak(
      text,
      {
        voiceURI: ttsProfile?.ttsVoice,
        rate: ttsProfile?.ttsRate,
        lang: ttsProfile?.ttsLang,
      },
      {
        onStart: () => {
          isSpeaking = true;
        },
        onEnd: () => {
          isSpeaking = false;
        },
      }
    );
  }

  // Stop any reading when the visible card or its reveal state changes so a
  // reading never bleeds across cards or into the answer.
  function cancelSpeechOnChange(_cardId: string | undefined, _revealed: boolean): void {
    if (!tts) return;
    tts.stop();
    isSpeaking = false;
  }
  $: cancelSpeechOnChange(currentCard?.id, showAnswer);

  function getBreadcrumbParts(card: Flashcard): string[] {
    const parts = card.breadcrumb ? card.breadcrumb.split(" > ") : [];
    // A session over several notes names each card's note first; a one-note deck already has it in the title.
    const note = isDirectoryDeckPath(card.sourceFile)
      ? ""
      : (card.sourceFile.split("/").pop() ?? "").replace(/\.(md|canvas)$/i, "");
    if (note && note !== deckOrGroup.name && parts[0] !== note) parts.unshift(note);
    return parts;
  }

  function setClozeAttributes(
    el: HTMLElement,
    clozeIndex: number,
    mode: ClozeShowContext,
    revealed: boolean,
    clozeIndexEnd?: number
  ): void {
    el.setAttribute("data-decks-cloze-index", String(clozeIndex));
    el.setAttribute("data-decks-cloze-mode", mode);
    el.setAttribute("data-decks-cloze-revealed", String(revealed));
    el.removeAttribute("data-decks-cloze-counter");
    if (clozeIndexEnd !== undefined) {
      el.setAttribute("data-decks-cloze-index-end", String(clozeIndexEnd));
    } else {
      el.removeAttribute("data-decks-cloze-index-end");
    }
  }

  function clearClozeAttributes(el: HTMLElement): void {
    el.removeAttribute("data-decks-cloze-index");
    el.removeAttribute("data-decks-cloze-index-end");
    el.removeAttribute("data-decks-cloze-mode");
    el.removeAttribute("data-decks-cloze-revealed");
  }

  let collapsedBreadcrumbIndices = new Set<number>();

  function toggleBreadcrumbIndex(i: number) {
    const next = new Set(collapsedBreadcrumbIndices);
    if (next.has(i)) {
      next.delete(i);
    } else {
      next.add(i);
    }
    collapsedBreadcrumbIndices = next;
  }

  // Helper function to handle complete action (supports both Svelte 4 and Svelte 5)
  function handleComplete(detail: { reason: string; reviewed: number }) {
    if (onComplete) {
      onComplete(detail);
    } else {
      dispatch("complete", detail);
    }
  }

  let showAnswer = false;
  let showNotes = false;
  let showScratchpad = false;
  let isLoading = false;
  let reviewFinished = false;
  let frontEl: HTMLElement;
  let backEl: HTMLElement;
  let notesEl: HTMLElement;
  // Template resolved for the currently displayed card (null = default columns).
  let currentResolved: ResolvedRender | null = null;
  // When a template is bound, notes come ONLY from the template (table columns
  // are template data, not a separate notes field). Otherwise use the card's
  // own notes column (default 3-column behavior).
  $: hasNotes = currentResolved
    ? !!currentResolved.notes
    : !!currentCard?.notes;
  // HTML-template sides render seamless inside a shell (cloze always stays on
  // the boxed markdown path). Each side is independent.
  $: frontIsHtml =
    currentResolved?.frontType === "html" &&
    !(currentCard && isClozeType(currentCard.type));
  $: backIsHtml =
    currentResolved?.backType === "html" &&
    !(currentCard && isClozeType(currentCard.type));
  $: notesIsHtml = currentResolved?.notesType === "html";
  let schedulingInfo: SchedulingPreview | null = null;
  let reviewedCount = 0;
  let cardStartTime = 0;
  let currentCard: Flashcard | null = initialCard;
  $: cardHealth = currentCard
    ? computeCardHealth(
        currentCard,
        {
          leechThreshold: settings.review.leechThreshold,
          denseCardCharThreshold: settings.review.denseCardCharThreshold,
        },
        (() => {
          const profile = "profile" in deckOrGroup ? deckOrGroup.profile : undefined;
          return profile
            ? {
                examEnabled: profile.examEnabled ?? false,
                typedGrading: profile.examSettings?.typedGrading ?? "tolerant",
              }
            : undefined;
        })()
      )
    : null;
  let sessionId: string | null = null;
  let cramSessionId: string | null = null;
  // The deck file path is the sourcePath Obsidian needs to resolve ![[…]] embeds
  // (audio/images). All cards in a deck share one sourceFile.
  $: deckFilePath = currentCard?.sourceFile ?? "";
  let sessionProgress: SessionProgress | null = null;
  let canUndo = false;

  // Cloze group review state: the note's clozes as steps, and what the shown step covers.
  let clozeSteps: ClozeStep[] = [];
  let clozeGroupIndex = 0;
  let clozeGroupTotal = 0;
  let inClozeGroupReview = false;
  let stepCards: Flashcard[] = [];
  let activeOrders: number[] = [];

  // Cards a rating or card action covers, and the clozes shown with them.
  async function stepFor(card: Flashcard): Promise<ClozeStep> {
    const own = clozeSteps[clozeGroupIndex];
    if (inClozeGroupReview && own?.cards[0]?.id === card.id) return own;
    if (cramMode && cramSessionId) return scheduler.getCramClozeStep(cramSessionId, card);
    const grouped = browseMode && (await scheduler.groupsClozesByLine(card));
    return { cards: [card], activeOrders: clozeActiveOrders(card, grouped) };
  }

  function resetClozeGroup(): void {
    inClozeGroupReview = false;
    clozeSteps = [];
    clozeGroupIndex = 0;
    clozeGroupTotal = 0;
  }

  $: clozeShowContext =
    ("profile" in deckOrGroup ? deckOrGroup.profile : undefined)?.clozeShowContext ?? "open";

  // Multiple-choice inside an ordinary review: interactive select → reveal
  // (objective verdict styling) → the normal self-rating buttons. Nothing is
  // persisted beyond the rating; an empty selection is a plain reveal.
  $: isMultipleChoice = currentCard?.type === "multiple-choice";
  // One entry per question: a question has one, an exercise one per sub-question.
  type ReviewItem =
    | { kind: "choice"; stem: string; options: ExamOption[]; notes: string; order: number[]; multi: boolean }
    | { kind: "typed" | "cloze"; stem: string; text: string; notes: string };
  let mcqItems: ReviewItem[] = [];
  let mcqShared = "";
  let mcqSelected: number[][] = [];
  let mcqCardId: string | null = null;
  $: if (currentCard && isMultipleChoice && currentCard.id !== mcqCardId) {
    mcqCardId = currentCard.id;
    const classified = classifyExamBody(currentCard.back);
    const profile = "profile" in deckOrGroup ? deckOrGroup.profile : undefined;
    const shuffle = profile?.examSettings?.shuffleOptions ?? true;
    const choice = (stem: string, options: ExamOption[], notes: string): ReviewItem => {
      const order = options.map((_o, i) => i);
      return {
        kind: "choice",
        stem,
        options,
        notes,
        order: shuffle ? shuffleInPlace(order) : order,
        multi: options.filter((option) => option.correct).length > 1,
      };
    };
    mcqItems =
      classified.kind === "mcq"
        ? [choice(classified.stem, classified.options, "")]
        : classified.kind === "exercise"
          ? classified.items.map((item): ReviewItem =>
              item.kind === "choice"
                ? choice(item.stem, item.options, item.notes)
                : { kind: item.kind, stem: item.stem, text: item.kind === "typed" ? item.answer : item.text, notes: item.notes }
            )
          : [];
    mcqShared = classified.kind === "exercise" ? classified.shared : "";
    mcqSelected = mcqItems.map(() => []);
  }

  /** A fill-in question's text, blanked until the answer is shown. */
  function clozeShown(text: string, revealed: boolean): string {
    return revealed ? text : blankClozeDeletions(text, "\\[...\\]");
  }

  function toggleMcqOption(item: number, fileIndex: number): void {
    const entry = mcqItems[item];
    if (showAnswer || entry?.kind !== "choice") return;
    const current = mcqSelected[item] ?? [];
    const nextSelection = entry.multi
      ? current.includes(fileIndex)
        ? current.filter((v) => v !== fileIndex)
        : [...current, fileIndex]
      : [fileIndex];
    mcqSelected = mcqSelected.map((selection, i) => (i === item ? nextSelection : selection));
  }

  // Selection/reveal passed as params so the template expression depends on
  // them — Svelte only invalidates on identifiers visible in the template.
  function mcqOptionState(
    item: number,
    fileIndex: number,
    selected: number[][],
    revealed: boolean
  ): string {
    const isSelected = (selected[item] ?? []).includes(fileIndex);
    if (!revealed) return isSelected ? "selected" : "";
    const entry = mcqItems[item];
    const correct = entry?.kind === "choice" && entry.options[fileIndex]?.correct === true;
    if (isSelected && correct) return "chosen-correct";
    if (isSelected && !correct) return "chosen-wrong";
    if (!isSelected && correct) return "missed-correct";
    return "";
  }

  function mcqRenderInto(el: HTMLElement, content: string): { destroy(): void } {
    renderMarkdown(content, el, deckFilePath);
    return { destroy() {} };
  }

  // Browse mode variables
  let browseCardIndex = 0;
  let browseCards: Flashcard[] = [];

  // Quick switcher state
  let searchMode = false;
  let searchQuery = "";
  let searchInputEl: HTMLInputElement | undefined;

  $: frontOnlyClozeCard = !!currentCard && isFrontOnlyCloze(currentCard);

  // V2 occlusion: whether the active mask has answer text. A deletion-only mask
  // (no answer) reveals in place on the image and shows no back panel.
  $: currentV2Answered =
    !!currentCard &&
    isOcclusionV2(currentCard) &&
    (() => {
      const doc = parseOcclusionBack(currentCard!.back);
      const active = doc?.masks.find((m) => m.id === activeMaskIdForCard(currentCard!));
      return !!active && active.answer.trim().length > 0;
    })();

  // A front-only cloze keeps the cloze on the front (empty back); its Notes
  // button lives on the front card, so the answer section only appears to host
  // the Extra panel once the user toggles notes open.
  // Multiple-choice: the options carry the answer (verdict styling on
  // reveal); the raw task-list back never renders — the section only opens
  // to host notes.
  $: answerSectionHidden = isMultipleChoice || frontOnlyClozeCard
      ? true
      : (!!currentCard && isOcclusionV2(currentCard) && !currentV2Answered) ||
        (!showAnswer && !(currentCard && isClozeType(currentCard.type) && !isOcclusionV2(currentCard)));

  // Before the reveal the answer keeps its place, so the question stays put when it appears.
  $: answerPending =
    answerSectionHidden &&
    !showAnswer &&
    !isMultipleChoice &&
    !frontOnlyClozeCard &&
    !(!!currentCard && isOcclusionV2(currentCard) && !currentV2Answered);
  $: answerAbsent = answerSectionHidden && !answerPending;
  $: notesToggleVisible = hasNotes && !isMultipleChoice && (showAnswer || !answerSectionHidden);
  $: copyVisible = !frontOnlyClozeCard && !isMultipleChoice && !answerSectionHidden;

  // A pending answer that would not fit leaves the layout, so the question side never scrolls into blank space.
  let pendingOut = false;
  let pendingCardId: string | null = null;
  let schedulePendingMeasure: () => void = () => {};
  $: if ((currentCard?.id ?? null) !== pendingCardId) {
    pendingCardId = currentCard?.id ?? null;
    pendingOut = false;
  }
  $: remeasurePending(answerPending, pendingCardId);

  function remeasurePending(_pending: boolean, _cardId: string | null): void {
    schedulePendingMeasure();
  }

  // Text takes the largest step at which the whole card, hidden answer included, fits without scrolling.
  const FIT_STEPS = ["1", "2", "3", "4"];

  function observePendingAnswer(node: HTMLElement): { destroy(): void } {
    let frame = 0;
    const scrolls = (el: Element): boolean => el.scrollHeight > el.clientHeight + 1;
    const measure = (): void => {
      frame = 0;
      const card = node.querySelector<HTMLElement>(".decks-review-card");
      const stack = node.querySelector<HTMLElement>(".decks-review-card-stack");
      if (!card || !stack) return;
      // The review scrolls as a whole, except on an index card, which scrolls its own text.
      const overflows = (): boolean => scrolls(node) || scrolls(stack);
      if (answerPending) {
        // Measured with the answer in the flow at the base size, within this frame, so nothing flickers.
        stack.classList.remove("decks-answer-left-out");
        card.setAttribute("data-fit", "4");
        pendingOut = overflows();
        if (pendingOut) {
          stack.classList.add("decks-answer-left-out");
          return;
        }
      } else {
        pendingOut = false;
      }
      for (const step of FIT_STEPS) {
        card.setAttribute("data-fit", step);
        if (!overflows()) return;
      }
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    const stack = node.querySelector(".decks-review-card-stack");
    if (stack) {
      observer.observe(stack);
      // An index card's text area keeps its size, so the faces are watched for new content.
      stack.querySelectorAll(":scope > .decks-question-section, :scope > .decks-answer-section").forEach((face) => observer.observe(face));
    }
    schedulePendingMeasure = schedule;
    schedule();
    return {
      destroy() {
        observer.disconnect();
        if (frame) cancelAnimationFrame(frame);
        schedulePendingMeasure = () => {};
      },
    };
  }

  $: searchResults =
    searchMode && searchQuery.trim()
      ? (() => {
          const search = prepareFuzzySearch(searchQuery);
          const scored: { card: Flashcard; index: number; score: number }[] =
            [];
          for (let i = 0; i < browseCards.length; i++) {
            const c = browseCards[i];
            const frontResult = search(c.front);
            const backResult = search(c.back);
            const best = Math.max(
              frontResult ? frontResult.score : -Infinity,
              backResult ? backResult.score : -Infinity
            );
            if (frontResult || backResult) {
              scored.push({ card: c, index: i, score: best });
            }
          }
          scored.sort((a, b) => b.score - a.score);
          return scored.slice(0, 50);
        })()
      : [];

  // Swipe tracking for mobile browse navigation
  let touchStartX = 0;
  let touchStartY = 0;

  // Session timer variables
  let sessionStartTime = 0;
  let sessionTimeRemaining = 0;
  let sessionTimer: number | null = null;

  // Track last event to prevent double execution
  let lastEventTime = 0;
  let lastEventType = "";

  // Card-state actions dropdown (bury / suspend / reset). Toggled from the
  // top-right ⋯ icon and via hotkeys B / S / R. Click-outside closes the menu.
  let actionsMenuOpen = false;
  let actionsMenuEl: HTMLElement | undefined;

  $: progress = sessionProgress
    ? Math.max(sessionProgress.progress, sessionProgress.doneUnique > 0 ? 1 : 0)
    : 0;
  $: timeRemainingDisplay = formatTimeRemaining(sessionTimeRemaining);
  $: cardsRemaining = sessionProgress
    ? sessionProgress.goalTotal - sessionProgress.doneUnique
    : 0;
  $: reviewedCountDisplay = sessionProgress
    ? sessionProgress.doneUnique
    : reviewedCount;

  onMount(async () => {
    if (cramMode) {
      // Cram mode: drill every card until it graduates to a >= 1 day interval.
      const session = await scheduler.startCramSession(
        deckOrGroup,
        allCards,
        new Date()
      );
      cramSessionId = session.sessionId;
      await refreshCramProgress();
      currentCard = await scheduler.getNextCramCard(cramSessionId);
      if (currentCard) {
        await loadCard();
      } else {
        await endReview();
      }
    } else if (browseMode) {
      // Browse mode: load all cards, no session
      browseCards = allCards;
      if (browseCards.length > 0) {
        currentCard = browseCards[0];
        browseCardIndex = 0;
        await loadCard();
      } else {
        reviewFinished = true;
      }
    } else {
      // Standard mode: initialize review session
      let session;
      if (isDeckGroup(deckOrGroup)) {
        session = await scheduler.startReviewSessionForDeckGroup(
          deckOrGroup,
          new Date(),
          settings.review.sessionDuration
        );
      } else if (isCustomDeck(deckOrGroup)) {
        session = await scheduler.startReviewSessionForCustomDeck(
          deckOrGroup,
          new Date()
        );
      } else {
        session = await scheduler.startFreshSession(
          deckOrGroup.id,
          new Date(),
          settings.review.sessionDuration
        );
      }

      sessionId = session.sessionId;
      scheduler.setCurrentSession(sessionId);
      sessionProgress = await scheduler.getSessionProgress(sessionId);
      canUndo = await scheduler.hasUndoableReview();

      // Initialize session timer
      startSessionTimer();

      // If no initial card provided, get the first card from scheduler
      if (!currentCard) {
        if (isDeckGroup(deckOrGroup)) {
          currentCard = await scheduler.getNextForDeckGroup(
            new Date(),
            deckOrGroup,
            {
              allowNew: true,
            }
          );
        } else if (isCustomDeck(deckOrGroup)) {
          currentCard = await scheduler.getNextForCustomDeck(
            new Date(),
            deckOrGroup,
            { allowNew: true }
          );
        } else {
          currentCard = await scheduler.getNext(new Date(), deckOrGroup.id, {
            allowNew: true,
          });
        }
      }

      if (currentCard) {
        await loadCard();
      } else {
        await endReview();
      }
    }

    // Add keydown event listener
    window.addEventListener("keydown", handleKeydown);
    // Click-outside closes the card-actions dropdown.
    window.addEventListener("mousedown", handleDocumentMouseDown);
  });

  function handleDocumentMouseDown(event: MouseEvent) {
    if (!actionsMenuOpen || !actionsMenuEl) return;
    const target = event.target as Node | null;
    if (target && !actionsMenuEl.contains(target)) {
      actionsMenuOpen = false;
    }
  }

  function handleClozeBlankClick(event: Event) {
    const target = event.target as HTMLElement;
    if (
      !target.classList.contains("decks-cloze-active") ||
      !currentCard?.clozeText
    )
      return;

    const container = target.closest("[data-decks-cloze-index]");
    if (
      !container ||
      container.getAttribute("data-decks-cloze-revealed") === "true"
    )
      return;

    // Every blank of the card's step reveals together.
    const fallback = currentCard.clozeText;
    container.querySelectorAll(".decks-cloze-active").forEach((el) => {
      const span = activeDocument.createElement("span");
      span.className = "decks-cloze-revealed";
      span.textContent =
        el.getAttribute("data-decks-cloze-text") ||
        (el === target ? fallback : el.textContent || "");
      el.replaceWith(span);
    });

    container.setAttribute("data-decks-cloze-revealed", "true");
    // Revealing the blank also surfaces the rating buttons.
    showAnswer = true;
  }

  // Render a V2 occlusion image (with mask overlay) into a target element. The
  // active mask reveals in place on the front; the answer text renders
  // separately into the answer section.
  function renderOcclusionV2Into(
    el: HTMLElement,
    card: Flashcard,
    revealed: boolean
  ): void {
    const doc = parseOcclusionBack(card.back);
    if (!doc) {
      el.empty();
      return;
    }
    renderOcclusion(el, {
      doc,
      activeMaskId: activeMaskIdForCard(card),
      revealed,
      showContext: clozeShowContext,
      resolveImage: (lp) => resolveEmbed(lp, card.sourceFile ?? ""),
    });
  }

  function renderOcclusionAnswerInto(el: HTMLElement, card: Flashcard): void {
    el.empty();
    const doc = parseOcclusionBack(card.back);
    const activeId = activeMaskIdForCard(card);
    const active = doc?.masks.find((m) => m.id === activeId);
    if (active && active.answer.trim().length > 0) {
      renderMarkdown(active.answer, el, deckFilePath);
    }
  }

  // Render a cloze card into a target element, blanked or revealed.
  function renderClozeInto(
    el: HTMLElement,
    card: Flashcard,
    revealed: boolean
  ): void {
    el.empty();
    if (card.type === "image-occlusion" && card.clozeOrder !== null) {
      const prepared = prepareImageOcclusionBack(card.back, card.clozeOrder);
      setClozeAttributes(el, prepared.markStart, clozeShowContext, revealed, prepared.markEnd);
      renderMarkdown(prepared.content, el, deckFilePath);
    } else {
      // Clozes inside MathJax can't become <mark> (MathJax owns the $…$ span),
      // so rewrite those to LaTeX up front; out-of-math clozes stay ==…== for the
      // post-processor, with the active index remapped to them.
      const orders = activeOrders.length > 0 ? activeOrders : [card.clozeOrder ?? 0];
      const { markdown, markActiveIndices } = prepareClozeMath(
        clozeContent(card),
        orders,
        clozeShowContext,
        revealed
      );
      const range = clozeMarkRange(markActiveIndices);
      setClozeAttributes(el, range?.start ?? -1, clozeShowContext, revealed, range?.end);
      renderMarkdown(markdown, el, deckFilePath);
    }
  }

  // Where the current card came from, when it is one the workbench wrote and
  // has been missed enough times to be the suspect itself.
  //
  // How often is too often is the leech threshold: the same question the leech
  // filter already asks, answered once by the reader rather than twice by us. A
  // card offered repair here is a card that filter would catch.
  let repairSource: { page: number; path: string } | null = null;
  $: repairThreshold = settings.review.leechThreshold;
  $: repairOffered =
    repair !== null &&
    !cramMode &&
    repairSource !== null &&
    wantsRepair(currentCard?.lapses ?? 0, true, repairThreshold);

  async function loadRepairSource(card: Flashcard): Promise<void> {
    repairSource = null;
    // Asked only for a card already past the threshold, so an ordinary review
    // costs no lookup.
    if (!repair || cramMode || !wantsRepair(card.lapses ?? 0, true, repairThreshold))
      return;
    try {
      const found = await repair.resolve(card);
      if (currentCard?.id === card.id) repairSource = found;
    } catch (e) {
      console.debug("Decks: could not resolve the card's source", e);
    }
  }

  async function loadCard() {
    if (!currentCard) return;
    void loadRepairSource(currentCard);

    const parts = getBreadcrumbParts(currentCard);
    const initialCollapsed = new Set<number>();
    for (let idx = 0; idx < parts.length - 2; idx++) {
      initialCollapsed.add(idx);
    }
    collapsedBreadcrumbIndices = initialCollapsed;
    showAnswer = false;
    showNotes = false;
    showScratchpad = false;

    // Cloze indicator count for the current card (recomputed every card so it's
    // never stale; 0 for non-cloze cards hides the indicator).
    clozeGroupTotal = isClozeType(currentCard.type)
      ? await scheduler.getClozeGroupSize(currentCard)
      : 0;

    // Build the sequential cloze group only in review mode (browse and cram
    // navigate every card individually, so they must not enter group-review state).
    if (
      !browseMode &&
      !cramMode &&
      isClozeType(currentCard.type) &&
      !inClozeGroupReview
    ) {
      clozeSteps = await scheduler.getClozeSteps(currentCard, new Date());
      clozeGroupIndex = 0;
      inClozeGroupReview = true;
    }
    const step = await stepFor(currentCard);
    stepCards = step.cards;
    activeOrders = step.activeOrders;

    // Cram uses a fixed two-button bar (no per-rating interval preview), and its
    // scheduling is isolated from the card's real FSRS state.
    if (cramMode) {
      schedulingInfo = null;
    } else {
      try {
        schedulingInfo = await scheduler.preview(currentCard);
      } catch (error) {
        console.error("Error getting scheduling preview:", error);
        schedulingInfo = null;
      }
    }
    cardStartTime = Date.now();

    // Resolve any tag-bound template for this card (null → default columns).
    currentResolved = resolveTemplate(currentCard);

    // Let the per-side html/markdown branch swap before rendering, so frontEl
    // points at the freshly-mounted container (template layer vs boxed side).
    await tick();

    // Render front side. A front-only cloze (no back) shows its sentence here,
    // in a single container, so the back area stays empty.
    if (frontEl) {
      frontEl.empty();
      if (isFrontOnlyCloze(currentCard)) {
        renderClozeInto(frontEl, currentCard, false);
      } else if (isOcclusionV2(currentCard)) {
        renderOcclusionV2Into(frontEl, currentCard, false);
      } else {
        renderCardSide(
          frontEl,
          currentResolved ? currentResolved.front : currentCard.front,
          currentResolved ? currentResolved.frontType : null,
          renderMarkdown,
          deckFilePath,
          (lp) => resolveEmbed(lp, currentCard?.sourceFile ?? "")
        );
      }
    }

    // Pre-render back side but keep it hidden
    tick().then(() => {
      if (backEl && currentCard) {
        backEl.empty();
        if (isFrontOnlyCloze(currentCard)) {
          clearClozeAttributes(backEl);
        } else if (isOcclusionV2(currentCard)) {
          // The image reveals in place on the front; a mask's answer is laid out hidden so the image stays put.
          clearClozeAttributes(backEl);
          if (currentV2Answered) renderOcclusionAnswerInto(backEl, currentCard);
        } else if (isClozeType(currentCard.type) && currentCard.clozeOrder !== null) {
          renderClozeInto(backEl, currentCard, false);
        } else {
          clearClozeAttributes(backEl);
          renderCardSide(
            backEl,
            currentResolved ? currentResolved.back : currentCard.back,
            currentResolved ? currentResolved.backType : null,
            renderMarkdown,
            deckFilePath,
            (lp) => resolveEmbed(lp, currentCard?.sourceFile ?? "")
          );
        }
      }
    });
  }

  function revealAnswer() {
    showAnswer = true;
    tick().then(() => {
      if (!currentCard) return;
      // Front-only cloze: reveal the active blank in the front container.
      if (isFrontOnlyCloze(currentCard) && frontEl) {
        renderClozeInto(frontEl, currentCard, true);
        return;
      }
      // V2 occlusion: uncover the active mask in place on the front, and render
      // its answer text into the answer section.
      if (isOcclusionV2(currentCard)) {
        if (frontEl) renderOcclusionV2Into(frontEl, currentCard, true);
        if (backEl) {
          clearClozeAttributes(backEl);
          renderOcclusionAnswerInto(backEl, currentCard);
        }
        return;
      }
      if (backEl) {
        backEl.empty();
        if (isClozeType(currentCard.type) && currentCard.clozeOrder !== null) {
          renderClozeInto(backEl, currentCard, true);
        } else {
          clearClozeAttributes(backEl);
          renderCardSide(
            backEl,
            currentResolved ? currentResolved.back : currentCard.back,
            currentResolved ? currentResolved.backType : null,
            renderMarkdown,
            deckFilePath,
            (lp) => resolveEmbed(lp, currentCard?.sourceFile ?? "")
          );
        }
      }
    });
  }

  function toggleScratchpad() {
    showScratchpad = !showScratchpad;
  }

  function toggleNotes() {
    showNotes = !showNotes;
    if (showNotes) {
      tick().then(() => {
        const notesContent = currentResolved
          ? currentResolved.notes
          : currentCard?.notes;
        if (notesEl && notesContent) {
          notesEl.empty();
          renderCardSide(
            notesEl,
            notesContent,
            currentResolved?.notes !== undefined
              ? currentResolved.notesType ?? "md"
              : null,
            renderMarkdown,
            deckFilePath,
            (lp) => resolveEmbed(lp, currentCard?.sourceFile ?? "")
          );
        }
      });
    }
  }

  async function refreshCramProgress() {
    if (!cramSessionId) return;
    const p = await scheduler.getCramProgress(cramSessionId);
    if (p) {
      // Reuse the shared progress bar/counters by mapping cram progress
      // (graduated / goal) onto the session-progress shape.
      sessionProgress = {
        doneUnique: p.graduated,
        goalTotal: p.goalTotal,
        progress: p.progress,
      };
    }
  }

  async function handleCramReview(rating: CramRating) {
    if (!currentCard || isLoading || !cramSessionId) return;

    isLoading = true;
    try {
      const rated = stepCards.length > 0 ? stepCards : [currentCard];
      await scheduler.rateCramGroup(cramSessionId, rated.map((card) => card.id), rating, new Date());
      reviewedCount += rated.length;
      await refreshCramProgress();

      currentCard = await scheduler.getNextCramCard(cramSessionId);
      await yieldToUI();

      if (currentCard) {
        await loadCard();
      } else {
        await endReview();
      }
    } catch (error) {
      console.error("Error cramming card:", error);
    } finally {
      isLoading = false;
    }
  }

  async function handleReview(rating: RatingLabel) {
    if (!currentCard || isLoading) return;

    if (cramMode) {
      // Cram is a two-button drill: only Again / Good are possible.
      await handleCramReview(rating === "again" ? "again" : "good");
      return;
    }

    isLoading = true;
    const reviewPerfStart = performance.now();
    try {
      const timeElapsed = Date.now() - cardStartTime;
      const shownAt = new Date(cardStartTime);
      const rated = stepCards.length > 0 ? stepCards : [currentCard];
      await onReview(rated, rating, timeElapsed, shownAt);
      reviewedCount += rated.length;

      // Update session progress after review
      if (sessionId) {
        sessionProgress = await scheduler.getSessionProgress(sessionId);
      }
      canUndo = await scheduler.hasUndoableReview();

      // Trigger stats refresh after each card review
      if (onCardReviewed) {
        await onCardReviewed(currentCard);
        await yieldToUI();
      }

      // Advance through cloze group or get next card from scheduler
      if (inClozeGroupReview && clozeGroupIndex < clozeSteps.length - 1) {
        clozeGroupIndex++;
        currentCard = clozeSteps[clozeGroupIndex].cards[0];
        await loadCard();
      } else {
        if (inClozeGroupReview) resetClozeGroup();

        if (isDeckGroup(deckOrGroup)) {
          currentCard = await scheduler.getNextForDeckGroup(
            new Date(),
            deckOrGroup,
            {
              allowNew: true,
            }
          );
        } else if (isCustomDeck(deckOrGroup)) {
          currentCard = await scheduler.getNextForCustomDeck(
            new Date(),
            deckOrGroup,
            { allowNew: true }
          );
        } else {
          currentCard = await scheduler.getNext(new Date(), deckOrGroup.id, {
            allowNew: true,
          });
        }
        await yieldToUI();

        if (currentCard) {
          await loadCard();
        } else {
          await endReview();
        }
      }
    } catch (error) {
      console.error("Error reviewing card:", error);
    } finally {
      isLoading = false;
      if (settings?.debug?.performanceLogs) {
        console.debug(
          `[Decks Performance] Review turn (rate + next card) in ${(
            performance.now() - reviewPerfStart
          ).toFixed(1)}ms`
        );
      }
    }
  }

  /**
   * Advance to the next card after a non-rating action (bury/suspend/reset).
   * Mirrors the same fork as handleReview: cloze group → deck group → custom
   * deck → standard deck. Reset propagates through immediately because the
   * card is now back in "new" state and the next pick will see it as
   * available (or another card if scheduler picks one first).
   */
  async function advanceToNextCard(): Promise<void> {
    if (browseMode) {
      // In browse mode bury/suspend/reset still advance; the underlying
      // list isn't re-fetched, so we just step to the next index.
      handleBrowseNext();
      return;
    }
    if (inClozeGroupReview && clozeGroupIndex < clozeSteps.length - 1) {
      clozeGroupIndex++;
      currentCard = clozeSteps[clozeGroupIndex].cards[0];
      await loadCard();
      return;
    }
    if (inClozeGroupReview) resetClozeGroup();
    if (isDeckGroup(deckOrGroup)) {
      currentCard = await scheduler.getNextForDeckGroup(
        new Date(),
        deckOrGroup,
        { allowNew: true }
      );
    } else if (isCustomDeck(deckOrGroup)) {
      currentCard = await scheduler.getNextForCustomDeck(
        new Date(),
        deckOrGroup,
        { allowNew: true }
      );
    } else {
      currentCard = await scheduler.getNext(new Date(), deckOrGroup.id, {
        allowNew: true,
      });
    }
    await yieldToUI();
    if (currentCard) {
      await loadCard();
    } else {
      await endReview();
    }
  }

  function toggleActionsMenu() {
    actionsMenuOpen = !actionsMenuOpen;
  }

  function runCardTool(action: () => void): void {
    actionsMenuOpen = false;
    action();
  }

  /**
   * Apply a per-card state action (suspend / bury / reset). The wrapper's
   * callback handles the destructive confirmation modal (for reset), the DB
   * call, and the user-facing Notice. We just close the menu, advance to
   * the next card if applied, and bookkeep the session/stats the same way
   * handleReview does.
   */
  async function handleCardAction(
    action: "suspend" | "bury" | "reset"
  ): Promise<void> {
    if (!currentCard || isLoading) return;
    if (!onCardStateAction) {
      actionsMenuOpen = false;
      return;
    }
    actionsMenuOpen = false;
    isLoading = true;
    const targetCard = currentCard;
    try {
      const applied = await onCardStateAction(
        stepCards.length > 0 ? stepCards : [targetCard],
        action
      );
      if (!applied) return;
      // Notify stats consumers (deck panel etc.) that this card changed.
      if (onCardReviewed) {
        await onCardReviewed(targetCard);
        await yieldToUI();
      }
      // Refresh session progress so the goal counter reacts to the card
      // disappearing from the queue.
      if (sessionId) {
        sessionProgress = await scheduler.getSessionProgress(sessionId);
      }
      await advanceToNextCard();
    } catch (error) {
      console.error("Error applying card action:", error);
    } finally {
      isLoading = false;
    }
  }

  async function handleUndo() {
    if (isLoading || !canUndo || browseMode) return;
    isLoading = true;
    try {
      const restoredCards = await scheduler.undoLastReviewGroup();
      const restored = restoredCards[0];
      if (!restored) {
        canUndo = await scheduler.hasUndoableReview();
        return;
      }

      resetClozeGroup();

      currentCard = restored;
      reviewedCount = Math.max(0, reviewedCount - restoredCards.length);
      if (sessionId) {
        sessionProgress = await scheduler.getSessionProgress(sessionId);
      }
      canUndo = await scheduler.hasUndoableReview();
      await loadCard();
      if (onCardReviewed) {
        await onCardReviewed(restored);
        await yieldToUI();
      }
    } catch (error) {
      console.error("Error undoing review:", error);
    } finally {
      isLoading = false;
    }
  }

  function getIntervalDisplay(minutes: number): string {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    } else if (minutes < 1440) {
      const hours = Math.round(minutes / 60);
      return `${hours}h`;
    } else {
      const days = Math.ceil(minutes / 1440);
      return `${days}d`;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (isActive && !isActive()) return;
    if (isLoading) return;
    if (searchMode) return;
    // While the scratchpad covers the card, keep review shortcuts (ratings,
    // reveal, B/S/R) from firing — the text box would otherwise trigger them.
    if (showScratchpad) return;

    const now = Date.now();
    const eventType = "keyboard";

    // Prevent double execution within 100ms (same as touch protection)
    if (now - lastEventTime < 100 && lastEventType === eventType) {
      return;
    }

    if (
      !browseMode &&
      (event.metaKey || event.ctrlKey) &&
      (event.key === "z" || event.key === "Z")
    ) {
      event.preventDefault();
      lastEventTime = now;
      lastEventType = eventType;
      handleUndo();
      return;
    }

    // Card-state action hotkeys (B / S / R). Fire on both front and back —
    // these are meta-actions, not review answers. Gated by enableKeyboardShortcuts
    // and skipped when modifier keys are held (avoid eating shortcuts like Cmd+R).
    if (
      currentCard &&
      settings.review.enableKeyboardShortcuts &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const k = event.key.toLowerCase();
      // A key bound to a review shortcut (e.g. rebinding a rating to "s") takes
      // precedence over the card-action keys, so it isn't swallowed here.
      if (
        (k === "b" || k === "s" || k === "r") &&
        !isReviewShortcut(event.key, shortcuts)
      ) {
        event.preventDefault();
        lastEventTime = now;
        lastEventType = eventType;
        const action: "suspend" | "bury" | "reset" =
          k === "b" ? "bury" : k === "s" ? "suspend" : "reset";
        handleCardAction(action);
        return;
      }
    }

    if (browseMode) {
      // Browse mode: reveal key shows the answer, then advances
      if (!showAnswer && kbEnabled && matchesShortcut(event.key, shortcuts.reveal)) {
        event.preventDefault();
        lastEventTime = now;
        lastEventType = eventType;
        revealAnswer();
      } else if (showAnswer) {
        lastEventTime = now;
        lastEventType = eventType;

        if (
          (kbEnabled && matchesShortcut(event.key, shortcuts.reveal)) ||
          event.key === "Enter" ||
          event.key === "ArrowRight"
        ) {
          event.preventDefault();
          handleBrowseNext();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          handleBrowsePrevious();
        } else if (
          (event.key === "n" || event.key === "N") &&
          hasNotes
        ) {
          event.preventDefault();
          toggleNotes();
        }
      }
      return;
    }

    // Cram mode: two-button drill (again / good; reveal doubles as good)
    if (cramMode) {
      if (!showAnswer && kbEnabled && matchesShortcut(event.key, shortcuts.reveal)) {
        event.preventDefault();
        lastEventTime = now;
        lastEventType = eventType;
        revealAnswer();
      } else if (showAnswer) {
        lastEventTime = now;
        lastEventType = eventType;

        if ((event.key === "n" || event.key === "N") && hasNotes) {
          event.preventDefault();
          toggleNotes();
          return;
        }

        if (!kbEnabled) return;

        if (matchesShortcut(event.key, shortcuts.again)) {
          event.preventDefault();
          handleReview("again");
        } else if (
          matchesShortcut(event.key, shortcuts.good) ||
          matchesShortcut(event.key, shortcuts.reveal)
        ) {
          event.preventDefault();
          handleReview("good");
        }
      }
      return;
    }

    // Standard mode
    if (!showAnswer && kbEnabled && isMultipleChoice && /^[1-9]$/.test(event.key)) {
      // Number keys only here — letters would clash with the B/S/R bindings.
      const displayPosition = parseInt(event.key, 10) - 1;
      // An exercise has several lists, so number keys only pick in a single question.
      const only = mcqItems.length === 1 ? mcqItems[0] : null;
      const order = only?.kind === "choice" ? only.order : [];
      if (displayPosition < order.length) {
        event.preventDefault();
        lastEventTime = now;
        lastEventType = eventType;
        toggleMcqOption(0, order[displayPosition]);
      }
      return;
    }
    if (!showAnswer && kbEnabled && matchesShortcut(event.key, shortcuts.reveal)) {
      event.preventDefault();
      lastEventTime = now;
      lastEventType = eventType;
      revealAnswer();
    } else if (showAnswer) {
      // Update timing before handling review
      lastEventTime = now;
      lastEventType = eventType;

      if ((event.key === "n" || event.key === "N") && hasNotes) {
        event.preventDefault();
        toggleNotes();
        return;
      }

      if (!kbEnabled) return;

      // The reveal key doubles as "Good" once the answer is shown (as Space did).
      if (matchesShortcut(event.key, shortcuts.again)) {
        handleReview("again");
      } else if (matchesShortcut(event.key, shortcuts.hard)) {
        handleReview("hard");
      } else if (
        matchesShortcut(event.key, shortcuts.good) ||
        matchesShortcut(event.key, shortcuts.reveal)
      ) {
        handleReview("good");
      } else if (matchesShortcut(event.key, shortcuts.easy)) {
        handleReview("easy");
      }
    }
  }

  async function rate(v: 1 | 2 | 3 | 4) {
    if (v === 1) await handleReview("again");
    else if (v === 2) await handleReview("hard");
    else if (v === 3) await handleReview("good");
    else if (v === 4) await handleReview("easy");
  }

  const onShowAnswer = async (e: PointerEvent) => {
    e.preventDefault();
    revealAnswer();
    await yieldToUI();
  };

  const onRating = async (e: PointerEvent, v: 1 | 2 | 3 | 4) => {
    e.preventDefault();
    await rate(v);
    await yieldToUI();
  };

  // Browse mode navigation
  async function handleBrowseNext() {
    if (!browseMode || isLoading) return;

    if (browseCardIndex >= browseCards.length - 1) {
      handleComplete({
        reason: "browse-complete",
        reviewed: browseCards.length,
      });
      reviewFinished = true;
      return;
    }

    browseCardIndex++;
    currentCard = browseCards[browseCardIndex];
    await loadCard();
  }

  async function handleBrowsePrevious() {
    if (!browseMode || isLoading || browseCardIndex <= 0) return;

    browseCardIndex--;
    currentCard = browseCards[browseCardIndex];
    await loadCard();
  }

  async function handleSliderNavigation() {
    if (browseCardIndex >= 0 && browseCardIndex < browseCards.length) {
      currentCard = browseCards[browseCardIndex];
      showAnswer = false;
      await loadCard();
    }
  }

  async function openSearch() {
    searchMode = true;
    searchQuery = "";
    await tick();
    searchInputEl?.focus();
  }

  function closeSearch() {
    searchMode = false;
    searchQuery = "";
  }

  async function selectSearchResult(index: number) {
    browseCardIndex = index;
    currentCard = browseCards[index];
    showAnswer = false;
    closeSearch();
    await loadCard();
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    }
  }

  function handleTouchStart(event: TouchEvent) {
    if (!browseMode || event.touches.length !== 1) return;
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  }

  function handleTouchEnd(event: TouchEvent) {
    if (!browseMode || event.changedTouches.length !== 1) return;
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    const deltaY = event.changedTouches[0].clientY - touchStartY;

    // Require minimum 50px horizontal movement and more horizontal than vertical
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY)) return;

    if (deltaX > 0) {
      handleBrowseNext();
    } else {
      handleBrowsePrevious();
    }
  }

  onDestroy(async () => {
    // Clean up keydown event listener
    window.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("mousedown", handleDocumentMouseDown);

    // Stop any in-progress read-aloud
    tts?.stop();

    // Clean up session timer (standard mode only)
    if (sessionTimer) {
      window.clearInterval(sessionTimer);
      sessionTimer = null;
    }

    // End review/browse session
    if (browseMode) {
      await endBrowse();
    } else {
      await endReview();
    }
  });

  const endBrowse = async () => {
    if (reviewFinished) return;

    handleComplete({
      reason: "browse-complete",
      reviewed: browseCardIndex + 1,
    });
    reviewFinished = true;
  };

  const endReview = async () => {
    if (reviewFinished) return;

    // Clean up session timer
    if (sessionTimer) {
      window.clearInterval(sessionTimer);
      sessionTimer = null;
    }

    // Cram: do NOT end the session on close — leave it open so it can be resumed
    // later the same study day. startCramSession retires stale/completed sessions
    // lazily on the next start.
    if (cramMode) {
      handleComplete({
        reason: "cram-complete",
        reviewed: sessionProgress ? sessionProgress.doneUnique : reviewedCount,
      });
      reviewFinished = true;
      return;
    }

    // End the review session
    if (sessionId) {
      await scheduler.endReviewSession(sessionId);
      // Only clear current session if it's still ours (avoids race with new component's onMount)
      if (scheduler.getCurrentSession() === sessionId) {
        scheduler.setCurrentSession(null);
      }
    }

    handleComplete({
      reason: "end-review",
      reviewed: sessionProgress ? sessionProgress.doneUnique : reviewedCount,
    });
    reviewFinished = true;
  };

  function startSessionTimer() {
    const sessionDurationMs = settings.review.sessionDuration * 60 * 1000; // Convert minutes to milliseconds
    sessionStartTime = Date.now();
    sessionTimeRemaining = sessionDurationMs;

    // Update timer every second
    sessionTimer = window.setInterval(() => {
      const elapsed = Date.now() - sessionStartTime;
      sessionTimeRemaining = Math.max(0, sessionDurationMs - elapsed);

      // Auto-close when time is up
      if (sessionTimeRemaining <= 0) {
        endReview();
      }
    }, 1000);
  }

  function formatTimeRemaining(ms: number): string {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
</script>

<div class="decks-review-modal">
  <div class="decks-modal-header">
    <div class="decks-modal-title-row">
      <h3>
        <span class="decks-review-title-text">{deckOrGroup.name}</span>
        {#if browseMode}
          <span class="decks-review-mode">{t.views.browse}</span>
        {:else if cramMode}
          <span class="decks-review-mode">{t.deckList.cram}</span>
        {/if}
      </h3>
      <DocInfoButton path="reviewing/sessions" />
    </div>
    <div class="decks-header-stats">
      {#if browseMode}
        {#if searchMode && browseCards.length > 1}
          <div class="decks-qs-wrapper">
            <input
              type="text"
              class="decks-qs-input"
              placeholder={r.searchCardsPlaceholder}
              bind:value={searchQuery}
              bind:this={searchInputEl}
              on:keydown={handleSearchKeydown}
            />
            {#if searchResults.length > 0}
              <div class="decks-qs-dropdown">
                {#each searchResults as result (result.card.id)}
                  <button
                    type="button"
                    class="decks-qs-result"
                    on:pointerup={() => selectSearchResult(result.index)}
                  >
                    <span class="decks-qs-result-front"
                      >{result.card.front}</span
                    >
                    <span class="decks-qs-result-index"
                      >#{result.index + 1}</span
                    >
                  </button>
                {/each}
              </div>
            {:else if searchQuery.trim()}
              <div class="decks-qs-dropdown decks-qs-empty">
                {r.noCardsMatch}
              </div>
            {/if}
          </div>
        {:else}
          <div class="decks-progress-info">
            <span>{I18n.format(r.cardOfCountAlt, { current: browseCardIndex + 1, total: browseCards.length })}</span>
          </div>
        {/if}
        {#if browseCards.length > 1}
          <button
            type="button"
            class="clickable-icon decks-qs-toggle"
            aria-label={searchMode ? r.closeSearch : r.searchCards}
            on:pointerup={() => (searchMode ? closeSearch() : openSearch())}
          >
            {#if searchMode}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            {/if}
          </button>
        {/if}
      {:else}
        <div class="decks-progress-info">
          {#if sessionProgress}
            <span>{I18n.format(r.sessionCount, { done: reviewedCountDisplay, total: Math.max(sessionProgress.goalTotal, reviewedCountDisplay) })}</span>
          {:else}
            <span>{I18n.format(r.reviewedLabel, { count: reviewedCountDisplay })}</span>
            <span class="decks-session-sep" aria-hidden="true">·</span>
            <span>{currentCard ? r.moreCardsAvailable : r.sessionComplete}</span>
          {/if}
          {#if !cramMode}
            <span class="decks-session-sep" aria-hidden="true">·</span>
            <span class="decks-timer-value" class:decks-timer-warning={sessionTimeRemaining < 60000}
              >{I18n.format(r.timeLeft, { time: timeRemainingDisplay })}</span
            >
          {/if}
        </div>
        {#if canUndo}
          <button
            class="decks-undo-button decks-icon-btn clickable-icon"
            on:click={handleUndo}
            disabled={isLoading}
            title={r.undoTooltip}
            type="button"
            tabindex="-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 7v6h6"></path>
              <path d="M21 17a9 9 0 0 0-15-6.7L3 13"></path>
            </svg>
          </button>
        {/if}
      {/if}
    </div>
  </div>

  {#if !browseMode && settings?.review?.showProgress !== false}
    <div class="decks-review-progress-bar">
      <div class="decks-progress-fill" style="width: {progress}%"></div>
    </div>
  {/if}

  {#if browseMode && browseCards.length > 1}
    <div class="decks-browse-scrubber">
      <div class="decks-browse-track">
        <div class="decks-browse-fill" style="width: {(browseCardIndex / (browseCards.length - 1)) * 100}%"></div>
      </div>
      <input
        type="range"
        class="decks-browse-range"
        min="0"
        max={browseCards.length - 1}
        step="1"
        aria-label={I18n.format(r.cardOfCountAlt, { current: browseCardIndex + 1, total: browseCards.length })}
        bind:value={browseCardIndex}
        on:input={handleSliderNavigation}
      />
    </div>
  {/if}

  {#if currentCard}
    <div
      class="decks-card-content"
      class:decks-scratchpad-covered={showScratchpad}
      use:observePendingAnswer
      on:touchstart|passive={handleTouchStart}
      on:touchend|passive={handleTouchEnd}
    >
      {#snippet cardTools()}
          <div class="decks-card-utilities">
            <div class="decks-card-actions-menu" bind:this={actionsMenuEl}>
              <button
                class="decks-card-actions-trigger decks-icon-btn clickable-icon"
                class:decks-card-actions-live={isSpeaking}
                on:click|stopPropagation={toggleActionsMenu}
                aria-label={r.cardActions}
                aria-haspopup="menu"
                aria-expanded={actionsMenuOpen}
                type="button"
                tabindex="-1"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                  ></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
              {#if actionsMenuOpen}
                <div class="decks-card-actions-dropdown" role="menu" tabindex="-1">
                  {#if onNavigateToSource && currentCard && !isDirectoryDeckPath(currentCard.sourceFile)}
                    <button
                      class="decks-card-actions-item"
                      on:click={() => runCardTool(handleNavigateToSource)}
                      role="menuitem"
                      type="button"
                    >
                      <span>{r.openSourceFile}</span>
                    </button>
                  {/if}
                  {#if ttsAvailable}
                    <button
                      class="decks-card-actions-item"
                      on:click={() => runCardTool(handleToggleSpeak)}
                      role="menuitem"
                      type="button"
                    >
                      <span>{isSpeaking ? r.stopAudio : r.playAudio}</span>
                    </button>
                  {/if}
                  <button
                    class="decks-card-actions-item"
                    on:click={() => runCardTool(toggleScratchpad)}
                    role="menuitem"
                    type="button"
                  >
                    <span>{r.scratchpad}</span>
                  </button>
                  {#if copyVisible}
                    <button
                      class="decks-card-actions-item"
                      on:click={() => runCardTool(handleCopyBack)}
                      role="menuitem"
                      type="button"
                    >
                      <span>{r.copyContent}</span>
                    </button>
                  {/if}
                  {#if onCardStateAction}
                    <div class="decks-card-actions-divider" role="separator"></div>
                  <button
                    class="decks-card-actions-item"
                    on:click={() => handleCardAction("bury")}
                    role="menuitem"
                    type="button"
                  >
                    <span>{r.bury}</span>
                    <kbd>B</kbd>
                  </button>
                  <button
                    class="decks-card-actions-item"
                    on:click={() => handleCardAction("suspend")}
                    role="menuitem"
                    type="button"
                  >
                    <span>{r.suspend}</span>
                    <kbd>S</kbd>
                  </button>
                  <button
                    class="decks-card-actions-item decks-card-actions-danger"
                    on:click={() => handleCardAction("reset")}
                    role="menuitem"
                    type="button"
                  >
                    <span>{r.reset}</span>
                    <kbd>R</kbd>
                  </button>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
      {/snippet}
      {#snippet notesButton()}
        {#if hasNotes}
          <button
            class="decks-notes-button decks-icon-btn clickable-icon"
            class:decks-notes-active={showNotes}
            on:click={toggleNotes}
            title={r.toggleNotes}
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </button>
        {/if}
      {/snippet}
      {#snippet cardMeta()}
        {#if currentCard}
          {@const breadcrumbParts = getBreadcrumbParts(currentCard)}
          {#if breadcrumbParts.length > 0}
            <div class="decks-breadcrumb">
              {#each breadcrumbParts as part, i}
                {#if i > 0}<span class="decks-breadcrumb-sep">&nbsp;›&nbsp;</span
                  >{/if}
                {#if collapsedBreadcrumbIndices.has(i)}
                  <span
                    class="decks-breadcrumb-collapsed"
                    role="button"
                    tabindex="-1"
                    on:click={() => toggleBreadcrumbIndex(i)}
                    on:keydown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        toggleBreadcrumbIndex(i);
                    }}>...</span
                  >
                {:else}
                  <span
                    class="decks-breadcrumb-expanded"
                    role="button"
                    tabindex="-1"
                    on:click={() => toggleBreadcrumbIndex(i)}
                    on:keydown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        toggleBreadcrumbIndex(i);
                    }}>{part}</span
                  >
                {/if}
              {/each}
            </div>
          {/if}
        {/if}
      {/snippet}
      {#snippet footMeta()}
        {#if currentCard}
          {@const clozeLabel = isClozeType(currentCard.type) && clozeGroupTotal > 0}
          {@const healthLabel = cardHealth?.isLeech && cardHealth.isDense
            ? r.cardLeechAndDense
            : cardHealth?.isLeech
              ? r.cardLeech
              : cardHealth?.isDense
                ? r.cardDense
                : ""}
          {#if healthLabel}
            <button
              class="clickable-icon decks-warning-icon decks-icon-btn"
              type="button"
              tabindex="-1"
              aria-label={healthLabel}
              title={healthLabel}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
                ></path>
                <path d="M12 9v4"></path>
                <path d="M12 17h.01"></path>
              </svg>
            </button>
          {/if}
          {#if clozeLabel}
            <span class="decks-cloze-indicator"
              >Cloze {clozeOrderRange(activeOrders.length > 0 ? activeOrders : [currentCard.clozeOrder ?? clozeGroupIndex])}/{clozeGroupTotal}</span
            >
          {/if}
          {#each currentCard.tags ?? [] as t}
            <span class="decks-card-tag-chip">#{t}</span>
          {/each}
        {/if}
      {/snippet}
      <div class="decks-review-card">
        <div class="decks-review-card-bar">
          <div class="decks-review-card-meta">{@render cardMeta()}</div>
          {@render cardTools()}
        </div>
        <div
          class="decks-review-card-stack"
          class:decks-answer-left-out={answerPending && pendingOut}
        >
          <div class="decks-question-section">
            {#if frontIsHtml}
              <div class="decks-card-shell">
                <div class="decks-template-layer decks-front" bind:this={frontEl}></div>
              </div>
            {:else}
              <div class="decks-card-side decks-front">
                <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                <div
                  class="decks-card-text markdown-rendered"
                  bind:this={frontEl}
                  on:click={handleClozeBlankClick}
                ></div>
              </div>
            {/if}
            {#if isMultipleChoice && mcqItems.length > 0}
              <div class="decks-review-mcq">
                {#key mcqCardId}
                  {#if mcqShared}
                    <div class="decks-review-shared-text decks-card-text markdown-rendered" use:mcqRenderInto={mcqShared}></div>
                  {/if}
                  {#each mcqItems as item, itemIndex}
                    {#if item.stem}
                      <div class="decks-card-text markdown-rendered" class:decks-review-mcq-stem={mcqItems.length > 1} use:mcqRenderInto={item.stem}></div>
                    {/if}
                    {#if item.kind === "choice"}
                      {#each item.order as fileIndex, displayPosition (`${mcqCardId}:${itemIndex}:${fileIndex}`)}
                        <button
                          class="decks-exam-option {mcqOptionState(itemIndex, fileIndex, mcqSelected, showAnswer)}"
                          type="button"
                          on:click={() => toggleMcqOption(itemIndex, fileIndex)}
                        >
                          <span class="decks-exam-option-prefix">{displayPosition + 1})</span>
                          <span
                            class="decks-exam-option-text markdown-rendered"
                            use:mcqRenderInto={item.options[fileIndex].text}
                          ></span>
                        </button>
                      {/each}
                    {:else if item.kind === "cloze"}
                      {#key showAnswer}
                        <div class="decks-review-exercise-answer decks-card-text markdown-rendered" use:mcqRenderInto={clozeShown(item.text, showAnswer)}></div>
                      {/key}
                    {:else if showAnswer}
                      <div class="decks-review-exercise-answer decks-card-text markdown-rendered" use:mcqRenderInto={item.text}></div>
                    {/if}
                    {#if showAnswer && item.notes}
                      <div class="decks-review-mcq-note decks-card-text markdown-rendered" use:mcqRenderInto={item.notes}></div>
                    {/if}
                  {/each}
                {/key}
              </div>
            {/if}
          </div>

          {#if currentCard?.hint && currentCard.hint.length > 0}
            <div class="decks-card-edge">
              <span class="decks-card-edge-line"></span>
              <span class="decks-card-edge-chip" aria-label={currentCard.hint}>{currentCard.hint}</span>
              <span class="decks-card-edge-line"></span>
            </div>
          {:else if !answerAbsent}
            <div
              class="decks-separator"
              class:decks-separator-pending={answerPending}
              class:decks-separator-rule={showAnswer}
            ></div>
          {/if}
          <div
            class="decks-answer-section"
            class:hidden={answerAbsent}
            class:decks-answer-pending={answerPending}
          >
            {#if !frontOnlyClozeCard && !isMultipleChoice}
              {#if backIsHtml}
                <div class="decks-card-shell">
                  <div class="decks-template-layer decks-back" bind:this={backEl}></div>
                </div>
              {:else}
                <div class="decks-card-side decks-back">
                  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                  <div
                    class="decks-card-text markdown-rendered"
                    bind:this={backEl}
                    on:click={handleClozeBlankClick}
                  ></div>
                </div>
              {/if}
            {/if}
          </div>
        </div>
        <div class="decks-review-card-foot">
          <div class="decks-review-card-details">{@render footMeta()}</div>
          {#if notesToggleVisible}
            {@render notesButton()}
          {/if}
        </div>
        {#if showNotes && hasNotes}
          <div class="decks-notes-panel" role="dialog" aria-label={t.exam.notes}>
            <div class="decks-notes-panel-head">
              <span class="decks-notes-panel-label">{t.exam.notes}</span>
              <button
                class="decks-notes-panel-close decks-icon-btn clickable-icon"
                type="button"
                aria-label={r.close}
                on:click={toggleNotes}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            {#if notesIsHtml}
              <div class="decks-template-layer decks-notes" bind:this={notesEl}></div>
            {:else}
              <div class="decks-card-text decks-notes markdown-rendered" bind:this={notesEl}></div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#key currentCard?.id}
      <ReviewScratchpad
        open={showScratchpad}
        on:close={() => (showScratchpad = false)}
      />
    {/key}

    <div class="decks-action-buttons">
      {#if showAnswer && repairOffered && repairSource && currentCard}
        <div class="decks-repair-offer">
          <span class="decks-repair-count">
            {I18n.format(r.repair.missed, { count: currentCard.lapses })}
          </span>
          <span class="decks-repair-hint">{r.repair.hint}</span>
          <button
            type="button"
            class="decks-repair-action"
            on:click={() => repairSource && repair?.read(repairSource)}
          >
            {I18n.format(r.repair.reread, { page: repairSource.page })}
          </button>
          <button
            type="button"
            class="decks-repair-action"
            on:click={() =>
              currentCard && repairSource && repair?.fix(currentCard, repairSource)}
          >
            {r.repair.repair}
          </button>
        </div>
      {/if}
      {#if !showAnswer}
        <button
          class="decks-show-answer-button"
          disabled={isLoading}
          on:pointerup={async (e) => await onShowAnswer(e)}
          style="touch-action: manipulation;"
          type="button"
        >
          <span>{r.showAnswerButton}</span>
          <kbd class="decks-shortcut">{displayShortcutKey(shortcuts.reveal)}</kbd>
        </button>
      {/if}

      {#if showAnswer && browseMode}
        <div class="decks-browse-buttons">
          <button
            class="decks-browse-button decks-prev"
            disabled={browseCardIndex <= 0 || isLoading}
            on:pointerup={handleBrowsePrevious}
            style="touch-action: manipulation;"
            type="button"
          >
            <kbd class="decks-shortcut">&larr;</kbd>
            <span>{r.previous}</span>
          </button>
          <button
            class="decks-browse-button decks-next"
            disabled={isLoading}
            on:pointerup={handleBrowseNext}
            style="touch-action: manipulation;"
            type="button"
          >
            <span
              >{browseCardIndex >= browseCards.length - 1
                ? r.finish
                : r.next}</span
            >
            <kbd class="decks-shortcut">{displayShortcutKey(shortcuts.reveal)}</kbd>
          </button>
        </div>
      {:else if showAnswer && cramMode}
        <div class="decks-difficulty-buttons decks-cram-buttons">
          <button
            class="decks-difficulty-button decks-again decks-rate-btn"
            disabled={isLoading}
            on:pointerup={async (e) => await onRating(e, 1)}
            style="touch-action: manipulation;"
            type="button"
          >
            <div class="decks-button-label">{r.again}</div>
            <kbd class="decks-shortcut">{displayShortcutKey(shortcuts.again)}</kbd>
          </button>

          <button
            class="decks-difficulty-button decks-good decks-rate-btn"
            disabled={isLoading}
            on:pointerup={async (e) => await onRating(e, 3)}
            style="touch-action: manipulation;"
            type="button"
          >
            <div class="decks-button-label">{r.good}</div>
            <kbd class="decks-shortcut">{displayShortcutKey(shortcuts.reveal)}</kbd>
          </button>
        </div>
      {:else if showAnswer && schedulingInfo}
        <div class="decks-difficulty-buttons">
          <button
            class="decks-difficulty-button decks-again decks-rate-btn"
            disabled={isLoading}
            on:pointerup={async (e) => await onRating(e, 1)}
            style="touch-action: manipulation;"
            type="button"
          >
            <div class="decks-button-label">{r.again}</div>
            <div class="decks-interval">
              {getIntervalDisplay(schedulingInfo.again.interval)}
            </div>
            <kbd class="decks-shortcut">{displayShortcutKey(shortcuts.again)}</kbd>
          </button>

          <button
            class="decks-difficulty-button decks-hard decks-rate-btn"
            on:pointerup={async (e) => await onRating(e, 2)}
            style="touch-action: manipulation;"
            disabled={isLoading}
            type="button"
          >
            <div class="decks-button-label">{r.hard}</div>
            <div class="decks-interval">
              {getIntervalDisplay(schedulingInfo.hard.interval)}
            </div>
            <kbd class="decks-shortcut">{displayShortcutKey(shortcuts.hard)}</kbd>
          </button>

          <button
            class="decks-difficulty-button decks-good decks-rate-btn"
            on:pointerup={async (e) => await onRating(e, 3)}
            disabled={isLoading}
            type="button"
          >
            <div class="decks-button-label">{r.good}</div>
            <div class="decks-interval">
              {getIntervalDisplay(schedulingInfo.good.interval)}
            </div>
            <kbd class="decks-shortcut">{displayShortcutKey(shortcuts.good)}</kbd>
          </button>

          <button
            class="decks-difficulty-button decks-easy decks-rate-btn"
            on:pointerup={async (e) => await onRating(e, 4)}
            disabled={isLoading}
            type="button"
          >
            <div class="decks-button-label">{r.easy}</div>
            <div class="decks-interval">
              {getIntervalDisplay(schedulingInfo.easy.interval)}
            </div>
            <kbd class="decks-shortcut">{displayShortcutKey(shortcuts.easy)}</kbd>
          </button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="decks-empty-state">
      <p>{r.noMoreCards}</p>
    </div>
  {/if}
</div>

<style>
  .decks-review-modal {
    container: decks-review / inline-size;
    --decks-review-gutter: 20px;
    --decks-review-column: 720px;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background-primary);
    color: var(--text-normal);
    overflow: hidden;
    width: 100%;
    justify-content: space-between;
  }

  /* A modal keeps itself inside the safe area, so the review adds no inset of its own there. */
  :global(.modal) .decks-review-modal {
    padding: 16px 0 0;
  }

  :global(.modal) .decks-action-buttons {
    padding-bottom: 20px;
  }

  .decks-breadcrumb {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-decoration: none;
  }

  .decks-card-tag-chip {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 10px;
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }

  .decks-card-edge {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 auto;
    width: 100%;
    max-width: 600px;
  }

  .decks-card-edge-line {
    flex: 1 1 0;
    min-width: 24px;
    height: 1px;
    background: var(--background-modifier-border-hover);
  }

  .decks-card-edge-chip {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 75%;
    padding: 2px 10px;
    border-radius: 10px;
    background: var(--background-modifier-border);
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    font-style: italic;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .decks-card-utilities {
    grid-column: 3;
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .decks-review-card-details .decks-warning-icon {
    color: var(--text-warning);
  }

  .decks-warning-icon {
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    color: var(--text-muted);
  }

  .decks-warning-icon:hover {
    color: var(--text-warning);
  }

  .decks-breadcrumb-sep {
    display: inline;
    white-space: "pre";
  }

  .decks-breadcrumb-collapsed,
  .decks-breadcrumb-expanded {
    display: inline;
    outline: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  .decks-breadcrumb-collapsed:focus,
  .decks-breadcrumb-collapsed:focus-visible,
  .decks-breadcrumb-expanded:focus,
  .decks-breadcrumb-expanded:focus-visible {
    outline: none;
  }

  .decks-breadcrumb-collapsed {
    cursor: pointer;
    color: var(--text-muted);
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .decks-breadcrumb-collapsed:hover {
    color: var(--text-normal);
  }

  .decks-breadcrumb-expanded {
    cursor: pointer;
    color: var(--text-muted);
    text-decoration: none;
  }

  .decks-breadcrumb-expanded:hover {
    color: var(--text-normal);
  }

  /* Header, progress line, card and buttons share one column, so their edges line up at any width. */
  .decks-modal-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: calc(var(--decks-review-column) + 2 * var(--decks-review-gutter));
    margin-inline: auto;
    box-sizing: border-box;
    padding: 16px var(--decks-review-gutter) 12px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-modal-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .decks-modal-header h3 {
    margin: 0;
    min-width: 0;
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-normal);
    overflow-wrap: anywhere;
  }

  .decks-review-mode {
    padding: 0 6px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-weight: 500;
  }

  /* The progress track is the header's edge, so the border would draw it twice. */
  .decks-modal-header:has(+ :is(.decks-review-progress-bar, .decks-browse-scrubber)) {
    border-bottom: none;
  }

  .decks-header-stats {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    min-height: 24px;
  }

  .decks-progress-info {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px;
    font-size: var(--font-ui-small);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .decks-session-sep {
    color: var(--text-faint);
  }

  .decks-timer-value {
    white-space: nowrap;
  }

  .decks-timer-value.decks-timer-warning {
    color: var(--text-error);
  }

  .decks-review-progress-bar {
    flex: none;
    width: calc(100% - 2 * var(--decks-review-gutter));
    max-width: var(--decks-review-column);
    height: 3px;
    margin: 0 auto;
    border-radius: 2px;
    overflow: hidden;
    background: var(--background-modifier-border);
    position: relative;
  }

  .decks-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .decks-card-content {
    container: decks-card-area / size;
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px var(--decks-review-gutter) 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    min-height: 0;
  }

  .decks-review-card {
    position: relative;
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--decks-review-column);
    box-sizing: border-box;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
  }

  /* Equal side columns keep the breadcrumb centred whatever sits beside it. */
  .decks-review-card-bar {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) 56px;
    align-items: start;
    gap: 8px;
    min-height: 32px;
    padding: 8px 8px 0;
  }

  .decks-review-card-meta {
    grid-column: 2;
    min-width: 0;
    padding-top: 4px;
    text-align: center;
  }

  /* The foot mirrors the top row, so short cards sit in the true middle. */
  .decks-review-card-foot {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 8px;
    min-height: 32px;
    padding: 0 8px 8px 16px;
  }

  .decks-review-card-details {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-width: 0;
    min-height: 24px;
  }

  /* Notes float over the card's lower corner, so the card keeps its size whether they show or not. */
  .decks-notes-panel {
    position: absolute;
    right: 8px;
    bottom: 40px;
    z-index: 20;
    width: min(360px, calc(100% - 16px));
    max-height: calc(100% - 96px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 10px 14px 14px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    box-shadow: var(--shadow-l, 0 8px 24px rgba(0, 0, 0, 0.12));
    font-size: var(--font-ui-small);
    line-height: 1.5;
  }

  .decks-notes-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .decks-notes-panel-label {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-weight: 600;
  }

  .decks-notes-panel-close {
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    color: var(--text-muted);
  }

  .decks-notes-panel .decks-card-text {
    width: auto;
    -webkit-user-select: text;
    user-select: text;
  }

  .decks-notes-panel .decks-card-text :global(:is(pre, table, .MathJax, mjx-container)) {
    max-width: 100%;
    overflow-x: auto;
  }

  .decks-notes-panel .decks-card-text :global(img) {
    max-width: 100%;
  }

  .decks-notes-panel .decks-card-text > :global(:first-child) {
    margin-top: 0;
  }

  .decks-notes-panel .decks-card-text > :global(:last-child) {
    margin-bottom: 0;
  }

  /* Auto margins centre short content in the card; long content starts at the top and scrolls. */
  .decks-review-card-stack {
    flex: none;
    margin-block: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    width: 100%;
    box-sizing: border-box;
    padding: 12px 32px;
  }

  /* A large review shows a centred 4:3 index card; text too long for it scrolls inside the card. */
  @container decks-card-area (min-width: 480px) and (min-height: 420px) {
    .decks-review-card {
      flex: none;
      width: min(var(--decks-review-column), 100cqw, 133.33cqh);
      height: calc(min(var(--decks-review-column), 100cqw, 133.33cqh) * 0.75);
      margin-block: auto;
    }

    .decks-review-card-stack {
      flex: 1 1 auto;
      min-height: 0;
      margin-block: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }

    /* Equal spacers centre short text and give way when it scrolls. */
    .decks-review-card-stack::before,
    .decks-review-card-stack::after {
      content: "";
      flex: 1 0 0;
    }
  }

  .decks-card-side.decks-front .decks-card-text {
    max-width: min(100%, 46ch);
  }

  .decks-card-side.decks-back .decks-card-text {
    max-width: min(100%, 66ch);
    text-wrap: pretty;
  }

  .decks-card-side .decks-card-text:has(:global(:is(img, table, pre, canvas, video, iframe))) {
    max-width: 100%;
  }

  .decks-answer-section {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  /* Column so a multiple-choice card's options stack under the front card
     rather than beside it; single-front cards stay centered. */
  .decks-question-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  /* A face is a region of the card, so it draws no frame of its own. */
  .decks-card-side {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    overflow-x: auto;
  }

  /* Shrink-wrap centering: the inner box hugs short content (so the card
     centers it) but grows to full width for long content (so text-align:left
     reads naturally). text-align is inherited from the per-face rule. */
  .decks-card-text {
    width: fit-content;
    max-width: 100%;
  }

  /* Holds an HTML-template face inside the card; the template draws what it needs. */
  .decks-card-shell {
    position: relative;
    display: flex;
    width: 100%;
    overflow: hidden;
  }

  /* In-flow layer: fills the shell and holds the Shadow DOM host. */
  .decks-template-layer {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
  }

  .decks-card-side.decks-front {
    text-align: center;
    text-wrap: balance;
    font-size: var(--decks-fit-front);
    line-height: 1.35;
    font-weight: 500;
  }

  .decks-card-side.decks-back {
    font-size: var(--decks-fit-back);
    line-height: 1.6;
  }

  /* Steps 1 to 3 enlarge text that has room; step 4 is the base size. */
  .decks-review-card {
    --decks-fit-front: 20px;
    --decks-fit-back: 16px;
  }
  .decks-review-card:global([data-fit="1"]) {
    --decks-fit-front: 32px;
    --decks-fit-back: 22px;
  }
  .decks-review-card:global([data-fit="2"]) {
    --decks-fit-front: 27px;
    --decks-fit-back: 19px;
  }
  .decks-review-card:global([data-fit="3"]) {
    --decks-fit-front: 23px;
    --decks-fit-back: 17px;
  }

  .decks-notes-button {
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
  }

  .decks-notes-button.decks-notes-active {
    color: var(--interactive-accent);
  }

  /* The scratchpad takes the card's flex slot; hide the card underneath it. */
  .decks-card-content.decks-scratchpad-covered {
    display: none;
  }

  .decks-card-actions-menu {
    position: relative;
    display: inline-flex;
  }

  .decks-card-actions-trigger {
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    color: var(--text-muted);
  }
  .decks-card-actions-trigger:hover {
    color: var(--text-normal);
  }

  .decks-card-actions-trigger.decks-card-actions-live {
    color: var(--interactive-accent);
  }

  .decks-card-actions-divider {
    height: 1px;
    margin: 4px 0;
    background: var(--background-modifier-border);
  }

  .decks-card-actions-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: var(--layer-popover, 30);
    min-width: 180px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m, 6px);
    box-shadow: var(--shadow-l, 0 4px 12px rgba(0, 0, 0, 0.18));
    padding: 4px 0;
    display: flex;
    flex-direction: column;
  }

  .decks-card-actions-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-normal);
    text-align: left;
    box-shadow: none;
  }
  .decks-card-actions-item:hover {
    background: var(--background-modifier-hover);
  }
  .decks-card-actions-item.decks-card-actions-danger:hover {
    color: var(--text-error);
  }
  .decks-card-actions-item kbd {
    font-size: 11px;
    opacity: 0.7;
    padding: 1px 6px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
  }

  .decks-undo-button {
    color: var(--text-muted);
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
  }

  .decks-answer-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }

  .decks-answer-section.hidden {
    display: none;
  }

  .decks-separator {
    flex: none;
    height: 1px;
    width: 100%;
    background: var(--background-modifier-border-hover);
  }

  /* Once the answer shows, the line is the card's rule; the margin gives back its second pixel. */
  .decks-separator.decks-separator-rule {
    height: 2px;
    margin-bottom: -1px;
    border-radius: 1px;
    background: var(--interactive-accent);
  }

  .decks-separator-pending,
  .decks-answer-pending {
    visibility: hidden;
  }

  .decks-answer-left-out > .decks-separator,
  .decks-answer-left-out > .decks-answer-section {
    display: none;
  }

  /* A card that keeps being missed, offering the two things that help: the
     page it came from, and a fix. Sits above the ratings, never in their way. */
  .decks-repair-offer {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    width: 100%;
    max-width: var(--decks-review-column);
    margin: 0 auto 8px;
    padding: 4px 8px;
    box-sizing: border-box;
    border-radius: var(--radius-s);
    background: rgba(var(--color-yellow-rgb), 0.1);
    font-size: 11px;
  }
  .decks-repair-count {
    color: var(--text-warning);
    font-weight: 500;
  }
  .decks-repair-hint {
    flex: 1 1 auto;
    color: var(--text-muted);
  }
  .decks-repair-action {
    font-size: 11px;
    padding: 2px 8px;
    height: auto;
  }

  /* Show answer and the rating row share one height, so the card above keeps its size on reveal. */
  .decks-action-buttons {
    --decks-action-row: 48px;
    padding: 16px var(--decks-review-gutter) 20px;
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .decks-show-answer-button {
    width: 100%;
    max-width: var(--decks-review-column);
    margin: 0 auto;
    padding: 12px 24px;
    min-height: var(--decks-action-row);
    min-width: 44px;
    font-size: 16px;
    font-weight: 500;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    pointer-events: auto !important;
    touch-action: manipulation;
    border-radius: var(--radius-m);
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    position: relative;
    box-sizing: border-box;
    min-height: 48px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .decks-show-answer-button:hover,
  .decks-show-answer-button:active {
    background: var(--interactive-accent-hover);
  }

  .decks-shortcut {
    font-family: var(--font-monospace);
    font-size: var(--font-ui-smaller);
    padding: 2px 6px;
    background-color: var(--background-modifier-form-field);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    color: var(--text-muted);
    display: inline-block;
    line-height: 1;
  }

  .decks-difficulty-buttons {
    display: flex;
    align-items: center;
    min-height: var(--decks-action-row);
    flex-wrap: nowrap;
    gap: 8px;
    box-sizing: border-box;
    width: 100%;
    max-width: var(--decks-review-column);
    margin: 0 auto;
  }

  .decks-difficulty-button,
  .decks-rate-btn {
    flex: 1 1 0;
    min-width: 0;
    min-height: 44px;
    padding: 12px 6px;
    pointer-events: auto !important;
    touch-action: manipulation !important;
    border: 1px solid var(--background-modifier-border);
    border-top: 3px solid var(--background-modifier-border);
    background-color: var(--background-secondary);
    background-image: none;
    color: var(--text-normal);
    border-radius: var(--radius-m);
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    text-align: center;
    overflow: hidden;
    opacity: 1 !important;
    -webkit-tap-highlight-color: transparent !important;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }

  .decks-difficulty-button:hover,
  .decks-difficulty-button:active {
    background: var(--background-modifier-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-s);
  }

  .decks-difficulty-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .decks-difficulty-button.decks-again {
    border-top-color: #e74c3c;
  }

  .decks-difficulty-button.decks-hard {
    border-top-color: #f39c12;
  }

  .decks-difficulty-button.decks-good {
    border-top-color: #27ae60;
  }

  .decks-difficulty-button.decks-easy {
    border-top-color: #3498db;
  }

  .decks-button-label {
    font-weight: 600;
    font-size: 13px;
  }

  .decks-interval {
    font-size: 11px;
    color: var(--text-muted);
  }

  .decks-difficulty-button:hover .decks-interval {
    color: inherit;
  }

  .decks-difficulty-button .decks-shortcut {
    position: absolute;
    top: 4px;
    right: 4px;
    font-size: 10px;
    padding: 1px 4px;
  }

  :global(body.is-mobile) .decks-rate-btn .decks-shortcut,
  :global(body.is-mobile) .decks-difficulty-button .decks-shortcut {
    display: none;
  }

  /* In browse the progress line is a scrubber: click or drag it to jump to a card. */
  .decks-browse-scrubber {
    position: relative;
    flex: none;
    width: calc(100% - 2 * var(--decks-review-gutter));
    max-width: var(--decks-review-column);
    height: 16px;
    margin: -6px auto -7px;
  }

  /* The track is inset by half a thumb, so the fill ends under the thumb's centre. */
  .decks-browse-track {
    position: absolute;
    left: 6px;
    right: 6px;
    top: 6px;
    height: 3px;
    border-radius: 2px;
    overflow: hidden;
    background: var(--background-modifier-border);
    pointer-events: none;
  }

  .decks-browse-fill {
    height: 100%;
    background: var(--interactive-accent);
  }

  .decks-browse-range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
  }

  .decks-browse-range:focus {
    outline: none;
  }

  .decks-browse-range::-webkit-slider-runnable-track {
    height: 100%;
    border: none;
    background: transparent;
  }

  /* Obsidian lifts and resizes slider thumbs; this one stays centred on the line, at one size. */
  .decks-browse-range::-webkit-slider-thumb,
  .decks-browse-range::-webkit-slider-thumb:active {
    -webkit-appearance: none;
    position: relative;
    top: 0;
    width: 12px;
    height: 12px;
    margin-top: 2px;
    cursor: pointer;
    border: 2px solid var(--background-primary);
    border-radius: 50%;
    background: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--interactive-accent);
    transition: transform 120ms ease;
  }

  .decks-browse-range:hover::-webkit-slider-thumb,
  .decks-browse-range:focus-visible::-webkit-slider-thumb {
    transform: scale(1.3);
  }

  .decks-review-modal .decks-browse-range:focus::-webkit-slider-thumb {
    box-shadow: 0 0 0 1px var(--interactive-accent);
  }

  .decks-browse-range::-moz-range-track {
    border: none;
    background: transparent;
  }

  .decks-browse-range::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 2px solid var(--background-primary);
    border-radius: 50%;
    background: var(--interactive-accent);
  }

  .decks-qs-toggle {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .decks-qs-toggle:hover {
    color: var(--text-normal);
  }

  .decks-qs-wrapper {
    flex: 1;
    position: relative;
  }

  .decks-qs-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    background: var(--background-modifier-form-field);
    color: var(--text-normal);
    font-size: 13px;
    box-sizing: border-box;
  }

  .decks-qs-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .decks-qs-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: var(--layer-popover);
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-l);
    max-height: 320px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .decks-qs-result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-normal);
    font-size: 13px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .decks-qs-result:hover {
    background: var(--background-modifier-hover);
  }

  .decks-qs-result-front {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .decks-qs-result-index {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .decks-qs-empty {
    padding: 10px 12px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .decks-browse-buttons {
    display: flex;
    gap: var(--size-4-2);
    width: 100%;
    max-width: var(--decks-review-column);
    margin: 0 auto;
  }

  .decks-browse-button {
    flex: 1;
    padding: 12px 24px;
    font-size: 16px;
    font-weight: 500;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-m);
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.2s ease;
  }

  .decks-browse-button.decks-prev {
    background: var(--background-secondary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
  }

  .decks-browse-button:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-s);
  }

  .decks-browse-button.decks-prev:hover {
    background: var(--background-modifier-hover);
  }

  .decks-browse-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .decks-empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: var(--text-muted);
  }

  /* Markdown content styling */
  :global(.decks-card-side h1),
  :global(.decks-card-side h2),
  :global(.decks-card-side h3),
  :global(.decks-card-side h4),
  :global(.decks-card-side h5),
  :global(.decks-card-side h6) {
    margin-top: 0;
    margin-bottom: 16px;
  }

  :global(.decks-card-side p) {
    margin-bottom: 16px;
  }

  :global(.decks-card-side p:last-child) {
    margin-bottom: 0;
  }

  :global(.decks-card-text > *:first-child) {
    margin-top: 0;
  }

  :global(.decks-card-side ul),
  :global(.decks-card-side ol) {
    margin-bottom: 16px;
    padding-left: 24px;
  }

  /* Inline code only — block code (pre > code) is styled by Obsidian's
     markdown-rendered theme styles. */
  :global(.decks-card-side code) {
    font-size: 0.9em;
  }
  :global(.decks-card-side :not(pre) > code) {
    background: var(--code-background);
    padding: 2px 4px;
    border-radius: 3px;
  }

  :global(.decks-card-side blockquote) {
    border-left: 3px solid var(--blockquote-border);
    padding-left: 16px;
    margin-left: 0;
    margin-right: 0;
    color: var(--text-muted);
  }

  /* Mobile responsive styles */
  /* Narrow layouts follow the review's own width: a phone, a split pane or a small tab. */
  @container decks-review (max-width: 560px) {
    .decks-modal-header,
    .decks-review-progress-bar,
    .decks-browse-scrubber,
    .decks-card-content,
    .decks-action-buttons {
      --decks-review-gutter: 12px;
    }

    .decks-modal-header {
      padding-block: 12px;
    }

    .decks-modal-header h3 {
      font-size: 16px;
    }

    .decks-card-content {
      padding-top: 12px;
      padding-bottom: 0;
    }

    .decks-review-card-bar {
      padding: 6px 6px 0;
    }

    .decks-review-card-foot {
      padding: 0 6px 6px 12px;
    }

    .decks-review-card-stack {
      gap: 20px;
      padding: 8px 16px;
    }

    .decks-review-card {
      --decks-fit-front: 18px;
      --decks-fit-back: 15px;
    }

    .decks-review-card:global([data-fit="1"]) {
      --decks-fit-front: 26px;
      --decks-fit-back: 19px;
    }

    .decks-review-card:global([data-fit="2"]) {
      --decks-fit-front: 22px;
      --decks-fit-back: 17px;
    }

    .decks-review-card:global([data-fit="3"]) {
      --decks-fit-front: 20px;
      --decks-fit-back: 16px;
    }

    .decks-action-buttons {
      padding-top: 8px;
    }

    .decks-show-answer-button {
      padding: 14px 24px;
      font-size: 16px;
    }

    .decks-difficulty-buttons {
      gap: 6px;
    }

    .decks-difficulty-button {
      padding: 10px 4px;
      min-height: 48px;
    }

    .decks-button-label {
      font-size: 13px;
    }

    .decks-interval {
      font-size: 11px;
    }
  }

  /* The phone layout's close button is placed for this header height at any width. */
  :global(.decks-modal-mobile) .decks-modal-header {
    padding-block: 12px;
  }

  :global(.decks-modal-mobile) .decks-modal-header h3 {
    font-size: 16px;
  }

  @container decks-review (max-width: 420px) {
    .decks-progress-info {
      font-size: 13px;
    }
  }

  /* In a very narrow pane the grade labels need the room the key badges take. */
  @container decks-review (max-width: 380px) {
    .decks-difficulty-button .decks-shortcut {
      display: none;
    }
  }

  /*@media (max-width: 500px) {
        .modal-header {
            padding: 10px 12px;
            flex-direction: column;
            gap: 8px;
            align-items: flex-start;
        }

        .modal-header h3 {
            font-size: 14px;
        }

        .decks-progress-info {
            align-self: flex-end;
        }

        .decks-card-content {
            padding: 16px 8px;
            gap: 16px;
        }

        .decks-card-side {
            padding: var(--decks-card-reserve) 12px;
        }

        .decks-card-side.decks-front {
            font-size: 16px;
        }

        .decks-card-side.decks-back {
            font-size: 14px;
        }

        .decks-action-buttons {
            padding: 12px;
        }

        .decks-show-answer-button {
            padding: 12px 20px;
            font-size: 15px;
            min-height: 52px;
        }

        .decks-difficulty-buttons {
            gap: 4px;
            padding: 0 5px;
        }

        .decks-difficulty-button {
            padding: 8px 4px;
            min-height: 40px;
        }

        .decks-button-label {
            font-size: 12px;
        }

        .decks-interval {
            font-size: 10px;
        }

        .decks-difficulty-button .decks-shortcut {
            font-size: 8px;
            padding: 1px 2px;
        }
    }*/

  /* Mobile modal overlay protection - Blocker #3 */
  .decks-review-modal {
    position: relative;
    pointer-events: auto;
  }

  /* Prevent form submission issues - Blocker #5 */
  /* No submit buttons present in this modal */

  /* Override Obsidian mobile CSS interference - Blocker #12 */
  .decks-rate-btn,
  .decks-difficulty-button,
  .decks-show-answer-button {
    pointer-events: auto !important;
    opacity: 1 !important;
    touch-action: manipulation !important;
    -webkit-tap-highlight-color: transparent !important;
    position: relative !important;
    z-index: 10 !important;
  }

  /* Disabled state override - Blocker #4 */
  .decks-rate-btn:disabled,
  .decks-difficulty-button:disabled,
  .decks-show-answer-button:disabled {
    opacity: 0.6 !important;
    pointer-events: none !important;
    cursor: not-allowed !important;
  }

  /* Focus trap compatibility - Blocker #8 */
  .decks-action-buttons {
    pointer-events: auto;
    position: relative;
    z-index: 5;
  }

  /* Prevent parent event blocking - Blocker #7 */
  .decks-difficulty-buttons {
    pointer-events: auto;
    position: relative;
    z-index: 5;
  }

  /* Mobile responsive styles */
  /*@media (max-width: 768px) {
        .decks-review-modal {
            padding: 16px 12px;
            font-size: 14px;
        }

        .modal-header h3 {
            font-size: 18px;
            margin-bottom: 8px;
        }

        .progress-info {
            font-size: 13px;
            margin-bottom: 12px;
        }

        .card-front,
        .card-back {
            font-size: 16px;
            padding: 16px 12px;
            margin: 12px 0;
        }

        .difficulty-buttons {
            gap: 6px;
            padding: 0 8px;
        }

        .difficulty-button,
        .rate-btn {
            padding: 10px 6px;
            font-size: 13px;
            min-height: 44px;
        }

        .shortcut {
            font-size: 11px;
            padding: 1px 4px;
        }
    }

    @media (max-width: 480px) {
        .review-modal {
            padding: 12px 8px;
            font-size: 13px;
        }

        .modal-header h3 {
            font-size: 16px;
            text-align: center;
        }

        .progress-info {
            font-size: 12px;
            text-align: center;
        }

        .card-front,
        .card-back {
            font-size: 15px;
            padding: 12px 8px;
            margin: 10px 0;
        }

        .difficulty-buttons {
            gap: 4px;
            padding: 0 4px;
            flex-wrap: wrap;
        }

        .difficulty-button,
        .rate-btn {
            flex: 1;
            min-width: calc(25% - 3px);
            padding: 8px 4px;
            font-size: 12px;
            min-height: 40px;
        }

        .shortcut {
            display: none; /* Hide shortcuts on small screens
        }
    }

    @media (max-width: 390px) {
        .review-modal {
            padding: 8px 4px;
            font-size: 12px;
        }

        .modal-header h3 {
            font-size: 14px;
        }

        .progress-info {
            font-size: 11px;
        }

        .card-front,
        .card-back {
            font-size: 14px;
            padding: 10px 6px;
            margin: 8px 0;
        }

        .difficulty-button,
        .rate-btn {
            padding: 6px 2px;
            font-size: 11px;
            min-height: 36px;
        }
    }

    /* Mobile safe area and viewport optimizations */
  /*@media screen and (max-height: 600px) {
        .review-modal {
            max-height: 90vh;
            overflow-y: auto;
        }

        .action-buttons {
            padding-bottom: calc(20px + env(safe-area-inset-bottom));
        }
    }*/

  /* In a tab the bar keeps its own inset, which also holds it clear of the app's floating bar. */
  .decks-action-buttons {
    padding-bottom: calc(20px + var(--safe-area-inset-bottom));
    position: relative;
    bottom: 0;
  }

  /*
    @media (orientation: landscape) and (max-height: 500px) {
        .action-buttons {
            padding: 8px 16px;
            padding-bottom: calc(8px + env(safe-area-inset-bottom));
        }

        .difficulty-button,
        .rate-btn {
            min-height: 40px;
            padding: 8px 4px;
        }
    }*/

  /* Insets for the review in a tab; the modal-scoped rule above clears them inside a modal. */
  .decks-review-modal {
    padding-bottom: var(--safe-area-inset-bottom);
    padding-left: var(--safe-area-inset-left);
    padding-right: var(--safe-area-inset-right);
    box-sizing: border-box;
    overflow-x: hidden;
  }

  /* Additional mobile optimizations */
  /*@media (hover: none) and (pointer: coarse) {
        .rate-btn,
        .difficulty-button,
        .show-answer-button {
            min-height: 48px !important;
            min-width: 48px !important;
            font-size: 16px !important;
            line-height: 1.2;
        }
    }*/

  /*@media (max-width: 390px) {
        .modal-header {
            padding: 12px 16px;
        }

        .modal-header h3 {
            font-size: 14px;
        }

        .progress-info {
            font-size: 11px;
        }

        .card-content {
            padding: 12px 16px;
            min-height: 150px;
        }

        .card-side {
            min-height: 120px;
        }

        .card-side.front {
            min-height: 120px;
        }

        .card-side.back {
            min-height: 120px;
        }

        .action-buttons {
            padding: 12px 16px;
            padding-bottom: calc(12px + env(safe-area-inset-bottom));
        }

        .show-answer-button {
            padding: 10px 16px;
            font-size: 14px;
        }

        .difficulty-buttons {
            gap: 4px;
            padding: 0 4px;
        }

        .difficulty-button {
            padding: 8px 4px;
            font-size: 11px;
        }

        .button-label {
            font-size: 11px;
        }

        .interval {
            font-size: 10px;
        }

        .difficulty-button .shortcut {
            display: none;
        }
    }*/

  /*@media (max-width: 380px) {
        .card-content {
            min-height: 120px;
        }

        .difficulty-buttons {
            gap: 2px;
            padding: 0 2px;
        }

        .difficulty-button {
            padding: 6px 2px;
            font-size: 10px;
        }

        .action-buttons {
            padding-bottom: calc(12px + env(safe-area-inset-bottom));
        }
    }*/

  /* A blank's padding sits outside the line, so revealing it leaves the line's height alone. */
  :global(.decks-cloze-blank) {
    background: var(--background-modifier-border);
    padding: 2px 12px;
    margin-block: -2px;
    border-radius: 4px;
    display: inline-block;
    min-width: 40px;
    text-align: center;
  }

  :global(.decks-cloze-active) {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    padding: 2px 12px;
    margin-block: -2px;
    border-radius: 4px;
    display: inline-block;
    min-width: 40px;
    text-align: center;
    cursor: pointer;
    font-weight: 600;
  }

  :global(.decks-cloze-revealed) {
    font-weight: 600;
    text-decoration: underline;
    text-decoration-color: var(--text-accent);
    text-underline-offset: 3px;
  }

  :global(.decks-cloze-context) {
    color: var(--text-muted);
    font-style: italic;
  }

  .decks-cloze-indicator {
    padding: 1px 0;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
</style>
