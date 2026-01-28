<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { DeckWithProfile, DeckStats, DeckGroup, DeckOrGroup } from "../database/types";
  import { isDeckGroup, isFileDeck } from "../database/types";
  import { generateDeckGroupId } from "../utils/hash";

  import ReviewHeatmap from "./statistics/ReviewHeatmap.svelte";
  import { AnkiExportModal } from "./export/AnkiExportModal";
  import type { StatisticsService } from "@/services/StatisticsService";
  import type { DeckSynchronizer } from "@/services/DeckSynchronizer";
  import type { IDatabaseService } from "@/database/DatabaseFactory";
  import type { TagGroupService } from "@/services/TagGroupService";
  import type { App } from "obsidian";

  let decks: DeckWithProfile[] = [];
  let allDecks: DeckWithProfile[] = [];
  let stats = new Map<string, DeckStats>();
  let filterText = "";
  let heatmapComponent: ReviewHeatmap;
  let showSuggestions = false;
  let availableTags: string[] = [];
  let filteredSuggestions: string[] = [];
  let inputFocused = false;
  let activeDropdown: HTMLElement | null = null;
  let activeDropdownDeckId: string | null = null;
  let dropdownEventListeners: {
    click?: (e: Event) => void;
    scroll?: () => void;
    resize?: () => void;
  } = {};

  let viewMode: 'files' | 'tags' = 'files';
  let deckGroups: DeckGroup[] = [];
  let currentItems: DeckOrGroup[] = [];

  export let statisticsService: StatisticsService;
  export let deckSynchronizer: DeckSynchronizer;
  export let db: IDatabaseService;
  export let tagGroupService: TagGroupService;

  export let onDeckClick: (deck: DeckWithProfile) => void;
  export let onDeckGroupClick: (deckGroup: DeckGroup) => void;

  export let app: App;

  export let onRefresh: () => Promise<void>;
  export let onForceRefreshDeck: (deckId: string) => Promise<void>;
  export let openStatisticsModal: () => void;
  export let openProfilesManagerModal: () => void;
  export let openDeckConfigModal: (deck: DeckWithProfile) => void;

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
  const onOpenDeckConfig = () => {
    if (allDecks.length > 0) {
      openDeckConfigModal(allDecks[0]);
    }
  };

  let isRefreshing = false;
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

  function getItemId(item: DeckOrGroup): string {
    if (isDeckGroup(item)) {
      return generateDeckGroupId(item.tag);
    }
    return item.id;
  }

  function getDeckStats(deckId: string): DeckStats {
    return (
      stats.get(deckId) ?? {
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
    } catch (error) {
      console.error("Error during refresh:", error);
    } finally {
      isRefreshing = false;
    }
  }

  async function handleForceRefreshDeck(deck: DeckWithProfile) {
    isRefreshing = true;
    try {
      await onForceRefreshDeck(deck.id);
      refreshHeatmap();
      await loadStudyStats();
    } catch (error) {
      console.error("Error during deck force refresh:", error);
    } finally {
      isRefreshing = false;
    }
  }

  export function updateStatsById(deckId: string, newStats: DeckStats) {
    isUpdatingStats = true;
    stats.set(deckId, newStats);
    // eslint-disable-next-line no-self-assign
    decks = decks;
    loadStudyStats().catch(console.error);
    isUpdatingStats = false;
  }
  // Function to force UI update when stats change
  export function updateStats(newStats: Map<string, DeckStats>) {
    isUpdatingStats = true;
    stats = newStats;
    // eslint-disable-next-line no-self-assign
    decks = decks;
    isUpdatingStats = false;
  }
  $: currentItems = viewMode === 'files'
    ? allDecks.map(d => ({ ...d, type: 'file' as const }))
    : deckGroups;

  $: filteredItems = filterItems(currentItems, filterText);

  function filterItems(items: DeckOrGroup[], filter: string): DeckOrGroup[] {
    if (!filter.trim()) return items;
    const filterLower = filter.toLowerCase();
    return items.filter(item =>
      item.name.toLowerCase().includes(filterLower) ||
      item.tag.toLowerCase().includes(filterLower)
    );
  }

  export function updateDecks(newDecks: DeckWithProfile[]) {
    allDecks = newDecks;
    // Extract unique tags
    availableTags = [...new Set(newDecks.map((deck) => deck.tag))].filter(
      (tag) => tag
    );

    // Generate deck groups asynchronously
    tagGroupService.aggregateByTag(newDecks)
      .then(groups => {
        deckGroups = groups;
      })
      .catch(console.error);

    applyFilter();
  }

  function applyFilter() {
    if (!filterText.trim()) {
      decks = allDecks;
    } else {
      const filter = filterText.toLowerCase();
      decks = allDecks.filter(
        (deck) =>
          deck.name.toLowerCase().includes(filter) ||
          deck.tag.toLowerCase().includes(filter)
      );
    }
  }

  function handleFilterInput(event: Event) {
    const target = event.target as HTMLInputElement;
    filterText = target.value;
    updateSuggestions();
    applyFilter();
  }

  function updateSuggestions() {
    if (!filterText.trim()) {
      showSuggestions = false;
      return;
    }

    const filter = filterText.toLowerCase();
    filteredSuggestions = availableTags.filter(
      (tag) =>
        tag.toLowerCase().includes(filter) && tag.toLowerCase() !== filter
    );
    showSuggestions = filteredSuggestions.length > 0;
  }

  function selectSuggestion(tag: string) {
    filterText = tag;
    showSuggestions = false;
    applyFilter();
  }

  function handleFilterFocus() {
    inputFocused = true;
    if (filterText.trim()) {
      updateSuggestions();
    } else if (availableTags.length > 0) {
      showSuggestions = true;
    }
  }

  function handleFilterBlur() {
    inputFocused = false;
    // Delay hiding suggestions to allow clicks
    setTimeout(() => {
      showSuggestions = false;
    }, 200);
  }

  function handleItemClick(item: DeckOrGroup) {
    if (isDeckGroup(item)) {
      onDeckGroupClick(item);
    } else {
      onDeckClick(item);
    }
  }

  export function refreshHeatmap() {
    if (heatmapComponent) {
      heatmapComponent.refresh();
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
    }
    refreshHeatmap();
    await loadStudyStats();
  }

  // Load study stats on component mount
  onMount(() => {
    void loadStudyStats();
  });

  function handleGroupConfigClick(group: DeckGroup, event: Event) {
    event.stopPropagation();
    openAnkiExportForGroup(group);
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
    const dropdown = document.createElement("div");
    dropdown.className = "decks-deck-config-dropdown";

    const forceRefreshOption = document.createElement("div");
    forceRefreshOption.className = "decks-dropdown-option";
    forceRefreshOption.textContent = "Force refresh";
    forceRefreshOption.onclick = () => {
      closeActiveDropdown();
      void handleForceRefreshDeck(deck);
    };

    const exportOption = document.createElement("div");
    exportOption.className = "decks-dropdown-option";
    exportOption.textContent = "Export to Anki";
    exportOption.onclick = () => {
      closeActiveDropdown();
      openAnkiExport(deck);
    };

    dropdown.appendChild(forceRefreshOption);
    dropdown.appendChild(exportOption);

    // Position dropdown with viewport bounds checking
    const button = event.target as HTMLElement;
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    dropdown.addClass("decks-context-menu");

    // Temporarily append to measure dimensions
    document.body.appendChild(dropdown);
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
    setTimeout(() => {
      if (dropdownEventListeners.click) {
        document.addEventListener("click", dropdownEventListeners.click);
      }
      if (dropdownEventListeners.scroll) {
        window.addEventListener("scroll", dropdownEventListeners.scroll, true);
      }
      if (dropdownEventListeners.resize) {
        window.addEventListener("resize", dropdownEventListeners.resize);
      }
    }, 0);
  }

  function closeActiveDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
      activeDropdownDeckId = null;

      // Clean up all event listeners
      if (dropdownEventListeners.click) {
        document.removeEventListener("click", dropdownEventListeners.click);
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

<div class="decks-deck-list-panel">
  <div class="decks-panel-header">
    <h3 class="decks-panel-title">Flashcard Decks</h3>
    <div class="decks-header-buttons">
      <button
        class="decks-deck-config-button"
        on:click={(e) => handleTouchClick(onOpenDeckConfig, e)}
        on:touchend={(e) => handleTouchClick(onOpenDeckConfig, e)}
        title="Configure Deck"
        disabled={allDecks.length === 0}
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
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
      </button>
      <button
        class="decks-profiles-button"
        on:click={(e) => handleTouchClick(onOpenProfilesManager, e)}
        on:touchend={(e) => handleTouchClick(onOpenProfilesManager, e)}
        title="Manage Profiles"
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
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      </button>
      <button
        class="decks-stats-button"
        on:click={(e) => handleTouchClick(onOpenStatistics, e)}
        on:touchend={(e) => handleTouchClick(onOpenStatistics, e)}
        title="View Overall Statistics"
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
          <path d="M3 3v18h18"></path>
          <path d="M18 17V9"></path>
          <path d="M13 17V5"></path>
          <path d="M8 17v-3"></path>
        </svg>
      </button>
      <button
        class="decks-refresh-button"
        class:refreshing={isRefreshing}
        on:click={(e) => handleTouchClick(() => void handleRefresh(), e)}
        on:touchend={(e) => handleTouchClick(() => void handleRefresh(), e)}
        disabled={isRefreshing}
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
          <path d="M23 4v6h-6"></path>
          <path d="M1 20v-6h6"></path>
          <path
            d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
          ></path>
        </svg>
      </button>
    </div>
  </div>

  <div class="decks-deck-content">
    <div class="decks-tab-switcher">
      <button
        class="decks-tab-button"
        class:active={viewMode === 'files'}
        on:click={() => viewMode = 'files'}
      >
        Files ({allDecks.length})
      </button>
      <button
        class="decks-tab-button"
        class:active={viewMode === 'tags'}
        on:click={() => viewMode = 'tags'}
      >
        Tags ({deckGroups.length})
      </button>
    </div>

    <div class="decks-filter-section">
      <div class="decks-filter-container">
        <input
          type="text"
          class="decks-filter-input"
          placeholder="Filter by name or tag... (e.g., 'spanish', '#flashcards')"
          bind:value={filterText}
          on:input={handleFilterInput}
          on:focus={handleFilterFocus}
          on:blur={handleFilterBlur}
        />
        {#if showSuggestions && filteredSuggestions.length > 0}
          <div class="decks-suggestions-dropdown">
            <div class="decks-suggestions-header">Filter by tags:</div>
            {#each filteredSuggestions as tag}
              <button
                class="decks-suggestion-item"
                on:mousedown|preventDefault={() => selectSuggestion(tag)}
                on:click={(e) =>
                  handleTouchClick(() => selectSuggestion(tag), e)}
                on:touchend={(e) =>
                  handleTouchClick(() => selectSuggestion(tag), e)}
              >
                {tag}
              </button>
            {/each}
          </div>
        {:else if !filterText.trim() && availableTags.length > 0 && inputFocused}
          <div class="decks-suggestions-dropdown">
            <div class="decks-suggestions-header">
              Available tags (click to filter):
            </div>
            {#each availableTags.slice(0, 5) as tag}
              <button
                class="decks-suggestion-item"
                on:mousedown|preventDefault={() => selectSuggestion(tag)}
                on:click={(e) =>
                  handleTouchClick(() => selectSuggestion(tag), e)}
                on:touchend={(e) =>
                  handleTouchClick(() => selectSuggestion(tag), e)}
              >
                {tag}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if allDecks.length === 0}
      <div class="decks-empty-state">
        <p>No flashcard decks found.</p>
        <p class="decks-help-text">
          Tag your notes with #flashcards to create decks.
        </p>
      </div>
    {:else if decks.length === 0}
      <div class="decks-empty-state">
        <p>No decks match your filter.</p>
        <p class="decks-help-text">Try adjusting your search terms.</p>
      </div>
    {:else}
      <div class="decks-deck-table">
        <div class="decks-table-header">
          <div class="decks-col-deck">{viewMode === 'files' ? 'Deck' : 'Tag Group'}</div>
          <div class="decks-col-stat">New</div>
          <div class="decks-col-stat">Due</div>
          <div class="decks-col-config"></div>
        </div>

        <div class="decks-table-body">
          {#each filteredItems as item}
            {@const itemStats = getDeckStats(getItemId(item))}
            <div class="decks-deck-row">
              <div class="decks-col-deck">
                <span
                  class="decks-deck-name-link"
                  on:click={(e) =>
                    handleTouchClick(() => handleItemClick(item), e)}
                  on:touchend={(e) =>
                    handleTouchClick(() => handleItemClick(item), e)}
                  on:keydown={(e) => e.key === "Enter" && handleItemClick(item)}
                  role="button"
                  tabindex="0"
                  title="Click to review {item.name}"
                >
                  {#if isDeckGroup(item)}
                    <span class="decks-tag-group-icon">🏷️</span>
                  {/if}
                  {item.name}
                  {#if isDeckGroup(item)}
                    <span class="decks-tag-group-count">({item.deckIds.length} files)</span>
                  {/if}
                </span>
              </div>
              <div
                class="decks-col-stat"
                class:has-cards={itemStats.newCount > 0}
                class:updating={isUpdatingStats}
                class:has-limit={item.profile.hasNewCardsLimitEnabled}
                title={item.profile.hasNewCardsLimitEnabled
                  ? `${itemStats.newCount} new cards available today (limit: ${item.profile.newCardsPerDay})`
                  : `${itemStats.newCount} new cards due`}
              >
                {itemStats.newCount}
                {#if item.profile.hasNewCardsLimitEnabled}
                  <span class="decks-limit-indicator">⚠</span>
                {/if}
              </div>

              <div
                class="decks-col-stat"
                class:has-cards={itemStats.dueCount > 0}
                class:updating={isUpdatingStats}
                class:has-limit={item.profile.hasReviewCardsLimitEnabled}
                title={item.profile.hasReviewCardsLimitEnabled
                  ? `${itemStats.dueCount} review cards available today (limit: ${item.profile.reviewCardsPerDay})`
                  : `${itemStats.dueCount} review cards due`}
              >
                {itemStats.dueCount}
                {#if item.profile.hasReviewCardsLimitEnabled}
                  <span class="decks-limit-indicator">📅</span>
                {/if}
              </div>
              <div class="decks-col-config">
                {#if isDeckGroup(item)}
                  <button
                    class="decks-deck-config-button"
                    on:click={(e) =>
                      handleTouchClick(() => handleGroupConfigClick(item, e), e)}
                    on:touchend={(e) =>
                      handleTouchClick(() => handleGroupConfigClick(item, e), e)}
                    title="Export tag group to Anki"
                    aria-label="Export {item.name} to Anki"
                  >
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
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  </button>
                {:else if isFileDeck(item)}
                  <button
                    class="decks-deck-config-button"
                    on:click={(e) =>
                      handleTouchClick(() => handleConfigClick(item, e), e)}
                    on:touchend={(e) =>
                      handleTouchClick(() => handleConfigClick(item, e), e)}
                    title="Configure deck settings"
                    aria-label="Configure {item.name}"
                  >
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
                    <circle cx="12" cy="12" r="3"></circle>
                    <path
                      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
                    ></path>
                  </svg>
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
        Studied {studyStats.todayCards} cards in {formatHours(
          studyStats.todayHours
        )} today ({formatPace(studyStats.todayPaceSeconds)})
      </div>
    {/if}

    <div class="decks-stats-grid">
      <div class="decks-stat-item">
        <div class="decks-stat-label">Total</div>
        <div class="decks-stat-value">
          {formatHours(studyStats.totalHours)}
        </div>
      </div>
      <div class="decks-stat-item">
        <div class="decks-stat-label">Past Month</div>
        <div class="decks-stat-value">
          {formatHours(studyStats.pastMonthHours)}
        </div>
      </div>
      <div class="decks-stat-item">
        <div class="decks-stat-label">Past Week</div>
        <div class="decks-stat-value">
          {formatHours(studyStats.pastWeekHours)}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
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
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
    overflow: hidden;
    padding-bottom: 12px !important;
  }

  .decks-deck-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  .decks-tab-switcher {
    display: flex;
    gap: 4px;
    padding: 8px 12px 0 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }

  .decks-tab-button {
    flex: 1;
    padding: 8px 16px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px 4px 0 0;
    background: var(--background-primary);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 13px;
    font-weight: 500;
  }

  .decks-tab-button:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .decks-tab-button.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
    font-weight: 600;
  }

  .decks-tag-group-icon {
    margin-right: 4px;
    font-size: 12px;
    opacity: 0.8;
  }

  .decks-tag-group-count {
    margin-left: 8px;
    font-size: 11px;
    color: var(--text-muted);
    font-weight: normal;
  }

  .decks-heatmap-section {
    flex-shrink: 0;
    border-top: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
  }

  .decks-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-header-buttons {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .decks-filter-section {
    margin: 0 12px 16px 12px;
  }

  .decks-filter-container {
    position: relative;
    width: 100%;
  }

  .decks-filter-input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 14px;
    height: 32px;
    box-sizing: border-box;
  }

  .decks-suggestions-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-top: none;
    border-radius: 0 0 4px 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    max-height: 200px;
    overflow-y: auto;
  }

  .decks-suggestions-header {
    padding: 8px 12px;
    font-size: 12px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }

  .decks-suggestion-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--text-normal);
    text-align: left;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 0.1s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .decks-suggestion-item:hover,
  .decks-suggestion-item:active {
    background: var(--background-modifier-hover);
  }

  .decks-filter-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .decks-filter-input::placeholder {
    color: var(--text-muted);
  }

  .decks-panel-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .decks-deck-config-button,
  .decks-profiles-button,
  .decks-stats-button {
    padding: 6px;
    background: var(--interactive-normal);
    border: 1px solid var(--interactive-normal);
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.2s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .decks-deck-config-button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .decks-deck-config-button:hover,
  .decks-deck-config-button:active,
  .decks-profiles-button:hover,
  .decks-profiles-button:active,
  .decks-stats-button:hover,
  .decks-stats-button:active {
    background: var(--interactive-hover);
    color: var(--text-normal);
  }

  .decks-refresh-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    color: var(--text-muted);
    transition: all 0.2s ease;
    position: relative;
    z-index: 1;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .decks-refresh-button:hover,
  .decks-refresh-button:active {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .decks-refresh-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-refresh-button.refreshing svg {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .decks-empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 32px;
    text-align: center;
  }

  .decks-empty-state p {
    margin: 8px 0;
  }

  .decks-help-text {
    font-size: 14px;
    color: var(--text-muted);
  }

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
    display: grid;
    grid-template-columns: 1fr 60px 60px 60px;
    gap: 8px;
    padding: 8px 12px;
    font-weight: 600;
    font-size: 14px;
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    align-items: center;
  }

  .decks-table-body {
    flex: 1;
    overflow-y: auto;
    max-height: calc(100vh - 240px);
  }

  .decks-deck-row {
    display: grid;
    grid-template-columns: 1fr 60px 60px 60px;
    gap: 8px;
    padding: 6px;
    border-bottom: 1px solid var(--background-modifier-border);
    align-items: center;
  }

  .decks-deck-name-link {
    cursor: pointer;
    color: var(--text-normal);
    text-decoration: underline;
    text-decoration-color: transparent;
    transition: text-decoration-color 0.2s ease;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: break-spaces;
    max-width: 250px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .decks-deck-name-link:hover,
  .decks-deck-name-link:active {
    text-decoration-color: var(--text-accent);
    color: var(--text-accent);
  }

  .decks-deck-name-link:focus {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
    border-radius: 3px;
  }

  .decks-col-config {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .decks-deck-config-button {
    background: transparent;
    border: none;
    padding: 4px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .decks-deck-config-button:hover,
  .decks-deck-config-button:active {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .decks-deck-config-button:focus {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
  }

  .decks-col-deck {
    font-size: 14px;
    color: var(--text-normal);
    justify-self: start;
    min-width: 0;
    width: 100%;
    overflow: hidden;
  }

  .decks-col-stat {
    text-align: center;
    font-size: 14px;
    color: var(--text-muted);
    justify-self: center;
  }

  .decks-table-header .decks-col-deck {
    font-size: 14px;
    color: var(--text-normal);
    justify-self: start;
  }

  .decks-table-header .decks-col-stat {
    text-align: center;
    font-size: 14px;
    color: var(--text-normal);
    justify-self: center;
  }

  .decks-col-stat.has-cards {
    color: #4aa3df;
    font-weight: 500;
  }

  .decks-col-stat.updating {
    opacity: 0.6;
    transition: opacity 0.3s ease;
  }

  .decks-col-stat.has-limit {
    position: relative;
    border-left: 2px solid var(--interactive-accent);
    padding-left: 6px;
  }

  .decks-limit-indicator {
    font-size: 10px;
    margin-left: 4px;
    opacity: 0.7;
  }

  .decks-table-body::-webkit-scrollbar {
    width: 8px;
  }

  .decks-table-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .decks-table-body::-webkit-scrollbar-thumb {
    background: var(--background-modifier-border);
    border-radius: 4px;
  }

  .decks-table-body::-webkit-scrollbar-thumb:hover {
    background: var(--background-modifier-border-hover);
  }
  /* Mobile responsive styles */
  @media (max-width: 768px) {
    .decks-deck-list-panel {
      min-width: unset;
      width: 100%;
    }

    .decks-panel-header {
      padding: 10px 16px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .decks-panel-title {
      font-size: 14px;
    }

    .decks-header-buttons {
      gap: 6px;
    }

    .decks-deck-config-button,
    .decks-profiles-button,
    .decks-stats-button,
    .decks-refresh-button {
      padding: 8px;
      min-height: 44px; /* Touch-friendly size */
      min-width: 44px;
    }

    .decks-filter-input {
      padding: 8px 12px;
      font-size: 16px; /* Prevent zoom on iOS */
      width: 100%;
      box-sizing: border-box;
    }

    .decks-filter-section {
      margin: 0 8px 16px 8px;
      width: calc(100% - 16px);
      box-sizing: border-box;
    }

    .decks-deck-list-panel {
      padding: 8px;
    }

    .decks-panel-header {
      padding: 12px 8px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .decks-header-buttons {
      gap: 8px;
    }

    .decks-deck-table {
      margin: 0 8px;
      width: calc(100% - 16px);
    }

    .decks-table-header {
      grid-template-columns: 1fr 55px 55px 55px;
      padding: 8px 16px;
      font-size: 12px;
    }

    .decks-deck-row {
      grid-template-columns: 1fr 55px 55px 55px;
    }

    .decks-deck-name-link {
      font-size: 14px;
    }

    .decks-col-stat {
      font-size: 13px;
    }

    .decks-deck-config-button {
      padding: 8px;
      min-height: 44px;
      min-width: 44px;
    }

    .decks-empty-state {
      padding: 24px 16px;
    }
  }

  /*@media (max-width: 480px) {
        .panel-header {
            padding: 8px 12px;
        }

        .panel-title {
            font-size: 13px;
        }

        .table-header {
            grid-template-columns: 1fr 45px 45px 45px 40px;
            padding: 6px 12px;
            font-size: 11px;
        }

        .deck-row {
            grid-template-columns: 1fr 45px 45px 45px 40px;
            padding: 10px 12px;
        }

        .deck-name-link {
            max-width: none;
            font-size: 13px;
        }

        .col-stat {
            font-size: 12px;
        }

        .deck-config-button {
            padding: 6px;
            min-height: 40px;
            min-width: 40px;
        }

        .filter-input {
            padding: 8px 12px;
            width: 100%;
            box-sizing: border-box;
            font-size: 16px; /* Prevent zoom on iOS
        }

        .filter-section {
            margin: 0 4px 12px 4px;
            width: calc(100% - 8px);
            box-sizing: border-box;
        }

        .deck-list-panel {
            padding: 4px;
        }

        .panel-header {
            padding: 8px 4px;
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
        }

        .panel-title {
            text-align: center;
            margin-bottom: 8px;
        }

        .header-buttons {
            justify-content: center;
            gap: 12px;
        }

        .deck-table {
            margin: 0 4px;
            width: calc(100% - 8px);
        }

        .table-header {
            padding: 4px 8px;
            font-size: 11px;
        }

        .deck-row {
            padding: 8px;
            gap: 4px;
        }

        .deck-name-link {
            font-size: 13px;
            line-height: 1.3;
        }

        .col-stat {
            font-size: 11px;
        }

        .suggestions-dropdown {
            max-height: 150px;
        }

        .suggestion-item {
            padding: 12px;
            font-size: 16px; /* Touch-friendly
        }

        .empty-state {
            padding: 20px 12px;
        }

        .help-text {
            font-size: 13px;
        }
    }

    @media (max-width: 390px) {
        .deck-list-panel {
            min-width: unset;
            width: 100%;
            max-width: calc(100% - 38px);
        }

        .panel-header {
            padding: 8px 12px;
        }

        .panel-title {
            font-size: 12px;
        }

        .header-buttons {
            gap: 4px;
        }

        .stats-button,
        .refresh-button {
            padding: 6px;
            min-height: 36px;
            min-width: 36px;
        }

        .filter-input {
            padding: 6px 8px;
            font-size: 14px;
            width: 100%;
            box-sizing: border-box;
        }

        .filter-section {
            margin: 0 2px 8px 2px;
            width: calc(100% - 4px);
            box-sizing: border-box;
        }

        .deck-list-panel {
            padding: 2px;
        }

        .panel-header {
            padding: 6px 2px;
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
        }

        .panel-title {
            text-align: center;
            font-size: 12px;
            margin-bottom: 4px;
        }

        .header-buttons {
            justify-content: center;
            gap: 8px;
        }

        .deck-table {
            margin: 0 2px;
            width: calc(100% - 4px);
        }

        .table-header {
            padding: 2px 4px;
            font-size: 9px;
            gap: 2px;
        }

        .deck-row {
            padding: 6px 4px;
            gap: 2px;
        }

        .deck-name-link {
            font-size: 12px;
            line-height: 1.2;
            word-break: break-word;
        }

        .col-stat {
            font-size: 10px;
        }

        .deck-config-button {
            padding: 4px;
            min-height: 32px;
            min-width: 32px;
        }

        .stats-button,
        .refresh-button {
            padding: 4px;
            min-height: 32px;
            min-width: 32px;
        }

        .table-header {
            grid-template-columns: 1fr 38px 38px 38px 36px;
            padding: 4px 8px;
            font-size: 10px;
            gap: 4px;
        }

        .deck-row {
            grid-template-columns: 1fr 38px 38px 38px 36px;
            padding: 8px 8px;
            gap: 4px;
        }

        .deck-name-link {
            max-width: none;
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: break-spaces;
        }

        .col-stat {
            font-size: 11px;
        }

        .table-header .col-stat {
            font-size: 10px;
        }

        .deck-config-button {
            padding: 4px;
            min-height: 36px;
            min-width: 36px;
        }

        .suggestions-dropdown {
            max-height: 120px;
        }

        .suggestion-item {
            padding: 10px 8px;
            font-size: 14px;
        }

        .empty-state {
            padding: 16px 8px;
        }

        .help-text {
            font-size: 12px;
        }
    }*/

  /* Dropdown styles */
  :global(.decks-deck-config-dropdown) {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 4px 0;
    min-width: 140px;
  }

  :global(.decks-context-menu) {
    position: fixed;
    z-index: 1000;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s ease, visibility 0.15s ease;
  }

  :global(.decks-context-menu-visible) {
    position: fixed;
    z-index: 1000;
    opacity: 1;
    visibility: visible;
  }

  :global(.decks-dropdown-option) {
    padding: 8px 12px;
    cursor: pointer;
    font-size: 0.9em;
    color: var(--text-normal);
    transition: background-color 0.15s ease;
  }

  :global(.decks-dropdown-option:hover) {
    background: var(--background-modifier-hover);
  }

  :global(.decks-dropdown-option:active) {
    background: var(--background-modifier-active);
  }

  /* Study Statistics Section */
  .decks-study-stats-section {
    padding: 16px;
  }

  .decks-today-summary {
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-normal);
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
  }

  .decks-stat-item {
    text-align: center;
  }

  .decks-stat-label {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .decks-stat-value {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-accent);
  }

  @media (max-width: 768px) {
    .decks-study-stats-section {
      margin-top: 12px;
      padding: 12px;
    }

    .decks-today-summary {
      font-size: 13px;
      margin-bottom: 12px;
    }

    .decks-stats-grid {
      gap: 12px;
    }

    .decks-stat-value {
      font-size: 14px;
    }
  }
</style>
