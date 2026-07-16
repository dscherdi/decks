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
  import { I18n, yieldToUI, type ResolvedRender } from "@decks/core";
  import { prepareFuzzySearch } from "obsidian";
  import { computeCardHealth } from "@decks/core";
  import {
    classifyExamBody,
    indexSetsEqual,
    shuffleInPlace,
    type ExamOption,
  } from "@decks/core";
  import { isOcclusionV2, parseOcclusionBack, activeMaskIdForCard, prepareClozeMath } from "@decks/core";
  import { renderCardSide } from "../../utils/html-template-render";
  import { renderOcclusion } from "../../utils/occlusion-render";
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
    card: Flashcard,
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
        card: Flashcard,
        action: "suspend" | "bury" | "reset"
      ) => Promise<boolean>)
    | undefined = undefined;
  export let browseMode = false;
  // Cram (drill) mode: two-button Again/Good drill over allCards. Isolated from
  // real scheduling — writes no review logs and does not mutate card state.
  export let cramMode = false;
  export let allCards: Flashcard[] = [];
  export let isActive: (() => boolean) | undefined = undefined;

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

  function getBreadcrumbParts(card: Flashcard): string[] {
    if (!card.breadcrumb) return [];
    return card.breadcrumb.split(" > ");
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

  // Cloze group review state
  let clozeGroup: Flashcard[] = [];
  let clozeGroupIndex = 0;
  let clozeGroupTotal = 0;
  let inClozeGroupReview = false;

  $: clozeShowContext =
    ("profile" in deckOrGroup ? deckOrGroup.profile : undefined)?.clozeShowContext ?? "open";

  // Multiple-choice inside an ordinary review: interactive select → reveal
  // (objective verdict styling) → the normal self-rating buttons. Nothing is
  // persisted beyond the rating; an empty selection is a plain reveal.
  $: isMultipleChoice = currentCard?.type === "multiple-choice";
  let mcqOptions: ExamOption[] = [];
  let mcqStem = "";
  let mcqDisplayOrder: number[] = [];
  let mcqSelected: number[] = [];
  let mcqCardId: string | null = null;
  $: if (currentCard && isMultipleChoice && currentCard.id !== mcqCardId) {
    mcqCardId = currentCard.id;
    const classified = classifyExamBody(currentCard.back);
    mcqOptions = classified.kind === "mcq" ? classified.options : [];
    mcqStem = classified.kind === "mcq" ? classified.stem : "";
    mcqSelected = [];
    const order = mcqOptions.map((_o, i) => i);
    const profile = "profile" in deckOrGroup ? deckOrGroup.profile : undefined;
    mcqDisplayOrder =
      (profile?.examSettings?.shuffleOptions ?? true)
        ? shuffleInPlace(order)
        : order;
  }
  $: mcqCorrectIndices = mcqOptions
    .map((option, index) => (option.correct ? index : -1))
    .filter((index) => index >= 0);
  $: mcqMulti = mcqCorrectIndices.length > 1;

  function toggleMcqOption(fileIndex: number): void {
    if (showAnswer) return;
    if (mcqMulti) {
      mcqSelected = mcqSelected.includes(fileIndex)
        ? mcqSelected.filter((v) => v !== fileIndex)
        : [...mcqSelected, fileIndex];
    } else {
      mcqSelected = [fileIndex];
    }
  }

  function mcqOptionState(fileIndex: number): string {
    const isSelected = mcqSelected.includes(fileIndex);
    if (!showAnswer) return isSelected ? "selected" : "";
    const correct = mcqOptions[fileIndex]?.correct === true;
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
  $: answerSectionHidden = isMultipleChoice
    ? !(showNotes && hasNotes)
    : frontOnlyClozeCard
      ? !(showNotes && hasNotes)
      : (!!currentCard && isOcclusionV2(currentCard) && !currentV2Answered) ||
        (!showAnswer && !(currentCard && isClozeType(currentCard.type) && !isOcclusionV2(currentCard)));

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

    if (currentCard.type === "image-occlusion") {
      const allActive = container.querySelectorAll(".decks-cloze-active");
      allActive.forEach((el) => {
        const span = activeDocument.createElement("span");
        span.className = "decks-cloze-revealed";
        span.textContent =
          el.getAttribute("data-decks-cloze-text") || el.textContent || "";
        el.replaceWith(span);
      });
    } else {
      const span = activeDocument.createElement("span");
      span.className = "decks-cloze-revealed";
      span.textContent =
        target.getAttribute("data-decks-cloze-text") || currentCard.clozeText;
      target.replaceWith(span);
    }

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
      const { markdown, markActiveIndex } = prepareClozeMath(
        clozeContent(card),
        card.clozeOrder ?? 0,
        clozeShowContext,
        revealed
      );
      setClozeAttributes(el, markActiveIndex, clozeShowContext, revealed);
      renderMarkdown(markdown, el, deckFilePath);
    }
  }

  async function loadCard() {
    if (!currentCard) return;

    const parts = getBreadcrumbParts(currentCard);
    const initialCollapsed = new Set<number>();
    for (let idx = 0; idx < parts.length - 2; idx++) {
      initialCollapsed.add(idx);
    }
    collapsedBreadcrumbIndices = initialCollapsed;
    showAnswer = false;
    showNotes = false;

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
      const siblings = await scheduler.getClozeSiblings(
        currentCard,
        new Date()
      );
      clozeGroup = [currentCard, ...siblings];
      clozeGroupIndex = 0;
      inClozeGroupReview = true;
    }

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
          // The image reveals in place on the front; keep the answer hidden
          // until the user reveals it.
          clearClozeAttributes(backEl);
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
      await scheduler.rateCram(cramSessionId, currentCard.id, rating, new Date());
      reviewedCount++;
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
      await onReview(currentCard, rating, timeElapsed, shownAt);
      reviewedCount++;

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
      if (inClozeGroupReview && clozeGroupIndex < clozeGroup.length - 1) {
        clozeGroupIndex++;
        currentCard = clozeGroup[clozeGroupIndex];
        await loadCard();
      } else {
        // Reset cloze group state
        if (inClozeGroupReview) {
          inClozeGroupReview = false;
          clozeGroup = [];
          clozeGroupIndex = 0;
          clozeGroupTotal = 0;
        }

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
    if (inClozeGroupReview && clozeGroupIndex < clozeGroup.length - 1) {
      clozeGroupIndex++;
      currentCard = clozeGroup[clozeGroupIndex];
      await loadCard();
      return;
    }
    if (inClozeGroupReview) {
      inClozeGroupReview = false;
      clozeGroup = [];
      clozeGroupIndex = 0;
      clozeGroupTotal = 0;
    }
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
      const applied = await onCardStateAction(targetCard, action);
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
      const restored = await scheduler.undoLastReview();
      if (!restored) {
        canUndo = await scheduler.hasUndoableReview();
        return;
      }

      inClozeGroupReview = false;
      clozeGroup = [];
      clozeGroupIndex = 0;
      clozeGroupTotal = 0;

      currentCard = restored;
      reviewedCount = Math.max(0, reviewedCount - 1);
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
      if (displayPosition < mcqDisplayOrder.length) {
        event.preventDefault();
        lastEventTime = now;
        lastEventType = eventType;
        toggleMcqOption(mcqDisplayOrder[displayPosition]);
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
    <h3>
      {browseMode ? "Browse" : "Review session"} - {deckOrGroup.name}
      {#if currentCard && isClozeType(currentCard.type) && clozeGroupTotal > 0}
        <span class="decks-cloze-indicator"
          >Cloze {(currentCard.clozeOrder ?? clozeGroupIndex) + 1}/{clozeGroupTotal}</span
        >
      {/if}
    </h3>
    {#if currentCard}
      {@const breadcrumbParts = getBreadcrumbParts(currentCard)}
      {#if breadcrumbParts.length > 0}
        <div class="decks-breadcrumb">
          {#each breadcrumbParts as part, i}
            {#if i > 0}<span class="decks-breadcrumb-sep">&nbsp;>&nbsp;</span
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
      {#if currentCard.tags && currentCard.tags.length > 0}
        <div class="decks-card-tags">
          {#each currentCard.tags as t}
            <span class="decks-card-tag-chip">#{t}</span>
          {/each}
        </div>
      {/if}
    {/if}
    <div class="decks-header-stats">
      {#if browseMode}
        {#if browseCards.length > 1}
          <div class="decks-browse-row">
            {#if searchMode}
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
              <div class="decks-browse-slider">
                <input
                  type="range"
                  class="decks-browse-range"
                  min="0"
                  max={browseCards.length - 1}
                  bind:value={browseCardIndex}
                  on:input={handleSliderNavigation}
                />
                <span class="decks-browse-slider-label">
                  {I18n.format(r.cardOfCount, { current: browseCardIndex + 1, total: browseCards.length })}
                </span>
              </div>
            {/if}
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
          </div>
        {:else}
          <div class="decks-progress-info">
            <span>{I18n.format(r.cardOfCountAlt, { current: browseCardIndex + 1, total: browseCards.length })}</span>
          </div>
        {/if}
      {:else}
        <div class="decks-progress-info">
          <span>{I18n.format(r.reviewedLabel, { count: reviewedCountDisplay })}</span>
          <span class="decks-remaining"
            >({sessionProgress
              ? I18n.format(r.remainingCount, { count: cardsRemaining })
              : currentCard
                ? r.moreCardsAvailable
                : r.sessionComplete})</span
          >
        </div>
        {#if !cramMode}
          <div class="decks-timer-display">
            <span class="decks-timer-label">{r.timeRemaining}</span>
            <span
              class="decks-timer-value"
              class:decks-timer-warning={sessionTimeRemaining < 60000}
            >
              {timeRemainingDisplay}
            </span>
          </div>
        {/if}
      {/if}
    </div>
  </div>

  {#if !browseMode && settings?.review?.showProgress !== false}
    <div class="decks-review-progress-bar">
      <div class="decks-progress-fill" style="width: {progress}%"></div>
    </div>
  {/if}

  {#if currentCard}
    <div
      class="decks-card-content"
      on:touchstart|passive={handleTouchStart}
      on:touchend|passive={handleTouchEnd}
    >
      {#snippet frontControls()}
          {#if canUndo && !browseMode}
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
                width="12"
                height="12"
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
          <div class="decks-card-utilities">
            {#if cardHealth && (cardHealth.isLeech || cardHealth.isDense)}
              <button
                class="clickable-icon decks-warning-icon decks-icon-btn"
                type="button"
                tabindex="-1"
                aria-label={cardHealth.isLeech && cardHealth.isDense
                  ? r.cardLeechAndDense
                  : cardHealth.isLeech
                    ? r.cardLeech
                    : r.cardDense}
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
            {#if onNavigateToSource && currentCard}
              <button
                class="decks-go-to-file-button decks-icon-btn clickable-icon"
                on:click={handleNavigateToSource}
                aria-label={r.openSourceFile}
                type="button"
                tabindex="-1"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                  ></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </button>
            {/if}
            {#if onCardStateAction && currentCard}
              <div
                class="decks-card-actions-menu"
                bind:this={actionsMenuEl}
              >
                <button
                  class="decks-card-actions-trigger decks-icon-btn clickable-icon"
                  on:click|stopPropagation={toggleActionsMenu}
                  aria-label={r.cardActions}
                  aria-haspopup="menu"
                  aria-expanded={actionsMenuOpen}
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
                    <circle cx="12" cy="5" r="1.5"></circle>
                    <circle cx="12" cy="12" r="1.5"></circle>
                    <circle cx="12" cy="19" r="1.5"></circle>
                  </svg>
                </button>
                {#if actionsMenuOpen}
                  <div class="decks-card-actions-dropdown" role="menu" tabindex="-1">
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
                  </div>
                {/if}
              </div>
            {/if}
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
              width="12"
              height="12"
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
      <div class="decks-question-section">
        {#if frontIsHtml}
          <div class="decks-card-shell">
            <div class="decks-template-layer decks-front" bind:this={frontEl}></div>
            <div class="decks-controls-layer">{@render frontControls()}</div>
          </div>
        {:else}
          <div class="decks-front-wrapper">
            {@render frontControls()}
            <div class="decks-card-side decks-front">
              <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
              <div
                class="decks-card-text markdown-rendered"
                bind:this={frontEl}
                on:click={handleClozeBlankClick}
              ></div>
            </div>
            <!-- Front-only cloze: surface the Extra's Notes button on the front card
                 itself (like the back card's button) once the cloze is revealed. -->
            {#if frontOnlyClozeCard && showAnswer}
              {@render notesButton()}
            {/if}
          </div>
        {/if}
        {#if isMultipleChoice && mcqOptions.length > 0}
          <div class="decks-review-mcq">
            {#if mcqStem}
              {#key mcqCardId}
                <div
                  class="decks-card-text markdown-rendered"
                  use:mcqRenderInto={mcqStem}
                ></div>
              {/key}
            {/if}
            {#each mcqDisplayOrder as fileIndex, displayPosition (`${mcqCardId}:${fileIndex}`)}
              <button
                class="decks-exam-option {mcqOptionState(fileIndex)}"
                type="button"
                on:click={() => toggleMcqOption(fileIndex)}
              >
                <span class="decks-exam-option-prefix">{displayPosition + 1})</span>
                <span
                  class="decks-exam-option-text markdown-rendered"
                  use:mcqRenderInto={mcqOptions[fileIndex].text}
                ></span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if currentCard?.hint && currentCard.hint.length > 0}
        <div class="decks-card-edge">
          <span class="decks-card-edge-line"></span>
          <span class="decks-card-edge-chip" aria-label={currentCard.hint}>{currentCard.hint}</span>
          <span class="decks-card-edge-line"></span>
        </div>
      {:else if showAnswer && !(!!currentCard && isOcclusionV2(currentCard) && !currentV2Answered) && !(frontOnlyClozeCard && !showNotes)}
        <div class="decks-separator"></div>
      {/if}
      <div class="decks-answer-section" class:hidden={answerSectionHidden}>
        {#snippet backTopControls()}
          {#if currentCard}
            <button
              class="decks-copy-button decks-icon-btn clickable-icon"
              on:click={handleCopyBack}
              title={r.copyContent}
              type="button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path
                  d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                ></path>
              </svg>
            </button>
          {/if}
        {/snippet}
        {#if !frontOnlyClozeCard && !isMultipleChoice}
          {#if backIsHtml}
            <div class="decks-card-shell">
              <div class="decks-template-layer decks-back" bind:this={backEl}></div>
              <div class="decks-controls-layer">
                {@render backTopControls()}
                {@render notesButton()}
              </div>
            </div>
          {:else}
            <div class="decks-back-wrapper">
              {@render backTopControls()}
              <div class="decks-card-side decks-back">
                <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                <div
                  class="decks-card-text markdown-rendered"
                  bind:this={backEl}
                  on:click={handleClozeBlankClick}
                ></div>
              </div>
              {@render notesButton()}
            </div>
          {/if}
        {/if}
        {#if showNotes && hasNotes}
          {#if notesIsHtml}
            <div class="decks-card-shell decks-notes-shell">
              <div class="decks-template-layer decks-notes" bind:this={notesEl}></div>
            </div>
          {:else}
            <div class="decks-notes-wrapper">
              <div class="decks-card-side decks-notes">
                <div class="decks-card-text markdown-rendered" bind:this={notesEl}></div>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <div class="decks-action-buttons">
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
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background-primary);
    color: var(--text-normal);
    overflow: hidden;
    width: 100%;
    justify-content: space-between;
  }

  :global(.modal) .decks-review-modal {
    padding-top: calc(env(safe-area-inset-top) + 16px);
  }

  .decks-breadcrumb {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-decoration: none;
  }

  .decks-card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
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
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 10;
    display: flex;
    gap: 4px;
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

  .decks-modal-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-modal-header h3 {
    margin: 0;
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .decks-header-stats {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }

  .decks-progress-info {
    display: flex;
    gap: 8px;
    font-size: 14px;
  }

  .decks-timer-display {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
  }

  .decks-timer-label {
    color: var(--text-muted);
  }

  .decks-timer-value {
    font-weight: 600;
    color: var(--text-normal);
    font-family: monospace;
  }

  .decks-timer-value.decks-timer-warning {
    color: var(--text-error);
  }

  .decks-remaining {
    color: var(--text-muted);
  }

  .decks-review-progress-bar {
    height: 4px;
    background: var(--background-modifier-border);
    position: relative;
  }

  .decks-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .decks-card-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 32px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 24px;
    width: 100%;
    box-sizing: border-box;
    min-height: 0;
  }

  .decks-question-section,
  .decks-answer-section {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  /* Markdown / fallback face — shares the physical look of .decks-card-shell so
     HTML-template and markdown faces read as a cohesive set. */
  .decks-card-side {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
    padding: 2rem;
    min-height: 250px;
    width: 100%;
    max-width: 900px;
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

  .decks-front-wrapper,
  .decks-back-wrapper {
    position: relative;
    width: 100%;
    max-width: 900px;
  }

  /* Physical card shell — HTML-template sides only. The plugin enforces the
     card frame (border, background, shadow, rounded corners); the in-flow
     template layer fills it and the controls layer floats on top without
     blocking selection/clicks in the template. */
  .decks-card-shell {
    position: relative;
    display: flex;
    width: 100%;
    max-width: 900px;
    min-height: 250px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--background-modifier-border);
    background-color: var(--background-primary);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
  }

  /* In-flow layer: fills the shell and holds the Shadow DOM host. */
  .decks-template-layer {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
  }

  /* Overlay layer anchored exactly to the shell; never blocks the template. */
  .decks-controls-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: none;
  }

  .decks-controls-layer .decks-undo-button,
  .decks-controls-layer .decks-copy-button,
  .decks-controls-layer .decks-notes-button,
  .decks-controls-layer .decks-card-utilities,
  .decks-controls-layer .decks-card-actions-menu,
  .decks-controls-layer .decks-card-actions-dropdown {
    pointer-events: auto;
  }

  /* Frosted-glass treatment so floating controls stay readable over any
     template background (template cards only — scoped to the controls layer). */
  .decks-controls-layer .decks-icon-btn {
    pointer-events: auto;
    color: var(--text-normal);
    background-color: var(--background-modifier-form-field);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    border-radius: 6px;
  }

  .decks-card-side.decks-front {
    text-align: center;
    font-size: 20px;
    font-weight: 500;
  }

  .decks-card-side.decks-back {
    font-size: 16px;
    line-height: 1.6;
  }

  .decks-notes-button {
    position: absolute;
    bottom: 4px;
    right: 4px;
    z-index: 10;
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
  }

  .decks-notes-button.decks-notes-active {
    color: var(--interactive-accent);
  }

  .decks-notes-wrapper {
    width: 100%;
    max-width: 900px;
    margin-top: 8px;
  }

  .decks-card-side.decks-notes {
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-muted);
    /* Notes keeps the white chrome but hugs its content (no 250px floor) and
       stays a left-aligned, top annotation rather than centered. */
    min-height: 0;
    justify-content: flex-start;
    align-items: flex-start;
  }

  .decks-go-to-file-button {
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
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

  .decks-copy-button {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 10;
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
  }

  .decks-undo-button {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 10;
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
    height: 1px;
    background: var(--background-modifier-border-hover);
    margin: 0 auto;
    width: 100%;
    max-width: 600px;
  }

  .decks-action-buttons {
    padding: 20px;
    border-top: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .decks-show-answer-button {
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
    padding: 12px 24px;
    min-height: 44px;
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
    flex-wrap: nowrap;
    gap: 8px;
    padding: 0 10px;
    box-sizing: border-box;
    width: 100%;
    max-width: 600px;
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

  .decks-browse-slider {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }

  .decks-browse-range {
    flex: 1;
    height: 6px;
    cursor: pointer;
    accent-color: var(--interactive-accent);
  }

  .decks-browse-slider-label {
    font-size: 13px;
    color: var(--text-muted);
    white-space: nowrap;
    min-width: 90px;
    text-align: right;
  }

  .decks-browse-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .decks-browse-row .decks-browse-slider {
    flex: 1;
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
  @media (max-width: 768px) {
    .decks-review-modal {
      box-sizing: border-box;
      overflow-x: hidden;
    }
    .decks-modal-header {
      padding: 12px 16px;
    }

    .decks-modal-header h3 {
      font-size: 16px;
    }

    .decks-card-content {
      padding: 20px 12px;
      gap: 20px;
    }

    .decks-card-side {
      padding: 20px 16px;
      max-width: none;
    }

    .decks-card-side.decks-front {
      font-size: 18px;
    }

    .decks-card-side.decks-back {
      font-size: 15px;
    }

    .decks-action-buttons {
      padding: 8px 16px;
    }

    .decks-show-answer-button {
      padding: 14px 24px;
      font-size: 16px;
      min-height: 44px;
    }

    .decks-browse-slider-label {
      font-size: 12px;
      min-width: 80px;
    }

    .decks-difficulty-buttons {
      gap: 6px;
      padding: 0 8px;
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

    .decks-header-stats {
      flex-direction: column;
      gap: 8px;
      align-items: flex-start;
    }

    .decks-timer-display {
      align-self: flex-end;
      font-size: 13px;
    }
  }

  @media (max-width: 480px) {
    .decks-timer-display {
      font-size: 12px;
    }

    .decks-progress-info {
      font-size: 13px;
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
            padding: 16px 12px;
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

  /* Mobile keyboard and safe area protection - Blocker #9 */
  .decks-action-buttons {
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
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

  /* Mobile safe area insets. padding-top is handled by the modal-scoped
   * `:global(.modal) .decks-review-modal` rule above so it only adds a
   * top inset in modal mode; tab-mode review lives inside Obsidian's
   * workspace which already accounts for safe-area-inset-top, and adding
   * another top inset there would double up. */
  .decks-review-modal {
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
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

  :global(.decks-cloze-blank) {
    background: var(--background-modifier-border);
    padding: 2px 12px;
    border-radius: 4px;
    display: inline-block;
    min-width: 40px;
    text-align: center;
  }

  :global(.decks-cloze-active) {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    padding: 2px 12px;
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
    font-size: 12px;
    font-weight: 400;
    color: var(--text-muted);
  }
</style>
