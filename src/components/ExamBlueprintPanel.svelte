<script lang="ts">
  import {
    I18n,
    type BlueprintSection,
    type ExamFeedbackTiming,
    type ExamSettings,
    type QuestionMix,
    type TypedGradingMode,
    autoWeightByPages,
    isPlannable,
    blueprintTotal,
    clampSectionQuestions,
    mixTotal,
  } from "@decks/core";

  export let sections: BlueprintSection[] = [];
  export let mix: QuestionMix = { generated: 0, mcq: 0, typeIn: 0, cloze: 0 };
  export let settings: ExamSettings;
  export let hasProfile = true;
  /** Offer "By meaning" grading; it stays listed while selected. */
  export let meaningAvailable = false;
  export let savedDefaults = false;
  export let busy = false;
  /** Which section is being generated, while the run is in flight. */
  export let progress: { index: number; total: number; title: string } | null = null;
  export let onSections: (next: BlueprintSection[]) => void = () => {};
  export let onSettings: (next: ExamSettings) => void = () => {};
  export let onSaveDefaults: () => void = () => {};
  export let onGenerate: () => void = () => {};

  const b = I18n.t.modals.aiGenerator.blueprint;
  const e = I18n.t.exam;

  $: planned = blueprintTotal(sections);
  $: drawable = mixTotal({ ...mix, generated: planned });

  function setQuestions(id: string, value: number): void {
    onSections(
      sections.map((s) =>
        s.id === id ? { ...s, questions: clampSectionQuestions(value) } : s,
      ),
    );
  }

  // Weighted against the total already planned, so the button redistributes
  // rather than inventing a number the user never chose.
  function autoWeight(): void {
    const total =
      planned > 0 ? planned : settings.questionCount || sections.filter(isPlannable).length * 5;
    onSections(autoWeightByPages(sections, total));
  }

  function patch(next: Partial<ExamSettings>): void {
    onSettings({ ...settings, ...next });
  }

  function numberOf(event: Event): number {
    const value = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    return Number.isFinite(value) ? value : 0;
  }
</script>

