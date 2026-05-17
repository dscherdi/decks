<script lang="ts">
  import type {
    Flashcard,
    CustomDeck,
    FilterDefinition,
    FilterRule,
  } from "../database/types";
  import type { IDatabaseService } from "../database/DatabaseFactory";
  import type { CustomDeckService } from "../services/CustomDeckService";
  import { evaluateFilter } from "../services/FilterEvaluator";
  import { computeCardHealth } from "../services/CardHealth";
  import { formatBadgeParts } from "../services/FilterBadgeFormatter";
  import type { EditTarget, EditCommitPayload } from "./FlashcardManagerEditTypes";
  import FilterBuilder from "./FilterBuilder.svelte";
  import { onMount, onDestroy } from "svelte";
  import { prepareFuzzySearch } from "obsidian";

  export let db: IDatabaseService;
  export let customDeckService: CustomDeckService;
  export let onCreateCustomDeck: (name: string, flashcardIds: string[]) => Promise<void>;
  export let onAddToCustomDeck: (customDeckId: string, flashcardIds: string[]) => Promise<void>;
  export let onCreateFilterDeck: ((name: string, definition: FilterDefinition) => Promise<void>) | null = null;
  export let onCommitEdit:
    | ((target: EditTarget, payload: EditCommitPayload) => Promise<void>)
    | null = null;
  export let initialEditTarget: EditTarget | null = null;
  export let leechThreshold = 8;
  export let denseCardCharThreshold = 500;

  type SortColumn =
    | "front"
    | "back"
    | "sourceFile"
    | "breadcrumb"
    | "deckTag"
    | "state"
    | "health"
    | "dueDate"
    | "lastReviewed";
  type SortDirection = "asc" | "desc";

  let allFlashcards: Flashcard[] = [];
  let deckTagMap: Map<string, string> = new Map();
  let customDecks: CustomDeck[] = [];

  let availableTags: string[] = [];
  let availableCardTags: string[] = [];
  let availableDecks: { id: string; name: string }[] = [];

  let editTarget: EditTarget | null = initialEditTarget;
  let originalDeckCards: Set<string> | null = null;
  let editTargetSelectId: string = initialEditTarget?.id ?? "";

  let filterDefinition: FilterDefinition =
    initialEditTarget?.kind === "filter"
      ? initialEditTarget.filterDefinition
      : { version: 1, logic: "AND", rules: [] };

  let searchQuery = "";
  let filterPopoverOpen = false;
  let filterPopoverContainer: HTMLDivElement | null = null;

  let sortColumn: SortColumn = "dueDate";
  let sortDirection: SortDirection = "asc";

  let selectedIds: Set<string> = new Set();
  let selectAll = false;

  let loading = true;
  let displayLimit = 100;

  let customDeckDropdownOpen = false;
  let newDeckName = "";
  let showNewDeckInput = false;
  let customDeckDropdownEl: HTMLDivElement | null = null;

  let saveAsDeckMode: "filter" | null = null;
  let saveAsDeckName = "";

  $: thresholds = { leechThreshold, denseCardCharThreshold };
  $: ruleFilteredFlashcards = filterByRules(
    allFlashcards,
    filterDefinition,
    deckTagMap,
    thresholds
  );
  $: searchedFlashcards = applySearchRanking(ruleFilteredFlashcards, searchQuery);
  $: sortedFlashcards = searchQuery.trim()
    ? searchedFlashcards
    : sortCards(searchedFlashcards, sortColumn, sortDirection, originalDeckCards);
  $: displayedFlashcards = sortedFlashcards.slice(0, displayLimit);
  $: hasMore = sortedFlashcards.length > displayLimit;
  $: selectedCount = selectedIds.size;
  $: hasFilter = filterDefinition.rules.length > 0;
  $: hasSearch = searchQuery.trim().length > 0;
  $: filterRowVisible = hasFilter || hasSearch;

  // Cancel save-as if rules cleared mid-flight.
  $: if (saveAsDeckMode === "filter" && !hasFilter) {
    saveAsDeckMode = null;
    saveAsDeckName = "";
  }

  function filterByRules(
    cards: Flashcard[],
    def: FilterDefinition,
    tagMap: Map<string, string>,
    th: { leechThreshold: number; denseCardCharThreshold: number }
  ): Flashcard[] {
    if (def.rules.length === 0) return cards;
    return cards.filter((c) =>
      evaluateFilter(c, def, { deckTagMap: tagMap, thresholds: th })
    );
  }

  type FuzzyMatcher = ReturnType<typeof prepareFuzzySearch>;

  function applySearchRanking(cards: Flashcard[], query: string): Flashcard[] {
    const q = query.trim();
    if (!q) return cards;
    const search = prepareFuzzySearch(q);
    const ranked: { card: Flashcard; tier: number; score: number }[] = [];
    for (const c of cards) {
      const r = computeSearchRank(c, search);
      if (r) ranked.push({ card: c, tier: r.tier, score: r.score });
    }
    ranked.sort((a, b) => a.tier - b.tier || b.score - a.score);
    return ranked.map((r) => r.card);
  }

  // Priority order: filename -> breadcrumb -> front -> back. First field that
  // matches sets the tier; the actual fuzzy score is the tiebreaker within a tier.
  function computeSearchRank(
    card: Flashcard,
    search: FuzzyMatcher
  ): { tier: number; score: number } | null {
    const fields: string[] = [
      getFilename(card.sourceFile),
      card.breadcrumb,
      card.front,
      card.back,
    ];
    for (let i = 0; i < fields.length; i++) {
      const value = fields[i];
      if (!value) continue;
      const result = search(value);
      if (result) return { tier: i, score: result.score };
    }
    return null;
  }

  function healthRank(card: Flashcard): number {
    const h = computeCardHealth(card, thresholds);
    if (h.isLeech && h.isDense) return 3;
    if (h.isLeech) return 2;
    if (h.isDense) return 1;
    return 0;
  }

  function sortCards(
    cards: Flashcard[],
    column: SortColumn,
    direction: SortDirection,
    pinnedIds: Set<string> | null = null,
  ): Flashcard[] {
    const sorted = [...cards].sort((a, b) => compareByColumn(a, b, column));
    const ordered = direction === "asc" ? sorted : sorted.reverse();
    if (!pinnedIds || pinnedIds.size === 0) return ordered;
    const pinned: Flashcard[] = [];
    const rest: Flashcard[] = [];
    for (const c of ordered) {
      (pinnedIds.has(c.id) ? pinned : rest).push(c);
    }
    return [...pinned, ...rest];
  }

  function compareByColumn(a: Flashcard, b: Flashcard, column: SortColumn): number {
    switch (column) {
      case "front":
        return a.front.localeCompare(b.front);
      case "back":
        return a.back.localeCompare(b.back);
      case "sourceFile":
        return a.sourceFile.localeCompare(b.sourceFile);
      case "breadcrumb":
        return a.breadcrumb.localeCompare(b.breadcrumb);
      case "deckTag": {
        const ta = deckTagMap.get(a.deckId) ?? "";
        const tb = deckTagMap.get(b.deckId) ?? "";
        return ta.localeCompare(tb);
      }
      case "state": {
        const order = { new: 0, review: 1 } as const;
        return order[a.state] - order[b.state];
      }
      case "health":
        return healthRank(a) - healthRank(b);
      case "dueDate":
        return a.dueDate.localeCompare(b.dueDate);
      case "lastReviewed": {
        const aVal = a.lastReviewed ?? "";
        const bVal = b.lastReviewed ?? "";
        return aVal.localeCompare(bVal);
      }
      default:
        return 0;
    }
  }

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortColumn = column;
      sortDirection = "asc";
    }
  }

  function sortGlyph(column: SortColumn): string {
    if (sortColumn !== column) return "";
    return sortDirection === "asc" ? "▲" : "▼";
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
    selectAll = selectedIds.size === sortedFlashcards.length && sortedFlashcards.length > 0;
  }

  function toggleSelectAll() {
    if (selectAll) {
      selectedIds = new Set();
      selectAll = false;
    } else {
      selectedIds = new Set(sortedFlashcards.map((c) => c.id));
      selectAll = true;
    }
  }

  function clearSelection() {
    selectedIds = new Set();
    selectAll = false;
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

  $: isEditMode = !!editTarget;
  $: editingCustomDeckName = editTarget?.name ?? null;

  async function handleEditTargetChange(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const id = target.value;
    await applyEditTargetById(id);
  }

  async function applyEditTargetById(id: string) {
    editTargetSelectId = id;
    if (!id) {
      editTarget = null;
      originalDeckCards = null;
      selectedIds = new Set();
      selectAll = false;
      filterDefinition = { version: 1, logic: "AND", rules: [] };
      return;
    }
    const deck = customDecks.find((d) => d.id === id);
    if (!deck) return;
    if (deck.deckType === "filter") {
      const def: FilterDefinition = deck.filterDefinition
        ? JSON.parse(deck.filterDefinition)
        : { version: 1, logic: "AND", rules: [] };
      editTarget = { kind: "filter", id: deck.id, name: deck.name, filterDefinition: def };
      filterDefinition = def;
      originalDeckCards = null;
      selectedIds = new Set();
      selectAll = false;
    } else {
      const cardIds = await db.getFlashcardIdsForCustomDeck(deck.id);
      editTarget = { kind: "manual", id: deck.id, name: deck.name };
      originalDeckCards = new Set(cardIds);
      selectedIds = new Set(cardIds);
      selectAll = false;
      filterDefinition = { version: 1, logic: "AND", rules: [] };
    }
  }

  function cancelEdit() {
    void applyEditTargetById("");
  }

  async function saveEdit() {
    if (!editTarget || !onCommitEdit) return;
    let payload: EditCommitPayload;
    if (editTarget.kind === "filter") {
      payload = { kind: "filter", definition: filterDefinition };
    } else {
      const original = originalDeckCards ?? new Set<string>();
      const toAdd: string[] = [];
      const toRemove: string[] = [];
      for (const id of selectedIds) if (!original.has(id)) toAdd.push(id);
      for (const id of original) if (!selectedIds.has(id)) toRemove.push(id);
      payload = { kind: "manual", toAdd, toRemove };
    }
    await onCommitEdit(editTarget, payload);
  }

  function startSaveAs() {
    saveAsDeckMode = "filter";
    saveAsDeckName = "";
  }

  function cancelSaveAs() {
    saveAsDeckMode = null;
    saveAsDeckName = "";
  }

  async function confirmSaveAs() {
    const name = saveAsDeckName.trim();
    if (!name || !onCreateFilterDeck || !hasFilter) return;
    await onCreateFilterDeck(name, filterDefinition);
    saveAsDeckMode = null;
    saveAsDeckName = "";
    customDecks = await customDeckService.getAllCustomDecks();
  }

  function removeRule(index: number) {
    filterDefinition = {
      ...filterDefinition,
      rules: filterDefinition.rules.filter((_, i) => i !== index),
    };
  }

  function clearSearch() {
    searchQuery = "";
  }

  function toggleFilterPopover() {
    filterPopoverOpen = !filterPopoverOpen;
  }

  function handleDocClickPopover(event: MouseEvent) {
    if (!filterPopoverOpen) return;
    if (
      filterPopoverContainer &&
      !filterPopoverContainer.contains(event.target as Node)
    ) {
      filterPopoverOpen = false;
    }
  }

  function badgeParts(rule: FilterRule) {
    return formatBadgeParts(rule, availableDecks);
  }

  onMount(async () => {
    document.addEventListener("click", handleDocClickPopover);
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

      allFlashcards = await db.getAllFlashcards();
      if (initialEditTarget?.kind === "manual") {
        const cardIds = await db.getFlashcardIdsForCustomDeck(initialEditTarget.id);
        originalDeckCards = new Set(cardIds);
        selectedIds = new Set(cardIds);
      }
      const cardTagSet = new Set<string>();
      for (const c of allFlashcards) {
        for (const t of c.tags) cardTagSet.add(t);
      }
      availableCardTags = Array.from(cardTagSet).sort();
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    document.removeEventListener("click", handleOutsideClick);
    document.removeEventListener("click", handleDocClickPopover);
  });

  // Clean up selection when filter or search changes
  $: {
    if (sortedFlashcards) {
      const visibleIds = new Set(sortedFlashcards.map((c) => c.id));
      const newSelected = new Set<string>();
      for (const id of selectedIds) {
        if (visibleIds.has(id)) {
          newSelected.add(id);
        }
      }
      if (newSelected.size !== selectedIds.size) {
        selectedIds = newSelected;
        selectAll =
          selectedIds.size === sortedFlashcards.length &&
          sortedFlashcards.length > 0;
      }
    }
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="decks-flashcard-manager">
  {#if loading}
    <div class="decks-fm-loading">Loading flashcards...</div>
  {:else}
    <!-- Edit target row: dropdown to pick a custom deck to edit -->
    {#if customDecks.length > 0 || isEditMode}
      <div class="decks-edit-target-row">
        <label class="decks-edit-target-label" for="decks-edit-target-select">Edit:</label>
        <select
          id="decks-edit-target-select"
          class="decks-edit-target-select"
          value={editTargetSelectId}
          on:change={handleEditTargetChange}
        >
          <option value="">— Browse all flashcards —</option>
          {#each customDecks as deck (deck.id)}
            <option value={deck.id}>
              {deck.deckType === "filter" ? "🔍" : "📁"} {deck.name}
            </option>
          {/each}
        </select>
        {#if isEditMode}
          <button
            class="decks-edit-save-btn"
            disabled={!onCommitEdit}
            on:click={saveEdit}
            title="Save changes to {editingCustomDeckName ?? 'this deck'}"
          >Save</button>
          <button
            class="decks-edit-cancel-btn"
            on:click={cancelEdit}
            title="Discard edit and return to browse mode"
          >Cancel</button>
        {/if}
      </div>
    {/if}

    <!-- Control bar: search + filter button -->
    <div class="decks-control-bar">
      <div class="decks-control-search-wrap">
        <span class="decks-control-search-icon" aria-hidden="true">🔍</span>
        <input
          type="text"
          class="decks-control-search"
          placeholder="Search filename, breadcrumb, front, back..."
          bind:value={searchQuery}
        />
        {#if hasSearch}
          <button
            class="decks-control-search-clear"
            on:click={clearSearch}
            title="Clear search"
            aria-label="Clear search"
          >×</button>
        {/if}
      </div>
      <div class="decks-filter-popover-container" bind:this={filterPopoverContainer}>
        <button
          class="decks-control-filter-btn"
          class:decks-control-filter-btn-active={hasFilter || filterPopoverOpen}
          on:click|stopPropagation={toggleFilterPopover}
          aria-expanded={filterPopoverOpen}
        >
          + Filter{hasFilter ? ` (${filterDefinition.rules.length})` : ""}
        </button>
        {#if filterPopoverOpen}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="decks-filter-popover" on:click|stopPropagation>
            <FilterBuilder
              filterDefinition={filterDefinition}
              availableDecks={availableDecks}
              availableTags={availableTags}
              availableCardTags={availableCardTags}
              previewCount={ruleFilteredFlashcards.length}
              onChange={(def) => { filterDefinition = def; }}
            />
          </div>
        {/if}
      </div>
    </div>

    <!-- Active filters row: badges + save as filter deck -->
    {#if filterRowVisible}
      <div class="decks-active-filters-row">
        <div class="decks-active-filters-badges">
          {#each filterDefinition.rules as rule, i (i)}
            {@const parts = badgeParts(rule)}
            <span class="decks-badge">
              {#if parts.key}
                <span class="decks-badge-key">{parts.key}:</span>
              {/if}
              <span class="decks-badge-value">{parts.value}</span>
              <button
                class="decks-badge-close"
                on:click={() => removeRule(i)}
                aria-label="Remove filter"
              >×</button>
            </span>
          {/each}
          {#if !hasFilter && hasSearch}
            <span class="decks-active-filters-hint">Search-only view (saving is disabled)</span>
          {/if}
        </div>
        {#if !isEditMode}
          <div class="decks-save-action">
            {#if saveAsDeckMode === "filter"}
              <input
                type="text"
                class="decks-save-name-input"
                placeholder="Filter deck name"
                bind:value={saveAsDeckName}
                on:keydown={(e) => { if (e.key === "Enter") confirmSaveAs(); if (e.key === "Escape") cancelSaveAs(); }}
              />
              <button
                class="decks-save-confirm-btn"
                disabled={!saveAsDeckName.trim()}
                on:click={confirmSaveAs}
              >Save</button>
              <button
                class="decks-save-cancel-btn"
                on:click={cancelSaveAs}
              >Cancel</button>
            {:else}
              <button
                class="decks-save-as-deck-btn"
                disabled={!hasFilter || !onCreateFilterDeck}
                on:click={startSaveAs}
                title={hasFilter ? "Save current filter as a filter deck" : "Add a filter rule to save"}
              >💾 Save as filter deck</button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Action bar (when cards selected, free mode only) -->
    {#if selectedCount > 0 && !isEditMode}
      <div class="decks-fm-action-bar">
        <span class="decks-fm-selected-count">{selectedCount} selected</span>
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
                {#each customDecks.filter(d => d.deckType !== 'filter') as deck}
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
          <div class="decks-fm-col-front decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("front")} on:keydown={(e) => e.key === "Enter" && toggleSort("front")}>
            Front <span class="decks-fm-sort-glyph">{sortGlyph("front")}</span>
          </div>
          <div class="decks-fm-col-back decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("back")} on:keydown={(e) => e.key === "Enter" && toggleSort("back")}>
            Back <span class="decks-fm-sort-glyph">{sortGlyph("back")}</span>
          </div>
          <div class="decks-fm-col-file decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("sourceFile")} on:keydown={(e) => e.key === "Enter" && toggleSort("sourceFile")}>
            File <span class="decks-fm-sort-glyph">{sortGlyph("sourceFile")}</span>
          </div>
          <div class="decks-fm-col-breadcrumb decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("breadcrumb")} on:keydown={(e) => e.key === "Enter" && toggleSort("breadcrumb")}>
            Breadcrumb <span class="decks-fm-sort-glyph">{sortGlyph("breadcrumb")}</span>
          </div>
          <div class="decks-fm-col-tag decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("deckTag")} on:keydown={(e) => e.key === "Enter" && toggleSort("deckTag")}>
            Deck tag <span class="decks-fm-sort-glyph">{sortGlyph("deckTag")}</span>
          </div>
          <div class="decks-fm-col-cardtags">Card tags</div>
          <div class="decks-fm-col-state decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("state")} on:keydown={(e) => e.key === "Enter" && toggleSort("state")}>
            State <span class="decks-fm-sort-glyph">{sortGlyph("state")}</span>
          </div>
          <div class="decks-fm-col-health decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("health")} on:keydown={(e) => e.key === "Enter" && toggleSort("health")}>
            Health <span class="decks-fm-sort-glyph">{sortGlyph("health")}</span>
          </div>
          <div class="decks-fm-col-due decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("dueDate")} on:keydown={(e) => e.key === "Enter" && toggleSort("dueDate")}>
            Due <span class="decks-fm-sort-glyph">{sortGlyph("dueDate")}</span>
          </div>
          <div class="decks-fm-col-reviewed decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("lastReviewed")} on:keydown={(e) => e.key === "Enter" && toggleSort("lastReviewed")}>
            Reviewed <span class="decks-fm-sort-glyph">{sortGlyph("lastReviewed")}</span>
          </div>
        </div>

        <div class="decks-fm-table-body">
          {#each displayedFlashcards as card (card.id)}
            {@const health = computeCardHealth(card, thresholds)}
            <div
              class="decks-fm-table-row"
              class:decks-fm-row-selected={selectedIds.has(card.id)}
              role="row"
              tabindex="0"
              on:click={() => toggleSelection(card.id)}
              on:keydown={(e) => e.key === "Enter" && toggleSelection(card.id)}
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
              <div class="decks-fm-col-cardtags">
                {#each card.tags as t}
                  <span class="decks-fm-cardtag-chip">#{t}</span>
                {/each}
              </div>
              <div class="decks-fm-col-state">
                <span class="decks-fm-state-badge decks-fm-state-{card.state}">
                  {card.state === "new" ? "New" : "Review"}
                </span>
              </div>
              <div class="decks-fm-col-health">
                {#if health.isLeech}
                  <span class="decks-fm-health-badge decks-fm-health-leech" title="Repeatedly forgotten ({card.lapses} lapses) — consider rewriting">
                    Leech
                  </span>
                {/if}
                {#if health.isDense}
                  <span class="decks-fm-health-badge decks-fm-health-dense" title="Back content is {card.back.length} chars — consider splitting">
                    Dense
                  </span>
                {/if}
                {#if !health.isLeech && !health.isDense}
                  <span class="decks-fm-health-badge decks-fm-health-healthy" title="No leech or density issues detected">
                    Healthy
                  </span>
                {/if}
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
          {#if filterRowVisible}
            Showing {sortedFlashcards.length} of {allFlashcards.length} cards in "{editingCustomDeckName}"
          {:else}
            {allFlashcards.length} cards in "{editingCustomDeckName}"
          {/if}
        {:else if filterRowVisible}
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

  /* Control bar */
  .decks-edit-target-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--background-secondary);
    border-radius: 6px;
  }

  .decks-edit-target-label {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .decks-edit-target-select {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
  }

  .decks-edit-save-btn {
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--interactive-accent);
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-edit-save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-edit-cancel-btn {
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-edit-cancel-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .decks-control-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--background-secondary);
    border-radius: 6px;
  }

  .decks-control-search-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
  }

  .decks-control-search-wrap:focus-within {
    border-color: var(--interactive-accent);
  }

  .decks-control-search-icon {
    font-size: 12px;
    opacity: 0.6;
  }

  .decks-control-search {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-normal);
    font-size: 13px;
    outline: none;
    padding: 2px 0;
  }

  .decks-control-search-clear {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 4px;
  }

  .decks-control-search-clear:hover {
    color: var(--text-normal);
  }

  .decks-control-filter-btn {
    padding: 5px 14px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
  }

  .decks-control-filter-btn:hover {
    background: var(--background-modifier-hover);
  }

  .decks-control-filter-btn-active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  /* Filter popover */
  .decks-filter-popover-container {
    position: relative;
  }

  .decks-filter-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 1000;
    min-width: 520px;
    max-width: 720px;
    max-height: 70vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px;
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    box-shadow: var(--shadow-l);
  }

  /* Active filters row */
  .decks-active-filters-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 4px 8px;
  }

  .decks-active-filters-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
    align-items: center;
  }

  .decks-active-filters-hint {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }

  .decks-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    background-color: var(--background-secondary-alt);
    color: var(--text-normal);
    font-size: var(--font-ui-smaller);
    line-height: 1.2;
    white-space: nowrap;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .decks-badge-key {
    color: var(--text-muted);
    font-weight: 500;
  }

  .decks-badge-value {
    color: var(--text-normal);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Override Obsidian's default button styles so the close icon doesn't get
     stretched into a pill or gain a hover background. */
  .decks-badge .decks-badge-close {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    min-height: unset !important;
    height: auto !important;
    padding: 0 !important;
    margin: 0 !important;

    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
  }

  .decks-badge .decks-badge-close:hover {
    background: transparent !important;
    color: var(--text-error);
  }

  .decks-save-action {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }

  .decks-save-as-deck-btn {
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--interactive-normal);
    color: var(--text-normal);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .decks-save-as-deck-btn:hover:not(:disabled) {
    background: var(--interactive-hover);
  }

  .decks-save-as-deck-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-save-name-input {
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 12px;
    min-width: 200px;
  }

  .decks-save-confirm-btn {
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--interactive-accent);
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-save-confirm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-save-cancel-btn {
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
  }

  .decks-save-cancel-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
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

  .decks-fm-action-btn:hover:not(:disabled) {
    background: var(--interactive-hover);
  }

  .decks-fm-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-fm-remove-btn {
    background: var(--background-modifier-error);
    color: var(--text-on-accent);
    border-color: var(--background-modifier-error);
  }

  .decks-fm-remove-btn:hover {
    opacity: 0.9;
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
    min-width: 900px;
  }

  .decks-fm-table-header {
    display: grid;
    grid-template-columns: 36px 1fr 1fr 110px 110px 90px 110px 70px 90px 80px 80px;
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

  .decks-fm-col-sortable {
    cursor: pointer;
    user-select: none;
  }

  .decks-fm-col-sortable:hover {
    color: var(--text-normal);
  }

  .decks-fm-sort-glyph {
    font-size: 9px;
    margin-left: 2px;
    opacity: 0.7;
  }

  .decks-fm-table-row {
    display: grid;
    grid-template-columns: 36px 1fr 1fr 110px 110px 90px 110px 70px 90px 80px 80px;
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

  .decks-fm-col-cardtags {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    align-items: center;
    overflow: hidden;
  }

  .decks-fm-cardtag-chip {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    font-size: 10px;
    white-space: nowrap;
  }

  .decks-fm-col-state,
  .decks-fm-col-health,
  .decks-fm-col-due,
  .decks-fm-col-reviewed {
    display: flex;
    align-items: center;
    font-size: 11px;
    flex-wrap: wrap;
    gap: 2px;
  }

  .decks-fm-state-badge,
  .decks-fm-health-badge {
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

  .decks-fm-health-leech {
    background: var(--color-red);
    color: var(--text-on-accent);
  }

  .decks-fm-health-dense {
    background: var(--color-orange);
    color: var(--text-on-accent);
  }

  .decks-fm-health-healthy {
    background: transparent;
    border: 1px solid var(--color-green);
    color: var(--color-green);
    font-weight: 500;
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
