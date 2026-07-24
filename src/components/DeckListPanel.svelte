<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import type {
    DeckWithProfile,
    DeckStats,
    DeckGroup,
    DeckProfile,
  } from "../database/types";
  import {
    buildDeckTree,
    filterDeckTree,
    sortDeckTree,
    flattenDeckTree,
    allBranchIds,
    generateDeckGroupId,
    I18n,
    DEFAULT_DECK_PROFILE,
  } from "@decks/core";
  import type { DeckTree, TreeNode, FlatRow } from "@decks/core";

  import ReviewHeatmap from "./statistics/ReviewHeatmap.svelte";
  import { AnkiExportModal } from "./export/AnkiExportModal";
  import { DeckResetModal } from "./DeckResetModal";
  import type { StatisticsService } from "@/services/StatisticsService";
  import type { DeckSynchronizer } from "@/services/DeckSynchronizer";
  import type { IDatabaseService } from "@/database/DatabaseFactory";
  import type { TagGroupService } from "@decks/core";
  import type { CustomDeckService } from "@decks/core";
  import type { CustomDeckGroup } from "../database/types";
  import { RenameCustomDeckModal } from "./RenameCustomDeckModal";
  import { ConfirmModal } from "./ConfirmModal";
  import { Notice, setIcon } from "obsidian";
  import type { App } from "obsidian";
  import type { DeckListSortMode, DeckListView } from "@/settings";

  const t = I18n.t;

  let tableBodyWidth = 0;
  let panelWidth = 0;
  let headerOverflowOpen = false;

  // Collapse the action icons into the "…" overflow menu below this width — the
  // inline toolbar has enough buttons (incl. Anki import) to crowd a narrow panel.
  $: isHeaderCompact = panelWidth > 0 && panelWidth < 450;

  let allDecks: DeckWithProfile[] = [];
  let stats = new Map<string, DeckStats>();
  let filterText = "";
  let heatmapComponent: ReviewHeatmap;
  let activeDropdown: HTMLElement | null = null;
  let activeDropdownDeckId: string | null = null;
  let dropdownEventListeners: {
    click?: (e: Event) => void;
    scroll?: () => void;
    resize?: () => void;
  } = {};

  let deckGroups: DeckGroup[] = [];
  let customDeckGroups: CustomDeckGroup[] = [];
  let customDeckStats = new Map<string, DeckStats>();

  export let statisticsService: StatisticsService;
  export let deckSynchronizer: DeckSynchronizer;
  export let db: IDatabaseService;
  export let tagGroupService: TagGroupService;

  export let onDeckClick: (deck: DeckWithProfile) => void;
  export let onDeckGroupClick: (deckGroup: DeckGroup) => void;
  export let onBrowseDeck: (deck: DeckWithProfile) => void;
  export let onBrowseDeckGroup: (deckGroup: DeckGroup) => void;
  export let onCramDeck: ((deck: DeckWithProfile) => void) | undefined = undefined;
  export let onCramDeckGroup: ((deckGroup: DeckGroup) => void) | undefined = undefined;
  export let isCramResumable:
    | ((deck: DeckWithProfile) => Promise<boolean>)
    | undefined = undefined;
  export let isCramResumableGroup:
    | ((deckGroup: DeckGroup) => Promise<boolean>)
    | undefined = undefined;
  export let onCustomDeckClick: (customDeck: CustomDeckGroup) => void;
  export let onBrowseCustomDeck: (customDeck: CustomDeckGroup) => void;
  export let onCramCustomDeck: ((customDeck: CustomDeckGroup) => void) | undefined = undefined;
  export let isCramResumableCustom:
    | ((customDeck: CustomDeckGroup) => Promise<boolean>)
    | undefined = undefined;
  export let onEditCustomDeck: (customDeck: CustomDeckGroup) => void;
  export let onOpenSource: ((deck: DeckWithProfile) => void) | undefined =
    undefined;

  // Exam entry points: shown only where exam questions are enabled — per row
  // via item.profile for file decks and groups, via the vault-level flag for
  // custom decks. Start review is the escape hatch on exam-enabled rows,
  // whose row click opens the exam setup instead of review.
  export let onExamDeck: ((deck: DeckWithProfile) => void) | undefined = undefined;
  export let onExamDeckGroup: ((deckGroup: DeckGroup) => void) | undefined = undefined;
  export let onExamCustomDeck: ((customDeck: CustomDeckGroup) => void) | undefined = undefined;
  export let onReviewDeck: ((deck: DeckWithProfile) => void) | undefined = undefined;
  export let onReviewDeckGroup: ((deckGroup: DeckGroup) => void) | undefined = undefined;
  export let examCapable = false;

  export let app: App;

  export let onRefresh: () => Promise<void>;
  export let openStatisticsModal: () => void;
  export let openProfilesManagerModal: () => void;
  export let openSrMigrationModal: () => void = () => {};
  export let openAnkiImportModal: () => void = () => {};
  export let openDeckConfigModal: (deck: DeckWithProfile) => void;
  export let openFlashcardManager: () => void;
  export let openAiGeneratorModal: () => void = () => {};
  export let aiEnabled = false;
  export let customDeckService: CustomDeckService;
  export let deckTag = "#decks";
  // Synced via data.json — pin/unpin on one device shows up on all others
  // after the user's normal cloud sync. The panel owns rendering and
  // re-sort; the parent owns persistence via onTogglePin.
  export let pinnedDeckIds: string[] = [];
  export let onTogglePin: (id: string) => Promise<void> | void = () => {};

  $: pinnedIds = new Set(pinnedDeckIds);

  async function togglePinFor(id: string) {
    await onTogglePin(id);
  }

  /**
   * Lets the parent push fresh pinned ids in (e.g., after saveSettings or
   * a cross-device settings reload) without remounting. Same pattern as
   * the existing updateAll / updateStats methods.
   */
  export function updatePinnedIds(ids: string[]): void {
    pinnedDeckIds = ids;
  }

  // Global daily review cap status ({done, cap}) or null when disabled.
  // Pushed by the parent alongside stat refreshes.
  export let globalReviewToday: { done: number; cap: number } | null = null;

  export function updateGlobalReviewToday(
    v: { done: number; cap: number } | null
  ): void {
    globalReviewToday = v;
  }

  // Active sort + size filter — both synced through data.json. The panel
  // owns rendering and re-sort; the parent owns persistence.
  export let deckListSort: DeckListSortMode = "name-asc";
  export let minDeckCardCount = 0;
  export let onChangeSortMode: (mode: DeckListSortMode) => Promise<void> | void =
    () => {};

  export function updateSortMode(mode: DeckListSortMode): void {
    deckListSort = mode;
  }

  // Deck list layout (tree/flat) — synced through data.json like the sort mode.
  export let deckListView: DeckListView = "tree";
  export let onChangeDeckListView: (view: DeckListView) => Promise<void> | void =
    () => {};

  export function updateDeckListView(view: DeckListView): void {
    deckListView = view;
  }

  function setDeckListView(view: DeckListView): void {
    if (view !== deckListView) void onChangeDeckListView(view);
  }

  export function updateMinDeckCardCount(value: number): void {
    minDeckCardCount = value;
  }

  // Collapsed branch-node ids for the tree — synced through data.json. The
  // panel owns rendering; the parent owns persistence via onSetCollapsedIds.
  export let collapsedDeckNodeIds: string[] = [];
  export let onSetCollapsedIds: (ids: string[]) => Promise<void> | void =
    () => {};

  let collapsedIds = new Set(collapsedDeckNodeIds);
  // Transient collapse state used only while a search is active, so the user can
  // still fold search results without touching (or persisting) the normal tree
  // state. Reset when the filter clears (see the reactive block below).
  let searchCollapsed = new Set<string>();

  export function updateCollapsedIds(ids: string[]): void {
    collapsedDeckNodeIds = ids;
    collapsedIds = new Set(ids);
  }

  function toggleCollapse(id: string): void {
    if (filtering) {
      const next = new Set(searchCollapsed);
      if (!next.delete(id)) next.add(id);
      searchCollapsed = next;
      return;
    }
    const next = new Set(collapsedIds);
    if (!next.delete(id)) next.add(id);
    collapsedIds = next;
    void onSetCollapsedIds([...next]);
  }

  // One button that collapses everything, or expands everything when the tree
  // is already fully collapsed. Operates on the transient set while searching.
  function toggleCollapseAll(): void {
    const branchIds = allBranchIds(tree);
    if (filtering) {
      const allCollapsed = branchIds.every((id) => searchCollapsed.has(id));
      searchCollapsed = new Set(allCollapsed ? [] : branchIds);
      return;
    }
    const allCollapsed = branchIds.every((id) => collapsedIds.has(id));
    const next = allCollapsed ? [] : branchIds;
    collapsedIds = new Set(next);
    void onSetCollapsedIds(next);
  }

  // Push the AI-enabled toggle in after a settings change so the generate
  // button enables/disables without remounting the panel.
  export function updateAiEnabled(enabled: boolean): void {
    aiEnabled = enabled;
  }

  /**
   * Click handler for sortable column headers. Cycles asc/desc on the same
   * column, otherwise starts fresh at ascending. Calls into the parent so
   * the choice is persisted to settings.
   */
  async function clickSortColumn(column: "name" | "new" | "due") {
    const ascMode = `${column}-asc` as DeckListSortMode;
    const descMode = `${column}-desc` as DeckListSortMode;
    const nextMode = deckListSort === ascMode ? descMode : ascMode;
    await onChangeSortMode(nextMode);
  }

  function sortArrowIcon(column: "name" | "new" | "due", mode: DeckListSortMode): string {
    if (mode === `${column}-asc`) return "arrow-up";
    if (mode === `${column}-desc`) return "arrow-down";
    return "chevrons-up-down";
  }
  $: nameArrow = sortArrowIcon("name", deckListSort);
  $: newArrow = sortArrowIcon("new", deckListSort);
  $: dueArrow = sortArrowIcon("due", deckListSort);
  $: nameSortActive = deckListSort === "name-asc" || deckListSort === "name-desc";
  $: newSortActive = deckListSort === "new-asc" || deckListSort === "new-desc";
  $: dueSortActive = deckListSort === "due-asc" || deckListSort === "due-desc";

  function sortIconAction(el: HTMLElement, iconName: string) {
    setIcon(el, iconName);
    return {
      update(name: string) {
        el.empty();
        setIcon(el, name);
      },
    };
  }

  function buildPinDropdownOption(id: string): HTMLDivElement {
    const option = activeDocument.createElement("div");
    option.className = "decks-dropdown-option";
    const isPinned = pinnedIds.has(id);
    const labelEl = activeDocument.createElement("span");
    labelEl.className = "decks-dropdown-option-label";
    labelEl.textContent = isPinned ? t.deckList.unpinFromTop : t.deckList.pinToTop;
    const iconEl = activeDocument.createElement("span");
    iconEl.className = "decks-dropdown-option-icon";
    setIcon(iconEl, isPinned ? "pin-off" : "pin");
    option.appendChild(iconEl);
    option.appendChild(labelEl);
    option.onclick = () => {
      closeActiveDropdown();
      togglePinFor(id);
    };
    return option;
  }

  function pinIconAction(el: HTMLElement, iconName: string) {
    setIcon(el, iconName);
    return {
      update(newIconName: string) {
        el.empty();
        setIcon(el, newIconName);
      },
    };
  }

  const getReviewCounts = async (days: number) => {
    if (!statisticsService) {
      console.error("StatisticsService is not available");
      return new Map();
    }
    return await statisticsService.getReviewCountsByDate(days);
  };
  const getStudyStats = async () => {
    if (!statisticsService) {
      console.error("StatisticsService is not available");
      return {
        totalHours: 0,
        pastMonthHours: 0,
        pastWeekHours: 0,
        todayCards: 0,
        todayHours: 0,
        todayPaceSeconds: 0,
      };
    }
    const baseStats = await statisticsService.getStudyStats();
    return {
      totalHours: baseStats.totalHours,
      pastMonthHours: baseStats.pastMonthHours,
      pastWeekHours: baseStats.pastWeekHours,
      todayCards: 0,
      todayHours: 0,
      todayPaceSeconds: 0,
    };
  };
  const onOpenStatistics = () => {
    openStatisticsModal();
  };
  const onOpenProfilesManager = () => {
    openProfilesManagerModal();
  };
  const onOpenSrMigration = () => {
    openSrMigrationModal();
  };
  const onOpenAnkiImport = () => {
    openAnkiImportModal();
  };
  const onOpenDeckConfig = () => {
    if (allDecks.length > 0) {
      openDeckConfigModal(allDecks[0]);
    }
  };

  let isRefreshing = false;
  // Distinct from isRefreshing: this fires when a background sync runs
  // outside the user's manual refresh button click (modal open, focus
  // event, etc.). Both flags share the same spinning-icon visual via
  // `decks-refreshing` so the user always sees "sync in flight" feedback
  // regardless of how the sync was triggered.
  let isSyncing = false;
  let isUpdatingStats = false;
  let studyStats = {
    totalHours: 0,
    pastMonthHours: 0,
    pastWeekHours: 0,
    todayCards: 0,
    todayHours: 0,
    todayPaceSeconds: 0,
  };

  // Track last event to prevent double execution
  let lastEventTime = 0;
  let lastEventType = "";

  function getDeckStats(deckId: string): DeckStats {
    return (
      stats.get(deckId) ?? customDeckStats.get(deckId) ?? {
        deckId,
        newCount: 0,
        dueCount: 0,
        totalCount: 0,
        matureCount: 0,
      }
    );
  }

  async function handleRefresh() {
    isRefreshing = true;
    try {
      await onRefresh();
      refreshHeatmap();
      await loadStudyStats();
      await loadCustomDecks();
    } catch (error) {
      console.error("Error during refresh:", error);
    } finally {
      isRefreshing = false;
    }
  }

  // Called by DecksView / DecksViewModal when a non-user-initiated sync
  // is in flight. Bound to the same spinning-icon visual as the manual
  // refresh button so the user always sees consistent feedback.
  export function setSyncing(value: boolean): void {
    isSyncing = value;
  }

  export function updateStatsById(deckId: string, newStats: DeckStats) {
    isUpdatingStats = true;
    stats.set(deckId, newStats);
    // eslint-disable-next-line no-self-assign -- self-assignment triggers Svelte reactivity
    stats = stats;
    loadStudyStats().catch(console.error);
    isUpdatingStats = false;
  }

  // Single-custom-deck stats patch. Custom decks reference cards that live in
  // file decks, so their stats must be computed via CustomDeckService — never
  // routed through the file-deck `stats` map, which would shadow the correct
  // values returned by customDeckStats in getDeckStats().
  export function updateCustomDeckStatsById(deckId: string, newStats: DeckStats) {
    customDeckStats.set(deckId, newStats);
    // eslint-disable-next-line no-self-assign -- self-assignment triggers Svelte reactivity
    customDeckStats = customDeckStats;
  }
  // Function to force UI update when stats change
  export function updateStats(newStats: Map<string, DeckStats>) {
    isUpdatingStats = true;
    stats = newStats;
    isUpdatingStats = false;
  }
  // Build the unified tree, then filter → sort → flatten into rows. `stats` and
  // `customDeckStats` are passed explicitly so Svelte re-derives when they
  // change (reassigned in updateStats* to trigger this).
  function buildTree(
    fileDecks: DeckWithProfile[],
    groups: DeckGroup[],
    customs: CustomDeckGroup[],
    fileStats: Map<string, DeckStats>,
    customStats: Map<string, DeckStats>,
    pins: Set<string>,
    minCount: number,
    view: DeckListView,
  ): DeckTree {
    const getStats = (id: string) => fileStats.get(id) ?? customStats.get(id);
    return buildDeckTree({
      fileDecks: fileDecks.map((d) => ({ ...d, type: "file" as const })),
      deckGroups: groups,
      customDeckGroups: customs,
      getStats,
      pinnedIds: pins,
      minDeckCardCount: minCount,
      flat: view === "flat",
    });
  }

  $: tree = buildTree(
    allDecks,
    deckGroups,
    customDeckGroups,
    stats,
    customDeckStats,
    pinnedIds,
    minDeckCardCount,
    deckListView,
  );
  $: filtering = filterText.trim().length > 0;
  // Leaving a search discards any transient folds made during it.
  $: if (!filtering && searchCollapsed.size) searchCollapsed = new Set();
  // While searching, results start fully expanded (empty transient set) and the
  // user can fold branches into searchCollapsed; otherwise use the persisted set.
  $: activeCollapsed = filtering ? searchCollapsed : collapsedIds;
  $: sortedFilteredTree = sortDeckTree(filterDeckTree(tree, filterText), deckListSort);
  $: flattenedRows = flattenDeckTree(sortedFilteredTree, activeCollapsed);
  // Count matches from a fully-expanded flatten so folding all results during a
  // search doesn't falsely trigger the "no matches" empty state.
  $: matchingLeafCount = flattenDeckTree(sortedFilteredTree, new Set()).reduce(
    (n, r) => n + (r.node.kind === "leaf" ? 1 : 0),
    0,
  );

  // Synthetic profile for subtree study — limits disabled so a folder/section
  // review surfaces every due+new card underneath, uncapped.
  const syntheticProfile: DeckProfile = {
    ...DEFAULT_DECK_PROFILE,
    id: "profile_default",
    created: "",
    modified: "",
  };

  // A real backing group for a tag node, or a synthetic group over a folder's
  // descendant deck ids, so subtree actions can reuse the deck-group handlers.
  function groupForNode(node: TreeNode): DeckGroup {
    if (node.group) return node.group;
    return {
      type: "group",
      tag: node.id,
      name: node.name,
      deckIds: node.deckIds,
      profile: syntheticProfile,
      lastReviewed: null,
      created: "",
      modified: "",
    };
  }

  function handleRowStudy(node: TreeNode): void {
    if (node.kind === "section") {
      toggleCollapse(node.id);
      return;
    }
    if (node.kind === "folder") {
      onDeckGroupClick(groupForNode(node));
      return;
    }
    if (node.fileDeck) onDeckClick(node.fileDeck);
    else if (node.group) onDeckGroupClick(node.group);
    else if (node.customDeck) onCustomDeckClick(node.customDeck);
  }

  function handleRowConfig(node: TreeNode, event: Event): void {
    if (node.kind === "folder") {
      handleFolderConfigClick(node, event);
    } else if (node.fileDeck) {
      handleConfigClick(node.fileDeck, event);
    } else if (node.group) {
      handleGroupConfigClick(node.group, event);
    } else if (node.customDeck) {
      handleCustomDeckConfigClick(node.customDeck, event);
    }
  }

  // Row icon: emoji for tags/custom, a Lucide glyph for folders/sections.
  function rowIcon(node: TreeNode): { emoji?: string; lucide?: string } | null {
    if (node.kind === "section") {
      if (node.section === "tags") return { emoji: "🏷️" };
      if (node.section === "custom") return { emoji: "📋" };
      if (node.section === "pinned") return { lucide: "pin" };
      return { lucide: "folder-tree" };
    }
    if (node.kind === "folder") {
      return node.id.startsWith("tag:") ? { emoji: "🏷️" } : { lucide: "folder" };
    }
    if (node.group) return { emoji: "🏷️" };
    if (node.customDeck) {
      return node.customDeck.deckType === "filter" ? { emoji: "🔍" } : { emoji: "📋" };
    }
    if (node.fileDeck) {
      return node.fileDeck.filepath.endsWith(".canvas")
        ? { lucide: "layout-dashboard" }
        : { lucide: "file-text" };
    }
    return null;
  }

  function sectionMeta(node: TreeNode): string {
    const count =
      node.section === "files"
        ? allDecks.length
        : node.section === "tags"
          ? deckGroups.length
          : node.section === "custom"
            ? customDeckGroups.length
            : node.children.length;
    return `(${count})`;
  }

  function nodeProfile(node: TreeNode): DeckProfile | null {
    return node.fileDeck?.profile ?? node.group?.profile ?? null;
  }

  function newTitle(node: TreeNode): string {
    const p = nodeProfile(node);
    if (p?.hasNewCardsLimitEnabled) {
      return node.group
        ? I18n.format(t.deckList.newCardsGroupTooltip, { count: node.newCount, limit: p.newCardsPerDay })
        : I18n.format(t.deckList.newCardsLimitTooltip, { count: node.newCount, limit: p.newCardsPerDay });
    }
    return I18n.format(t.deckList.newCardsDueTooltip, { count: node.newCount });
  }

  function dueTitle(node: TreeNode): string {
    const p = nodeProfile(node);
    if (p?.hasReviewCardsLimitEnabled) {
      return node.group
        ? I18n.format(t.deckList.reviewCardsGroupTooltip, { count: node.dueCount, limit: p.reviewCardsPerDay })
        : I18n.format(t.deckList.reviewCardsLimitTooltip, { count: node.dueCount, limit: p.reviewCardsPerDay });
    }
    return I18n.format(t.deckList.reviewCardsDueTooltip, { count: node.dueCount });
  }

  function reviewLimited(node: TreeNode): boolean {
    return nodeProfile(node)?.hasReviewCardsLimitEnabled ?? false;
  }

  export function updateDecks(newDecks: DeckWithProfile[]) {
    allDecks = newDecks;

    // Generate deck groups asynchronously — the tree re-derives when they land.
    tagGroupService
      .aggregateByTag(newDecks)
      .then((groups) => {
        deckGroups = groups;
      })
      .catch(console.error);
  }

  function clearFilter() {
    filterText = "";
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      clearFilter();
      (event.target as HTMLInputElement).blur();
    }
  }

  export function refreshHeatmap() {
    if (heatmapComponent) {
      heatmapComponent.refresh();
    }
  }

  async function loadCustomDecks() {
    try {
      customDeckGroups = await customDeckService.getAllCustomDeckGroups();
      customDeckStats = await customDeckService.getAllCustomDeckStats();
    } catch (e) {
      console.error("Failed to load custom decks:", e);
    }
  }

  async function loadStudyStats() {
    if (getStudyStats && statisticsService) {
      try {
        const newStats = await getStudyStats();
        studyStats = {
          totalHours: newStats?.totalHours ?? 0,
          pastMonthHours: newStats?.pastMonthHours ?? 0,
          pastWeekHours: newStats?.pastWeekHours ?? 0,
          todayCards: newStats?.todayCards ?? 0,
          todayHours: newStats?.todayHours ?? 0,
          todayPaceSeconds: newStats?.todayPaceSeconds ?? 0,
        };
      } catch (error) {
        console.error("Error loading study stats:", error);
      }
    }
  }

  function formatHours(hours: number | undefined): string {
    return (hours ?? 0).toFixed(2) + " hrs";
  }

  function formatPace(seconds: number | undefined): string {
    return (seconds ?? 0).toFixed(2) + "s/card";
  }

  /**
   * Unified function to update all UI components in the DeckListPanel.
   * This consolidates all UI updates to prevent scattered update calls throughout the codebase.
   *
   * @param newDecks - Optional array of decks to update the deck list
   * @param newStats - Optional map of all deck stats to update all deck statistics
   * @param singleDeckId - Optional deck ID for updating a single deck's stats
   * @param singleDeckStats - Optional stats for a single deck (used with singleDeckId)
   *
   * Updates performed:
   * - Deck list (if newDecks provided)
   * - Deck statistics (if newStats or single deck stats provided)
   * - Review heatmap (always)
   * - Study statistics (always)
   */
  export async function updateAll(
    newDecks?: DeckWithProfile[],
    newStats?: Map<string, DeckStats>,
    singleDeckId?: string,
    singleDeckStats?: DeckStats
  ) {
    if (newDecks) {
      updateDecks(newDecks);
    }
    if (newStats) {
      updateStats(newStats);
    }
    if (singleDeckId && singleDeckStats) {
      updateStatsById(singleDeckId, singleDeckStats);
      // single-deck update: skip the global dashboard recompute below
      if (!newDecks && !newStats) return;
    }
    refreshHeatmap();
    await loadStudyStats();
    await loadCustomDecks();
  }

  // Load study stats and custom decks on component mount
  onMount(() => {
    void loadCustomDecks();
    void loadStudyStats();
  });

  function handleGroupConfigClick(group: DeckGroup, event: Event) {
    event.stopPropagation();

    const groupId = generateDeckGroupId(group.tag);

    // If clicking the same cog, close the dropdown
    if (activeDropdown && activeDropdownDeckId === groupId) {
      closeActiveDropdown();
      return;
    }

    // Close any existing dropdown
    closeActiveDropdown();

    // Create dropdown menu
    const dropdown = activeDocument.createElement("div");
    dropdown.className = "decks-deck-config-dropdown";

    const browseOption = activeDocument.createElement("div");
    browseOption.className = "decks-dropdown-option";
    browseOption.textContent = t.deckList.browseAllCards;
    browseOption.onclick = () => {
      closeActiveDropdown();
      onBrowseDeckGroup(group);
    };

    const cramOption = activeDocument.createElement("div");
    cramOption.className = "decks-dropdown-option";
    cramOption.textContent = t.deckList.cram;
    cramOption.onclick = () => {
      closeActiveDropdown();
      onCramDeckGroup?.(group);
    };
    isCramResumableGroup?.(group).then((resumable) => {
      if (resumable) cramOption.textContent = t.deckList.resumeCram;
    });

    const exportOption = activeDocument.createElement("div");
    exportOption.className = "decks-dropdown-option";
    exportOption.textContent = t.deckList.exportToAnki;
    exportOption.onclick = () => {
      closeActiveDropdown();
      openAnkiExportForGroup(group);
    };

    const configOption = activeDocument.createElement("div");
    configOption.className = "decks-dropdown-option";
    configOption.textContent = t.deckList.configureProfile;
    configOption.onclick = () => {
      closeActiveDropdown();
      const deckForGroup = allDecks.find((d) => group.deckIds.includes(d.id));
      if (deckForGroup) {
        openDeckConfigModal(deckForGroup);
      }
    };

    const pinOption = buildPinDropdownOption(groupId);

    const groupExamEnabled = group.profile?.examEnabled === true;
    const examOption = activeDocument.createElement("div");
    examOption.className = "decks-dropdown-option";
    examOption.textContent = t.exam.startExam;
    examOption.onclick = () => {
      closeActiveDropdown();
      onExamDeckGroup?.(group);
    };
    const reviewOption = activeDocument.createElement("div");
    reviewOption.className = "decks-dropdown-option";
    reviewOption.textContent = t.exam.startReview;
    reviewOption.onclick = () => {
      closeActiveDropdown();
      onReviewDeckGroup?.(group);
    };

    dropdown.appendChild(pinOption);
    if (groupExamEnabled && onExamDeckGroup) dropdown.appendChild(examOption);
    if (groupExamEnabled && onReviewDeckGroup) dropdown.appendChild(reviewOption);
    dropdown.appendChild(browseOption);
    if (onCramDeckGroup) dropdown.appendChild(cramOption);
    dropdown.appendChild(exportOption);
    dropdown.appendChild(configOption);

    // Position dropdown with viewport bounds checking
    const button = event.target as HTMLElement;
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    dropdown.addClass("decks-context-menu");

    // Temporarily append to measure dimensions
    activeDocument.body.appendChild(dropdown);
    const dropdownRect = dropdown.getBoundingClientRect();

    // Calculate optimal position
    let top = rect.bottom + 5;
    let left = rect.left;

    // Adjust if dropdown would go below viewport
    if (top + dropdownRect.height > viewportHeight - 10) {
      top = rect.top - dropdownRect.height - 5;
    }

    // Adjust if dropdown would go right of viewport
    if (left + dropdownRect.width > viewportWidth - 10) {
      left = viewportWidth - dropdownRect.width - 10;
    }

    // Ensure it doesn't go above or left of viewport
    top = Math.max(10, top);
    left = Math.max(10, left);

    dropdown.setCssProps({
      top: `${top}px`,
      left: `${left}px`,
    });
    dropdown.removeClass("decks-context-menu");
    dropdown.addClass("decks-context-menu-visible");

    // Store active dropdown reference
    activeDropdown = dropdown;
    activeDropdownDeckId = groupId;

    // Store event listener functions for cleanup
    dropdownEventListeners.click = (e: Event) => {
      if (!dropdown.contains(e.target as Node)) {
        closeActiveDropdown();
      }
    };
    dropdownEventListeners.scroll = closeActiveDropdown;
    dropdownEventListeners.resize = closeActiveDropdown;

    // Add event listeners with slight delay to prevent immediate closure
    window.setTimeout(() => {
      if (dropdownEventListeners.click) {
        activeDocument.addEventListener("click", dropdownEventListeners.click);
      }
      if (dropdownEventListeners.scroll) {
        window.addEventListener("scroll", dropdownEventListeners.scroll, true);
      }
      if (dropdownEventListeners.resize) {
        window.addEventListener("resize", dropdownEventListeners.resize);
      }
    }, 0);
  }

  function handleConfigClick(deck: DeckWithProfile, event: Event) {
    event.stopPropagation();

    // If clicking the same cog, close the dropdown
    if (activeDropdown && activeDropdownDeckId === deck.id) {
      closeActiveDropdown();
      return;
    }

    // Close any existing dropdown
    closeActiveDropdown();

    // Create dropdown menu
    const dropdown = activeDocument.createElement("div");
    dropdown.className = "decks-deck-config-dropdown";

    const browseOption = activeDocument.createElement("div");
    browseOption.className = "decks-dropdown-option";
    browseOption.textContent = t.deckList.browseAllCards;
    browseOption.onclick = () => {
      closeActiveDropdown();
      onBrowseDeck(deck);
    };

    const cramOption = activeDocument.createElement("div");
    cramOption.className = "decks-dropdown-option";
    cramOption.textContent = t.deckList.cram;
    cramOption.onclick = () => {
      closeActiveDropdown();
      onCramDeck?.(deck);
    };
    isCramResumable?.(deck).then((resumable) => {
      if (resumable) cramOption.textContent = t.deckList.resumeCram;
    });

    const openSourceOption = activeDocument.createElement("div");
    openSourceOption.className = "decks-dropdown-option";
    openSourceOption.textContent = t.deckList.openSourceFile;
    openSourceOption.onclick = () => {
      closeActiveDropdown();
      onOpenSource?.(deck);
    };

    const exportOption = activeDocument.createElement("div");
    exportOption.className = "decks-dropdown-option";
    exportOption.textContent = t.deckList.exportToAnki;
    exportOption.onclick = () => {
      closeActiveDropdown();
      openAnkiExport(deck);
    };

    const configOption = activeDocument.createElement("div");
    configOption.className = "decks-dropdown-option";
    configOption.textContent = t.deckList.configureProfile;
    configOption.onclick = () => {
      closeActiveDropdown();
      openDeckConfigModal(deck);
    };

    const resetOption = activeDocument.createElement("div");
    resetOption.className = "decks-dropdown-option decks-dropdown-option-danger";
    resetOption.textContent = t.deckList.resetProgress;
    resetOption.onclick = () => {
      closeActiveDropdown();
      openResetDeckModal(deck);
    };

    const pinOption = buildPinDropdownOption(deck.id);

    const deckExamEnabled = deck.profile.examEnabled === true;
    const examOption = activeDocument.createElement("div");
    examOption.className = "decks-dropdown-option";
    examOption.textContent = t.exam.startExam;
    examOption.onclick = () => {
      closeActiveDropdown();
      onExamDeck?.(deck);
    };
    const reviewOption = activeDocument.createElement("div");
    reviewOption.className = "decks-dropdown-option";
    reviewOption.textContent = t.exam.startReview;
    reviewOption.onclick = () => {
      closeActiveDropdown();
      onReviewDeck?.(deck);
    };

    dropdown.appendChild(pinOption);
    if (deckExamEnabled && onExamDeck) dropdown.appendChild(examOption);
    if (deckExamEnabled && onReviewDeck) dropdown.appendChild(reviewOption);
    dropdown.appendChild(browseOption);
    if (onCramDeck) dropdown.appendChild(cramOption);
    if (onOpenSource) dropdown.appendChild(openSourceOption);
    dropdown.appendChild(exportOption);
    dropdown.appendChild(configOption);
    dropdown.appendChild(resetOption);

    // Position dropdown with viewport bounds checking
    const button = event.target as HTMLElement;
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    dropdown.addClass("decks-context-menu");

    // Temporarily append to measure dimensions
    activeDocument.body.appendChild(dropdown);
    const dropdownRect = dropdown.getBoundingClientRect();

    // Calculate optimal position
    let top = rect.bottom + 5;
    let left = rect.left;

    // Adjust if dropdown would go below viewport
    if (top + dropdownRect.height > viewportHeight - 10) {
      top = rect.top - dropdownRect.height - 5;
    }

    // Adjust if dropdown would go right of viewport
    if (left + dropdownRect.width > viewportWidth - 10) {
      left = viewportWidth - dropdownRect.width - 10;
    }

    // Ensure it doesn't go above or left of viewport
    top = Math.max(10, top);
    left = Math.max(10, left);

    dropdown.setCssProps({
      top: `${top}px`,
      left: `${left}px`,
    });
    dropdown.removeClass("decks-context-menu");
    dropdown.addClass("decks-context-menu-visible");

    // Store active dropdown reference
    activeDropdown = dropdown;
    activeDropdownDeckId = deck.id;

    // Store event listener functions for cleanup
    dropdownEventListeners.click = (e: Event) => {
      if (!dropdown.contains(e.target as Node)) {
        closeActiveDropdown();
      }
    };
    dropdownEventListeners.scroll = closeActiveDropdown;
    dropdownEventListeners.resize = closeActiveDropdown;

    // Add event listeners with slight delay to prevent immediate closure
    window.setTimeout(() => {
      if (dropdownEventListeners.click) {
        activeDocument.addEventListener("click", dropdownEventListeners.click);
      }
      if (dropdownEventListeners.scroll) {
        window.addEventListener("scroll", dropdownEventListeners.scroll, true);
      }
      if (dropdownEventListeners.resize) {
        window.addEventListener("resize", dropdownEventListeners.resize);
      }
    }, 0);
  }

  function handleCustomDeckConfigClick(customDeck: CustomDeckGroup, event: Event) {
    event.stopPropagation();

    if (activeDropdown && activeDropdownDeckId === customDeck.id) {
      closeActiveDropdown();
      return;
    }

    closeActiveDropdown();

    const dropdown = activeDocument.createElement("div");
    dropdown.className = "decks-deck-config-dropdown";

    const browseOption = activeDocument.createElement("div");
    browseOption.className = "decks-dropdown-option";
    browseOption.textContent = t.deckList.browseAllCards;
    browseOption.onclick = () => {
      closeActiveDropdown();
      onBrowseCustomDeck(customDeck);
    };

    const cramOption = activeDocument.createElement("div");
    cramOption.className = "decks-dropdown-option";
    cramOption.textContent = t.deckList.cram;
    cramOption.onclick = () => {
      closeActiveDropdown();
      onCramCustomDeck?.(customDeck);
    };
    isCramResumableCustom?.(customDeck).then((resumable) => {
      if (resumable) cramOption.textContent = t.deckList.resumeCram;
    });

    const exportOption = activeDocument.createElement("div");
    exportOption.className = "decks-dropdown-option";
    exportOption.textContent = t.deckList.exportToAnki;
    exportOption.onclick = () => {
      closeActiveDropdown();
      openAnkiExportForCustomDeck(customDeck);
    };

    const renameOption = activeDocument.createElement("div");
    renameOption.className = "decks-dropdown-option";
    renameOption.textContent = t.deckList.rename;
    renameOption.onclick = () => {
      closeActiveDropdown();
      renameCustomDeck(customDeck);
    };

    const resetOption = activeDocument.createElement("div");
    resetOption.className = "decks-dropdown-option decks-dropdown-option-danger";
    resetOption.textContent = t.deckList.resetProgress;
    resetOption.onclick = () => {
      closeActiveDropdown();
      resetCustomDeckProgress(customDeck);
    };

    const deleteOption = activeDocument.createElement("div");
    deleteOption.className = "decks-dropdown-option decks-dropdown-option-danger";
    deleteOption.textContent = t.deckList.delete;
    deleteOption.onclick = () => {
      closeActiveDropdown();
      deleteCustomDeck(customDeck);
    };

    const editOption = activeDocument.createElement("div");
    editOption.className = "decks-dropdown-option";
    editOption.textContent = customDeck.deckType === "filter" ? t.deckList.editFilter : t.deckList.editCards;
    editOption.onclick = () => {
      closeActiveDropdown();
      onEditCustomDeck(customDeck);
    };

    const pinOption = buildPinDropdownOption(customDeck.id);

    const examOption = activeDocument.createElement("div");
    examOption.className = "decks-dropdown-option";
    examOption.textContent = t.exam.startExam;
    examOption.onclick = () => {
      closeActiveDropdown();
      onExamCustomDeck?.(customDeck);
    };

    dropdown.appendChild(pinOption);
    if (examCapable && onExamCustomDeck) dropdown.appendChild(examOption);
    dropdown.appendChild(browseOption);
    if (onCramCustomDeck) dropdown.appendChild(cramOption);
    dropdown.appendChild(editOption);
    dropdown.appendChild(exportOption);
    dropdown.appendChild(renameOption);
    dropdown.appendChild(resetOption);
    dropdown.appendChild(deleteOption);

    const button = event.target as HTMLElement;
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    dropdown.addClass("decks-context-menu");

    activeDocument.body.appendChild(dropdown);
    const dropdownRect = dropdown.getBoundingClientRect();

    let top = rect.bottom + 5;
    let left = rect.left;

    if (top + dropdownRect.height > viewportHeight - 10) {
      top = rect.top - dropdownRect.height - 5;
    }
    if (left + dropdownRect.width > viewportWidth - 10) {
      left = viewportWidth - dropdownRect.width - 10;
    }

    top = Math.max(10, top);
    left = Math.max(10, left);

    dropdown.setCssProps({
      top: `${top}px`,
      left: `${left}px`,
    });
    dropdown.removeClass("decks-context-menu");
    dropdown.addClass("decks-context-menu-visible");

    activeDropdown = dropdown;
    activeDropdownDeckId = customDeck.id;

    dropdownEventListeners.click = (e: Event) => {
      if (!dropdown.contains(e.target as Node)) {
        closeActiveDropdown();
      }
    };
    dropdownEventListeners.scroll = closeActiveDropdown;
    dropdownEventListeners.resize = closeActiveDropdown;

    window.setTimeout(() => {
      if (dropdownEventListeners.click) {
        activeDocument.addEventListener("click", dropdownEventListeners.click);
      }
      if (dropdownEventListeners.scroll) {
        window.addEventListener("scroll", dropdownEventListeners.scroll, true);
      }
      if (dropdownEventListeners.resize) {
        window.addEventListener("resize", dropdownEventListeners.resize);
      }
    }, 0);
  }

  function renameCustomDeck(customDeck: CustomDeckGroup) {
    const existingNames = customDeckGroups
      .map((g) => g.name)
      .filter((n) => n !== customDeck.name);
    new RenameCustomDeckModal(app, customDeck.name, existingNames, (newName) => {
      customDeckService
        .renameCustomDeck(customDeck.id, newName)
        .then(() => loadCustomDecks())
        .catch((e) => console.error("Failed to rename custom deck:", e));
    }).open();
  }

  function deleteCustomDeck(customDeck: CustomDeckGroup) {
    new ConfirmModal(app, {
      title: t.deckList.deleteCustomDeckTitle,
      message: I18n.format(t.deckList.deleteCustomDeckMessage, { name: customDeck.name }),
      confirmText: t.deckList.confirmDelete,
      isDanger: true,
      onConfirm: () => {
        customDeckService
          .deleteCustomDeck(customDeck.id)
          .then(() => loadCustomDecks())
          .catch((e) => console.error("Failed to delete custom deck:", e));
      },
    }).open();
  }

  function openAnkiExportForCustomDeck(customDeck: CustomDeckGroup) {
    if (!app) {
      console.warn("Plugin not available for Anki export");
      return;
    }

    db.getFlashcardsForCustomDeck(customDeck.id)
      .then((cards) => {
        if (cards.length === 0) {
          new Notice(I18n.format(t.notices.noCardsFoundInGroup, { name: customDeck.name }));
          return;
        }

        const deckIds = [...new Set(cards.map((c) => c.deckId))];
        db.getDeckById(deckIds[0])
          .then((firstDeck) => {
            if (!firstDeck) {
              console.error("Cannot export: no source deck found");
              return;
            }

            const virtualDeck = {
              ...firstDeck,
              id: customDeck.id,
              name: customDeck.name,
              tag: `[Custom: ${customDeck.name}]`,
              filepath: `[Custom: ${customDeck.name}]`,
            };

            const modal = new AnkiExportModal(app, virtualDeck, db);
            modal.deckIds = deckIds;
            modal.isGroupExport = true;
            modal.open();
          })
          .catch((e) => console.error("Error opening Anki export:", e));
      })
      .catch((e) => console.error("Error loading custom deck cards:", e));
  }

  function resetCustomDeckProgress(customDeck: CustomDeckGroup) {
    new ConfirmModal(app, {
      title: t.deckList.resetCustomDeckTitle,
      message: I18n.format(t.deckList.resetCustomDeckProgress, { name: customDeck.name }),
      confirmText: t.deckList.resetProgress,
      isDanger: true,
      onConfirm: () => {
        db.resetCustomDeckProgress(customDeck.id)
          .then(() => db.save())
          .then(() => {
            new Notice(I18n.format(t.deckList.progressResetFor, { name: customDeck.name }));
            return loadCustomDecks();
          })
          .catch((e) => {
            console.error("Failed to reset custom deck progress:", e);
            new Notice(t.deckList.resetCustomDeckFailed);
          });
      },
    }).open();
  }

  // Measure, position (with viewport-bounds flipping), show and activate a
  // freshly-built dropdown near `button`. Shared by the folder menu.
  function positionAndActivateDropdown(
    dropdown: HTMLElement,
    button: HTMLElement,
    activeId: string,
  ) {
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    dropdown.addClass("decks-context-menu");
    activeDocument.body.appendChild(dropdown);
    const dropdownRect = dropdown.getBoundingClientRect();

    let top = rect.bottom + 5;
    let left = rect.left;
    if (top + dropdownRect.height > viewportHeight - 10) {
      top = rect.top - dropdownRect.height - 5;
    }
    if (left + dropdownRect.width > viewportWidth - 10) {
      left = viewportWidth - dropdownRect.width - 10;
    }
    top = Math.max(10, top);
    left = Math.max(10, left);

    dropdown.setCssProps({ top: `${top}px`, left: `${left}px` });
    dropdown.removeClass("decks-context-menu");
    dropdown.addClass("decks-context-menu-visible");

    activeDropdown = dropdown;
    activeDropdownDeckId = activeId;

    dropdownEventListeners.click = (e: Event) => {
      if (!dropdown.contains(e.target as Node)) closeActiveDropdown();
    };
    dropdownEventListeners.scroll = closeActiveDropdown;
    dropdownEventListeners.resize = closeActiveDropdown;
    window.setTimeout(() => {
      if (dropdownEventListeners.click) {
        activeDocument.addEventListener("click", dropdownEventListeners.click);
      }
      if (dropdownEventListeners.scroll) {
        window.addEventListener("scroll", dropdownEventListeners.scroll, true);
      }
      if (dropdownEventListeners.resize) {
        window.addEventListener("resize", dropdownEventListeners.resize);
      }
    }, 0);
  }

  function buildDropdownOption(label: string, onClick: () => void): HTMLDivElement {
    const option = activeDocument.createElement("div");
    option.className = "decks-dropdown-option";
    option.textContent = label;
    option.onclick = () => {
      closeActiveDropdown();
      onClick();
    };
    return option;
  }

  // Options menu for a folder / tag-folder node: subtree actions over a real
  // (backed tag) or synthetic (folder) deck group.
  function handleFolderConfigClick(node: TreeNode, event: Event) {
    event.stopPropagation();

    if (activeDropdown && activeDropdownDeckId === node.id) {
      closeActiveDropdown();
      return;
    }
    closeActiveDropdown();

    const group = groupForNode(node);
    const dropdown = activeDocument.createElement("div");
    dropdown.className = "decks-deck-config-dropdown";

    dropdown.appendChild(
      buildDropdownOption(t.deckList.studyAll, () => onDeckGroupClick(group)),
    );
    dropdown.appendChild(
      buildDropdownOption(t.deckList.browseAllCards, () => onBrowseDeckGroup(group)),
    );
    if (onCramDeckGroup) {
      const cramOption = buildDropdownOption(t.deckList.cram, () =>
        onCramDeckGroup?.(group),
      );
      isCramResumableGroup?.(group).then((resumable) => {
        if (resumable) cramOption.textContent = t.deckList.resumeCram;
      });
      dropdown.appendChild(cramOption);
    }
    dropdown.appendChild(
      buildDropdownOption(t.deckList.exportToAnki, () => openAnkiExportForGroup(group)),
    );
    // Pin only applies to a real tag group — a folder id isn't in the pin space.
    if (node.group) {
      dropdown.appendChild(buildPinDropdownOption(generateDeckGroupId(node.group.tag)));
    }

    positionAndActivateDropdown(dropdown, event.target as HTMLElement, node.id);
  }

  function closeActiveDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
      activeDropdownDeckId = null;

      // Clean up all event listeners
      if (dropdownEventListeners.click) {
        activeDocument.removeEventListener("click", dropdownEventListeners.click);
      }
      if (dropdownEventListeners.scroll) {
        window.removeEventListener(
          "scroll",
          dropdownEventListeners.scroll,
          true
        );
      }
      if (dropdownEventListeners.resize) {
        window.removeEventListener("resize", dropdownEventListeners.resize);
      }

      // Clear stored references
      dropdownEventListeners = {};
    }
  }

  onDestroy(() => {
    closeActiveDropdown();
  });

  function openAnkiExport(deck: DeckWithProfile) {
    if (!app) {
      console.warn("Plugin not available for Anki export");
      return;
    }
    const modal = new AnkiExportModal(app, deck, db);
    modal.open();
  }

  function openResetDeckModal(deck: DeckWithProfile) {
    if (!app) {
      console.warn("Plugin not available for deck reset");
      return;
    }
    const modal = new DeckResetModal(app, deck, db, onRefresh);
    modal.open();
  }

  async function openAnkiExportForGroup(group: DeckGroup) {
    if (!app) {
      console.warn("Plugin not available for Anki export");
      return;
    }

    // For deck groups, we'll create a virtual deck that represents all decks in the group
    // The AnkiExportModal will need to query all flashcards from all deckIds
    // We'll use the first deck as a template but with the group's tag
    try {
      const firstDeck = await db.getDeckById(group.deckIds[0]);
      if (!firstDeck) {
        console.error("Cannot export: no decks found in group");
        return;
      }

      // Create a virtual deck object for the export modal
      const virtualDeck = {
        ...firstDeck,
        id: generateDeckGroupId(group.tag),
        name: group.name,
        tag: group.tag,
        // Store the deck IDs in a way the export modal can access them
        filepath: `[Tag Group: ${group.tag}]`,
      };

      // Pass the virtual deck with the group's deck IDs
      // The export modal will need to be updated to handle this case
      const modal = new AnkiExportModal(app, virtualDeck, db);

      // Store deck IDs on the modal instance so it can query all flashcards
      modal.deckIds = group.deckIds;
      modal.isGroupExport = true;

      modal.open();
    } catch (error) {
      console.error("Error opening Anki export for group:", error);
    }
  }

  function handleTouchClick(callback: () => void, event: Event) {
    const now = Date.now();
    const eventType = event.type;

    // Prevent double execution within 100ms
    if (now - lastEventTime < 100 && lastEventType !== eventType) {
      return;
    }

    lastEventTime = now;
    lastEventType = eventType;

    callback();
  }

  onMount(() => {
    // Initial load
    // handleRefresh();
  });
