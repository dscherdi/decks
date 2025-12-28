<script lang="ts">
  import { onMount, createEventDispatcher, tick } from "svelte";
  import { Setting } from "obsidian";
  import ReviewHeatmap from "./ReviewHeatmap.svelte";
  import ReviewsOverTimeChart from "./ReviewsOverTimeChart.svelte";
  import CardCountsChart from "./CardCountsChart.svelte";
  import ReviewIntervalsChart from "./ReviewIntervalsChart.svelte";
  import CardStabilityChart from "./CardStabilityChart.svelte";
  import CardDifficultyChart from "./CardDifficultyChart.svelte";
  import HourlyBreakdownChart from "./HourlyBreakdownChart.svelte";
  import CardsAddedChart from "./CardsAddedChart.svelte";
  import CardRetrievabilityChart from "./CardRetrievabilityChart.svelte";
  import TrueRetentionTable from "./TrueRetentionTable.svelte";
  import FutureDueChart from "./FutureDueChart.svelte";
  import MaturityProgressionChart from "./MaturityProgressionChart.svelte";
  import OverallStatistics from "./OverallStatistics.svelte";
  import type { Statistics } from "../../database/types";

  import { StatisticsService } from "../../services/StatisticsService";
  import { Logger } from "@/utils/logging";

  export let statisticsService: StatisticsService;
  export let logger: Logger;
  export let onClose: (() => void) | undefined = undefined;

  const dispatch = createEventDispatcher();

  // Helper function to handle close action (supports both Svelte 4 and Svelte 5)
  function handleClose() {
    if (onClose) {
      onClose();
    } else {
      dispatch("close");
    }
  }

  let loading = false; // Don't load by default
  let statistics: Statistics | null = null;
  let selectedDeckFilter = ""; // Start with no selection
  let selectedTimeframe = "12months"; // "12months" or "all"
  let availableDecks: { id: string; name: string; tag: string }[] = [];
  let availableTags: string[] = [];

  // Computed deck IDs based on current filter - ONLY for child components
  $: selectedDeckIds = getDeckIdsFromFilter(selectedDeckFilter, availableDecks);

  let heatmapComponent: ReviewHeatmap;
  let deckFilterContainer: HTMLElement;
  let timeframeFilterContainer: HTMLElement;

  // Track last event to prevent double execution
  let lastEventTime = 0;
  let lastEventType = "";

  // Derived statistics - computed after loading
  let todayStats: {
    date: string;
    reviews: number;
    timeSpent: number;
    newCards: number;
    learningCards: number;
    reviewCards: number;
    correctRate: number;
  } | null = null;
  let weekStats: {
    reviews: number;
    timeSpent: number;
    newCards: number;
    reviewCards: number;
    correctRate: number;
  } | null = null;
  let monthStats: {
    reviews: number;
    timeSpent: number;
    newCards: number;
    reviewCards: number;
    correctRate: number;
  } | null = null;
  let yearStats: {
    reviews: number;
    timeSpent: number;
    newCards: number;
    reviewCards: number;
    correctRate: number;
  } | null = null;

  onMount(async () => {
    logger.debug("[StatisticsUI] Starting onMount");

    try {
      logger.debug("[StatisticsUI] Loading decks and tags...");
      await loadDecksAndTags();
      logger.debug("[StatisticsUI] Decks and tags loaded");

      // Mount filter components (don't auto-load statistics)
      await tick();
      logger.debug("[StatisticsUI] Mounting filter components");
      mountFilterComponents();
    } catch (error) {
      logger.error("[StatisticsUI] Error in onMount:", error);
    }
  });

  function mountFilterComponents() {
    // Deck filter dropdown
    if (deckFilterContainer) {
      // Clear existing content to avoid duplicates
      deckFilterContainer.empty();

      new Setting(deckFilterContainer)
        .setName("Select Deck(s):")
        .setClass("decks-deck-filter-container")
        .addDropdown((dropdown) => {
          dropdown.addOption("", "-- Select a deck --");
          dropdown.addOption("all", "All Decks");

          availableTags.forEach((tag) => {
            dropdown.addOption(`tag:${tag}`, `Tag: ${tag}`);
          });

          availableDecks.forEach((deck) => {
            dropdown.addOption(`deck:${deck.id}`, deck.name);
          });
          dropdown.setValue(selectedDeckFilter);
          dropdown.onChange(async (value: string) => {
            logger.debug(
              `[StatisticsUI] Dropdown onChange fired with value: "${value}"`
            );
            selectedDeckFilter = value;

            if (value !== "") {
              loading = true;

              // CALCULATE IDs MANUALLY HERE to bypass reactivity lag
              const nextIds = getDeckIdsFromFilter(value, availableDecks);
              logger.debug(
                `[StatisticsUI] Calculated IDs for value "${value}": [${nextIds.join(",")}]`
              );

              try {
                await loadStatistics(nextIds);
              } catch (error) {
                logger.error("[StatisticsUI] Error loading statistics:", error);
              } finally {
                loading = false;
              }
            } else {
              // Clear statistics when empty option selected
              statistics = null;
              todayStats = null;
              weekStats = null;
              monthStats = null;
              yearStats = null;
            }
          });
        });
    }

    // Timeframe filter dropdown
    if (timeframeFilterContainer) {
      // Clear existing content to avoid duplicates
      timeframeFilterContainer.empty();

      new Setting(timeframeFilterContainer)
        .setName("Timeframe:")
        .setClass("decks-timeframe-filter-container")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("12months", "Last 12 Months")
            .addOption("all", "All History")
            .setValue(selectedTimeframe)
            .onChange(async (value: string) => {
              selectedTimeframe = value;
              loading = true;

              // Calculate current deck IDs manually
              const currentIds = getDeckIdsFromFilter(
                selectedDeckFilter,
                availableDecks
              );

              try {
                await loadStatistics(currentIds);
              } catch (error) {
                logger.error("[StatisticsUI] Error loading statistics:", error);
              } finally {
                loading = false;
              }
            })
        );
    }
  }

  async function loadDecksAndTags() {
    try {
      logger.debug(
        "[StatisticsUI] Getting available decks and tags from StatisticsService..."
      );
      const decksAndTags = await statisticsService.getAvailableDecksAndTags();
      availableDecks = decksAndTags.decks;
      availableTags = decksAndTags.tags;
      logger.debug(
        `[StatisticsUI] Retrieved ${availableDecks.length} decks and ${availableTags.length} tags`
      );
    } catch (error) {
      logger.error("[StatisticsUI] Error loading decks and tags:", error);
      throw error;
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

  async function loadStatistics(ids: string[]) {
    try {
      logger.debug(
        `[StatisticsUI] Getting overall statistics (filter: ${selectedDeckFilter}, timeframe: ${selectedTimeframe})...`
      );
      logger.debug(`[StatisticsUI] Loading for IDs: ${ids.join(",") || "all"}`);

      statistics = await statisticsService.getOverallStatistics(
        ids,
        selectedTimeframe
      );

      logger.debug(
        "[StatisticsUI] Statistics loaded successfully:",
        statistics
      );
      logger.debug("[StatisticsUI] Forecast data:", statistics?.forecast);
      logger.debug("[StatisticsUI] Card stats:", statistics?.cardStats);

      // Compute derived statistics once data is loaded
      logger.debug("[StatisticsUI] Computing derived statistics...");
      todayStats = statisticsService.getTodayStats(statistics);
      weekStats = statisticsService.getTimeframeStats(statistics, 7);
      monthStats = statisticsService.getTimeframeStats(statistics, 30);
      yearStats = statisticsService.getTimeframeStats(statistics, 365);
      logger.debug("[StatisticsUI] Derived statistics computed");
    } catch (error) {
      logger.error("[StatisticsUI] Error loading statistics:", error);
      statistics = {
        dailyStats: [],
        cardStats: { new: 0, review: 0, mature: 0 },
        answerButtons: { again: 0, hard: 0, good: 0, easy: 0 },
        retentionRate: 0,
        intervals: [],
        forecast: [],
        averagePace: 0,
        totalReviewTime: 0,
      } as Statistics;

      // Set empty derived stats on error
      todayStats = null;
      weekStats = null;
      monthStats = null;
      yearStats = null;
    } finally {
      logger.debug("[StatisticsUI] Setting loading to false");
      loading = false;
    }
  }

  async function retryLoading() {
    logger.debug("[StatisticsUI] Retrying to load statistics...");
    loading = true;
    statistics = null;

    try {
      logger.debug("[StatisticsUI] Loading decks and tags...");
      await loadDecksAndTags();
      logger.debug("[StatisticsUI] Decks and tags loaded");

      logger.debug("[StatisticsUI] Loading statistics...");
      const currentIds = getDeckIdsFromFilter(
        selectedDeckFilter,
        availableDecks
      );
      await loadStatistics(currentIds);
      logger.debug("[StatisticsUI] Statistics loaded");

      // Mount filter components after data is loaded
      tick().then(() => {
        logger.debug("[StatisticsUI] Mounting filter components");
        mountFilterComponents();
      });
    } catch (error) {
      logger.error("[StatisticsUI] Error in retry:", error);
    } finally {
      loading = false;
    }
  }

  function getDeckIdsFromFilter(
    filter: string,
    decks: { id: string; name: string; tag: string }[]
  ): string[] {
    if (filter === "all") {
      return decks.map((deck) => deck.id);
    } else if (filter.startsWith("deck:")) {
      return [filter.replace("deck:", "")];
    } else if (filter.startsWith("tag:")) {
      const tag = filter.replace("tag:", "");
      return decks.filter((deck) => deck.tag === tag).map((deck) => deck.id);
    }
    return [];
  }
</script>

<div class="decks-statistics-container">
  <h2 class="decks-statistics-modal-title">Overrall Statistics</h2>

  <div class="decks-filters">
    <div bind:this={deckFilterContainer}></div>
    <div bind:this={timeframeFilterContainer}></div>
  </div>

  {#if loading}
    <div class="decks-loading">Loading statistics...</div>
  {:else if !statistics && selectedDeckFilter !== ""}
    <div class="decks-error">
      <h3>Failed to Load Statistics</h3>
      <p>There was an error loading your statistics. This might be due to:</p>
      <ul>
        <li>Database connection issues</li>
        <li>Corrupted data</li>
        <li>Large dataset taking too long to process</li>
      </ul>
      <p>Check the browser console (F12) for detailed error information.</p>
      <button
        class="decks-retry-button"
        on:click={(e) => handleTouchClick(retryLoading, e)}
        on:touchend={(e) => handleTouchClick(retryLoading, e)}
      >
        Retry Loading
      </button>
    </div>
  {:else if !statistics && selectedDeckFilter === ""}
    <div class="decks-no-selection">
      <p class="decks-chart-subtitle">
        <span class="decks-loading-indicator"
          >Select a deck from the dropdown above to view statistics.</span
        >
      </p>
    </div>
  {/if}

  <!-- Charts section - always visible -->
  <div class="decks-stats">
    <OverallStatistics
      {statistics}
      {todayStats}
      {weekStats}
      {monthStats}
      {yearStats}
    />

    <!-- Forecast -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <FutureDueChart
          {logger}
          {statistics}
          {statisticsService}
          {selectedDeckIds}
        />
      </div>
    {/key}

    <!-- Maturity Progression -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <MaturityProgressionChart
          {logger}
          {statisticsService}
          {selectedDeckIds}
        />
      </div>
    {/key}

    <!-- Reviews Over Time -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <ReviewsOverTimeChart {logger} {statisticsService} {selectedDeckIds} />
      </div>
    {/key}

    <!-- Card Counts -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <CardCountsChart {logger} {statisticsService} {selectedDeckIds} />
      </div>
    {/key}

    <!-- Review Intervals -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <ReviewIntervalsChart {logger} {statisticsService} {selectedDeckIds} />
      </div>
    {/key}

    <!-- Card Stability -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <CardStabilityChart {logger} {statisticsService} {selectedDeckIds} />
      </div>
    {/key}

    <!-- Card Difficulty -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <CardDifficultyChart {logger} {statisticsService} {selectedDeckIds} />
      </div>
    {/key}

    <!-- Card Retrievability -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <CardRetrievabilityChart
          {logger}
          {statisticsService}
          {selectedDeckIds}
        />
      </div>
    {/key}

    <!-- Hourly Breakdown -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <HourlyBreakdownChart {logger} {statisticsService} {selectedDeckIds} />
      </div>
    {/key}

    <!-- Cards Added -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <CardsAddedChart {logger} {statisticsService} {selectedDeckIds} />
      </div>
    {/key}

    <!-- True Retention -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <TrueRetentionTable {logger} {statisticsService} {selectedDeckIds} />
      </div>
    {/key}

    <!-- Review Heatmap -->
    {#key selectedDeckIds.join(",")}
      <div class="decks-stats-section">
        <h3>Review Heatmap</h3>
        <p>Daily review activity over time</p>
        <ReviewHeatmap
          bind:this={heatmapComponent}
          getReviewCounts={async (days) => {
            if (!statisticsService) {
              console.error("StatisticsService is not available");
              return new Map();
            }
            try {
              const counts = await statisticsService.getReviewCountsByDate(
                days,
                selectedDeckIds
              );
              return counts; // Already a Map, no need to convert
            } catch (error) {
              console.error("Error getting review counts:", error);
              return new Map();
            }
          }}
        />
      </div>
    {/key}
  </div>

  <div class="decks-modal-actions">
    <a href="https://www.buymeacoffee.com/dscherdil0">
      <img
        src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
        alt="Buy Me A Coffee"
        height="40"
      />
    </a>

    <button
      class="decks-close-button"
      on:click={(e) => handleTouchClick(handleClose, e)}
      on:touchend={(e) => handleTouchClick(handleClose, e)}
    >
      Close
    </button>
  </div>
</div>

<style>
  .decks-statistics-container {
    padding: 20px;
    font-family: var(--font-interface);
    width: 100%;
    overflow-x: hidden;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .decks-stats {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    width: 100%;
    overflow: scroll;
  }

  .decks-loading,
  .decks-error {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }

  .decks-no-selection {
    text-align: center;
    padding: 60px 40px;
    color: var(--text-muted);
  }

  .decks-filters {
    display: flex;
    gap: 24px;
    margin-bottom: 24px;
    padding: 20px;
    background: var(--background-secondary);
    border-radius: 10px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .decks-filters > div {
    min-width: 200px;
  }

  .decks-stats-section {
    margin-bottom: 32px;
    margin-right: 20px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-stats-section:last-of-type {
    border-bottom: none;
  }

  .decks-stats-section h3 {
    margin: 0 0 20px 0;
    color: var(--text-normal);
    font-size: 18px;
    font-weight: 600;
  }

  .decks-modal-actions {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 24px;
    padding: 16px 20px;
    border-top: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    bottom: 0;
    margin-left: -20px;
    margin-right: -20px;
  }

  .decks-close-button {
    padding: 8px 16px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
    min-height: 44px;
    min-width: 80px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .decks-close-button:hover,
  .decks-close-button:active {
    background: var(--interactive-accent-hover);
  }

  .decks-error {
    text-align: left;
    max-width: 600px;
    margin: 0 auto;
  }

  .decks-error h3 {
    color: var(--text-error);
    margin-bottom: 16px;
  }

  .decks-error ul {
    margin: 12px 0;
    padding-left: 20px;
  }

  .decks-error li {
    margin: 4px 0;
    color: var(--text-muted);
  }

  .decks-retry-button {
    margin-top: 16px;
    padding: 12px 24px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    min-height: 44px;
    min-width: 120px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
    font-size: 14px;
    font-weight: 500;
  }

  .decks-retry-button:hover,
  .decks-retry-button:active {
    background: var(--interactive-accent-hover);
    transform: translateY(-1px);
  }

  /* Mobile responsive styles */
  @media (max-width: 768px) {
    .decks-statistics-container {
      padding: 12px;
    }

    .decks-filters {
      gap: 16px;
      padding: 16px;
      flex-direction: column;
    }

    .decks-filters > div {
      min-width: unset;
      width: 100%;
    }

    .decks-modal-actions {
      padding: 12px 16px;
      margin-left: -12px;
      margin-right: -12px;
    }

    .decks-close-button {
      padding: 12px 24px;
      font-size: 16px;
      min-height: 44px; /* Touch-friendly size */
    }
  }

  @media (max-width: 480px) {
    .decks-statistics-container {
      padding: 8px;
    }

    .decks-filters {
      padding: 12px;
      gap: 12px;
    }

    .decks-modal-actions {
      padding: 8px 12px;
      margin-left: -8px;
      margin-right: -8px;
    }
  }

  /* Removed unused chart controls CSS selectors */

  /* Mobile responsive styles */
  @media (max-width: 768px) {
    .decks-statistics-container {
      padding: 12px;
    }

    .decks-filters {
      flex-direction: column;
      gap: 16px;
      padding: 16px;
    }

    .decks-close-button {
      padding: 12px 20px;
      font-size: 16px;
      min-height: 44px;
    }
  }
</style>
