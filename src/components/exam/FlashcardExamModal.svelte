<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import {
    EXAM_TARGET_BLANK,
    examQuestionText,
    groupExamExercises,
    I18n,
    type AttemptMiss,
    type WeakSection,
    formatPageList,
    missesSectionCards,
    missesSummary,
    weakSections,
    type ExamAttempt,
    type ExamQuestion,
    type ExamQuestionOutcome,
    type ExamSession,
    type ExamJudge,
    type JudgeOutcome,
    judgePending,
  } from "@decks/core";
  import type { Flashcard } from "../../database/types";
  import DocInfoButton from "../DocInfoButton.svelte";

  export let attempt: ExamAttempt;
  export let deckName: string;
  export let renderMarkdown: (
    content: string,
    el: HTMLElement,
    sourcePath?: string
  ) => Promise<void>;
  // Host persists the attempt (+ stamping) and returns previous attempts.
  export let onFinished: (result: ReturnType<ExamAttempt["finish"]>) => Promise<ExamSession[]>;
  export let confirmSubmit: (unansweredCount: number) => Promise<boolean>;
  export let confirmQuit: () => Promise<boolean>;
  export let onQuit: () => void;
  export let onRetake: () => void;
  export let onComplete: () => void;
  export let isActive: (() => boolean) | undefined = undefined;
  /** Where the missed cards came from, and how many cards each page carries.
   *  Absent when the workbench never wrote these cards. */
  export let missOrigins:
    | ((
        cards: Flashcard[],
      ) => Promise<{
        pages: Record<string, number | null>;
        cardsByPage: Record<number, number>;
        sourceRef: string;
        sourceHash: string | null;
      }>)
    | undefined = undefined;
  /** Open a workbench session aimed at these pages. */
  export let onSessionFromMisses:
    | ((seed: { pages: number[]; sourceRef: string; sourceHash: string | null }) => void)
    | undefined = undefined;
  /** Hand these cards to the batch repair flow. */
  export let onRepairCards: ((cardIds: string[]) => void) | undefined = undefined;
  /** Checks typed answers by meaning; resolves to null when that cannot run. */
  export let judge: (() => Promise<ExamJudge | null>) | undefined = undefined;

  const t = I18n.t.exam;
  const OPTION_KEYS = "abcdefghi";

  type Phase = "question" | "review" | "results";
  // How long one answer, then the whole paper, may wait for the meaning check.
  const CHECK_ONE_MS = 10_000;
  const CHECK_ALL_MS = 15_000;
  let phase: Phase = "question";
  let currentIndex = attempt.currentIndex;
  let typedText = "";
  let selectedIndices: number[] = [];
  let revealed = false; // immediate-mode verdict visible for current question
  let selfPromptVisible = false;
  let finishResult: ReturnType<ExamAttempt["finish"]> | null = null;
  let previousAttempts: ExamSession[] = [];
  let misses: AttemptMiss[] = [];
  let missCardsByPage: Record<number, number> = {};
  let missSourceRef = "";
  let missSourceHash: string | null = null;
  $: missPageByCard = new Map(misses.filter((m) => m.page).map((m) => [m.cardId, m.page as number]));
  $: weakest = weakSections(misses, missCardsByPage);
  $: missPageCount = misses.filter((m) => m.page !== null).length;
  let submitting = false;
  let judging = false;
  let checkFailed = false;
  let reviewQueue: number[] = [];
  let reviewPos = 0;

  let timeRemainingMs =
    attempt.settings.timeLimitMinutes > 0
      ? attempt.settings.timeLimitMinutes * 60 * 1000
      : 0;
  let timerId: number | null = null;
  let questionShownAt = Date.now();

  $: question = attempt.questions[currentIndex];
  $: total = attempt.questions.length;
  // A lone question is an exercise of one; the screen shows a whole exercise at a time.
  const exercises = groupExamExercises(attempt.questions);
  const exerciseAt: number[] = [];
  exercises.forEach((entry, n) => entry.indices.forEach((i) => (exerciseAt[i] = n)));
  $: exercise = exercises[exerciseAt[currentIndex] ?? 0];
  $: isExercise = exercise.material !== null;
  $: displayOrder =
    question?.displayOrder ?? question?.options?.map((_o, i) => i) ?? [];
  // Bumped when a question is graded: the attempt's own state is not reactive.
  let gradeVersion = 0;
  $: locked = lockedAt(currentIndex, gradeVersion);
  $: outcome = outcomeAt(currentIndex, gradeVersion);
  $: immediate = attempt.settings.feedbackTiming === "immediate";
  $: selfGraded = attempt.settings.typedGrading === "self";
  $: byMeaning = attempt.settings.typedGrading === "meaning";
  $: answeredFlags = refreshAnsweredFlags(currentIndex, phase, revealed);

  function lockedAt(i: number, ..._deps: unknown[]): boolean {
    return attempt.isLocked(i);
  }

  function outcomeAt(i: number, ..._deps: unknown[]): ExamQuestionOutcome | null {
    return attempt.getOutcome(i);
  }

  function refreshAnsweredFlags(..._deps: unknown[]): boolean[] {
    return attempt.questions.map((_q, i) => attempt.isAnswered(i));
  }

  function selectedAt(i: number, ..._deps: unknown[]): number[] {
    const given = attempt.getAnswer(i);
    return given?.kind === "options" ? given.selected : [];
  }

  function revealedAt(i: number, ..._deps: unknown[]): boolean {
    return i === currentIndex ? revealed : attempt.isLocked(i);
  }

  /** Make a question of the exercise on screen the one being answered. */
  function focusQuestion(i: number): void {
    if (i !== currentIndex) goTo(i);
  }

  function toggleOptionAt(i: number, fileIndex: number): void {
    focusQuestion(i);
    toggleOption(fileIndex);
  }

  function typeAt(i: number, value: string): void {
    focusQuestion(i);
    typedText = value;
    onTypedInput();
  }

  function optionPrefix(displayPosition: number): string {
    return attempt.settings.optionLabels === "numbers"
      ? `${displayPosition + 1})`
      : `${OPTION_KEYS[displayPosition] ?? "?"})`;
  }

  function formatTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function recordScreenTime(): void {
    attempt.addScreenTime(currentIndex, Date.now() - questionShownAt);
    questionShownAt = Date.now();
  }

  function loadQuestionState(): void {
    const given = attempt.getAnswer(currentIndex);
    typedText = given?.kind === "typed" ? given.text : "";
    selectedIndices = given?.kind === "options" ? [...given.selected] : [];
    revealed = attempt.isLocked(currentIndex);
    selfPromptVisible = false;
    checkFailed = false;
  }

  function goTo(i: number): void {
    if (phase !== "question" || i < 0 || i >= total) return;
    recordScreenTime();
    attempt.goTo(i);
    currentIndex = attempt.currentIndex;
    loadQuestionState();
  }

  function toggleOption(fileIndex: number): void {
    if (locked || phase !== "question") return;
    const options = question.options ?? [];
    const multi = options.filter((o) => o.correct).length > 1;
    if (multi) {
      selectedIndices = selectedIndices.includes(fileIndex)
        ? selectedIndices.filter((v) => v !== fileIndex)
        : [...selectedIndices, fileIndex];
    } else {
      selectedIndices = [fileIndex];
    }
    attempt.setAnswer(currentIndex, { kind: "options", selected: selectedIndices });
    answeredFlags = refreshAnsweredFlags();
  }

  function onTypedInput(): void {
    if (locked) return;
    const previous = attempt.getAnswer(currentIndex);
    attempt.setAnswer(currentIndex, {
      kind: "typed",
      text: typedText,
      selfVerdict: previous?.kind === "typed" ? previous.selfVerdict : null,
    });
    answeredFlags = refreshAnsweredFlags();
  }

  // Immediate mode (and self-graded type-ins in any mode): grade/reveal now.
  function submitCurrent(): void {
    if (locked || phase !== "question") return;
    if (question.kind === "type-in" && selfGraded) {
      revealed = true;
      selfPromptVisible = true;
      return;
    }
    if (question.kind === "type-in" && byMeaning && immediate) {
      void checkCurrent();
      return;
    }
    if (immediate) {
      attempt.lockAnswer(currentIndex);
      gradeVersion += 1;
      revealed = true;
      disableClozeInput(currentIndex);
      answeredFlags = refreshAnsweredFlags();
    } else {
      next();
    }
  }

  /** Check the answer on screen by meaning, then lock it or ask the student. */
  async function checkCurrent(): Promise<void> {
    if (judging) return;
    const i = currentIndex;
    judging = true;
    const out = await runJudge([i], CHECK_ONE_MS);
    judging = false;
    if (phase !== "question" || currentIndex !== i) return;
    if (attempt.needsSelfVerdict(i)) {
      checkFailed = out.failed;
      revealed = true;
      selfPromptVisible = true;
      return;
    }
    attempt.lockAnswer(i);
    gradeVersion += 1;
    revealed = true;
    disableClozeInput(i);
    answeredFlags = refreshAnsweredFlags();
  }

  /** Judge pending answers, giving up after `timeoutMs`; never throws. */
  async function runJudge(indices: number[] | undefined, timeoutMs: number): Promise<JudgeOutcome> {
    const pending = attempt.pendingJudgements(indices).length > 0;
    const judgeFn = pending ? ((await judge?.()) ?? null) : null;
    const controller = new AbortController();
    let timer: number | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);
    });
    try {
      const judged = await Promise.race([
        judgePending(attempt, judgeFn, indices, controller.signal),
        timeout,
      ]);
      const scope = indices ?? attempt.questions.map((_q, i) => i);
      return judged ?? { unresolved: scope.filter((i) => attempt.needsSelfVerdict(i)), failed: true };
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** The student's verdict on the answer under review; the last one finishes the exam. */
  function giveReviewVerdict(correct: boolean): void {
    const i = reviewQueue[reviewPos];
    if (phase !== "review" || i === undefined) return;
    attempt.setSelfVerdict(i, correct);
    if (reviewPos + 1 < reviewQueue.length) reviewPos += 1;
    else void finalize();
  }

  function typedAnswerAt(i: number): string {
    const given = attempt.getAnswer(i);
    return given?.kind === "typed" ? given.text : "";
  }

  function giveSelfVerdict(correct: boolean): void {
    attempt.setSelfVerdict(currentIndex, correct);
    attempt.lockAnswer(currentIndex);
    gradeVersion += 1;
    selfPromptVisible = false;
    revealed = true;
    disableClozeInput(currentIndex);
    answeredFlags = refreshAnsweredFlags();
  }

  function next(): void {
    goTo(currentIndex + 1);
  }

  function previous(): void {
    goTo(currentIndex - 1);
  }

  async function requestQuit(): Promise<void> {
    if (phase === "results") {
      onComplete();
      return;
    }
    if (await confirmQuit()) onQuit();
  }

  async function requestSubmit(force = false): Promise<void> {
    if (phase !== "question" || submitting) return;
    submitting = true;
    try {
      const unanswered = attempt.unansweredCount();
      if (!force && unanswered > 0 && !(await confirmSubmit(unanswered))) {
        return;
      }
      recordScreenTime();
      stopTimer();
      if (byMeaning) {
        judging = true;
        const out = await runJudge(undefined, CHECK_ALL_MS);
        judging = false;
        if (out.unresolved.length > 0) {
          checkFailed = out.failed;
          reviewQueue = out.unresolved;
          reviewPos = 0;
          phase = "review";
          return;
        }
      }
      submitting = false;
      await finalize();
    } catch (error) {
      console.error("Submitting exam failed:", error);
    } finally {
      submitting = false;
    }
  }

  /** Grade the attempt, persist it and show the results. */
  async function finalize(): Promise<void> {
    if ((phase !== "question" && phase !== "review") || submitting) return;
    submitting = true;
    try {
      finishResult = attempt.finish();
      phase = "results";
      void loadMisses();
      try {
        previousAttempts = await onFinished(finishResult);
      } catch (error) {
        console.error("Persisting exam attempt failed:", error);
      }
    } finally {
      submitting = false;
    }
  }

  function stopTimer(): void {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function startTimer(): void {
    if (attempt.settings.timeLimitMinutes <= 0) return;
    const endAt = Date.now() + timeRemainingMs;
    timerId = window.setInterval(() => {
      timeRemainingMs = endAt - Date.now();
      if (timeRemainingMs <= 0) {
        timeRemainingMs = 0;
        void requestSubmit(true);
      }
    }, 1000);
  }

  function isTypingTarget(event: KeyboardEvent): boolean {
    const target = event.target;
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    );
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isActive && !isActive()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      void requestQuit();
      return;
    }
    if (phase !== "question") return;
    if (isTypingTarget(event)) {
      if (event.key === "Enter") {
        event.preventDefault();
        if (revealed && locked) next();
        else submitCurrent();
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      previous();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (revealed && locked) next();
      else if (immediate || (question?.kind === "type-in" && selfGraded)) submitCurrent();
      else next();
      return;
    }
    if (question?.kind === "multiple-choice") {
      // Both key sets select positionally, whichever label style is set.
      const numeric = parseInt(event.key, 10);
      const letter = OPTION_KEYS.indexOf(event.key.toLowerCase());
      const displayPosition = Number.isNaN(numeric)
        ? letter
        : numeric >= 1 && numeric <= 9
          ? numeric - 1
          : -1;
      if (displayPosition >= 0 && displayPosition < displayOrder.length) {
        event.preventDefault();
        toggleOption(displayOrder[displayPosition]);
      }
    }
  }

  // Mount-time markdown action. Content is wrapped in {#key exercise.key}, so
  // moving to another exercise remounts these; within one, nothing re-renders.
  function renderBlock(el: HTMLElement, content: string): { destroy(): void } {
    el.empty();
    void renderMarkdown(content, el, question?.card.sourceFile ?? "");
    return { destroy() {} };
  }

  // A cloze renders, then its target blank is swapped for the answer input.
  function renderCloze(el: HTMLElement, p: { text: string; index: number }): { destroy(): void } {
    el.empty();
    void renderMarkdown(p.text, el, attempt.questions[p.index]?.card.sourceFile ?? "").then(() => {
      swapSentinel(el, p.index);
    });
    return { destroy() {} };
  }

  // Blank markers are text: "[...]" is no link and a "____" line no rule.
  function blanksAsText(text: string): string {
    return text.split("[...]").join("\\[...\\]").split("____").join("\\_\\_\\_\\_");
  }

  /** Markdown for an answer or result line, so its math renders as in the question. */
  function md(el: HTMLElement, p: { text: string; source: string }): { update(next: { text: string; source: string }): void } {
    const draw = (next: { text: string; source: string }) => {
      el.empty();
      void renderMarkdown(next.text, el, next.source);
    };
    draw(p);
    return { update: draw };
  }

  // Within an exercise, the question being answered scrolls into view.
  const questionEls: Record<number, HTMLElement> = {};
  $: if (isExercise) void scrollToQuestion(currentIndex);

  async function scrollToQuestion(i: number): Promise<void> {
    await tick();
    questionEls[i]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // The page strip keeps the current question in view; only the strip scrolls, never the question.
  let navEl: HTMLElement | null = null;
  $: if (navEl) {
    const chip = navEl.children[currentIndex];
    if (chip instanceof HTMLElement) {
      const left = chip.offsetLeft - (navEl.clientWidth - chip.offsetWidth) / 2;
      navEl.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    }
  }

  const clozeInputs = new Map<number, HTMLInputElement>();

  function disableClozeInput(i: number): void {
    const input = clozeInputs.get(i);
    if (input) input.disabled = true;
  }

  function swapSentinel(root: HTMLElement, index: number): void {
    const walker = activeDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node.nodeValue ?? "";
      const at = text.indexOf(EXAM_TARGET_BLANK);
      if (at >= 0 && node instanceof Text && node.parentElement) {
        const input = activeDocument.createElement("input");
        input.type = "text";
        input.className = "decks-exam-blank-input";
        input.placeholder = t.typeAnswerPlaceholder;
        input.value = index === currentIndex ? typedText : typedAnswerAt(index);
        input.disabled = attempt.isLocked(index);
        input.addEventListener("focus", () => focusQuestion(index));
        input.addEventListener("input", () => typeAt(index, input.value));
        const after = node.splitText(at);
        after.nodeValue = (after.nodeValue ?? "").slice(EXAM_TARGET_BLANK.length);
        node.parentElement.insertBefore(input, after);
        clozeInputs.set(index, input);
        if (index === currentIndex) input.focus();
        return;
      }
      node = walker.nextNode();
    }
  }

  // Selection and reveal state are passed in so the template expression
  // depends on them — Svelte only invalidates on identifiers it can see.
  function optionState(
    target: ExamQuestion,
    fileIndex: number,
    verdict: ExamQuestionOutcome | null,
    selected: number[],
    isRevealed: boolean
  ): string {
    const isSelected = selected.includes(fileIndex);
    if (!isRevealed || !verdict) return isSelected ? "selected" : "";
    const correct = target.options?.[fileIndex]?.correct === true;
    if (isSelected && correct) return "chosen-correct";
    if (isSelected && !correct) return "chosen-wrong";
    if (!isSelected && correct) return "missed-correct";
    return "";
  }

  /**
   * The misses, with the page each card cites. An attempt is the only place
   * where "covered" and "learned" can be told apart.
   */
  async function loadMisses(): Promise<void> {
    if (!finishResult || !missOrigins) return;
    const wrong = finishResult.outcomes.filter((o) => !o.isCorrect);
    if (wrong.length === 0) return;
    try {
      const origins = await missOrigins(wrong.map((o) => attempt.questions[o.index].card));
      missCardsByPage = origins.cardsByPage;
      missSourceRef = origins.sourceRef;
      missSourceHash = origins.sourceHash;
      misses = wrong.map((o) => {
        const card = attempt.questions[o.index].card;
        return {
          index: o.index + 1,
          cardId: card.id,
          page: origins.pages[card.id] ?? null,
          unanswered: o.givenAnswerText.trim() === "",
        };
      });
    } catch (e) {
      console.debug("Decks: could not read where the missed cards came from", e);
    }
  }

  function cardIdsFor(section: WeakSection): string[] {
    const pages = new Set(section.pages);
    return misses
      .filter((m) => m.page !== null && pages.has(m.page))
      .map((m) => m.cardId);
  }

  function questionResultRows(): Array<{
    question: ExamQuestion;
    outcome: ExamQuestionOutcome;
  }> {
    if (!finishResult) return [];
    return finishResult.outcomes.map((o) => ({
      question: attempt.questions[o.index],
      outcome: o,
    }));
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    startTimer();
    loadQuestionState();
    questionShownAt = Date.now();
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
    stopTimer();
  });
