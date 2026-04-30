<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import type {
    DeckWithProfile,
    DeckStats,
    DeckGroup,
    DeckOrGroup,
  } from "../database/types";
  import { isDeckGroup, isFileDeck, isCustomDeck } from "../database/types";
  import { generateDeckGroupId } from "../utils/hash";

  import ReviewHeatmap from "./statistics/ReviewHeatmap.svelte";
  import { AnkiExportModal } from "./export/AnkiExportModal";
  import { DeckResetModal } from "./DeckResetModal";
  import type { StatisticsService } from "@/services/StatisticsService";
  import type { DeckSynchronizer } from "@/services/DeckSynchronizer";
  import type { IDatabaseService } from "@/database/DatabaseFactory";
  import type { TagGroupService } from "@/services/TagGroupService";
  import type { CustomDeckService } from "@/services/CustomDeckService";
  import type { CustomDeckGroup } from "../database/types";
  import { RenameCustomDeckModal } from "./RenameCustomDeckModal";
  import { ConfirmModal } from "./ConfirmModal";
  import { Notice } from "obsidian";
  import type { App } from "obsidian";

  let decks: DeckWithProfile[] = [];
  let allDecks: DeckWithProfile[] = [];
  let stats = new Map<string, DeckStats>();
  let filterText = "";
  let heatmapComponent: ReviewHeatmap;
  let searchOpen = false;
  let searchInputEl: HTMLInputElement | undefined;
  let activeDropdown: HTMLElement | null = null;
  let activeDropdownDeckId: string | null = null;
  let dropdownEventListeners: {
    click?: (e: Event) => void;
    scroll?: () => void;
    resize?: () => void;
  } = {};

  let viewMode: "files" | "tags" | "custom" = "files";
  let deckGroups: DeckGroup[] = [];
  let customDeckGroups: CustomDeckGroup[] = [];
  let customDeckStats = new Map<string, DeckStats>();
  let currentItems: DeckOrGroup[] = [];

  export let statisticsService: StatisticsService;
  export let deckSynchronizer: DeckSynchronizer;
  export let db: IDatabaseService;
  export let tagGroupService: TagGroupService;

  export let onDeckClick: (deck: DeckWithProfile) => void;
  export let onDeckGroupClick: (deckGroup: DeckGroup) => void;
  export let onBrowseDeck: (deck: DeckWithProfile) => void;
  export let onBrowseDeckGroup: (deckGroup: DeckGroup) => void;
  export let onCustomDeckClick: (customDeck: CustomDeckGroup) => void;
  export let onBrowseCustomDeck: (customDeck: CustomDeckGroup) => void;
  export let onEditCustomDeck: (customDeck: CustomDeckGroup) => void;

  export let app: App;

  export let onRefresh: () => Promise<void>;
  export let openStatisticsModal: () => void;
  export let openProfilesManagerModal: () => void;
  export let openDeckConfigModal: (deck: DeckWithProfile) => void;
  export let openFlashcardManager: () => void;
  export let customDeckService: CustomDeckService;
  export let onCreateCustomDeck: () => void;
  export let deckTag = "#decks";

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
    if (item.type === 'custom') {
      return item.id;
    }
    return item.id;
  }

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
  $: currentItems =
    viewMode === "files"
      ? allDecks.map((d) => ({ ...d, type: "file" as const }))
      : viewMode === "tags"
        ? deckGroups
        : customDeckGroups;

  $: filteredItems = filterItems(currentItems, filterText);

  function filterItems(items: DeckOrGroup[], filter: string): DeckOrGroup[] {
    if (!filter.trim()) return items;
    const filterLower = filter.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(filterLower) ||
        ("tag" in item && item.tag.toLowerCase().includes(filterLower))
    );
  }

  export function updateDecks(newDecks: DeckWithProfile[]) {
    allDecks = newDecks;

    // Generate deck groups asynchronously
    tagGroupService
      .aggregateByTag(newDecks)
      .then((groups) => {
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
    applyFilter();
  }

  function clearFilter() {
    filterText = "";
    applyFilter();
  }

  async function toggleSearch() {
    searchOpen = !searchOpen;
    if (searchOpen) {
      await tick();
      searchInputEl?.focus();
    }
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      clearFilter();
      searchOpen = false;
      searchInputEl?.blur();
    }
  }

  function handleItemClick(item: DeckOrGroup) {
    if (isDeckGroup(item)) {
      onDeckGroupClick(item);
    } else if (isCustomDeck(item)) {
      onCustomDeckClick(item);
    } else if (isFileDeck(item)) {
      onDeckClick(item);
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
    const dropdown = document.createElement("div");
    dropdown.className = "decks-deck-config-dropdown";

    const browseOption = document.createElement("div");
    browseOption.className = "decks-dropdown-option";
    browseOption.textContent = "Browse all cards";
    browseOption.onclick = () => {
      closeActiveDropdown();
      onBrowseDeckGroup(group);
    };

    const exportOption = document.createElement("div");
    exportOption.className = "decks-dropdown-option";
    exportOption.textContent = "Export to Anki";
    exportOption.onclick = () => {
      closeActiveDropdown();
      openAnkiExportForGroup(group);
    };

    const configOption = document.createElement("div");
    configOption.className = "decks-dropdown-option";
    configOption.textContent = "Configure profile";
    configOption.onclick = () => {
      closeActiveDropdown();
      const deckForGroup = allDecks.find((d) => group.deckIds.includes(d.id));
      if (deckForGroup) {
        openDeckConfigModal(deckForGroup);
      }
    };

    dropdown.appendChild(browseOption);
    dropdown.appendChild(exportOption);
    dropdown.appendChild(configOption);

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

    const browseOption = document.createElement("div");
    browseOption.className = "decks-dropdown-option";
    browseOption.textContent = "Browse all cards";
    browseOption.onclick = () => {
      closeActiveDropdown();
      onBrowseDeck(deck);
    };

    const exportOption = document.createElement("div");
    exportOption.className = "decks-dropdown-option";
    exportOption.textContent = "Export to Anki";
    exportOption.onclick = () => {
      closeActiveDropdown();
      openAnkiExport(deck);
    };

    const configOption = document.createElement("div");
    configOption.className = "decks-dropdown-option";
    configOption.textContent = "Configure profile";
    configOption.onclick = () => {
      closeActiveDropdown();
      openDeckConfigModal(deck);
    };

    const resetOption = document.createElement("div");
    resetOption.className = "decks-dropdown-option decks-dropdown-option-danger";
    resetOption.textContent = "Reset progress";
    resetOption.onclick = () => {
      closeActiveDropdown();
      openResetDeckModal(deck);
    };

    dropdown.appendChild(browseOption);
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

  function handleCustomDeckConfigClick(customDeck: CustomDeckGroup, event: Event) {
    event.stopPropagation();

    if (activeDropdown && activeDropdownDeckId === customDeck.id) {
      closeActiveDropdown();
      return;
    }

    closeActiveDropdown();

    const dropdown = document.createElement("div");
    dropdown.className = "decks-deck-config-dropdown";

    const browseOption = document.createElement("div");
    browseOption.className = "decks-dropdown-option";
    browseOption.textContent = "Browse all cards";
    browseOption.onclick = () => {
      closeActiveDropdown();
      onBrowseCustomDeck(customDeck);
    };

    const exportOption = document.createElement("div");
    exportOption.className = "decks-dropdown-option";
    exportOption.textContent = "Export to Anki";
    exportOption.onclick = () => {
      closeActiveDropdown();
      openAnkiExportForCustomDeck(customDeck);
    };

    const renameOption = document.createElement("div");
    renameOption.className = "decks-dropdown-option";
    renameOption.textContent = "Rename";
    renameOption.onclick = () => {
      closeActiveDropdown();
      renameCustomDeck(customDeck);
    };

    const resetOption = document.createElement("div");
    resetOption.className = "decks-dropdown-option decks-dropdown-option-danger";
    resetOption.textContent = "Reset progress";
    resetOption.onclick = () => {
      closeActiveDropdown();
      resetCustomDeckProgress(customDeck);
    };

    const deleteOption = document.createElement("div");
    deleteOption.className = "decks-dropdown-option decks-dropdown-option-danger";
    deleteOption.textContent = "Delete";
    deleteOption.onclick = () => {
      closeActiveDropdown();
      deleteCustomDeck(customDeck);
    };

    const editOption = document.createElement("div");
    editOption.className = "decks-dropdown-option";
    editOption.textContent = customDeck.deckType === "filter" ? "Edit filter" : "Edit cards";
    editOption.onclick = () => {
      closeActiveDropdown();
      onEditCustomDeck(customDeck);
    };

    dropdown.appendChild(browseOption);
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

    document.body.appendChild(dropdown);
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
      title: "Delete custom deck",
      message: `Delete custom deck "${customDeck.name}"? This will not delete the flashcards themselves.`,
      confirmText: "Delete",
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
          new Notice(`No cards found in "${customDeck.name}"`);
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
      title: "Reset custom deck progress",
      message: `Reset all progress for "${customDeck.name}"? All flashcards in this deck will be reset to new state and review history will be deleted. This cannot be undone.`,
      confirmText: "Reset progress",
      isDanger: true,
      onConfirm: () => {
        db.resetCustomDeckProgress(customDeck.id)
          .then(() => db.save())
          .then(() => {
            new Notice(`Progress reset for "${customDeck.name}"`);
            return loadCustomDecks();
          })
          .catch((e) => {
            console.error("Failed to reset custom deck progress:", e);
            new Notice("Failed to reset custom deck progress");
          });
      },
    }).open();
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

<div class="decks-deck-list-panel">
  <div class="decks-panel-header">
    <div class="decks-panel-title">Decks</div>
    <div class="decks-header-buttons">
      <button
        class="clickable-icon"
        on:click={(e) => handleTouchClick(onOpenDeckConfig, e)}
        on:touchend={(e) => handleTouchClick(onOpenDeckConfig, e)}
        title="Configure deck"
        disabled={allDecks.length === 0}
        aria-label="Configure deck"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
      </button>
      <button
        class="clickable-icon"
        on:click={(e) => handleTouchClick(onOpenProfilesManager, e)}
        on:touchend={(e) => handleTouchClick(onOpenProfilesManager, e)}
        title="Manage profiles"
        aria-label="Manage profiles"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
      </button>
      <button
        class="clickable-icon"
        on:click={(e) => handleTouchClick(onOpenStatistics, e)}
        on:touchend={(e) => handleTouchClick(onOpenStatistics, e)}
        title="View statistics"
        aria-label="View statistics"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path></svg>
      </button>
      <button
        class="clickable-icon"
        class:decks-refreshing={isRefreshing}
        on:click={(e) => handleTouchClick(() => void handleRefresh(), e)}
        on:touchend={(e) => handleTouchClick(() => void handleRefresh(), e)}
        disabled={isRefreshing}
        title="Refresh"
        aria-label="Refresh"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
      </button>
    </div>
  </div>

  <div class="decks-deck-content">
    <div class="decks-tab-switcher">
      <div class="decks-tab-group">
        <button
          class="decks-tab-button"
          class:decks-tab-active={viewMode === "files"}
          on:click={() => (viewMode = "files")}
        >
          Files ({allDecks.length})
        </button>
        <button
          class="decks-tab-button"
          class:decks-tab-active={viewMode === "tags"}
          on:click={() => (viewMode = "tags")}
        >
          Tags ({deckGroups.length})
        </button>
        <button
          class="decks-tab-button"
          class:decks-tab-active={viewMode === "custom"}
          on:click={() => { viewMode = "custom"; loadCustomDecks(); }}
        >
          Custom ({customDeckGroups.length})
        </button>
      </div>
      <button
        class="clickable-icon"
        class:decks-search-toggle-active={searchOpen}
        on:click={toggleSearch}
        title="Search"
        aria-label="Search"
        aria-expanded={searchOpen}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </button>
      <button
        class="clickable-icon"
        on:click={openFlashcardManager}
        title="Open flashcard manager"
        aria-label="Open flashcard manager"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      </button>
    </div>

    {#if searchOpen}
      <div class="decks-collapsible-search-row">
        <div class="decks-filter-input-wrapper">
          <svg class="decks-filter-search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input
            type="text"
            class="decks-filter-input"
            placeholder="Filter..."
            bind:this={searchInputEl}
            bind:value={filterText}
            on:input={handleFilterInput}
            on:keydown={handleSearchKeydown}
          />
          {#if filterText}
            <button
              class="clickable-icon decks-filter-clear-button"
              aria-label="Clear filter"
              on:click={clearFilter}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          {/if}
        </div>
      </div>
    {/if}

    {#if allDecks.length === 0}
      <div class="decks-empty-state">
        <p>No decks found.</p>
        <p class="decks-help-text">
          Tag your notes with {deckTag} to create decks.
        </p>
      </div>
    {:else if decks.length === 0}
      <div class="decks-empty-state">
        <p>No decks match your filter.</p>
        <p class="decks-help-text">Try adjusting your search terms.</p>
      </div>
    {:else}
      <div class="decks-deck-table">
        <div class="decks-table-body">
          <div class="decks-table-header">
            <div class="decks-col-deck">
              {viewMode === "files" ? "Deck" : viewMode === "tags" ? "Tag group" : "Custom deck"}
            </div>
            <div class="decks-col-stat">New</div>
            <div class="decks-col-stat">Due</div>
            <div class="decks-col-config"></div>
          </div>
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
                  {:else if item.type === 'custom' && item.deckType === 'filter'}
                    <span class="decks-tag-group-icon">🔍</span>
                  {:else if item.type === 'custom'}
                    <span class="decks-tag-group-icon">📋</span>
                  {/if}
                  {item.name}
                  {#if isDeckGroup(item)}
                    <span class="decks-tag-group-count"
                      >({item.deckIds.length} files)</span
                    >
                  {:else if item.type === 'custom' && item.deckType === 'filter'}
                    <span class="decks-tag-group-count"
                      >({getDeckStats(item.id).totalCount} cards)</span
                    >
                  {:else if item.type === 'custom'}
                    <span class="decks-tag-group-count"
                      >({item.flashcardIds.length} cards)</span
                    >
                  {/if}
                </span>
              </div>
              <div
                class="decks-col-stat"
                class:has-cards={itemStats.newCount > 0}
                class:updating={isUpdatingStats}
                class:has-limit={'profile' in item && item.profile.hasNewCardsLimitEnabled}
                title={'profile' in item && item.profile.hasNewCardsLimitEnabled
                  ? isDeckGroup(item)
                    ? `${itemStats.newCount} new cards available today (limit: ${item.profile.newCardsPerDay} per deck)`
                    : `${itemStats.newCount} new cards available today (limit: ${item.profile.newCardsPerDay})`
                  : `${itemStats.newCount} new cards due`}
              >
                {itemStats.newCount}
                {#if 'profile' in item && item.profile.hasNewCardsLimitEnabled}
                  <span class="decks-limit-indicator">⚠</span>
                {/if}
              </div>

              <div
                class="decks-col-stat"
                class:has-cards={itemStats.dueCount > 0}
                class:updating={isUpdatingStats}
                class:has-limit={'profile' in item && item.profile.hasReviewCardsLimitEnabled}
                title={'profile' in item && item.profile.hasReviewCardsLimitEnabled
                  ? isDeckGroup(item)
                    ? `${itemStats.dueCount} review cards available today (limit: ${item.profile.reviewCardsPerDay} per deck)`
                    : `${itemStats.dueCount} review cards available today (limit: ${item.profile.reviewCardsPerDay})`
                  : `${itemStats.dueCount} review cards due`}
              >
                {itemStats.dueCount}
                {#if 'profile' in item && item.profile.hasReviewCardsLimitEnabled}
                  <span class="decks-limit-indicator">📅</span>
                {/if}
              </div>
              <div class="decks-col-config">
                {#if isDeckGroup(item)}
                  <button
                    class="clickable-icon decks-row-action"
                    on:click={(e) => handleTouchClick(() => handleGroupConfigClick(item, e), e)}
                    on:touchend={(e) => handleTouchClick(() => handleGroupConfigClick(item, e), e)}
                    title="Tag group options"
                    aria-label="Options for {item.name}"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                  </button>
                {:else if isCustomDeck(item)}
                  <button
                    class="clickable-icon decks-row-action"
                    on:click={(e) => handleTouchClick(() => handleCustomDeckConfigClick(item, e), e)}
                    on:touchend={(e) => handleTouchClick(() => handleCustomDeckConfigClick(item, e), e)}
                    title="Custom deck options"
                    aria-label="Options for {item.name}"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                  </button>
                {:else if isFileDeck(item)}
                  <button
                    class="clickable-icon decks-row-action"
                    on:click={(e) => handleTouchClick(() => handleConfigClick(item, e), e)}
                    on:touchend={(e) => handleTouchClick(() => handleConfigClick(item, e), e)}
                    title="Deck options"
                    aria-label="Options for {item.name}"
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

    {#if viewMode === "custom"}
      <div class="decks-create-custom-deck-bar">
        <button
          class="decks-create-custom-deck-btn"
          on:click={onCreateCustomDeck}
        >
          + Create custom deck
        </button>
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
        <div class="decks-stat-label">Past month</div>
        <div class="decks-stat-value">
          {formatHours(studyStats.pastMonthHours)}
        </div>
      </div>
      <div class="decks-stat-item">
        <div class="decks-stat-label">Past week</div>
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
    padding: var(--size-4-2) var(--size-4-3);
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
    gap: var(--size-4-1);
    align-items: center;
  }

  .decks-refreshing :global(svg) {
    animation: decks-spin 1s linear infinite;
  }

  @keyframes decks-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Tabs (segmented control) ── */
  .decks-tab-switcher {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    padding: var(--size-4-2) var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-tab-group {
    display: flex;
    flex: 1;
    background-color: var(--background-modifier-hover);
    border-radius: var(--radius-s);
    padding: 2px;
  }

  .decks-tab-button {
    flex: 1;
    padding: var(--size-4-1) var(--size-4-2);
    border: none;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-medium);
    transition: all 0.15s ease;
  }

  .decks-tab-button:hover {
    color: var(--text-normal);
  }

  .decks-tab-active {
    background-color: var(--background-primary);
    color: var(--text-normal);
    box-shadow: var(--shadow-s);
    font-weight: var(--font-semibold);
  }

  /* ── Collapsible search row ── */
  .decks-collapsible-search-row {
    padding: var(--size-4-2) var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-search-toggle-active {
    color: var(--text-accent);
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
    padding: var(--size-4-1) 30px;
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
    display: grid;
    grid-template-columns: 1fr 44px 44px 36px;
    gap: 20px;
    padding: var(--size-4-1) var(--size-4-3);
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

  .decks-table-body {
    flex: 1;
    overflow-y: scroll;
    overflow-x: hidden;
    max-height: calc(100vh - 240px);
  }


  .decks-deck-row {
    display: grid;
    grid-template-columns: 1fr 44px 44px 36px;
    gap: 20px;
    padding: var(--size-4-1) var(--size-4-3);
    align-items: center;
    border-radius: var(--radius-s);
  }

  .decks-deck-row:hover {
    background-color: var(--background-modifier-hover);
  }

  /* ── Deck name ── */
  .decks-col-deck {
    font-size: var(--font-ui-small);
    color: var(--text-normal);
    justify-self: start;
    min-width: 0;
    width: 100%;
    overflow: hidden;
  }

  .decks-deck-name-link {
    cursor: pointer;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
    min-height: 100%;
    border-radius: var(--radius-s);
  }

  .decks-deck-name-link:hover {
    color: var(--text-accent);
  }

  .decks-deck-name-link:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
  }

  .decks-tag-group-icon {
    margin-right: var(--size-4-1);
    font-size: 11px;
  }

  .decks-tag-group-count {
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
  }

  .decks-deck-row:hover .decks-row-action {
    opacity: 1;
  }

  /* ── Create custom deck button ── */
  .decks-create-custom-deck-bar {
    padding: var(--size-4-2) var(--size-4-3);
    display: flex;
    justify-content: center;
  }

  .decks-create-custom-deck-btn {
    padding: var(--size-4-1) var(--size-4-3);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .decks-create-custom-deck-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
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

  .decks-stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
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
    z-index: var(--layer-popover);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.1s ease, visibility 0.1s ease;
  }

  :global(.decks-context-menu-visible) {
    position: fixed;
    z-index: var(--layer-popover);
    opacity: 1;
    visibility: visible;
  }

  :global(.decks-dropdown-option) {
    padding: var(--size-4-1) var(--size-4-3);
    cursor: pointer;
    font-size: var(--font-ui-small);
    color: var(--text-normal);
  }

  :global(.decks-dropdown-option:hover) {
    background: var(--background-modifier-hover);
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
  }
</style>
