<script lang="ts">
  import type { Flashcard } from "../database/types";
  import type { RefactorProposal, RefactorResult } from "@decks/core";
  import { wordDiff } from "../utils/word-diff";
  import { I18n } from "@decks/core";

  export let cards: Flashcard[];
  export let run: (card: Flashcard) => Promise<RefactorResult>;
  export let apply: (
    card: Flashcard,
    accepted: RefactorProposal[],
  ) => Promise<{ ok: boolean; error?: string }>;
  export let onClose: () => void;

  const b = I18n.t.modals.aiBatch;

  type Status = "pending" | "running" | "done" | "empty" | "error";
  interface CardState {
    card: Flashcard;
    status: Status;
    proposals: RefactorProposal[];
    error?: string;
  }

  let states: CardState[] = cards.map((card) => ({
    card,
    status: "pending",
    proposals: [],
  }));
  let phase: "running" | "review" | "applying" | "summary" = "running";
  let processed = 0;
  let accepted = new Set<string>();
  let applyResult = { applied: 0, skipped: 0, failed: 0 };
  let cancelled = false;

  const keyOf = (cardId: string, propKey: string) => `${cardId}::${propKey}`;

  function cardTitle(card: Flashcard): string {
    const front = card.front?.trim();
    if (front) return front.length > 80 ? `${front.slice(0, 80)}…` : front;
    return card.id;
  }

  function fieldLabel(key: string): string {
    return I18n.format(b.suggestionFor, { field: key });
  }

  function toggle(cardId: string, propKey: string) {
    const k = keyOf(cardId, propKey);
    const next = new Set(accepted);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    accepted = next;
  }

  async function processAll() {
    phase = "running";
    for (let i = 0; i < states.length; i++) {
      if (cancelled) break;
      states[i].status = "running";
      states = [...states];
      try {
        const res = await run(states[i].card);
        states[i].proposals = res.proposals;
        states[i].status = res.proposals.length > 0 ? "done" : "empty";
        const next = new Set(accepted);
        for (const p of res.proposals) {
          next.add(keyOf(states[i].card.id, p.key));
        }
        accepted = next;
      } catch (e) {
        states[i].status = "error";
        states[i].error = e instanceof Error ? e.message : String(e);
      }
      processed = i + 1;
      states = [...states];
    }
    phase = "review";
  }

  async function applyAll() {
    phase = "applying";
    let applied = 0;
    let skipped = 0;
    let failed = 0;
    for (const st of states) {
      if (st.status !== "done") {
        skipped++;
        continue;
      }
      const acc = st.proposals.filter((p) =>
        accepted.has(keyOf(st.card.id, p.key)),
      );
      if (acc.length === 0) {
        skipped++;
        continue;
      }
      const r = await apply(st.card, acc);
      if (r.ok) {
        applied++;
      } else {
        failed++;
        st.status = "error";
        st.error = r.error;
        states = [...states];
      }
    }
    applyResult = { applied, skipped, failed };
    phase = "summary";
  }

  function cancelRun() {
    cancelled = true;
    phase = "review";
  }

  $: changedCount = states.filter((s) => s.status === "done").length;
  $: acceptedCount = accepted.size;

  void processAll();
</script>