</script>

<div class="decks-exam">
  <div class="decks-exam-header">
    <div class="decks-exam-title">{deckName}</div>
    <div class="decks-exam-header-right">
      <DocInfoButton path="exams/taking-an-exam" />
      {#if attempt.settings.timeLimitMinutes > 0 && phase === "question"}
        <span
          class="decks-exam-timer"
          class:decks-exam-timer-warning={timeRemainingMs < 60_000}
        >
          {formatTime(timeRemainingMs)}
        </span>
      {/if}
      <button class="decks-exam-quit" on:click={() => void requestQuit()}>
        {phase === "results" ? t.close : t.quit}
      </button>
    </div>
  </div>

  {#if phase === "question" && question}
    <div class="decks-exam-body">
      <div class="decks-exam-progress">
        {I18n.format(t.questionOf, {
          current: String(currentIndex + 1),
          total: String(total),
        })}
      </div>

      {#key exercise.key}
        <div class="decks-exam-exercise" class:decks-exam-exercise-split={!!exercise.material?.body.trim()}>
          {#if exercise.material}
            {#if exercise.material.body.trim()}
              <aside class="decks-exam-shared">
                <div class="decks-exam-shared-heading">{exercise.material.heading}</div>
                <div class="decks-exam-shared-body markdown-rendered" use:renderBlock={exercise.material.body}></div>
              </aside>
            {:else}
              <div class="decks-exam-shared-heading">{exercise.material.heading}</div>
            {/if}
          {/if}
          <div class="decks-exam-exercise-questions">
            {#each exercise.indices as qi (qi)}
              {@const q = attempt.questions[qi]}
              {@const active = qi === currentIndex}
              {@const qOutcome = active ? outcome : outcomeAt(qi, gradeVersion)}
              {@const qLocked = active ? locked : lockedAt(qi, gradeVersion)}
              {@const qRevealed = revealedAt(qi, revealed, gradeVersion)}
              <div
                class="decks-exam-question"
                class:decks-exam-question-in-exercise={isExercise}
                class:decks-exam-question-active={isExercise && active}
                bind:this={questionEls[qi]}
              >
                {#if isExercise}
                  <button class="decks-exam-question-number" on:click={() => focusQuestion(qi)}>{qi + 1}</button>
                {/if}
                <div class="decks-exam-question-content">
                  {#if q.stem}
                    <div class="decks-exam-stem markdown-rendered" use:renderBlock={q.stem}></div>
                  {/if}

                  {#if q.kind === "multiple-choice"}
                    {@const order = q.displayOrder ?? q.options?.map((_o, i) => i) ?? []}
                    {@const picked = active ? selectedIndices : selectedAt(qi, answeredFlags)}
                    <div class="decks-exam-options">
                      {#each order as fileIndex, displayPosition (fileIndex)}
                        <button
                          class="decks-exam-option {optionState(q, fileIndex, qOutcome, picked, qRevealed)}"
                          disabled={qLocked && !qRevealed}
                          on:click={() => toggleOptionAt(qi, fileIndex)}
                        >
                          <span class="decks-exam-option-prefix">{optionPrefix(displayPosition)}</span>
                          <span
                            class="decks-exam-option-text markdown-rendered"
                            use:renderBlock={q.options?.[fileIndex]?.text ?? ""}
                          ></span>
                        </button>
                      {/each}
                    </div>
                  {:else if q.isCloze && q.clozeContext}
                    <div
                      class="decks-exam-cloze markdown-rendered"
                      use:renderCloze={{ text: blanksAsText(q.clozeContext), index: qi }}
                    ></div>
                  {:else if byMeaning}
                    <textarea
                      class="decks-exam-typed-input decks-exam-typed-long"
                      rows="3"
                      placeholder={t.typeAnswerPlaceholder}
                      value={active ? typedText : typedAnswerAt(qi)}
                      on:focus={() => focusQuestion(qi)}
                      on:input={(e) => typeAt(qi, e.currentTarget.value)}
                      disabled={qLocked || judging || submitting}
                    ></textarea>
                  {:else}
                    <input
                      class="decks-exam-typed-input"
                      type="text"
                      placeholder={t.typeAnswerPlaceholder}
                      value={active ? typedText : typedAnswerAt(qi)}
                      on:focus={() => focusQuestion(qi)}
                      on:input={(e) => typeAt(qi, e.currentTarget.value)}
                      disabled={qLocked}
                    />
                  {/if}

                  {#if active && selfPromptVisible}
                    <div class="decks-exam-self-prompt">
                      {#if checkFailed}
                        <div class="decks-exam-check-note">{t.checkUnavailable}</div>
                      {/if}
                      <div class="decks-exam-correct-answer">
                        <span class="decks-exam-label">{t.correctAnswer}:</span>
                        <span class="decks-exam-md" use:md={{ text: q.expectedAnswer ?? "", source: q.card.sourceFile }}></span>
                      </div>
                      <div class="decks-exam-self-question">{t.selfPromptQuestion}</div>
                      <div class="decks-exam-self-buttons">
                        <button class="decks-exam-self-yes" on:click={() => giveSelfVerdict(true)}>
                          {t.selfYes}
                        </button>
                        <button class="decks-exam-self-no" on:click={() => giveSelfVerdict(false)}>
                          {t.selfNo}
                        </button>
                      </div>
                    </div>
                  {:else if qRevealed && qOutcome}
                    <div
                      class="decks-exam-verdict"
                      class:decks-exam-verdict-correct={qOutcome.isCorrect}
                      class:decks-exam-verdict-wrong={!qOutcome.isCorrect}
                    >
                      <div>{qOutcome.isCorrect ? t.correct : t.incorrect}</div>
                      {#if qOutcome.isCorrect && qOutcome.gradingMethod === "meaning"}
                        <div class="decks-exam-check-note">{t.acceptedByMeaning}</div>
                      {/if}
                      {#if q.kind === "type-in"}
                        <div class="decks-exam-correct-answer">
                          <span class="decks-exam-label">{t.correctAnswer}:</span>
                          <span class="decks-exam-md" use:md={{ text: qOutcome.correctAnswerText, source: q.card.sourceFile }}></span>
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/key}

      <div class="decks-exam-navigator" bind:this={navEl}>
        {#each attempt.questions as _q, i (i)}
          <button
            class="decks-exam-chip"
            class:decks-exam-chip-current={i === currentIndex}
            class:decks-exam-chip-answered={answeredFlags[i]}
            class:decks-exam-chip-group-start={i > 0 && exerciseAt[i] !== exerciseAt[i - 1] && (exercises[exerciseAt[i]].indices.length > 1 || exercises[exerciseAt[i - 1]].indices.length > 1)}
            class:decks-exam-chip-in-group={exercises[exerciseAt[i]].indices.length > 1}
            on:click={() => goTo(i)}
          >
            {i + 1}
          </button>
        {/each}
      </div>

      <div class="decks-exam-actions">
        <button on:click={previous} disabled={currentIndex === 0}>
          {t.previous}
        </button>
        {#if (immediate || (question.kind === "type-in" && selfGraded)) && !locked && !selfPromptVisible}
          <button class="decks-exam-submit-one" disabled={judging} on:click={submitCurrent}>
            {judging && !submitting ? t.checkingAnswer : t.submitAnswer}
          </button>
        {/if}
        <button
          class="decks-exam-submit mod-cta"
          disabled={submitting}
          on:click={() => void requestSubmit()}
        >
          {submitting && judging ? t.checkingAnswers : t.submitExam}
        </button>
        <button on:click={next} disabled={currentIndex === total - 1}>
          {t.next}
        </button>
      </div>

    </div>
  {:else if phase === "review"}
    {@const reviewIndex = reviewQueue[reviewPos] ?? 0}
    {@const reviewQuestion = attempt.questions[reviewIndex]}
    {@const reviewShared = exercises[exerciseAt[reviewIndex] ?? 0]?.material ?? null}
    <div class="decks-exam-body">
      <div class="decks-exam-review-title">{t.reviewAnswersTitle}</div>
      <div class="decks-exam-check-note">{checkFailed ? t.checkUnavailable : t.reviewAnswersIntro}</div>
      <div class="decks-exam-progress">
        {I18n.format(t.reviewAnswersProgress, {
          current: String(reviewPos + 1),
          total: String(reviewQueue.length),
        })}
      </div>
      {#key reviewIndex}
        {#if reviewShared}
          <details class="decks-exam-shared-details">
            <summary>{reviewShared.heading}</summary>
            {#if reviewShared.body.trim()}
              <div class="markdown-rendered" use:renderBlock={reviewShared.body}></div>
            {/if}
          </details>
        {/if}
        <div class="decks-exam-stem markdown-rendered" use:renderBlock={blanksAsText(examQuestionText(reviewQuestion))}></div>
        <div class="decks-exam-self-prompt">
          <div>
            <span class="decks-exam-label">{t.yourAnswer}:</span>
            <span class="decks-exam-md" use:md={{ text: typedAnswerAt(reviewIndex), source: reviewQuestion.card.sourceFile }}></span>
          </div>
          <div class="decks-exam-correct-answer">
            <span class="decks-exam-label">{t.correctAnswer}:</span>
            <span class="decks-exam-md" use:md={{ text: reviewQuestion.expectedAnswer ?? "", source: reviewQuestion.card.sourceFile }}></span>
          </div>
          <div class="decks-exam-self-question">{t.selfPromptQuestion}</div>
          <div class="decks-exam-self-buttons">
            <button class="decks-exam-self-yes" disabled={submitting} on:click={() => giveReviewVerdict(true)}>
              {t.selfYes}
            </button>
            <button class="decks-exam-self-no" disabled={submitting} on:click={() => giveReviewVerdict(false)}>
              {t.selfNo}
            </button>
          </div>
        </div>
      {/key}
    </div>
  {:else if phase === "results" && finishResult}
    <div class="decks-exam-results">
      <div class="decks-exam-score-block">
        <div class="decks-exam-score">
          {t.scoreLabel}: {finishResult.session.scorePct}%
        </div>
        <div
          class="decks-exam-passfail"
          class:decks-exam-verdict-correct={finishResult.session.passed}
          class:decks-exam-verdict-wrong={!finishResult.session.passed}
        >
          {finishResult.session.passed ? t.passed : t.failed}
        </div>
        <div class="decks-exam-time-used">
          {t.timeUsed}: {formatTime(finishResult.session.durationMs)}
        </div>
      </div>

      <div class="decks-exam-result-list">
        {#each questionResultRows() as row, i (i)}
          {@const group = exercises[exerciseAt[i] ?? 0]}
          {#if group.material && group.indices[0] === i}
            <details class="decks-exam-shared-details decks-exam-result-group">
              <summary>{group.material.heading}</summary>
              {#if group.material.body.trim()}
                <div class="markdown-rendered" use:md={{ text: group.material.body, source: row.question.card.sourceFile }}></div>
              {/if}
            </details>
          {/if}
          <div class="decks-exam-result-row" class:decks-exam-result-in-group={group.indices.length > 1}>
            <div class="decks-exam-result-verdict">
              {#if row.outcome.givenAnswerText === "" && !row.outcome.isCorrect}
                <span class="decks-exam-verdict-wrong">{t.unanswered}</span>
              {:else if row.outcome.isCorrect}
                <span class="decks-exam-verdict-correct">{t.correct}</span>
              {:else}
                <span class="decks-exam-verdict-wrong">{t.incorrect}</span>
              {/if}
            </div>
            <div class="decks-exam-result-detail">
              <div class="decks-exam-result-prompt">
                {i + 1}. <span class="decks-exam-md" use:md={{ text: blanksAsText(examQuestionText(row.question)), source: row.question.card.sourceFile }}></span>
              </div>
              <div>
                <span class="decks-exam-label">{t.yourAnswer}:</span>
                {#if row.outcome.givenAnswerText}
                  <span class="decks-exam-md" use:md={{ text: row.outcome.givenAnswerText, source: row.question.card.sourceFile }}></span>
                {:else}
                  —
                {/if}
              </div>
              <div>
                <span class="decks-exam-label">{t.correctAnswer}:</span>
                <span class="decks-exam-md" use:md={{ text: row.outcome.correctAnswerText, source: row.question.card.sourceFile }}></span>
              </div>
              {#if missPageByCard.get(row.question.card.id)}
                <span class="decks-exam-result-page"
                  >{I18n.format(I18n.t.modals.aiGenerator.pageChip, {
                    page: missPageByCard.get(row.question.card.id) ?? 0,
                  })}</span
                >
              {/if}
              {#if row.question.notes}
                <details class="decks-exam-result-notes">
                  <summary>{t.notes}</summary>
                  <div use:md={{ text: row.question.notes, source: row.question.card.sourceFile }}></div>
                </details>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if weakest.length > 0}
        <div class="decks-exam-weakest">
          <div class="decks-exam-weakest-head">
            <span class="decks-exam-weakest-title">{t.aiMisses.title}</span>
            <span class="decks-exam-weakest-summary">
              {missesSummary(missPageCount, weakest.length)}
            </span>
            {#if onSessionFromMisses && missPageCount > 0}
              <button
                type="button"
                class="mod-cta decks-exam-weakest-session"
                on:click={() =>
                  onSessionFromMisses?.({
                    pages: weakest.flatMap((w) => w.pages),
                    sourceRef: missSourceRef,
                    sourceHash: missSourceHash,
                  })}
              >
                {t.aiMisses.createSession}
              </button>
            {/if}
          </div>
          {#if onSessionFromMisses && missPageCount > 0}
            <div class="decks-exam-weakest-note">{t.aiMisses.note}</div>
          {/if}
          {#each weakest as section (section.startPage)}
            <div class="decks-exam-weakest-row">
              <span class="decks-exam-weakest-pages">
                {formatPageList(section.pages)}
              </span>
              <span class="decks-exam-weakest-count">
                {I18n.format(t.aiMisses.sectionMisses, { count: section.misses })}
              </span>
              <span
                class="decks-exam-weakest-cards"
                class:is-none={section.cards === 0}
                title={section.action === "generate"
                  ? t.aiMisses.hintGenerate
                  : t.aiMisses.hintRepair}
              >
                {section.cards === 0
                  ? t.aiMisses.sectionNoCards
                  : missesSectionCards(section.cards)}
              </span>
              {#if section.action === "generate" && onSessionFromMisses}
                <button
                  type="button"
                  on:click={() =>
                    onSessionFromMisses?.({
                      pages: section.pages,
                      sourceRef: missSourceRef,
                    sourceHash: missSourceHash,
                    })}
                >
                  {t.aiMisses.generate}
                </button>
              {:else if section.action === "repair" && onRepairCards}
                <button type="button" on:click={() => onRepairCards?.(cardIdsFor(section))}>
                  {t.aiMisses.repair}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      {:else if misses.length > 0 && missPageCount === 0}
        <div class="decks-exam-weakest-empty">{t.aiMisses.noPages}</div>
      {/if}

      {#if previousAttempts.length > 1}
        <div class="decks-exam-previous">
          <div class="decks-exam-previous-title">{t.previousAttempts}</div>
          {#each previousAttempts.slice(0, 10) as prior (prior.id)}
            <div class="decks-exam-previous-row">
              <span>{new Date(prior.endedAt).toLocaleString()}</span>
              <span>{prior.scorePct}%</span>
              <span
                class:decks-exam-verdict-correct={prior.passed}
                class:decks-exam-verdict-wrong={!prior.passed}
              >
                {prior.passed ? t.passed : t.failed}
              </span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="decks-exam-results-actions">
        <button class="decks-exam-retake mod-cta" on:click={onRetake}>{t.retake}</button>
        <button class="decks-exam-close" on:click={onComplete}>{t.close}</button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* What the attempt says about coverage: which pages keep going wrong, and
     whether they want cards or repair. */
  .decks-exam-weakest {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-exam-weakest-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .decks-exam-weakest-title {
    font-weight: 600;
  }
  .decks-exam-weakest-summary {
    font-size: 0.8em;
    color: var(--text-muted);
  }
  .decks-exam-weakest-session {
    margin-left: auto;
  }
  .decks-exam-weakest-note {
    font-size: 11px;
    color: var(--text-muted);
  }
  .decks-exam-result-page {
    display: inline-block;
    margin-top: 2px;
    font-family: var(--font-monospace);
    font-size: 10px;
    padding: 1px 5px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-hover);
    color: var(--text-muted);
  }
  .decks-exam-weakest-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85em;
  }
  .decks-exam-weakest-pages {
    min-width: 5.5em;
    font-variant-numeric: tabular-nums;
  }
  .decks-exam-weakest-count {
    color: var(--text-error);
  }
  .decks-exam-weakest-cards {
    color: var(--text-muted);
  }
  .decks-exam-weakest-cards.is-none {
    color: var(--text-warning);
  }
  .decks-exam-weakest-row button {
    margin-left: auto;
    font-size: 0.9em;
    padding: 0.1rem 0.5rem;
  }
  .decks-exam-weakest-empty {
    font-size: 0.85em;
    color: var(--text-muted);
  }

  .decks-exam {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 0.75rem;
    padding: 0.75rem;
  }
  .decks-exam-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--background-modifier-border);
    padding-bottom: 0.5rem;
  }
  .decks-exam-title {
    font-weight: 600;
  }
  .decks-exam-header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .decks-exam-timer {
    font-variant-numeric: tabular-nums;
  }
  .decks-exam-timer-warning {
    color: var(--text-error);
    font-weight: 600;
  }
  .decks-exam-body,
  .decks-exam-results {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
    flex: 1;
  }
  .decks-exam-body {
    container-type: inline-size;
  }
  .decks-exam-exercise,
  .decks-exam-exercise-questions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .decks-exam-shared {
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 0.6rem 0.8rem;
    background: var(--background-secondary);
  }
  .decks-exam-shared-heading {
    font-weight: 600;
    margin-bottom: 0.25rem;
  }
  /* Wide screens read the text beside the questions; it stays put while they scroll. */
  @container (min-width: 820px) {
    .decks-exam-exercise-split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
    .decks-exam-exercise-split .decks-exam-shared {
      position: sticky;
      top: 0;
      max-height: 70vh;
      overflow-y: auto;
    }
  }
  .decks-exam-question {
    display: flex;
    gap: 0.6rem;
  }
  .decks-exam-question-content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
  }
  .decks-exam-question-in-exercise {
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.4rem;
  }
  .decks-exam-question-active {
    border-color: var(--interactive-accent);
  }
  .decks-exam-question-number {
    flex: none;
    align-self: flex-start;
    min-width: 2rem;
    font-variant-numeric: tabular-nums;
  }
  .decks-exam-shared-details summary {
    cursor: pointer;
    font-weight: 600;
  }
  .decks-exam-result-group {
    border-top: 1px solid var(--background-modifier-border);
    padding-top: 0.5rem;
  }
  .decks-exam-result-in-group {
    padding-left: 0.75rem;
  }
  .decks-exam-progress {
    color: var(--text-muted);
    font-size: 0.9em;
  }
  .decks-exam-stem {
    font-size: 1.1em;
  }
  /* Option row visuals live in styles.css (shared with the review modal). */
  .decks-exam-options {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }
  .decks-exam-typed-input {
    width: 100%;
  }
  .decks-exam-typed-long {
    min-height: 5em;
    resize: vertical;
  }
  .decks-exam-review-title {
    font-weight: 600;
    font-size: 1.1em;
  }
  .decks-exam-check-note {
    color: var(--text-muted);
    font-size: 0.9em;
  }
  .decks-exam-self-prompt,
  .decks-exam-verdict {
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 0.6rem 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .decks-exam-verdict-correct {
    color: var(--color-green);
    font-weight: 600;
  }
  .decks-exam-verdict-wrong {
    color: var(--color-red);
    font-weight: 600;
  }
  .decks-exam-label {
    color: var(--text-muted);
  }
  .decks-exam-self-buttons {
    display: flex;
    gap: 0.5rem;
  }
  .decks-exam-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    align-items: center;
  }
  /* One line above the actions, as in the app; it scrolls rather than wrapping. */
  .decks-exam-navigator {
    position: relative;
    display: flex;
    flex-wrap: nowrap;
    gap: 0.3rem;
    margin-top: auto;
    overflow-x: auto;
    padding: 2px 0 6px;
    scrollbar-width: thin;
  }
  .decks-exam-chip {
    flex: none;
    min-width: 2rem;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    cursor: pointer;
  }
  .decks-exam-chip-answered {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }
  .decks-exam-chip-current {
    border-color: var(--interactive-accent);
    box-shadow: inset 0 0 0 1px var(--interactive-accent);
  }
  .decks-exam-chip-group-start {
    margin-left: 0.5rem;
  }
  .decks-exam-chip-in-group {
    border-bottom-width: 3px;
  }
  .decks-exam-chip-current.decks-exam-chip-answered {
    box-shadow: inset 0 0 0 2px var(--background-primary);
  }
  /* Rendered answers sit beside their label. */
  .decks-exam-md :global(p) {
    display: inline;
    margin: 0;
  }
  .decks-exam-score-block {
    display: flex;
    gap: 1rem;
    align-items: baseline;
  }
  .decks-exam-score {
    font-size: 1.4em;
    font-weight: 700;
  }
  .decks-exam-result-row {
    display: flex;
    gap: 0.75rem;
    border-top: 1px solid var(--background-modifier-border);
    padding: 0.5rem 0;
  }
  .decks-exam-result-verdict {
    min-width: 6rem;
  }
  .decks-exam-result-detail {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .decks-exam-result-prompt {
    font-weight: 600;
  }
  .decks-exam-previous-row {
    display: flex;
    gap: 1rem;
  }
  .decks-exam-previous-title {
    font-weight: 600;
    margin-top: 0.5rem;
  }
  .decks-exam-results-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }
</style>