<div class="decks-ai-bp">
  {#if sections.length === 0}
    <div class="decks-ai-bp-note">{b.empty}</div>
  {:else}
    <div class="decks-ai-bp-toolbar">
      <button type="button" disabled={busy} on:click={autoWeight}>{b.autoWeight}</button>
    </div>

    <div class="decks-ai-bp-table">
      <div class="decks-ai-bp-head">
        <span>{b.colSection}</span>
        <span class="decks-ai-bp-num">{b.colPages}</span>
        <span class="decks-ai-bp-num">{b.colCards}</span>
        <span class="decks-ai-bp-num">{b.colQuestions}</span>
      </div>
      {#each sections as section (section.id)}
        <div
          class="decks-ai-bp-row"
          class:is-excluded={section.excluded}
          class:is-unselected={section.unselected}
          class:is-uncovered={section.cards === 0 && !section.excluded && !section.unselected}
        >
          <span
            class="decks-ai-bp-title"
            title={section.excluded
              ? b.excludedHint
              : section.cards === 0
                ? b.noCardsHint
                : section.title}>{section.title}</span
          >
          <span class="decks-ai-bp-num decks-ai-bp-pages">
            {section.startPage}–{section.endPage}
          </span>
          <span class="decks-ai-bp-num" class:is-zero={section.cards === 0}>
            {section.cards}
          </span>
          {#if section.unselected}
            <span class="decks-ai-bp-num decks-ai-bp-dash">—</span>
          {:else if section.excluded}
            <span class="decks-ai-bp-num decks-ai-bp-dash" title={b.excludedHint}>—</span>
          {:else}
            <input
              class="decks-ai-bp-count"
              type="number"
              min="0"
              max="99"
              disabled={busy}
              value={section.questions}
              aria-label={`${b.colQuestions} · ${section.title}`}
              on:input={(ev) => setQuestions(section.id, numberOf(ev))}
            />
          {/if}
        </div>
      {/each}
    </div>

    <div class="decks-ai-bp-block">
      <div class="decks-ai-bp-block-title">{b.mixTitle}</div>
      <div class="decks-ai-bp-mix">
        <span class="decks-ai-bp-pill is-generated"
          >{I18n.format(b.mixGenerated, { count: planned })}</span
        >
        {#if mix.mcq > 0}
          <span class="decks-ai-bp-pill">{I18n.format(b.mixMcq, { count: mix.mcq })}</span>
        {/if}
        {#if mix.typeIn > 0}
          <span class="decks-ai-bp-pill"
            >{I18n.format(b.mixTypeIn, { count: mix.typeIn })}</span
          >
        {/if}
        {#if mix.cloze > 0}
          <span class="decks-ai-bp-pill"
            >{I18n.format(b.mixCloze, { count: mix.cloze })}</span
          >
        {/if}
      </div>
      <div class="decks-ai-bp-note">
        {mix.mcq + mix.typeIn + mix.cloze === 0 ? b.mixEmpty : b.mixNote}
      </div>
    </div>

    <div class="decks-ai-bp-block">
      <div class="decks-ai-bp-block-title">{b.defaultsTitle}</div>
      <label class="decks-ai-bp-field">
        <span>{e.questionCountSetting}</span>
        <input
          type="number"
          min="0"
          value={settings.questionCount}
          placeholder={String(drawable)}
          on:input={(ev) => patch({ questionCount: Math.max(0, numberOf(ev)) })}
        />
      </label>
      <label class="decks-ai-bp-field">
        <span>{e.timeLimitSetting}</span>
        <input
          type="number"
          min="0"
          value={settings.timeLimitMinutes}
          on:input={(ev) => patch({ timeLimitMinutes: Math.max(0, numberOf(ev)) })}
        />
      </label>
      <label class="decks-ai-bp-field">
        <span>{e.passScoreSetting}</span>
        <input
          type="number"
          min="0"
          max="100"
          value={settings.passScorePct}
          on:input={(ev) =>
            patch({ passScorePct: Math.min(100, Math.max(0, numberOf(ev))) })}
        />
      </label>
      <label class="decks-ai-bp-field">
        <span>{e.feedbackTimingSetting}</span>
        <select
          value={settings.feedbackTiming}
          on:change={(ev) =>
            patch({
              feedbackTiming: (ev.currentTarget as HTMLSelectElement)
                .value as ExamFeedbackTiming,
            })}
        >
          <option value="end">{e.feedbackEnd}</option>
          <option value="immediate">{e.feedbackImmediate}</option>
        </select>
      </label>
      <label class="decks-ai-bp-field">
        <span>{e.typedGradingSetting}</span>
        <select
          value={settings.typedGrading}
          on:change={(ev) =>
            patch({
              typedGrading: (ev.currentTarget as HTMLSelectElement)
                .value as TypedGradingMode,
            })}
        >
          <option value="tolerant">{e.gradingTolerant}</option>
          <option value="exact">{e.gradingExact}</option>
          <option value="self">{e.gradingSelf}</option>
          {#if meaningAvailable || settings.typedGrading === "meaning"}
            <option value="meaning">{e.gradingMeaning}</option>
          {/if}
        </select>
      </label>
      <div class="decks-ai-bp-note">{hasProfile ? b.defaultsNote : b.noProfile}</div>
      <div class="decks-ai-bp-defaults-actions">
        <button type="button" disabled={!hasProfile} on:click={onSaveDefaults}>
          {b.saveDefaults}
        </button>
        {#if savedDefaults}
          <span class="decks-ai-bp-saved">{b.savedDefaults}</span>
        {/if}
      </div>
    </div>

    <div class="decks-ai-bp-footer">
      {#if progress}
        <span class="decks-ai-bp-note">
          {I18n.format(b.running, {
            title: progress.title,
            index: progress.index,
            total: progress.total,
          })}
        </span>
      {/if}
      <button
        type="button"
        class="mod-cta"
        disabled={busy || planned === 0}
        on:click={onGenerate}
      >
        {I18n.format(b.generate, { count: planned })}
      </button>
    </div>
  {/if}
</div>

<style>
  .decks-ai-bp {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .decks-ai-bp-toolbar button {
    font-size: 11px;
    padding: 2px 8px;
  }
  .decks-ai-bp-note {
    font-size: 10px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .decks-ai-bp-table {
    display: flex;
    flex-direction: column;
  }
  .decks-ai-bp-head,
  .decks-ai-bp-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px 34px 62px;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 2px 0;
  }
  .decks-ai-bp-head > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-bp-head {
    color: var(--text-faint);
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .decks-ai-bp-row.is-unselected {
    opacity: 0.55;
  }
  /* A section nothing covers yet, as the design tints it. */
  .decks-ai-bp-row.is-uncovered {
    background: rgba(var(--callout-warning), 0.08);
  }
  .decks-ai-bp-row.is-excluded .decks-ai-bp-title {
    color: var(--text-faint);
  }
  .decks-ai-bp-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-bp-num {
    text-align: right;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .decks-ai-bp-pages {
    font-size: 10px;
  }
  /* A zero here is the gap read-out: those questions come from the source. */
  .decks-ai-bp-num.is-zero {
    color: var(--text-warning);
  }
  .decks-ai-bp-dash {
    color: var(--text-faint);
  }
  .decks-ai-bp-count {
    width: 100%;
    font-size: 11px;
    padding: 1px 4px;
    text-align: right;
  }

  .decks-ai-bp-block {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-top: 8px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-bp-block-title {
    font-size: 11px;
    font-weight: 500;
  }
  .decks-ai-bp-mix {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .decks-ai-bp-pill {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 10px;
    background: var(--background-secondary);
    color: var(--text-muted);
  }
  .decks-ai-bp-pill.is-generated {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .decks-ai-bp-field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 116px;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .decks-ai-bp-field input,
  .decks-ai-bp-field select {
    font-size: 11px;
    padding: 1px 4px;
    width: 100%;
  }
  .decks-ai-bp-defaults-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .decks-ai-bp-defaults-actions button {
    font-size: 11px;
    padding: 2px 8px;
  }
  .decks-ai-bp-saved {
    font-size: 10px;
    color: var(--text-success);
  }

  .decks-ai-bp-footer {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 8px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-bp-footer button {
    font-size: 11px;
    padding: 3px 10px;
    margin-left: auto;
  }
</style>
