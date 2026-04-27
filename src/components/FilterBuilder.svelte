<script lang="ts">
  import type { FilterDefinition, FilterRule, FilterField, FilterOperator, FilterLogic } from "../database/types";

  export let filterDefinition: FilterDefinition;
  export let onChange: (def: FilterDefinition) => void;
  export let previewCount: number | null = null;
  export let availableDecks: { id: string; name: string }[] = [];
  export let availableTags: string[] = [];

  interface FieldOption {
    value: FilterField;
    label: string;
    type: "string" | "numeric" | "date" | "state" | "deckId" | "deckTag";
  }

  const FIELD_OPTIONS: FieldOption[] = [
    { value: "state", label: "Card state", type: "state" },
    { value: "dueDate", label: "Due date", type: "date" },
    { value: "deckId", label: "Deck", type: "deckId" },
    { value: "deckTag", label: "Deck tag", type: "deckTag" },
    { value: "sourceFile", label: "Source file", type: "string" },
    { value: "breadcrumb", label: "Breadcrumb", type: "string" },
    { value: "type", label: "Card type", type: "string" },
    { value: "difficulty", label: "Difficulty", type: "numeric" },
    { value: "stability", label: "Stability", type: "numeric" },
    { value: "interval", label: "Interval (min)", type: "numeric" },
    { value: "repetitions", label: "Repetitions", type: "numeric" },
    { value: "lapses", label: "Lapses", type: "numeric" },
    { value: "lastReviewed", label: "Last reviewed", type: "date" },
    { value: "created", label: "Created", type: "date" },
  ];

  function getOperatorsForField(field: FilterField): { value: FilterOperator; label: string }[] {
    const fieldOption = FIELD_OPTIONS.find(f => f.value === field);
    if (!fieldOption) return [];

    switch (fieldOption.type) {
      case "state":
        return [
          { value: "is_new", label: "Is new" },
          { value: "is_due", label: "Is due" },
          { value: "equals", label: "Equals" },
          { value: "not_equals", label: "Not equals" },
        ];
      case "date":
        return [
          { value: "is_due", label: "Is due" },
          { value: "before", label: "Before" },
          { value: "after", label: "After" },
        ];
      case "numeric":
        return [
          { value: "equals", label: "Equals" },
          { value: "not_equals", label: "Not equals" },
          { value: "greater_than", label: "Greater than" },
          { value: "less_than", label: "Less than" },
        ];
      case "deckId":
        return [
          { value: "in", label: "Is one of" },
          { value: "equals", label: "Equals" },
        ];
      case "deckTag":
        return [
          { value: "contains", label: "Contains" },
          { value: "equals", label: "Equals" },
          { value: "not_contains", label: "Does not contain" },
        ];
      case "string":
      default:
        return [
          { value: "contains", label: "Contains" },
          { value: "not_contains", label: "Does not contain" },
          { value: "equals", label: "Equals" },
          { value: "not_equals", label: "Not equals" },
        ];
    }
  }

  function needsValue(operator: FilterOperator): boolean {
    return operator !== "is_new" && operator !== "is_due";
  }

  function emitChange() {
    onChange(filterDefinition);
  }

  function addRule() {
    filterDefinition = {
      ...filterDefinition,
      rules: [...filterDefinition.rules, { field: "state", operator: "is_new", value: "" }],
    };
    emitChange();
  }

  function removeRule(index: number) {
    filterDefinition = {
      ...filterDefinition,
      rules: filterDefinition.rules.filter((_, i) => i !== index),
    };
    emitChange();
  }

  function updateRule(index: number, updates: Partial<FilterRule>) {
    const newRules = [...filterDefinition.rules];
    const current = newRules[index];
    const updated = { ...current, ...updates };

    // Reset operator if field type changed
    if (updates.field && updates.field !== current.field) {
      const operators = getOperatorsForField(updates.field);
      if (operators.length > 0) {
        updated.operator = operators[0].value;
        updated.value = "";
      }
    }

    // Clear value for valueless operators
    if (updates.operator && !needsValue(updates.operator)) {
      updated.value = "";
    }

    newRules[index] = updated;
    filterDefinition = { ...filterDefinition, rules: newRules };
    emitChange();
  }

  function setLogic(logic: FilterLogic) {
    filterDefinition = { ...filterDefinition, logic };
    emitChange();
  }

  // Build a comma-separated value for "in" operator from selected deck IDs
  function getSelectedDeckIds(value: string): Set<string> {
    if (!value) return new Set();
    return new Set(value.split(",").map(v => v.trim()).filter(v => v.length > 0));
  }

  function toggleDeckId(index: number, deckId: string) {
    const rule = filterDefinition.rules[index];
    const selected = getSelectedDeckIds(rule.value);
    if (selected.has(deckId)) {
      selected.delete(deckId);
    } else {
      selected.add(deckId);
    }
    updateRule(index, { value: Array.from(selected).join(",") });
  }
</script>

