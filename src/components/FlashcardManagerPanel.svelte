<script lang="ts">
  import type { Flashcard, CustomDeck } from "../database/types";
  import type { IDatabaseService } from "../database/DatabaseFactory";
  import type { CustomDeckService } from "../services/CustomDeckService";
  import { fuzzySearchFlashcards } from "../utils/fuzzy-search";
  import { onMount, onDestroy } from "svelte";

  export let db: IDatabaseService;
  export let customDeckService: CustomDeckService;
  export let onCreateCustomDeck: (name: string, flashcardIds: string[]) => Promise<void>;
  export let onAddToCustomDeck: (customDeckId: string, flashcardIds: string[]) => Promise<void>;
  export let onRemoveFromCustomDeck: ((customDeckId: string, flashcardIds: string[]) => Promise<void>) | null = null;
  export let editingCustomDeckId: string | null = null;
  export let editingCustomDeckName: string | null = null;

  type SortField = "lastReviewed" | "dueDate" | "state" | "sourceFile" | "breadcrumb";
  type SortDirection = "asc" | "desc";

  interface ActiveSort {
    field: SortField;
    direction: SortDirection;
  }

  let allFlashcards: Flashcard[] = [];
  let deckTagMap: Map<string, string> = new Map();
  let customDecks: CustomDeck[] = [];

  let searchQuery = "";
  let tagFilter = "";
  let deckFilter = "";
  let availableTags: string[] = [];
  let availableDecks: { id: string; name: string }[] = [];

  let sorts: ActiveSort[] = [{ field: "dueDate", direction: "asc" }];

  let selectedIds: Set<string> = new Set();
  let selectAll = false;

  let loading = true;
  let displayLimit = 100;

  let customDeckDropdownOpen = false;
  let newDeckName = "";
  let showNewDeckInput = false;
  let customDeckDropdownEl: HTMLDivElement | null = null;

  $: filteredFlashcards = applyFilters(allFlashcards, searchQuery, tagFilter, deckFilter);
  $: sortedFlashcards = applySorts(filteredFlashcards, sorts);
  $: displayedFlashcards = sortedFlashcards.slice(0, displayLimit);
  $: hasMore = sortedFlashcards.length > displayLimit;
  $: selectedCount = selectedIds.size;

  function applyFilters(cards: Flashcard[], query: string, tag: string, deck: string): Flashcard[] {
    let result = cards;

    if (tag) {
      const matchingDeckIds = new Set<string>();
      for (const [deckId, deckTag] of deckTagMap) {
        if (deckTag === tag) {
          matchingDeckIds.add(deckId);
        }
      }
      result = result.filter((c) => matchingDeckIds.has(c.deckId));
    }

    if (deck) {
      result = result.filter((c) => c.deckId === deck);
    }

    if (query.trim()) {
      result = fuzzySearchFlashcards(query, result, deckTagMap);
    }

    return result;
  }

  function applySorts(cards: Flashcard[], activeSorts: ActiveSort[]): Flashcard[] {
    if (activeSorts.length === 0) return cards;

    return [...cards].sort((a, b) => {
      for (const sort of activeSorts) {
        const cmp = compareByField(a, b, sort.field);
        if (cmp !== 0) {
          return sort.direction === "asc" ? cmp : -cmp;
        }
      }
      return 0;
    });
  }

  function compareByField(a: Flashcard, b: Flashcard, field: SortField): number {
    switch (field) {
      case "lastReviewed": {
        const aVal = a.lastReviewed ?? "";
        const bVal = b.lastReviewed ?? "";
        return aVal.localeCompare(bVal);
      }
      case "dueDate":
        return a.dueDate.localeCompare(b.dueDate);
      case "state": {
        const order = { new: 0, review: 1 };
        return order[a.state] - order[b.state];
      }
      case "sourceFile":
        return a.sourceFile.localeCompare(b.sourceFile);
      case "breadcrumb":
        return a.breadcrumb.localeCompare(b.breadcrumb);
      default:
        return 0;
    }
  }

  function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + "...";
  }

  function formatRelativeDate(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      const absDays = Math.abs(diffDays);
      if (absDays === 0) return "Today";
      if (absDays === 1) return "Tomorrow";
      return `In ${absDays} days`;
    }
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  }

  function getFilename(filepath: string): string {
    const parts = filepath.split("/");
    const name = parts[parts.length - 1];
    return name.replace(/\.md$/, "");
  }

  function toggleSelection(id: string) {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    selectedIds = newSet;
    selectAll = selectedIds.size === filteredFlashcards.length && filteredFlashcards.length > 0;
  }

  function toggleSelectAll() {
    if (selectAll) {
      selectedIds = new Set();
      selectAll = false;
    } else {
      selectedIds = new Set(filteredFlashcards.map((c) => c.id));
      selectAll = true;
    }
  }

  function clearSelection() {
    selectedIds = new Set();
    selectAll = false;
  }

  function addSort(field: SortField) {
    const existing = sorts.find((s) => s.field === field);
    if (existing) {
      sorts = sorts.map((s) =>
        s.field === field
          ? { ...s, direction: s.direction === "asc" ? "desc" : "asc" }
          : s
      );
    } else {
      sorts = [...sorts, { field, direction: "asc" }];
    }
  }

  function removeSort(field: SortField) {
    sorts = sorts.filter((s) => s.field !== field);
  }

  function getSortLabel(field: SortField): string {
    switch (field) {
      case "lastReviewed": return "Last reviewed";
      case "dueDate": return "Due date";
      case "state": return "State";
      case "sourceFile": return "Filename";
      case "breadcrumb": return "Breadcrumb";
    }
  }

  function loadMore() {
    displayLimit += 100;
  }

  function toggleCustomDeckDropdown() {
    customDeckDropdownOpen = !customDeckDropdownOpen;
    showNewDeckInput = false;
    newDeckName = "";
  }

  async function handleAddToExistingDeck(deckId: string) {
    const ids = Array.from(selectedIds);
    await onAddToCustomDeck(deckId, ids);
    customDeckDropdownOpen = false;
    clearSelection();
    customDecks = await customDeckService.getAllCustomDecks();
  }

  async function handleCreateNewDeck() {
    if (!newDeckName.trim()) return;
    const ids = Array.from(selectedIds);
    await onCreateCustomDeck(newDeckName.trim(), ids);
    customDeckDropdownOpen = false;
    showNewDeckInput = false;
    newDeckName = "";
    clearSelection();
    customDecks = await customDeckService.getAllCustomDecks();
  }

  function handleOutsideClick(event: MouseEvent) {
    if (customDeckDropdownEl && !customDeckDropdownEl.contains(event.target as Node)) {
      customDeckDropdownOpen = false;
    }
  }

  const isEditMode = !!editingCustomDeckId;

  async function handleRemoveFromDeck() {
    if (!editingCustomDeckId || !onRemoveFromCustomDeck) return;
    const ids = Array.from(selectedIds);
    await onRemoveFromCustomDeck(editingCustomDeckId, ids);
    allFlashcards = allFlashcards.filter((c) => !selectedIds.has(c.id));
    clearSelection();
  }

  onMount(async () => {
    try {
      const [decks, cDecks] = await Promise.all([
        db.getAllDecks(),
        customDeckService.getAllCustomDecks(),
      ]);

      customDecks = cDecks;

      const dtMap = new Map<string, string>();
      const tags = new Set<string>();
      const deckList: { id: string; name: string }[] = [];
      for (const deck of decks) {
        dtMap.set(deck.id, deck.tag);
        tags.add(deck.tag);
        deckList.push({ id: deck.id, name: deck.name });
      }
      deckTagMap = dtMap;
      availableTags = Array.from(tags).sort();
      availableDecks = deckList.sort((a, b) => a.name.localeCompare(b.name));

      if (isEditMode && editingCustomDeckId) {
        allFlashcards = await db.getFlashcardsForCustomDeck(editingCustomDeckId);
      } else {
        allFlashcards = await db.getAllFlashcards();
      }
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    document.removeEventListener("click", handleOutsideClick);
  });

  // Clean up selection when filter changes
  $: {
    if (filteredFlashcards) {
      const filteredIds = new Set(filteredFlashcards.map((c) => c.id));
      const newSelected = new Set<string>();
      for (const id of selectedIds) {
        if (filteredIds.has(id)) {
          newSelected.add(id);
        }
      }
      if (newSelected.size !== selectedIds.size) {
        selectedIds = newSelected;
        selectAll = selectedIds.size === filteredFlashcards.length && filteredFlashcards.length > 0;
      }
    }
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="decks-flashcard-manager">
  {#if loading}
    <div class="decks-fm-loading">Loading flashcards...</div>
  {:else}
    <!-- Search and filter bar -->
    <div class="decks-fm-filter-bar">
      <input
        type="text"
        class="decks-fm-search-input"
        placeholder="Search flashcards..."
        bind:value={searchQuery}
      />
      <select
        class="decks-fm-tag-select"
        bind:value={tagFilter}
      >
        <option value="">All tags</option>
        {#each availableTags as tag}
          <option value={tag}>{tag}</option>
        {/each}
      </select>
      <select
        class="decks-fm-tag-select"
        bind:value={deckFilter}
      >
        <option value="">All decks</option>
        {#each availableDecks as deck}
          <option value={deck.id}>{deck.name}</option>
        {/each}
      </select>
    </div>

    <!-- Sort controls -->
    <div class="decks-fm-sort-bar">
      <span class="decks-fm-sort-label">Sort:</span>
      {#each sorts as sort}
        <button
          class="decks-fm-sort-chip"
          on:click={() => addSort(sort.field)}
        >
          {getSortLabel(sort.field)} {sort.direction === "asc" ? "\u2191" : "\u2193"}
          <span
            class="decks-fm-chip-remove"
            role="button"
            tabindex="0"
            on:click|stopPropagation={() => removeSort(sort.field)}
            on:keydown={(e) => e.key === "Enter" && removeSort(sort.field)}
          >&times;</span>
        </button>
      {/each}
      <select
        class="decks-fm-sort-add"
        on:change={(e) => {
          const target = e.target;
          if (target instanceof HTMLSelectElement && target.value) {
            addSort(target.value as SortField);
            target.value = "";
          }
        }}
      >
        <option value="">+ Add sort</option>
        <option value="dueDate">Due date</option>
        <option value="lastReviewed">Last reviewed</option>
        <option value="state">State</option>
        <option value="sourceFile">Filename</option>
        <option value="breadcrumb">Breadcrumb</option>
      </select>
    </div>

    <!-- Action bar (when cards selected) -->
    {#if selectedCount > 0}
      <div class="decks-fm-action-bar">
        <span class="decks-fm-selected-count">{selectedCount} selected</span>
        {#if isEditMode}
          <button
            class="decks-fm-action-btn decks-fm-remove-btn"
            on:click={handleRemoveFromDeck}
          >
            Remove from deck
          </button>
        {:else}
          <div class="decks-fm-deck-dropdown-container" bind:this={customDeckDropdownEl}>
            <button
              class="decks-fm-action-btn"
              on:click={toggleCustomDeckDropdown}
            >
              Add to custom deck
            </button>
            {#if customDeckDropdownOpen}
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div class="decks-fm-deck-dropdown" on:click|stopPropagation>
                {#each customDecks as deck}
                  <button
                    class="decks-fm-dropdown-option"
                    on:click={() => handleAddToExistingDeck(deck.id)}
                  >
                    {deck.name}
                  </button>
                {/each}
                {#if !showNewDeckInput}
                  <button
                    class="decks-fm-dropdown-option decks-fm-dropdown-new"
                    on:click={() => { showNewDeckInput = true; }}
                  >
                    + Create new deck...
                  </button>
                {:else}
                  <div class="decks-fm-new-deck-input">
                    <input
                      type="text"
                      placeholder="Deck name"
                      bind:value={newDeckName}
                      on:keydown={(e) => e.key === "Enter" && handleCreateNewDeck()}
                    />
                    <button
                      class="decks-fm-create-btn"
                      on:click={handleCreateNewDeck}
                      disabled={!newDeckName.trim()}
                    >
                      Create
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
        <button
          class="decks-fm-action-btn decks-fm-deselect-btn"
          on:click={clearSelection}
        >
          Deselect all
        </button>
      </div>
    {/if}

    <!-- Table -->
    <div class="decks-fm-table-container">
      <div class="decks-fm-table">
        <div class="decks-fm-table-header">
          <div class="decks-fm-col-check">
            <input
              type="checkbox"
              checked={selectAll}
              on:change={toggleSelectAll}
            />
          </div>
          <div class="decks-fm-col-front">Front</div>
          <div class="decks-fm-col-back">Back</div>
          <div class="decks-fm-col-file">File</div>
          <div class="decks-fm-col-breadcrumb">Breadcrumb</div>
          <div class="decks-fm-col-tag">Tag</div>
          <div class="decks-fm-col-state">State</div>
          <div class="decks-fm-col-due">Due</div>
          <div class="decks-fm-col-reviewed">Reviewed</div>
        </div>

        <div class="decks-fm-table-body">
          {#each displayedFlashcards as card (card.id)}
            <div
              class="decks-fm-table-row"
              class:decks-fm-row-selected={selectedIds.has(card.id)}
              on:click={() => toggleSelection(card.id)}
            >
              <div class="decks-fm-col-check">
                <input
                  type="checkbox"
                  checked={selectedIds.has(card.id)}
                  on:click|stopPropagation
                  on:change={() => toggleSelection(card.id)}
                />
              </div>
              <div class="decks-fm-col-front" title={card.front}>
                {truncate(card.front, 50)}
              </div>
              <div class="decks-fm-col-back" title={card.back}>
                {truncate(card.back, 50)}
              </div>
              <div class="decks-fm-col-file" title={card.sourceFile}>
                {getFilename(card.sourceFile)}
              </div>
              <div class="decks-fm-col-breadcrumb" title={card.breadcrumb}>
                {truncate(card.breadcrumb, 30)}
              </div>
              <div class="decks-fm-col-tag">
                {deckTagMap.get(card.deckId) ?? ""}
              </div>
              <div class="decks-fm-col-state">
                <span class="decks-fm-state-badge decks-fm-state-{card.state}">
                  {card.state === "new" ? "New" : "Review"}
                </span>
              </div>
              <div class="decks-fm-col-due">
                {formatRelativeDate(card.dueDate)}
              </div>
              <div class="decks-fm-col-reviewed">
                {formatRelativeDate(card.lastReviewed)}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="decks-fm-footer">
      <span>
        {#if isEditMode && editingCustomDeckName}
          {#if searchQuery || tagFilter || deckFilter}
            Showing {sortedFlashcards.length} of {allFlashcards.length} cards in "{editingCustomDeckName}"
          {:else}
            {allFlashcards.length} cards in "{editingCustomDeckName}"
          {/if}
        {:else if searchQuery || tagFilter || deckFilter}
          Showing {sortedFlashcards.length} of {allFlashcards.length} flashcards
        {:else}
          {allFlashcards.length} flashcards
        {/if}
      </span>
      {#if hasMore}
        <button class="decks-fm-load-more" on:click={loadMore}>
          Load more ({sortedFlashcards.length - displayLimit} remaining)
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .decks-flashcard-manager {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 8px;
  }

  .decks-fm-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: var(--text-muted);
  }

  .decks-fm-filter-bar {
    display: flex;
    gap: 8px;
  }

  .decks-fm-search-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
  }

  .decks-fm-tag-select {
    padding: 6px 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
    min-width: 140px;
  }

  .decks-fm-sort-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .decks-fm-sort-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .decks-fm-sort-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 12px;
    background: var(--background-modifier-hover);
    border: 1px solid var(--background-modifier-border);
    color: var(--text-normal);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-fm-chip-remove {
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    opacity: 0.6;
  }

  .decks-fm-chip-remove:hover {
    opacity: 1;
  }

  .decks-fm-sort-add {
    padding: 2px 6px;
    border: 1px dashed var(--background-modifier-border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-fm-action-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--background-secondary);
    border-radius: 4px;
  }

  .decks-fm-selected-count {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-normal);
  }

  .decks-fm-action-btn {
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--interactive-normal);
    color: var(--text-normal);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-fm-action-btn:hover {
    background: var(--interactive-hover);
  }

  .decks-fm-remove-btn {
    background: var(--background-modifier-error);
    color: var(--text-on-accent);
    border-color: var(--background-modifier-error);
  }

  .decks-fm-remove-btn:hover {
    opacity: 0.9;
  }

  .decks-fm-deselect-btn {
    margin-left: auto;
  }

  .decks-fm-deck-dropdown-container {
    position: relative;
  }

  .decks-fm-deck-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    min-width: 200px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    margin-top: 4px;
  }

  .decks-fm-dropdown-option {
    display: block;
    width: 100%;
    padding: 6px 12px;
    text-align: left;
    border: none;
    background: transparent;
    color: var(--text-normal);
    font-size: 13px;
    cursor: pointer;
  }

  .decks-fm-dropdown-option:hover {
    background: var(--background-modifier-hover);
  }

  .decks-fm-dropdown-new {
    border-top: 1px solid var(--background-modifier-border);
    color: var(--text-accent);
  }

  .decks-fm-new-deck-input {
    display: flex;
    gap: 4px;
    padding: 6px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .decks-fm-new-deck-input input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    font-size: 12px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .decks-fm-create-btn {
    padding: 4px 8px;
    border-radius: 4px;
    border: none;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-fm-create-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-fm-table-container {
    flex: 1;
    overflow: auto;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
  }

  .decks-fm-table {
    width: 100%;
    min-width: 800px;
  }

  .decks-fm-table-header {
    display: grid;
    grid-template-columns: 36px 1fr 1fr 120px 120px 100px 70px 80px 80px;
    gap: 4px;
    padding: 6px 8px;
    background: var(--background-secondary);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    position: sticky;
    top: 0;
    z-index: 1;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-fm-table-row {
    display: grid;
    grid-template-columns: 36px 1fr 1fr 120px 120px 100px 70px 80px 80px;
    gap: 4px;
    padding: 4px 8px;
    font-size: 12px;
    color: var(--text-normal);
    cursor: pointer;
    border-bottom: 1px solid var(--background-modifier-border-hover);
  }

  .decks-fm-table-row:hover {
    background: var(--background-modifier-hover);
  }

  .decks-fm-row-selected {
    background: var(--background-modifier-active-hover);
  }

  .decks-fm-col-check {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .decks-fm-col-front,
  .decks-fm-col-back,
  .decks-fm-col-file,
  .decks-fm-col-breadcrumb,
  .decks-fm-col-tag {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
  }

  .decks-fm-col-state,
  .decks-fm-col-due,
  .decks-fm-col-reviewed {
    display: flex;
    align-items: center;
    font-size: 11px;
  }

  .decks-fm-state-badge {
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .decks-fm-state-new {
    background: var(--color-blue);
    color: var(--text-on-accent);
  }

  .decks-fm-state-review {
    background: var(--color-green);
    color: var(--text-on-accent);
  }

  .decks-fm-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-muted);
    padding: 4px 0;
  }

  .decks-fm-load-more {
    padding: 4px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-accent);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-fm-load-more:hover {
    background: var(--background-modifier-hover);
  }
</style>
