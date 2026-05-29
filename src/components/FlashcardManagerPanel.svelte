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
  import { prepareFuzzySearch, Notice } from "obsidian";
  import type { App } from "obsidian";
  import { I18n } from "@/i18n/I18n";
  import { ConfirmModal } from "./ConfirmModal";

  const t = I18n.t;
  const m = t.manager;

  export let db: IDatabaseService;
  export let customDeckService: CustomDeckService;
  export let onCreateCustomDeck: (name: string, flashcardIds: string[]) => Promise<void>;
  export let onAddToCustomDeck: (customDeckId: string, flashcardIds: string[]) => Promise<void>;
  export let onCreateFilterDeck: ((name: string, definition: FilterDefinition) => Promise<void>) | null = null;
  export let onCommitEdit:
    | ((target: EditTarget, payload: EditCommitPayload) => Promise<void>)
    | null = null;
  export let onCleanupOrphans: (() => Promise<void>) | null = null;
  export let initialColumnWidths: Record<string, number> = {};
  export let onColumnWidthsChange: ((widths: Record<string, number>) => void) | null = null;
  export let onEditCard: ((card: Flashcard) => Promise<void>) | null = null;
  let editInFlightId: string | null = null;
  export let initialEditTarget: EditTarget | null = null;
  export let leechThreshold = 8;
  export let denseCardCharThreshold = 500;
  // Obsidian App so the panel can open ConfirmModal directly for destructive
  // bulk/per-row reset confirmations. Notice() is global to Obsidian, no
  // separate plumbing needed.
  export let app: App;
  // Same study-day rollover hour the scheduler uses for daily quotas; lets
  // the panel compute bury_until without dragging the full Scheduler in.
  export let nextDayStartsAt = 4;
  export let showNotices = true;

  /**
   * Compute the ISO timestamp where a card buried "today" should reappear.
   * Mirrors Scheduler.getBuryUntilForNextDay so the manager UI and review
   * modal converge on the same wall clock.
   */
  function getBuryUntilForNextDay(now: Date = new Date()): string {
    const localMidnight = new Date(now);
    localMidnight.setHours(0, 0, 0, 0);
    const studyDayStart = new Date(localMidnight);
    studyDayStart.setHours(nextDayStartsAt, 0, 0, 0);
    if (now < studyDayStart) {
      studyDayStart.setDate(studyDayStart.getDate() - 1);
    }
    studyDayStart.setDate(studyDayStart.getDate() + 1);
    return studyDayStart.toISOString();
  }

  const COLUMN_DEFAULTS: Record<string, number> = {
    check: 36,
    front: 240,
    back: 240,
    hint: 140,
    notes: 200,
    file: 110,
    breadcrumb: 110,
    deckTag: 90,
    cardTags: 110,
    state: 70,
    health: 90,
    dueDate: 80,
    lastReviewed: 80,
    // Holds both row-action pills (pencil + ⋯) at 28px each with a 6px
    // gap, plus the cell's horizontal padding (16px).
    edit: 80,
  };
  const COLUMN_ORDER: string[] = [
    "check",
    "front",
    "back",
    "hint",
    "notes",
    "file",
    "breadcrumb",
    "deckTag",
    "cardTags",
    "state",
    "health",
    "dueDate",
    "lastReviewed",
    "edit",
  ];
  const MIN_COLUMN_WIDTH = 50;

  let columnWidths: Record<string, number> = { ...COLUMN_DEFAULTS, ...initialColumnWidths };
  // Edit column needs to be wide enough to actually contain both pills
  // (28px pencil + 6px gap + 28px ⋯ + 16px cell padding = 78px). If a
  // persisted setting from an earlier dev build leaves it narrower, the
  // pills overflow the sticky cell and look like they scroll with the row.
  // Clamp local state here; user can still drag wider after.
  if ((columnWidths.edit ?? 0) < 80) {
    columnWidths.edit = COLUMN_DEFAULTS.edit;
  }
  let resizingColumn: string | null = null;

  $: gridTemplate = COLUMN_ORDER.map(
    (k) => `${columnWidths[k] ?? COLUMN_DEFAULTS[k]}px`,
  ).join(" ");

  async function handleEditCard(card: Flashcard) {
    if (!onEditCard) return;
    if (editInFlightId) return;
    editInFlightId = card.id;
    try {
      await onEditCard(card);
      const dtMap = deckTagMap;
      const rawFlashcards = await db.getAllFlashcards();
      allFlashcards = rawFlashcards.filter((c) => dtMap.has(c.deckId));
    } catch (e) {
      console.warn("Edit failed:", e);
    } finally {
      editInFlightId = null;
    }
  }

  function handleResizeStart(column: string, event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    resizingColumn = column;
    const startX = event.clientX;
    const startWidth = columnWidths[column] ?? COLUMN_DEFAULTS[column];

    const onMove = (e: PointerEvent) => {
      const delta = e.clientX - startX;
      const next = Math.max(MIN_COLUMN_WIDTH, startWidth + delta);
      columnWidths = { ...columnWidths, [column]: next };
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      resizingColumn = null;
      onColumnWidthsChange?.({ ...columnWidths });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  type SortColumn =
    | "front"
    | "back"
    | "hint"
    | "notes"
    | "sourceFile"
    | "breadcrumb"
    | "deckTag"
    | "cardTags"
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

  // Per-row card-actions menu. Only one row's menu can be open at a time
  // (the openId is null when nothing's open). Click-outside closes it via
  // selector match in handleOutsideClick.
  let openRowActionsId: string | null = null;
  // Re-evaluated each tick to keep "Suspended"/"Buried" badges fresh as
  // bury_until expires within an open session.
  let nowTick: number = Date.now();
  let nowTickTimer: ReturnType<typeof setInterval> | null = null;

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
      case "hint":
        return (a.hint ?? "").localeCompare(b.hint ?? "");
      case "notes":
        return (a.notes ?? "").localeCompare(b.notes ?? "");
      case "sourceFile":
        return a.sourceFile.localeCompare(b.sourceFile);
      case "breadcrumb":
        return a.breadcrumb.localeCompare(b.breadcrumb);
      case "deckTag": {
        const ta = deckTagMap.get(a.deckId) ?? "";
        const tb = deckTagMap.get(b.deckId) ?? "";
        return ta.localeCompare(tb);
      }
      case "cardTags": {
        const ta = [...a.tags].sort().join(",");
        const tb = [...b.tags].sort().join(",");
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

  function isCardSuspended(card: Flashcard): boolean {
    return !!card.suspendedAt;
  }
  function isCardBuried(card: Flashcard, nowMs: number): boolean {
    return !!card.buriedUntil && new Date(card.buriedUntil).getTime() > nowMs;
  }
  // Returns the selected cards as objects (not just ids) so bulk actions
  // can adapt their label/payload based on current state.
  function getSelectedCards(): Flashcard[] {
    return allFlashcards.filter((c) => selectedIds.has(c.id));
  }
  // Reactive selection snapshot. Reference both selectedIds and allFlashcards
  // explicitly in the $: line so Svelte tracks them — referencing them only
  // inside a called function does NOT register a dependency.
  $: selectedCardsLive = allFlashcards.filter((c) => selectedIds.has(c.id));
  // Labels for the suspend/bury bulk buttons flip to "Un…" when every
  // selected card is already in that state — same nowTick dependency keeps
  // bury auto-refreshing as buried_until expires.
  $: bulkSuspendLabel =
    selectedCardsLive.length > 0 && selectedCardsLive.every((c) => !!c.suspendedAt)
      ? m.unsuspendSelected
      : m.suspendSelected;
  $: bulkBuryLabel =
    selectedCardsLive.length > 0 &&
    selectedCardsLive.every(
      (c) => !!c.buriedUntil && new Date(c.buriedUntil).getTime() > nowTick
    )
      ? m.unburySelected
      : m.burySelected;

  async function reloadCards(): Promise<void> {
    const rawFlashcards = await db.getAllFlashcards();
    allFlashcards = rawFlashcards.filter((c) => deckTagMap.has(c.deckId));
  }

  function toggleRowActions(cardId: string) {
    openRowActionsId = openRowActionsId === cardId ? null : cardId;
  }

  async function handleRowAction(
    card: Flashcard,
    action: "suspend" | "unsuspend" | "bury" | "unbury" | "reset"
  ): Promise<void> {
    openRowActionsId = null;
    try {
      if (action === "suspend") {
        await db.suspendCard(card.id);
        if (showNotices) new Notice(I18n.t.review.cardSuspended);
      } else if (action === "unsuspend") {
        await db.unsuspendCard(card.id);
        if (showNotices) new Notice(I18n.t.review.cardUnsuspended);
      } else if (action === "bury") {
        const until = getBuryUntilForNextDay(new Date());
        await db.buryCard(card.id, until);
        if (showNotices) new Notice(I18n.t.review.cardBuried);
      } else if (action === "unbury") {
        await db.unburyCard(card.id);
      } else if (action === "reset") {
        const confirmed = await new Promise<boolean>((resolve) => {
          let okClicked = false;
          const modal = new ConfirmModal(app, {
            title: I18n.t.review.resetCardConfirmTitle,
            message: I18n.t.review.resetCardConfirmMessage,
            isDanger: true,
            onConfirm: () => {
              okClicked = true;
              resolve(true);
            },
          });
          const originalOnClose = modal.onClose.bind(modal);
          modal.onClose = () => {
            originalOnClose();
            if (!okClicked) resolve(false);
          };
          modal.open();
        });
        if (!confirmed) return;
        await db.resetCard(card.id);
        if (showNotices) new Notice(I18n.t.review.cardReset);
      }
      await reloadCards();
    } catch (e) {
      console.error("Row action failed:", e);
    }
  }

  async function handleBulkSuspendOrUnsuspend(): Promise<void> {
    const selected = getSelectedCards();
    if (selected.length === 0) return;
    const allSuspended = selected.every(isCardSuspended);
    const ids = selected.map((c) => c.id);
    try {
      if (allSuspended) {
        await db.batchUnsuspendCards(ids);
        if (showNotices) new Notice(I18n.t.review.cardUnsuspended);
      } else {
        await db.batchSuspendCards(ids);
        if (showNotices) new Notice(I18n.t.review.cardSuspended);
      }
      await reloadCards();
    } catch (e) {
      console.error("Bulk suspend/unsuspend failed:", e);
    }
  }

  async function handleBulkBuryOrUnbury(): Promise<void> {
    const selected = selectedCardsLive;
    if (selected.length === 0) return;
    const allBuried = selected.every(
      (c) => !!c.buriedUntil && new Date(c.buriedUntil).getTime() > nowTick
    );
    const ids = selected.map((c) => c.id);
    try {
      if (allBuried) {
        await db.batchUnburyCards(ids);
      } else {
        const until = getBuryUntilForNextDay(new Date());
        await db.batchBuryCards(ids, until);
        if (showNotices) new Notice(I18n.t.review.cardBuried);
      }
      await reloadCards();
    } catch (e) {
      console.error("Bulk bury/unbury failed:", e);
    }
  }

  async function handleBulkReset(): Promise<void> {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      let okClicked = false;
      const modal = new ConfirmModal(app, {
        title: m.resetSelectedConfirmTitle,
        message: I18n.format(m.resetSelectedConfirmMessage, { count: ids.length }),
        isDanger: true,
        onConfirm: () => {
          okClicked = true;
          resolve(true);
        },
      });
      const originalOnClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        originalOnClose();
        if (!okClicked) resolve(false);
      };
      modal.open();
    });
    if (!confirmed) return;
    try {
      await db.batchResetCards(ids);
      if (showNotices) new Notice(I18n.t.review.cardReset);
      clearSelection();
      await reloadCards();
    } catch (e) {
      console.error("Bulk reset failed:", e);
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
    if (openRowActionsId) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".decks-fm-row-actions")) {
        openRowActionsId = null;
      }
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
    document.addEventListener("click", handleOutsideClick);
    // Periodically refresh "now" so buried_until expiry visibly clears the
    // "Buried" badge in long-lived manager sessions without requiring a
    // user action.
    nowTickTimer = setInterval(() => {
      nowTick = Date.now();
    }, 30_000);
    try {
      if (onCleanupOrphans) {
        try {
          await onCleanupOrphans();
        } catch (e) {
          console.warn("Orphan deck cleanup failed:", e);
        }
      }

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

      const rawFlashcards = await db.getAllFlashcards();
      allFlashcards = rawFlashcards.filter((c) => dtMap.has(c.deckId));
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
    if (nowTickTimer !== null) {
      clearInterval(nowTickTimer);
      nowTickTimer = null;
    }
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
    <div class="decks-fm-loading">{m.loadingFlashcards}</div>
  {:else}
    <!-- Edit target row: dropdown to pick a custom deck to edit -->
    {#if customDecks.length > 0 || isEditMode}
      <div class="decks-edit-target-row">
        <label class="decks-edit-target-label" for="decks-edit-target-select">{m.editLabel}</label>
        <select
          id="decks-edit-target-select"
          class="decks-edit-target-select"
          value={editTargetSelectId}
          on:change={handleEditTargetChange}
        >
          <option value="">{m.browseAllOption}</option>
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
            title={I18n.format(m.saveTooltip, { name: editingCustomDeckName ?? "" })}
          >{m.saveButton}</button>
          <button
            class="decks-edit-cancel-btn"
            on:click={cancelEdit}
            title={m.discardTooltip}
          >{m.cancelButton}</button>
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
          placeholder={m.searchPlaceholderFull}
          bind:value={searchQuery}
        />
        {#if hasSearch}
          <button
            class="decks-control-search-clear"
            on:click={clearSearch}
            title={m.clearSearch}
            aria-label={m.clearSearch}
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
          {hasFilter ? I18n.format(m.filterButtonCount, { count: filterDefinition.rules.length }) : m.filterButton}
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
                aria-label={m.removeFilterAria}
              >×</button>
            </span>
          {/each}
          {#if !hasFilter && hasSearch}
            <span class="decks-active-filters-hint">{m.searchOnlyView}</span>
          {/if}
        </div>
        {#if !isEditMode}
          <div class="decks-save-action">
            {#if saveAsDeckMode === "filter"}
              <input
                type="text"
                class="decks-save-name-input"
                placeholder={m.filterDeckNamePlaceholder}
                bind:value={saveAsDeckName}
                on:keydown={(e) => { if (e.key === "Enter") confirmSaveAs(); if (e.key === "Escape") cancelSaveAs(); }}
              />
              <button
                class="decks-save-confirm-btn"
                disabled={!saveAsDeckName.trim()}
                on:click={confirmSaveAs}
              >{m.saveButton}</button>
              <button
                class="decks-save-cancel-btn"
                on:click={cancelSaveAs}
              >{m.cancelButton}</button>
            {:else}
              <button
                class="decks-save-as-deck-btn"
                disabled={!hasFilter || !onCreateFilterDeck}
                on:click={startSaveAs}
                title={hasFilter ? m.saveAsTitleHasFilter : m.saveAsTitleNoFilter}
              >{m.saveAsFilterDeck}</button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Action bar (when cards selected, free mode only) -->
    {#if selectedCount > 0 && !isEditMode}
      <div class="decks-fm-action-bar">
        <span class="decks-fm-selected-count">{I18n.format(m.selectedCount, { count: selectedCount })}</span>
        <button
          class="decks-fm-action-btn"
          on:click={handleBulkSuspendOrUnsuspend}
          type="button"
        >
          {bulkSuspendLabel}
        </button>
        <button
          class="decks-fm-action-btn"
          on:click={handleBulkBuryOrUnbury}
          type="button"
        >
          {bulkBuryLabel}
        </button>
        <button
          class="decks-fm-action-btn decks-fm-action-danger"
          on:click={handleBulkReset}
          type="button"
        >
          {m.resetSelected}
        </button>
        <div class="decks-fm-deck-dropdown-container" bind:this={customDeckDropdownEl}>
            <button
              class="decks-fm-action-btn"
              on:click={toggleCustomDeckDropdown}
            >
              {m.addToCustomDeck}
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
                    {m.createNewDeckOption}
                  </button>
                {:else}
                  <div class="decks-fm-new-deck-input">
                    <input
                      type="text"
                      placeholder={m.newDeckPlaceholder}
                      bind:value={newDeckName}
                      on:keydown={(e) => e.key === "Enter" && handleCreateNewDeck()}
                    />
                    <button
                      class="decks-fm-create-btn"
                      on:click={handleCreateNewDeck}
                      disabled={!newDeckName.trim()}
                    >
                      {m.createButton}
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
      </div>
    {/if}

    <!-- Table -->
    <div class="decks-fm-table-container" class:decks-fm-resizing={resizingColumn !== null}>
      <div class="decks-fm-table" style="--decks-fm-grid: {gridTemplate};">
        <div class="decks-fm-table-header">
          <div class="decks-fm-col-check">
            <input
              type="checkbox"
              checked={selectAll}
              on:change={toggleSelectAll}
            />
          </div>
          <div class="decks-fm-col-front decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("front")} on:keydown={(e) => e.key === "Enter" && toggleSort("front")}>
            {m.colFront} <span class="decks-fm-sort-glyph">{sortGlyph("front")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("front", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-back decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("back")} on:keydown={(e) => e.key === "Enter" && toggleSort("back")}>
            {m.colBack} <span class="decks-fm-sort-glyph">{sortGlyph("back")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("back", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-hint decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("hint")} on:keydown={(e) => e.key === "Enter" && toggleSort("hint")}>
            {m.colHint} <span class="decks-fm-sort-glyph">{sortGlyph("hint")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("hint", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-notes decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("notes")} on:keydown={(e) => e.key === "Enter" && toggleSort("notes")}>
            {m.colNotes} <span class="decks-fm-sort-glyph">{sortGlyph("notes")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("notes", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-file decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("sourceFile")} on:keydown={(e) => e.key === "Enter" && toggleSort("sourceFile")}>
            {m.colFile} <span class="decks-fm-sort-glyph">{sortGlyph("sourceFile")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("file", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-breadcrumb decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("breadcrumb")} on:keydown={(e) => e.key === "Enter" && toggleSort("breadcrumb")}>
            {m.colBreadcrumb} <span class="decks-fm-sort-glyph">{sortGlyph("breadcrumb")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("breadcrumb", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-tag decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("deckTag")} on:keydown={(e) => e.key === "Enter" && toggleSort("deckTag")}>
            {m.colDeckTag} <span class="decks-fm-sort-glyph">{sortGlyph("deckTag")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("deckTag", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-cardtags decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("cardTags")} on:keydown={(e) => e.key === "Enter" && toggleSort("cardTags")}>
            {m.colCardTags} <span class="decks-fm-sort-glyph">{sortGlyph("cardTags")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("cardTags", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-state decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("state")} on:keydown={(e) => e.key === "Enter" && toggleSort("state")}>
            {m.colState} <span class="decks-fm-sort-glyph">{sortGlyph("state")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("state", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-health decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("health")} on:keydown={(e) => e.key === "Enter" && toggleSort("health")}>
            {m.colHealth} <span class="decks-fm-sort-glyph">{sortGlyph("health")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("health", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-due decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("dueDate")} on:keydown={(e) => e.key === "Enter" && toggleSort("dueDate")}>
            {m.colDue} <span class="decks-fm-sort-glyph">{sortGlyph("dueDate")}</span>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="decks-fm-col-resize-handle" role="separator" tabindex="-1" on:pointerdown={(e) => handleResizeStart("dueDate", e)} on:click|stopPropagation></div>
          </div>
          <div class="decks-fm-col-reviewed decks-fm-col-sortable" role="button" tabindex="0" on:click={() => toggleSort("lastReviewed")} on:keydown={(e) => e.key === "Enter" && toggleSort("lastReviewed")}>
            {m.colReviewed} <span class="decks-fm-sort-glyph">{sortGlyph("lastReviewed")}</span>
          </div>
          <div class="decks-fm-col-edit" aria-hidden="true"></div>
        </div>

        <div class="decks-fm-table-body">
          {#each displayedFlashcards as card (card.id)}
            {@const health = computeCardHealth(card, thresholds)}
            {@const spatialClozeBlocked = !!card.edgeId && card.type === "cloze"}
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
              <div class="decks-fm-col-hint" title={card.hint ?? ""}>
                {truncate(card.hint ?? "", 40)}
              </div>
              <div class="decks-fm-col-notes" title={card.notes}>
                {truncate(card.notes ?? "", 50)}
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
                {#if isCardSuspended(card)}
                  <span
                    class="decks-fm-state-badge decks-fm-state-suspended"
                    title={m.suspendedTooltip}
                  >{m.suspendedBadge}</span>
                {:else if isCardBuried(card, nowTick)}
                  <span
                    class="decks-fm-state-badge decks-fm-state-buried"
                    title={I18n.format(m.buriedUntilTooltip, { date: card.buriedUntil ?? "" })}
                  >{m.buriedBadge}</span>
                {:else}
                  <span class="decks-fm-state-badge decks-fm-state-{card.state}">
                    {card.state === "new" ? m.badgeNew : m.badgeReview}
                  </span>
                {/if}
              </div>
              <div class="decks-fm-col-health">
                {#if health.isLeech}
                  <span class="decks-fm-health-badge decks-fm-health-leech" title={I18n.format(m.leechTooltip, { count: card.lapses })}>
                    {m.badgeLeech}
                  </span>
                {/if}
                {#if health.isDense}
                  <span class="decks-fm-health-badge decks-fm-health-dense" title={I18n.format(m.denseTooltip, { count: card.back.length })}>
                    {m.badgeDense}
                  </span>
                {/if}
                {#if !health.isLeech && !health.isDense}
                  <span class="decks-fm-health-badge decks-fm-health-healthy" title={m.healthyTooltip}>
                    {m.badgeHealthy}
                  </span>
                {/if}
              </div>
              <div class="decks-fm-col-due">
                {formatRelativeDate(card.dueDate)}
              </div>
              <div class="decks-fm-col-reviewed">
                {formatRelativeDate(card.lastReviewed)}
              </div>
              <div
                class="decks-fm-col-edit"
                class:decks-fm-col-edit-open={openRowActionsId === card.id}
              >
                <button
                  type="button"
                  class="decks-fm-edit-button clickable-icon"
                  aria-label={spatialClozeBlocked ? "Edit this card on the canvas directly" : "Edit flashcard"}
                  title={spatialClozeBlocked ? "Edit this card on the canvas directly" : "Edit flashcard"}
                  disabled={spatialClozeBlocked}
                  on:click|stopPropagation={() => !spatialClozeBlocked && handleEditCard(card)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                  </svg>
                </button>
                <div class="decks-fm-row-actions">
                  <button
                    type="button"
                    class="decks-fm-row-actions-trigger clickable-icon"
                    aria-label={m.cardActions}
                    aria-haspopup="menu"
                    aria-expanded={openRowActionsId === card.id}
                    on:click|stopPropagation={() => toggleRowActions(card.id)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="5" r="1.5"></circle>
                      <circle cx="12" cy="12" r="1.5"></circle>
                      <circle cx="12" cy="19" r="1.5"></circle>
                    </svg>
                  </button>
                  {#if openRowActionsId === card.id}
                    <div
                      class="decks-fm-row-actions-menu"
                      role="menu"
                      tabindex="-1"
                      on:click|stopPropagation
                      on:keydown|stopPropagation
                    >
                      {#if isCardSuspended(card)}
                        <button
                          type="button"
                          class="decks-fm-row-actions-item"
                          role="menuitem"
                          on:click|stopPropagation={() => handleRowAction(card, "unsuspend")}
                        >
                          {t.review.unsuspend}
                        </button>
                      {:else}
                        <button
                          type="button"
                          class="decks-fm-row-actions-item"
                          role="menuitem"
                          on:click|stopPropagation={() => handleRowAction(card, "suspend")}
                        >
                          {t.review.suspend}
                        </button>
                      {/if}
                      {#if isCardBuried(card, nowTick)}
                        <button
                          type="button"
                          class="decks-fm-row-actions-item"
                          role="menuitem"
                          on:click|stopPropagation={() => handleRowAction(card, "unbury")}
                        >
                          {t.review.unbury}
                        </button>
                      {:else}
                        <button
                          type="button"
                          class="decks-fm-row-actions-item"
                          role="menuitem"
                          on:click|stopPropagation={() => handleRowAction(card, "bury")}
                        >
                          {t.review.bury}
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="decks-fm-row-actions-item decks-fm-row-actions-danger"
                        role="menuitem"
                        on:click|stopPropagation={() => handleRowAction(card, "reset")}
                      >
                        {t.review.reset}
                      </button>
                    </div>
                  {/if}
                </div>
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
            {I18n.format(m.footerShowingOfInDeck, { shown: sortedFlashcards.length, total: allFlashcards.length, name: editingCustomDeckName })}
          {:else}
            {I18n.format(m.footerInDeck, { total: allFlashcards.length, name: editingCustomDeckName })}
          {/if}
        {:else if filterRowVisible}
          {I18n.format(m.footerShowingOf, { shown: sortedFlashcards.length, total: allFlashcards.length })}
        {:else}
          {I18n.format(m.footerTotal, { total: allFlashcards.length })}
        {/if}
      </span>
      {#if hasMore}
        <button class="decks-fm-load-more" on:click={loadMore}>
          {I18n.format(I18n.t.manager.loadMore, { remaining: sortedFlashcards.length - displayLimit })}
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

  .decks-fm-action-btn.decks-fm-action-danger {
    border-color: var(--background-modifier-error-hover, var(--background-modifier-error));
    color: var(--text-error);
  }
  .decks-fm-action-btn.decks-fm-action-danger:hover:not(:disabled) {
    background: var(--background-modifier-error-hover, var(--background-modifier-error));
    color: var(--text-on-accent);
  }

  /* Suspended/buried overlay badges occupy the state slot exclusively — a
   * card that's suspended or actively buried only shows its overlay state,
   * not the underlying NEW/REVIEW chip, so the cell content stays within
   * the 70px column width. */
  .decks-fm-state-badge.decks-fm-state-suspended {
    background: var(--background-modifier-error);
    color: var(--text-on-accent);
  }
  .decks-fm-state-badge.decks-fm-state-buried {
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }

  .decks-fm-row-actions {
    position: relative;
    display: inline-flex;
    /* This div is a flex item inside .decks-fm-col-edit; pin its size so
     * the parent flex layout can't squeeze the trigger button to nothing. */
    flex: 0 0 28px;
  }
  /* Matches .decks-fm-edit-button so the two row-action buttons read as a
   * consistent pair — solid pill, same border, same hover. !important
   * mirrors how .decks-fm-edit-button defeats Obsidian's clickable-icon
   * defaults (transparent background + no border). */
  .decks-fm-row-actions-trigger {
    flex: 0 0 28px !important;
    width: 28px !important;
    height: 28px !important;
    min-width: 28px !important;
    min-height: 28px !important;
    padding: 0 !important;
    background: var(--interactive-normal) !important;
    border: 1px solid var(--background-modifier-border) !important;
    border-radius: var(--radius-s);
    color: var(--text-normal);
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .decks-fm-row-actions-trigger:hover {
    background: var(--interactive-hover) !important;
    border-color: var(--background-modifier-border-hover) !important;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.18);
  }
  .decks-fm-row-actions-trigger:active {
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08) inset;
  }
  .decks-fm-row-actions-menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    min-width: 160px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    padding: 4px 0;
    margin-top: 4px;
    display: flex;
    flex-direction: column;
  }
  .decks-fm-row-actions-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--text-normal);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .decks-fm-row-actions-item:hover:not(:disabled) {
    background: var(--background-modifier-hover);
  }
  .decks-fm-row-actions-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .decks-fm-row-actions-item.decks-fm-row-actions-danger {
    color: var(--text-error);
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
    min-width: 1048px;
  }

  .decks-fm-table-header {
    display: grid;
    grid-template-columns: var(--decks-fm-grid);
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
    position: relative;
  }

  .decks-fm-col-sortable:hover {
    color: var(--text-normal);
  }

  .decks-fm-sort-glyph {
    font-size: 9px;
    margin-left: 2px;
    opacity: 0.7;
  }

  .decks-fm-col-resize-handle {
    position: absolute;
    top: 0;
    right: -2px;
    width: 4px;
    height: 100%;
    cursor: col-resize;
    z-index: 2;
  }

  .decks-fm-col-resize-handle:hover {
    background: var(--interactive-accent);
  }

  .decks-fm-resizing {
    cursor: col-resize;
    user-select: none;
  }

  .decks-fm-resizing * {
    cursor: col-resize !important;
  }

  .decks-fm-table-row {
    display: grid;
    grid-template-columns: var(--decks-fm-grid);
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

  /* Right-pinned Edit column — sticks to the right edge of the horizontal
   * scroller so the edit button is always reachable without scrolling.
   * z-index sits above table content (which has no z-index) so the column
   * cleanly occludes anything scrolling beneath it. */
  .decks-fm-col-edit {
    position: sticky;
    right: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 2px 8px;
    box-sizing: border-box;
    background: var(--background-secondary);
    border-left: 1px solid var(--background-modifier-border);
  }
  /* When the per-row actions dropdown is open, lift this cell above every
   * other body row's sticky cell (z-index 5) and the sticky header (6) so
   * the inner dropdown's z-index escapes above the entire table — without
   * this the menu gets occluded by later rows' edit cells, which paint
   * after in DOM order. */
  .decks-fm-col-edit.decks-fm-col-edit-open {
    z-index: 50;
  }
  .decks-fm-table-header .decks-fm-col-edit {
    /* Same solid as the body cell — the sticky column reads as one
     * consistent surface independent of row hover/selection. */
    background: var(--background-secondary);
    z-index: 6;
  }
  /* DELIBERATE: no row:hover or row-selected override for the sticky cell.
   * The row's hover/selected colors are alpha-blended modifier variables
   * — useful for non-sticky cells where there's no risk of horizontally-
   * scrolling content reading through, but on the sticky pinned column
   * that translucency lets text from the body bleed through the buttons.
   * Keeping a solid --background-secondary regardless of row state guarantees
   * the column always cleanly occludes scrolling content beneath it. */
  /* Solid pill background + drop shadow so the buttons visually lift off
   * the cell. Applied to both row-action pills via the trigger rule below. */
  .decks-fm-edit-button {
    /* `flex: 0 0 28px` forces fixed 28px width with no grow/shrink even
     * when the surrounding cell or flex container would otherwise compress
     * the button. Sibling ⋯ trigger uses the same. */
    flex: 0 0 28px !important;
    width: 28px !important;
    height: 28px !important;
    min-width: 28px !important;
    min-height: 28px !important;
    padding: 0 !important;
    background: var(--interactive-normal) !important;
    border: 1px solid var(--background-modifier-border) !important;
    border-radius: var(--radius-s);
    color: var(--text-normal);
    position: relative;
    z-index: 1;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .decks-fm-edit-button:hover {
    background: var(--interactive-hover) !important;
    border-color: var(--background-modifier-border-hover) !important;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.18);
  }
  .decks-fm-edit-button:active {
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08) inset;
  }

  .decks-fm-col-front,
  .decks-fm-col-back,
  .decks-fm-col-hint,
  .decks-fm-col-notes,
  .decks-fm-col-file,
  .decks-fm-col-breadcrumb,
  .decks-fm-col-tag {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
  }

  .decks-fm-col-hint {
    color: var(--text-muted);
    font-style: italic;
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
    overflow: hidden;
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