<div class="decks-fb">
  <!-- Logic toggle -->
  {#if filterDefinition.rules.length > 1}
    <div class="decks-fb-logic">
      <span class="decks-fb-logic-label">Match</span>
      <button
        class="decks-fb-logic-btn"
        class:decks-fb-logic-active={filterDefinition.logic === "AND"}
        on:click={() => setLogic("AND")}
      >All</button>
      <button
        class="decks-fb-logic-btn"
        class:decks-fb-logic-active={filterDefinition.logic === "OR"}
        on:click={() => setLogic("OR")}
      >Any</button>
      <span class="decks-fb-logic-label">of the following rules</span>
    </div>
  {/if}

  <!-- Rules -->
  <div class="decks-fb-rules">
    {#each filterDefinition.rules as rule, index (index)}
      <div class="decks-fb-rule">
        <select
          class="decks-fb-field-select"
          value={rule.field}
          on:change={(e) => {
            const target = e.target;
            if (target instanceof HTMLSelectElement) {
              updateRule(index, { field: target.value as FilterField });
            }
          }}
        >
          {#each FIELD_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>

        <select
          class="decks-fb-op-select"
          value={rule.operator}
          on:change={(e) => {
            const target = e.target;
            if (target instanceof HTMLSelectElement) {
              updateRule(index, { operator: target.value as FilterOperator });
            }
          }}
        >
          {#each getOperatorsForField(rule.field) as op}
            <option value={op.value}>{op.label}</option>
          {/each}
        </select>

        {#if needsValue(rule.operator)}
          {#if rule.field === "deckId" && rule.operator === "in"}
            <div class="decks-fb-deck-checklist">
              {#each availableDecks as deck}
                <label class="decks-fb-deck-check-item">
                  <input
                    type="checkbox"
                    checked={getSelectedDeckIds(rule.value).has(deck.id)}
                    on:change={() => toggleDeckId(index, deck.id)}
                  />
                  <span>{deck.name}</span>
                </label>
              {/each}
            </div>
          {:else if rule.field === "deckTag"}
            <select
              class="decks-fb-value-select"
              value={rule.value}
              on:change={(e) => {
                const target = e.target;
                if (target instanceof HTMLSelectElement) {
                  updateRule(index, { value: target.value });
                }
              }}
            >
              <option value="">Select tag...</option>
              {#each availableTags as tag}
                <option value={tag}>{tag}</option>
              {/each}
            </select>
          {:else if rule.field === "state"}
            <select
              class="decks-fb-value-select"
              value={rule.value}
              on:change={(e) => {
                const target = e.target;
                if (target instanceof HTMLSelectElement) {
                  updateRule(index, { value: target.value });
                }
              }}
            >
              <option value="new">New</option>
              <option value="review">Review</option>
            </select>
          {:else if rule.field === "type"}
            <select
              class="decks-fb-value-select"
              value={rule.value}
              on:change={(e) => {
                const target = e.target;
                if (target instanceof HTMLSelectElement) {
                  updateRule(index, { value: target.value });
                }
              }}
            >
              <option value="header-paragraph">Header paragraph</option>
              <option value="table">Table</option>
              <option value="cloze">Cloze</option>
              <option value="image-occlusion">Image occlusion</option>
            </select>
          {:else}
            <input
              class="decks-fb-value-input"
              type={FIELD_OPTIONS.find(f => f.value === rule.field)?.type === "numeric" ? "number" : "text"}
              value={rule.value}
              placeholder="Value..."
              on:input={(e) => {
                const target = e.target;
                if (target instanceof HTMLInputElement) {
                  updateRule(index, { value: target.value });
                }
              }}
            />
          {/if}
        {/if}

        <button
          class="decks-fb-remove-btn"
          on:click={() => removeRule(index)}
          title="Remove rule"
        >&times;</button>
      </div>
    {/each}
  </div>

  <div class="decks-fb-footer">
    <button class="decks-fb-add-btn" on:click={addRule}>
      + Add rule
    </button>
    {#if previewCount !== null}
      <span class="decks-fb-preview">
        {previewCount} card{previewCount !== 1 ? "s" : ""} match
      </span>
    {/if}
  </div>
</div>

<style>
  .decks-fb {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .decks-fb-logic {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .decks-fb-logic-btn {
    padding: 2px 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-fb-logic-active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  .decks-fb-logic-label {
    font-size: 12px;
  }

  .decks-fb-rules {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .decks-fb-rule {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px;
    background: var(--background-secondary);
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
  }

  .decks-fb-field-select,
  .decks-fb-op-select,
  .decks-fb-value-select {
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 12px;
    min-width: 100px;
  }

  .decks-fb-value-input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 12px;
    min-width: 80px;
  }

  .decks-fb-deck-checklist {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 120px;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    flex: 1;
  }

  .decks-fb-deck-check-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-normal);
    cursor: pointer;
  }

  .decks-fb-remove-btn {
    padding: 2px 6px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
  }

  .decks-fb-remove-btn:hover {
    color: var(--text-error);
  }

  .decks-fb-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .decks-fb-add-btn {
    padding: 4px 12px;
    border: 1px dashed var(--background-modifier-border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-accent);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-fb-add-btn:hover {
    background: var(--background-modifier-hover);
  }

  .decks-fb-preview {
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