</script>

<svelte:window on:click={() => { headerOverflowOpen = false; }} />

<div class="decks-deck-list-panel" bind:clientWidth={panelWidth}>
  <div class="decks-panel-header">
    <div class="decks-panel-title">{t.deckList.title}</div>
    <div class="decks-header-buttons">
      {#if !isHeaderCompact}
        <button
          class="clickable-icon"
          on:click={onOpenDeckConfig}
          title={t.deckList.configureDeck}
          disabled={allDecks.length === 0}
          aria-label={t.deckList.configureDeck}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
        </button>
        <button
          class="clickable-icon"
          on:click={onOpenProfilesManager}
          title={t.deckList.profiles}
          aria-label={t.deckList.profiles}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
        <button
          class="clickable-icon"
          on:click={openFlashcardManager}
          title={t.deckList.openManager}
          aria-label={t.deckList.openManager}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        </button>
        <button
          class="clickable-icon"
          on:click={onOpenSrMigration}
          title={t.deckList.srMigration}
          aria-label={t.deckList.srMigration}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="7.5 4.21 12 6.81 16.5 4.21"></polyline><polyline points="7.5 19.79 7.5 14.6 3 12"></polyline><polyline points="21 12 16.5 14.6 16.5 19.79"></polyline><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
        </button>
        <button
          class="clickable-icon"
          on:click={onOpenAnkiImport}
          title={t.deckList.ankiImport}
          aria-label={t.deckList.ankiImport}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m8 11 4 4 4-4"></path><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"></path></svg>
        </button>
        <button
          class="clickable-icon"
          on:click={onOpenStatistics}
          title={t.deckList.statistics}
          aria-label={t.deckList.statistics}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path></svg>
        </button>
      {/if}
      <button
        class="clickable-icon"
        on:click={() => openAiGeneratorModal()}
        disabled={!aiEnabled}
        title={t.deckList.aiGenerate}
        aria-label={t.deckList.aiGenerate}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"></path><path d="M15 16v-2"></path><path d="M8 9h2"></path><path d="M20 9h2"></path><path d="M17.8 11.8 19 13"></path><path d="M15 9h.01"></path><path d="M17.8 6.2 19 5"></path><path d="m3 21 9-9"></path><path d="M12.2 6.2 11 5"></path></svg>
      </button>
      <button
        class="clickable-icon"
        class:decks-refreshing={isRefreshing || isSyncing}
        on:click={() => void handleRefresh()}
        disabled={isRefreshing}
        title={isSyncing ? t.deckList.syncing : t.deckList.refresh}
        aria-label={t.deckList.refresh}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
      </button>
      {#if isHeaderCompact}
        <div class="decks-overflow-container">
          <button
            class="clickable-icon"
            on:click|stopPropagation={() => (headerOverflowOpen = !headerOverflowOpen)}
            title={t.deckList.moreActions ?? "More actions"}
            aria-label={t.deckList.moreActions ?? "More actions"}
            aria-expanded={headerOverflowOpen}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
          </button>
          {#if headerOverflowOpen}
            <div class="decks-overflow-menu decks-overflow-menu-header">
              <button
                class="decks-overflow-item"
                on:click={() => { onOpenDeckConfig(); headerOverflowOpen = false; }}
                disabled={allDecks.length === 0}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                {t.deckList.configureDeck}
              </button>
              <button
                class="decks-overflow-item"
                on:click={() => { onOpenProfilesManager(); headerOverflowOpen = false; }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                {t.deckList.profiles}
              </button>
              <button
                class="decks-overflow-item"
                on:click={() => { openFlashcardManager(); headerOverflowOpen = false; }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                {t.deckList.openManager}
              </button>
              <button
                class="decks-overflow-item"
                on:click={() => { onOpenSrMigration(); headerOverflowOpen = false; }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                {t.deckList.srMigration}
              </button>
              <button
                class="decks-overflow-item"
                on:click={() => { onOpenAnkiImport(); headerOverflowOpen = false; }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m8 11 4 4 4-4"></path><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"></path></svg>
                {t.deckList.ankiImport}
              </button>
              <button
                class="decks-overflow-item"
                on:click={() => { onOpenStatistics(); headerOverflowOpen = false; }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path></svg>
                {t.deckList.statistics}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="decks-deck-content">
    <div class="decks-filter-row">
      <div class="decks-filter-input-wrapper">
        <svg class="decks-filter-search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input
          type="text"
          class="decks-filter-input"
          placeholder={t.deckList.filterPlaceholder}
          bind:value={filterText}
          on:keydown={handleSearchKeydown}
        />
        {#if filterText}
          <button
            class="clickable-icon decks-filter-clear-button"
            aria-label={t.deckList.clearFilter}
            on:click={clearFilter}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        {/if}
      </div>
      <div class="decks-view-toggle" role="group" aria-label={t.deckList.viewToggle}>
        <button
          type="button"
          class="decks-view-toggle-btn"
          class:decks-view-toggle-active={deckListView === "tree"}
          on:click={() => setDeckListView("tree")}
          title={t.deckList.treeView}
          aria-label={t.deckList.treeView}
          aria-pressed={deckListView === "tree"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12h-8"></path><path d="M21 6H8"></path><path d="M21 18h-8"></path><path d="M3 6v4c0 1.1.9 2 2 2h3"></path><path d="M3 10v6c0 1.1.9 2 2 2h3"></path></svg>
        </button>
        <button
          type="button"
          class="decks-view-toggle-btn"
          class:decks-view-toggle-active={deckListView === "flat"}
          on:click={() => setDeckListView("flat")}
          title={t.deckList.flatView}
          aria-label={t.deckList.flatView}
          aria-pressed={deckListView === "flat"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
        </button>
      </div>
      <button
        class="clickable-icon decks-collapse-all-button"
        on:click={toggleCollapseAll}
        title={t.deckList.collapseAll}
        aria-label={t.deckList.collapseAll}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
      </button>
    </div>

    {#if allDecks.length === 0 && customDeckGroups.length === 0}
      <div class="decks-empty-state">
        <p>{t.deckList.emptyNoDecks}</p>
        <p class="decks-help-text">
          {I18n.format(t.deckList.tagYourNotes, { tag: deckTag })}
        </p>
      </div>
    {:else if filtering && matchingLeafCount === 0}
      <div class="decks-empty-state">
        <p>{t.deckList.emptyNoFilterMatch}</p>
        <p class="decks-help-text">{t.deckList.emptyFilterHint}</p>
      </div>
    {:else}
      <div class="decks-deck-table">
        <div
          class="decks-table-body"
          class:decks-table-compact={tableBodyWidth > 0 && tableBodyWidth < 250}
          class:decks-stat-labels-trimmed={tableBodyWidth > 0 && tableBodyWidth < 420}
          bind:clientWidth={tableBodyWidth}
        >
          <div class="decks-table-header">
            <button
              type="button"
              class="decks-col-deck decks-col-sortable"
              class:decks-col-sortable-active={nameSortActive}
              on:click={() => void clickSortColumn("name")}
              aria-label={t.deckList.sortByName}
            >
              <span>{t.deckList.columnDeck}</span>
              <span class="decks-sort-arrow" use:sortIconAction={nameArrow}></span>
            </button>
            <button
              type="button"
              class="decks-col-stat decks-col-sortable"
              class:decks-col-sortable-active={newSortActive}
              on:click={() => void clickSortColumn("new")}
              aria-label={t.deckList.sortByNewCardCount}
            >
              <span class="decks-col-stat-label">{t.deckList.columnNew}</span>
              <span class="decks-sort-arrow" use:sortIconAction={newArrow}></span>
            </button>
            <button
              type="button"
              class="decks-col-stat decks-col-sortable"
              class:decks-col-sortable-active={dueSortActive}
              on:click={() => void clickSortColumn("due")}
              aria-label={t.deckList.sortByDueCardCount}
            >
              <span class="decks-col-stat-label">{t.deckList.columnDue}</span>
              <span class="decks-sort-arrow" use:sortIconAction={dueArrow}></span>
            </button>
            <div class="decks-col-config"></div>
          </div>
          {#each flattenedRows as row (row.node.id)}
            {@const node = row.node}
            {@const icon = rowIcon(node)}
            <div
              class="decks-deck-row decks-tree-row-{node.kind}"
              class:decks-deck-row-pinned={node.pinned}
              in:fade|global={{ duration: 120 }}
            >
              <div class="decks-col-deck">
                <span class="decks-tree-indent" style="--decks-indent: {node.depth * 16}px;"></span>
                <span class="decks-tree-chevron-slot">
                  {#if node.kind !== "leaf"}
                    <button
                      class="decks-tree-chevron"
                      class:decks-tree-chevron-open={row.expanded}
                      on:click|stopPropagation={() => toggleCollapse(node.id)}
                      aria-label={row.expanded ? t.deckList.collapse : t.deckList.expand}
                      aria-expanded={row.expanded}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                  {:else}
                    <span class="decks-tree-chevron decks-tree-chevron-hidden" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </span>
                  {/if}
                </span>
                <span class="decks-tree-icon-slot">
                  {#if node.pinned}
                    <span class="decks-pin-indicator" use:pinIconAction={"pin"} title={t.deckList.pinned}></span>
                  {:else if icon?.emoji}
                    <span class="decks-tag-group-icon">{icon.emoji}</span>
                  {:else if icon?.lucide}
                    <span class="decks-tree-folder-icon" use:pinIconAction={icon.lucide}></span>
                  {/if}
                </span>
                <span
                  class="decks-deck-name-link"
                  on:click={(e) => handleTouchClick(() => handleRowStudy(node), e)}
                  on:touchend={(e) => handleTouchClick(() => handleRowStudy(node), e)}
                  on:keydown={(e) => e.key === "Enter" && handleRowStudy(node)}
                  role="button"
                  tabindex="0"
                  title={node.kind === "leaf"
                    ? I18n.format(t.deckList.clickToReview, { name: node.name })
                    : node.kind === "section"
                      ? node.name
                      : I18n.format(t.deckList.reviewAllUnder, { name: node.name })}
                >
                  <span class="decks-deck-name-text">{node.name}</span>
                  {#if node.kind === "section"}
                    <span class="decks-tag-group-count">{sectionMeta(node)}</span>
                  {:else if node.id.startsWith("tag:")}
                    <span class="decks-tag-group-count"
                      >{I18n.format(t.deckList.filesCount, { count: node.deckIds.length })}</span
                    >
                  {:else if node.customDeck && node.customDeck.deckType === "filter"}
                    <span class="decks-tag-group-count"
                      >{I18n.format(t.deckList.cardsCount, { count: getDeckStats(node.customDeck.id).totalCount })}</span
                    >
                  {:else if node.customDeck}
                    <span class="decks-tag-group-count"
                      >{I18n.format(t.deckList.cardsCount, { count: node.customDeck.flashcardIds.length })}</span
                    >
                  {/if}
                </span>
              </div>
              <div
                class="decks-col-stat"
                class:has-cards={node.newCount > 0}
                class:updating={isUpdatingStats}
                class:has-limit={node.hasLimit}
                title={newTitle(node)}
              >
                {node.newCount}
                {#if node.hasLimit}
                  <span class="decks-limit-indicator">⚠</span>
                {/if}
              </div>
              <div
                class="decks-col-stat"
                class:has-cards={node.dueCount > 0}
                class:updating={isUpdatingStats}
                class:has-limit={reviewLimited(node)}
                title={dueTitle(node)}
              >
                {node.dueCount}
                {#if reviewLimited(node)}
                  <span class="decks-limit-indicator">📅</span>
                {/if}
              </div>
              <div class="decks-col-config">
                {#if node.kind !== "section"}
                  <button
                    class="clickable-icon decks-row-action"
                    on:click={(e) => handleTouchClick(() => handleRowConfig(node, e), e)}
                    on:touchend={(e) => handleTouchClick(() => handleRowConfig(node, e), e)}
                    title={t.deckList.optionsDeck}
                    aria-label={I18n.format(t.deckList.optionsForItem, { name: node.name })}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

  </div>

  <div class="decks-heatmap-section">
    <ReviewHeatmap bind:this={heatmapComponent} {getReviewCounts} />
  </div>

  <div class="decks-study-stats-section">
    {#if studyStats.todayCards > 0}
      <div class="decks-today-summary">
        {I18n.format(t.deckList.studiedSummary, {
          cards: studyStats.todayCards,
          hours: formatHours(studyStats.todayHours),
          pace: formatPace(studyStats.todayPaceSeconds),
        })}
      </div>
    {/if}

    <div class="decks-stats-grid">
      {#if globalReviewToday}
        <div class="decks-stat-item">
          <div class="decks-stat-label">{t.deckList.statCardsToday}</div>
          <div
            class="decks-stat-value"
            class:decks-cap-reached={globalReviewToday.done >= globalReviewToday.cap}
          >
            {globalReviewToday.done}/{globalReviewToday.cap}
          </div>
        </div>
      {/if}
      <div class="decks-stat-item">
        <div class="decks-stat-label">{t.deckList.statTotal}</div>
        <div class="decks-stat-value">
          {formatHours(studyStats.totalHours)}
        </div>
      </div>
      <div class="decks-stat-item">
        <div class="decks-stat-label">{t.deckList.statPastMonth}</div>
        <div class="decks-stat-value">
          {formatHours(studyStats.pastMonthHours)}
        </div>
      </div>
      <div class="decks-stat-item">
        <div class="decks-stat-label">{t.deckList.statPastWeek}</div>
        <div class="decks-stat-value">
          {formatHours(studyStats.pastWeekHours)}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* ── Layout ── */
  .decks-deck-list-panel {
    width: 100%;
    height: 100%;
    max-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: var(--background-primary);
    color: var(--text-normal);
    touch-action: manipulation;
    user-select: none;
    overflow: hidden;
    padding-bottom: var(--size-4-3);
    -webkit-tap-highlight-color: transparent;
  }

  .decks-deck-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  /* ── Header ── */
  .decks-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--size-4-1) var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-panel-title {
    margin: 0;
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
  }

  .decks-header-buttons {
    display: flex;
    gap: var(--size-2-1);
    align-items: center;
  }

  /* Flat interaction — no focus ring and no press "bounce" on any panel button
     or the deck-name link (a role=button span). */
  .decks-deck-list-panel button:focus,
  .decks-deck-list-panel button:focus-visible,
  .decks-deck-list-panel .clickable-icon:focus,
  .decks-deck-list-panel .clickable-icon:focus-visible,
  .decks-deck-list-panel .decks-deck-name-link:focus,
  .decks-deck-list-panel .decks-deck-name-link:focus-visible {
    outline: none;
    box-shadow: none;
  }

  .decks-deck-list-panel button:not(.decks-tree-chevron):active,
  .decks-deck-list-panel .clickable-icon:active,
  .decks-deck-list-panel .decks-deck-name-link:active {
    transform: none;
  }

  /* Compact icon buttons in the header + filter row. */
  .decks-header-buttons .clickable-icon,
  .decks-collapse-all-button {
    padding: var(--size-2-2);
    min-width: 0;
    min-height: 0;
  }

  .decks-refreshing :global(svg) {
    animation: decks-spin 1s linear infinite;
  }

  @keyframes decks-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Filter row (search + view toggle + collapse-all) ── */
  .decks-filter-row {
    display: flex;
    align-items: center;
    gap: var(--size-4-1);
    padding: var(--size-4-1) var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-filter-row .decks-filter-input-wrapper {
    flex: 1;
    min-width: 0;
  }

  /* Compact, uniform icon button for the collapse-all control (override the
     larger clickable-icon default so it matches the view toggle). */
  .decks-collapse-all-button {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    min-height: 0;
    min-width: 0;
    padding: 0;
  }

  /* View toggle (tree / flat) — segmented control. */
  .decks-view-toggle {
    display: flex;
    flex-shrink: 0;
    background: var(--background-modifier-hover);
    border-radius: var(--radius-s);
    padding: 2px;
    gap: 2px;
  }

  .decks-view-toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    min-height: 0;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-s);
    cursor: pointer;
    box-shadow: none;
  }

  .decks-view-toggle-btn:hover {
    color: var(--text-normal);
  }

  .decks-view-toggle-active {
    background: var(--background-primary);
    color: var(--text-normal);
    box-shadow: var(--shadow-s);
  }

  .decks-view-toggle-btn :global(svg) {
    width: 15px;
    height: 15px;
  }

  .decks-filter-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .decks-filter-search-icon {
    position: absolute;
    left: var(--size-4-2);
    color: var(--text-faint);
    pointer-events: none;
  }

  .decks-filter-clear-button {
    position: absolute;
    right: var(--size-4-1);
  }

  .decks-filter-input {
    width: 100%;
    height: 28px;
    padding: 0 30px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    background: var(--background-modifier-form-field);
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    box-sizing: border-box;
  }

  .decks-filter-input:focus {
    outline: none;
    border-color: var(--background-modifier-border-focus);
    box-shadow: none;
  }

  .decks-filter-input::placeholder {
    color: var(--text-faint);
  }

  /* ── Deck table ── */
  .decks-deck-table {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    width: 100%;
    box-sizing: border-box;
    min-height: 0;
  }

  .decks-table-header {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    padding: var(--size-2-1) var(--size-4-3) var(--size-2-1) 14px;
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--background-modifier-border);
    align-items: center;
    position: sticky;
    top: 0;
    background: var(--background-primary);
    z-index: 1;
  }

  /* Sortable column header: strips default <button> chrome so it reads
     as the same flat label, plus a hover cue + a tucked-in sort arrow. */
  .decks-col-sortable {
    background: transparent;
    border: none;
    outline: none;
    padding: 0;
    margin: 0;
    min-height: 0;
    min-width: 0;
    font: inherit;
    color: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    box-shadow: none;
  }

  .decks-col-sortable:hover {
    color: var(--text-normal);
  }

  .decks-col-sortable:focus,
  .decks-col-sortable:focus-visible {
    outline: none;
    box-shadow: none;
  }

  /* Deck name column header: left-align label + arrow inside its grid cell. */
  .decks-col-deck.decks-col-sortable {
    justify-content: flex-start;
  }

  /* Stat columns are right-aligned — keep the same alignment when the
     header becomes a sortable button. Columns auto-size via subgrid so no
     truncation is needed. */
  .decks-col-stat.decks-col-sortable {
    justify-content: flex-end;
  }

  /* Arrow: dimmed by default so it reads as an affordance, not a state.
     Active column gets full-opacity accent color. */
  .decks-sort-arrow {
    display: inline-flex;
    align-items: center;
    color: var(--text-faint);
    opacity: 0.6;
  }

  .decks-col-sortable-active .decks-sort-arrow {
    color: var(--text-accent);
    opacity: 1;
  }

  .decks-sort-arrow :global(svg) {
    width: 12px;
    height: 12px;
  }

  .decks-table-body {
    flex: 1;
    overflow-y: scroll;
    overflow-x: hidden;
    max-height: calc(100vh - 240px);
    display: grid;
    grid-template-columns: 1fr auto auto 36px;
    grid-auto-rows: min-content;
    column-gap: 20px;
    align-content: start;
  }

  .decks-table-compact {
    grid-template-columns: 1fr 36px;
    column-gap: 16px;
  }

  .decks-table-compact .decks-col-stat {
    display: none;
  }

  .decks-deck-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    min-height: 26px;
    padding: 0 var(--size-4-3);
    align-items: center;
    border-radius: var(--radius-s);
  }

  .decks-deck-row:hover {
    background-color: var(--background-modifier-hover);
  }

  /* ── Deck name ── */
  .decks-col-deck {
    display: flex;
    align-items: center;
    font-size: var(--font-ui-small);
    color: var(--text-normal);
    justify-self: start;
    min-width: 0;
    width: 100%;
  }

  .decks-deck-name-link {
    flex: 1 1 auto;
    min-width: 0;
    cursor: pointer;
    color: var(--text-normal);
    display: flex;
    align-items: center;
    border-radius: var(--radius-s);
  }

  .decks-deck-name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .decks-deck-name-link:hover {
    color: var(--text-accent);
  }

  .decks-tag-group-icon {
    flex-shrink: 0;
    font-size: 11px;
  }

  .decks-tag-group-count {
    flex-shrink: 0;
    margin-left: var(--size-4-1);
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    font-weight: normal;
  }

  /* ── Stat columns ── */
  .decks-col-stat {
    text-align: right;
    font-size: var(--font-ui-small);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .decks-col-stat-label {
    display: block;
    white-space: nowrap;
  }

  .decks-stat-labels-trimmed .decks-col-stat-label {
    max-width: 4ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .decks-col-stat.has-cards {
    color: var(--text-accent);
    font-weight: var(--font-medium);
  }

  .decks-col-stat.updating {
    opacity: 0.5;
  }

  .decks-col-stat.has-limit {
    position: relative;
  }

  .decks-limit-indicator {
    font-size: 9px;
    margin-left: 2px;
    opacity: 0.6;
  }

  /* ── Row action (gear) — hidden until hover ── */
  .decks-col-config {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 0;
  }

  .decks-row-action {
    opacity: 0;
    transition: opacity 0.15s ease;
    box-shadow: none !important;
    border: none !important;
    width: 24px;
    height: 24px;
    min-height: 0;
    min-width: 0;
    padding: 0;
  }

  .decks-row-action :global(svg) {
    width: 14px;
    height: 14px;
  }

  .decks-deck-row:hover .decks-row-action {
    opacity: 1;
  }

  /* ── Empty state ── */
  .decks-empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: var(--size-4-8);
    text-align: center;
    color: var(--text-muted);
  }

  .decks-empty-state p {
    margin: var(--size-4-2) 0;
  }

  .decks-help-text {
    font-size: var(--font-ui-small);
    color: var(--text-faint);
  }

  /* ── Heatmap ── */
  .decks-heatmap-section {
    flex-shrink: 0;
    border-top: 1px solid var(--background-modifier-border);
  }

  /* ── Study stats footer ── */
  .decks-study-stats-section {
    padding: var(--size-4-3);
  }

  .decks-today-summary {
    text-align: center;
    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-normal);
    margin-bottom: var(--size-4-3);
    padding-bottom: var(--size-4-2);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-stat-value.decks-cap-reached {
    color: var(--text-accent);
  }

  .decks-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
    gap: var(--size-4-3);
  }

  .decks-stat-item {
    text-align: center;
  }

  .decks-stat-label {
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    margin-bottom: var(--size-4-1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .decks-stat-value {
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
    font-variant-numeric: tabular-nums;
  }

  /* ── Context menu (global, appended to body) ── */
  :global(.decks-deck-config-dropdown) {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-s);
    padding: var(--size-2-3) 0;
    min-width: 160px;
  }

  :global(.decks-context-menu) {
    position: fixed;
    z-index: calc(var(--layer-modal) + 1);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.1s ease, visibility 0.1s ease;
  }

  :global(.decks-context-menu-visible) {
    position: fixed;
    z-index: calc(var(--layer-modal) + 1);
    opacity: 1;
    visibility: visible;
  }

  :global(.decks-dropdown-option) {
    padding: var(--size-4-1) var(--size-4-3);
    cursor: pointer;
    font-size: var(--font-ui-small);
    color: var(--text-normal);
    display: flex;
    align-items: center;
    gap: var(--size-2-3);
  }

  :global(.decks-dropdown-option:hover) {
    background: var(--background-modifier-hover);
  }

  :global(.decks-dropdown-option-icon) {
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
  }

  :global(.decks-dropdown-option-icon svg) {
    width: 14px;
    height: 14px;
  }

  /* Pinned row indicator + subtle accent on the row itself */
  .decks-pin-indicator {
    display: inline-flex;
    align-items: center;
    color: var(--text-accent);
    vertical-align: middle;
  }

  .decks-pin-indicator :global(svg) {
    width: 12px;
    height: 12px;
  }

  .decks-deck-row-pinned {
    border-left: 2px solid var(--text-accent);
    padding-left: calc(var(--size-4-3) - 2px);
  }

  /* ── Scrollbar ── */
  .decks-table-body::-webkit-scrollbar {
    width: 6px;
  }

  .decks-table-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .decks-table-body::-webkit-scrollbar-thumb {
    background: var(--background-modifier-border);
    border-radius: var(--radius-s);
  }

  .decks-table-body::-webkit-scrollbar-thumb:hover {
    background: var(--background-modifier-border-hover);
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    .decks-filter-input {
      font-size: 16px;
    }

    .decks-row-action {
      opacity: 1;
    }

    .decks-table-body {
      column-gap: 8px;
    }
  }

  /* ── Overflow menus (header + tabs compact) ── */
  .decks-overflow-container {
    position: relative;
  }

  .decks-overflow-menu {
    position: absolute;
    top: 100%;
    right: 0;
    min-width: 160px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    box-shadow: var(--shadow-s);
    z-index: 100;
    display: flex;
    flex-direction: column;
    padding: var(--size-4-1);
  }

  .decks-overflow-item {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    padding: var(--size-4-1) var(--size-4-2);
    background: none;
    border: none;
    border-radius: var(--radius-s);
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .decks-overflow-item:hover {
    background: var(--background-modifier-hover);
  }

  /* ── Tree rows (section / folder / leaf) ── */
  .decks-tree-indent {
    flex-shrink: 0;
    width: var(--decks-indent, 0);
  }

  .decks-tree-chevron {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-s);
    box-shadow: none;
    transition: transform 0.12s ease;
  }

  .decks-tree-chevron:hover {
    color: var(--text-normal);
  }

  .decks-tree-chevron-open {
    transform: rotate(90deg);
  }

  /* Leaf rows render this hidden chevron so the slot always has content and
     never collapses; it keeps the same 16px box, just invisible. */
  .decks-tree-chevron-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* Fixed-width slot so leaf rows (chevron hidden) reserve exactly the same
     space as folder rows, keeping icons/labels aligned at every depth. Uses the
     same width pattern as .decks-tree-indent, which reserves space reliably. */
  .decks-tree-chevron-slot {
    flex-shrink: 0;
    width: 16px;
    min-width: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .decks-tree-chevron :global(svg),
  .decks-tree-folder-icon :global(svg) {
    width: 14px;
    height: 14px;
  }

  /* Fixed icon slot so every row (folder, tag, custom, file, section) reserves
     the same space before its label — files/folders/leaves stay aligned. */
  .decks-tree-icon-slot {
    flex-shrink: 0;
    width: 18px;
    min-width: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: var(--size-4-1);
  }

  .decks-tree-folder-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  /* Section header row: subtle fill + uppercase label, expand/collapse only. */
  .decks-tree-row-section {
    min-height: 26px;
    background: var(--background-secondary);
  }

  .decks-tree-row-section .decks-deck-name-link {
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .decks-tree-row-section .decks-deck-name-link:hover {
    color: var(--text-normal);
  }

  .decks-tree-row-folder .decks-deck-name-link {
    font-weight: var(--font-medium);
  }
</style>