<div class="decks-ai-batch">
  <div class="decks-ai-batch-header">
    <h3>{b.title}</h3>
    <div class="decks-ai-batch-sub">
      {I18n.format(b.intro, { count: cards.length })}
    </div>
  </div>

  {#if phase === "running"}
    <div class="decks-ai-batch-progress">
      <div class="decks-ai-batch-progress-text">
        {I18n.format(b.processing, { current: processed, total: cards.length })}
      </div>
      <div class="decks-ai-batch-bar">
        <div
          class="decks-ai-batch-bar-fill"
          style="width: {(processed / cards.length) * 100}%"
        ></div>
      </div>
    </div>
  {/if}

  <div class="decks-ai-batch-list">
    {#each states as st (st.card.id)}
      <div class="decks-ai-batch-card">
        <div class="decks-ai-batch-card-head">
          <span class="decks-ai-batch-card-title">{cardTitle(st.card)}</span>
          <span class="decks-ai-batch-card-status decks-ai-batch-status-{st.status}">
            {#if st.status === "running"}{b.waiting}
            {:else if st.status === "empty"}{b.noProposals}
            {:else if st.status === "error"}{st.error ?? b.failed}
            {:else if st.status === "done"}{st.proposals.length}
            {/if}
          </span>
        </div>
        {#if st.status === "done"}
          {#each st.proposals as p (p.key)}
            {@const ops = wordDiff(p.before, p.after)}
            <label class="decks-ai-batch-field">
              <input
                type="checkbox"
                checked={accepted.has(keyOf(st.card.id, p.key))}
                on:change={() => toggle(st.card.id, p.key)}
                disabled={phase !== "review"}
              />
              <span class="decks-ai-batch-field-body">
                <span class="decks-ai-batch-field-label">{fieldLabel(p.key)}</span>
                <span class="decks-ai-batch-diff"
                  >{#each ops as op}<span class="decks-ai-diff-{op.type}">{op.text}</span>{/each}</span
                >
              </span>
            </label>
          {/each}
        {/if}
      </div>
    {/each}
  </div>

  <div class="decks-ai-batch-footer">
    {#if phase === "running"}
      <button type="button" on:click={cancelRun}>{b.cancel}</button>
    {:else if phase === "review"}
      <span class="decks-ai-batch-footer-info">
        {acceptedCount} · {changedCount}
      </span>
      <span class="decks-ai-batch-footer-spacer"></span>
      <button type="button" on:click={onClose}>{b.cancel}</button>
      <button
        type="button"
        class="mod-cta"
        on:click={applyAll}
        disabled={acceptedCount === 0}
      >
        {b.accept}
      </button>
    {:else if phase === "applying"}
      <span class="decks-ai-batch-footer-info">{b.processing}</span>
    {:else if phase === "summary"}
      <span class="decks-ai-batch-footer-info">
        {I18n.format(b.summary, {
          applied: applyResult.applied,
          skipped: applyResult.skipped,
          failed: applyResult.failed,
        })}
      </span>
      <span class="decks-ai-batch-footer-spacer"></span>
      <button type="button" class="mod-cta" on:click={onClose}>{b.close}</button>
    {/if}
  </div>
</div>

<style>
  .decks-ai-batch {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-height: 0;
    padding: 16px 20px;
    box-sizing: border-box;
  }
  .decks-ai-batch-header {
    flex: 0 0 auto;
    padding-bottom: 10px;
  }
  .decks-ai-batch-header h3 {
    margin: 0 0 4px 0;
  }
  .decks-ai-batch-sub {
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-ai-batch-progress {
    flex: 0 0 auto;
    padding: 6px 0 12px;
  }
  .decks-ai-batch-progress-text {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .decks-ai-batch-bar {
    height: 6px;
    background: var(--background-modifier-border);
    border-radius: 3px;
    overflow: hidden;
  }
  .decks-ai-batch-bar-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.2s ease;
  }
  .decks-ai-batch-list {
    flex: 1 1 auto;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 0;
  }
  .decks-ai-batch-card {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    padding: 8px 10px;
    background: var(--background-secondary);
  }
  .decks-ai-batch-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .decks-ai-batch-card-title {
    font-weight: 600;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .decks-ai-batch-card-status {
    font-size: 11px;
    color: var(--text-muted);
    flex: 0 0 auto;
  }
  .decks-ai-batch-status-error {
    color: var(--text-error);
  }
  .decks-ai-batch-field {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 4px 0;
    cursor: pointer;
  }
  .decks-ai-batch-field-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .decks-ai-batch-field-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-accent);
  }
  .decks-ai-batch-diff {
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .decks-ai-diff-equal {
    color: var(--text-normal);
  }
  .decks-ai-diff-add {
    background: var(--background-modifier-success);
    color: var(--text-normal);
    border-radius: 2px;
  }
  .decks-ai-diff-remove {
    background: var(--background-modifier-error);
    color: var(--text-muted);
    text-decoration: line-through;
    border-radius: 2px;
  }
  .decks-ai-batch-footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
  }
  .decks-ai-batch-footer-info {
    font-size: 12px;
    color: var(--text-muted);
  }
  .decks-ai-batch-footer-spacer {
    flex: 1 1 auto;
  }
</style>
