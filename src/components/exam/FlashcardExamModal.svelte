<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    EXAM_TARGET_BLANK,
    I18n,
    type ExamAttempt,
    type ExamQuestion,
    type ExamQuestionOutcome,
    type ExamSession,
  } from "@decks/core";

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

  const t = I18n.t.exam;
  const OPTION_KEYS = "abcdefghi";

  type Phase = "question" | "results";
  let phase: Phase = "question";
  let currentIndex = attempt.currentIndex;
  let typedText = "";
  let selectedIndices: number[] = [];
  let revealed = false; // immediate-mode verdict visible for current question
  let selfPromptVisible = false;
  let finishResult: ReturnType<ExamAttempt["finish"]> | null = null;
  let previousAttempts: ExamSession[] = [];
  let submitting = false;

  let timeRemainingMs =
    attempt.settings.timeLimitMinutes > 0
      ? attempt.settings.timeLimitMinutes * 60 * 1000
      : 0;
  let timerId: number | null = null;
  let questionShownAt = Date.now();

  $: question = attempt.questions[currentIndex];
  $: total = attempt.questions.length;
  $: displayOrder =
    question?.displayOrder ?? question?.options?.map((_o, i) => i) ?? [];
  $: locked = attempt.isLocked(currentIndex);
  $: outcome = attempt.getOutcome(currentIndex);
  $: immediate = attempt.settings.feedbackTiming === "immediate";
  $: selfGraded = attempt.settings.typedGrading === "self";
  $: answeredFlags = refreshAnsweredFlags(currentIndex, phase, revealed);

  function refreshAnsweredFlags(..._deps: unknown[]): boolean[] {
    return attempt.questions.map((_q, i) => attempt.isAnswered(i));
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
    // The swapped input remounts with the question ({#key currentIndex}).
    clozeInputEl = null;
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
    if (immediate) {
      attempt.lockAnswer(currentIndex);
      revealed = true;
      if (clozeInputEl) clozeInputEl.disabled = true;
      answeredFlags = refreshAnsweredFlags();
    } else {
      next();
    }
  }

  function giveSelfVerdict(correct: boolean): void {
    attempt.setSelfVerdict(currentIndex, correct);
    attempt.lockAnswer(currentIndex);
    selfPromptVisible = false;
    revealed = true;
    if (clozeInputEl) clozeInputEl.disabled = true;
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
      finishResult = attempt.finish();
      phase = "results";
      try {
        previousAttempts = await onFinished(finishResult);
      } catch (error) {
        console.error("Persisting exam attempt failed:", error);
      }
    } catch (error) {
      console.error("Submitting exam failed:", error);
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
    if (phase === "results") return;
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

  // Mount-time markdown action: render, then swap the cloze sentinel for
  // the answer input so the target blank IS the input. Question content is
  // wrapped in {#key currentIndex}, so every navigation remounts these —
  // reactive re-render timing (which runs before the DOM patch) never
  // touches a stale or unmounted element.
  function renderBlock(el: HTMLElement, content: string): { destroy(): void } {
    el.empty();
    void renderMarkdown(content, el, question?.card.sourceFile ?? "").then(() => {
      swapSentinel(el);
    });
    return { destroy() {} };
  }

  let clozeInputEl: HTMLInputElement | null = null;

  function swapSentinel(root: HTMLElement): void {
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
        input.value = typedText;
        input.disabled = locked;
        input.addEventListener("input", () => {
          typedText = input.value;
          onTypedInput();
        });
        const after = node.splitText(at);
        after.nodeValue = (after.nodeValue ?? "").slice(EXAM_TARGET_BLANK.length);
        node.parentElement.insertBefore(input, after);
        clozeInputEl = input;
        input.focus();
        return;
      }
      node = walker.nextNode();
    }
  }

  // Selection and reveal state are passed in so the template expression
  // depends on them — Svelte only invalidates on identifiers it can see.
  function optionState(
    fileIndex: number,
    verdict: ExamQuestionOutcome | null,
    selected: number[],
    isRevealed: boolean
  ): string {
    const isSelected = selected.includes(fileIndex);
    if (!isRevealed || !verdict) return isSelected ? "selected" : "";
    const correct = question.options?.[fileIndex]?.correct === true;
    if (isSelected && correct) return "chosen-correct";
    if (isSelected && !correct) return "chosen-wrong";
    if (!isSelected && correct) return "missed-correct";
    return "";
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

      {#key currentIndex}
        <div class="decks-exam-stem markdown-rendered" use:renderBlock={question.stem}></div>

        {#if question.kind === "multiple-choice"}
          <div class="decks-exam-options">
            {#each displayOrder as fileIndex, displayPosition (fileIndex)}
              <button
                class="decks-exam-option {optionState(fileIndex, outcome, selectedIndices, revealed)}"
                disabled={locked && !revealed}
                on:click={() => toggleOption(fileIndex)}
              >
                <span class="decks-exam-option-prefix">{optionPrefix(displayPosition)}</span>
                <span
                  class="decks-exam-option-text markdown-rendered"
                  use:renderBlock={question.options?.[fileIndex]?.text ?? ""}
                ></span>
              </button>
            {/each}
          </div>
        {:else if question.isCloze && question.clozeContext}
          <div
            class="decks-exam-cloze markdown-rendered"
            use:renderBlock={question.clozeContext}
          ></div>
        {:else}
          <input
            class="decks-exam-typed-input"
            type="text"
            placeholder={t.typeAnswerPlaceholder}
            bind:value={typedText}
            on:input={onTypedInput}
            disabled={locked}
          />
        {/if}
      {/key}

      {#if selfPromptVisible}
        <div class="decks-exam-self-prompt">
          <div class="decks-exam-correct-answer">
            <span class="decks-exam-label">{t.correctAnswer}:</span>
            {question.expectedAnswer ?? ""}
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
      {:else if revealed && outcome}
        <div
          class="decks-exam-verdict"
          class:decks-exam-verdict-correct={outcome.isCorrect}
          class:decks-exam-verdict-wrong={!outcome.isCorrect}
        >
          <div>{outcome.isCorrect ? t.correct : t.incorrect}</div>
          {#if question.kind === "type-in"}
            <div class="decks-exam-correct-answer">
              <span class="decks-exam-label">{t.correctAnswer}:</span>
              {outcome.correctAnswerText}
            </div>
          {/if}
        </div>
      {/if}

      <div class="decks-exam-actions">
        <button on:click={previous} disabled={currentIndex === 0}>
          {t.previous}
        </button>
        {#if (immediate || (question.kind === "type-in" && selfGraded)) && !locked}
          <button class="decks-exam-submit-one" on:click={submitCurrent}>
            {t.submitAnswer}
          </button>
        {/if}
        <button class="decks-exam-submit mod-cta" on:click={() => void requestSubmit()}>
          {t.submitExam}
        </button>
        <button on:click={next} disabled={currentIndex === total - 1}>
          {t.next}
        </button>
      </div>

      <div class="decks-exam-navigator">
        {#each attempt.questions as _q, i (i)}
          <button
            class="decks-exam-chip"
            class:decks-exam-chip-current={i === currentIndex}
            class:decks-exam-chip-answered={answeredFlags[i]}
            on:click={() => goTo(i)}
          >
            {i + 1}
          </button>
        {/each}
      </div>
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
          <div class="decks-exam-result-row">
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
                {i + 1}. {row.question.stem}
              </div>
              <div>
                <span class="decks-exam-label">{t.yourAnswer}:</span>
                {row.outcome.givenAnswerText || "—"}
              </div>
              <div>
                <span class="decks-exam-label">{t.correctAnswer}:</span>
                {row.outcome.correctAnswerText}
              </div>
              {#if row.question.card.notes}
                <details class="decks-exam-result-notes">
                  <summary>{t.notes}</summary>
                  <div>{row.question.card.notes}</div>
                </details>
              {/if}
            </div>
          </div>
        {/each}
      </div>

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
    margin-top: auto;
  }
  .decks-exam-navigator {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    justify-content: center;
  }
  .decks-exam-chip {
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
    outline: 2px solid var(--interactive-accent);
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
