<script lang="ts">
    import { onMount, createEventDispatcher, tick } from "svelte";
    import { ButtonComponent, Setting } from "obsidian";
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
    import type {
        Statistics,
        ReviewLog,
        Flashcard,
    } from "../../database/types";

    import { StatisticsService } from "../../services/StatisticsService";
    import type { DecksSettings } from "../../settings";
    import { Logger } from "@/utils/logging";

    export let statisticsService: StatisticsService;
    export let deckFilter: string = "all";
    export let logger: Logger;
    export const settings: DecksSettings = {} as DecksSettings;

    const dispatch = createEventDispatcher();

    let loading = true;
    let statistics: Statistics | null = null;
    let selectedDeckFilter = deckFilter; // "all", "tag:tagname", or "deck:deckid"
    let selectedTimeframe = "12months"; // "12months" or "all"
    let availableDecks: any[] = [];
    let availableTags: string[] = [];

    // Computed deck IDs based on current filter
    $: selectedDeckIds = getDeckIdsFromFilter(
        selectedDeckFilter,
        availableDecks
    );
    let heatmapComponent: ReviewHeatmap;
    let deckFilterContainer: HTMLElement;
    let timeframeFilterContainer: HTMLElement;

    // Track last event to prevent double execution
    let lastEventTime = 0;
    let lastEventType = "";

    // Derived statistics - computed after loading
    let todayStats: any = null;
    let weekStats: any = null;
    let monthStats: any = null;
    let yearStats: any = null;

    onMount(async () => {
        loading = true;
        logger.debug("[StatisticsUI] Starting onMount");

        try {
            logger.debug("[StatisticsUI] Loading decks and tags...");
            await loadDecksAndTags();
            logger.debug("[StatisticsUI] Decks and tags loaded");

            logger.debug("[StatisticsUI] Loading statistics...");
            await loadStatistics();
            logger.debug("[StatisticsUI] Statistics loaded");

            // Mount filter components after data is loaded
            tick().then(() => {
                logger.debug("[StatisticsUI] Mounting filter components");
                mountFilterComponents();
            });
        } catch (error) {
            logger.error("[StatisticsUI] Error in onMount:", error);
        } finally {
            loading = false;
        }
    });

    function mountFilterComponents() {
        // Deck filter dropdown
        if (deckFilterContainer) {
            new Setting(deckFilterContainer)
                .setName("Select Deck(s):")
                .setClass("decks-deck-filter-container")
                .addDropdown((dropdown) => {
                    dropdown.addOption("all", "All Decks");

                    availableTags.forEach((tag) => {
                        dropdown.addOption(`tag:${tag}`, `Tag: ${tag}`);
                    });

                    availableDecks.forEach((deck) => {
                        dropdown.addOption(`deck:${deck.id}`, deck.name);
                    });
                    dropdown.setValue(selectedDeckFilter);
                    dropdown.onChange((value: string) => {
                        selectedDeckFilter = value;
                        handleFilterChange();
                    });
                });
        }

        // Timeframe filter dropdown
        if (timeframeFilterContainer) {
            new Setting(timeframeFilterContainer)
                .setName("Timeframe:")
                .setClass("decks-timeframe-filter-container")
                .addDropdown((dropdown) =>
                    dropdown
                        .addOption("12months", "Last 12 Months")
                        .addOption("all", "All History")
                        .setValue(selectedTimeframe)
                        .onChange((value: string) => {
                            selectedTimeframe = value;
                            handleFilterChange();
                        })
                );
        }
    }

    async function loadDecksAndTags() {
        try {
            logger.debug(
                "[StatisticsUI] Getting available decks and tags from StatisticsService..."
            );
            const decksAndTags =
                await statisticsService.getAvailableDecksAndTags();
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

    async function loadStatistics() {
        try {
            logger.debug(
                `[StatisticsUI] Getting overall statistics (filter: ${selectedDeckFilter}, timeframe: ${selectedTimeframe})...`
            );

            statistics = await statisticsService.getOverallStatistics(
                selectedDeckFilter,
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

    async function handleFilterChange() {
        logger.debug("[StatisticsUI] Filter changed, reloading data...");
        loading = true;
        try {
            await loadStatistics();
        } catch (error) {
            logger.error("[StatisticsUI] Error during filter change:", error);
        } finally {
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
            await loadStatistics();
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

    function formatDate(dateString: string) {
        return new Date(dateString).toLocaleDateString();
    }

    function formatTime(seconds: number) {
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        return `${minutes}m`;
    }

    function formatPace(seconds: number) {
        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
        }
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return `${minutes}m ${remainingSeconds}s`;
    }

    function calculateAverageEase() {
        return statisticsService.calculateAverageEase(statistics).toFixed(2);
    }

    function calculateAverageInterval() {
        return statisticsService.calculateAverageInterval(statistics) + "d";
    }

    function getDueToday() {
        const dueToday = statisticsService.getDueToday(statistics);
        logger.debug(
            `[StatisticsUI] Due today: ${dueToday}`,
            statistics?.forecast
        );
        return dueToday;
    }

    function getDueTomorrow() {
        const dueTomorrow = statisticsService.getDueTomorrow(statistics);
        logger.debug(
            `[StatisticsUI] Due tomorrow: ${dueTomorrow}`,
            statistics?.forecast
        );
        return dueTomorrow;
    }

    function getMaturityRatio() {
        return statisticsService.getMaturityRatio(statistics).toFixed(1) + "%";
    }

    function getDeckIdsFromFilter(filter: string, decks: any[]): string[] {
        if (filter === "all") {
            return decks.map((deck) => deck.id);
        } else if (filter.startsWith("deck:")) {
            return [filter.replace("deck:", "")];
        } else if (filter.startsWith("tag:")) {
            const tag = filter.replace("tag:", "");
            return decks
                .filter((deck) => deck.tag === tag)
                .map((deck) => deck.id);
        }
        return [];
    }
</script>

<div class="decks-statistics-container">
    <h2 class="decks-statistics-modal-title">Overrall Statistics</h2>
    {#if loading}
        <div class="decks-loading">Loading statistics...</div>
    {:else if !statistics}
        <div class="decks-error">
            <h3>Failed to Load Statistics</h3>
            <p>
                There was an error loading your statistics. This might be due
                to:
            </p>
            <ul>
                <li>Database connection issues</li>
                <li>Corrupted data</li>
                <li>Large dataset taking too long to process</li>
            </ul>
            <p>
                Check the browser console (F12) for detailed error information.
            </p>
            <button
                class="decks-retry-button"
                on:click={(e) => handleTouchClick(retryLoading, e)}
                on:touchend={(e) => handleTouchClick(retryLoading, e)}
            >
                Retry Loading
            </button>
        </div>
    {:else}
        <div class="decks-filters">
            <div bind:this={deckFilterContainer}></div>
            <div bind:this={timeframeFilterContainer}></div>
        </div>

        <div class="decks-stats">
            <!-- Current Status -->
            <div class="decks-stats-section">
                <h3>Current Status</h3>
                <div class="decks-stats-grid">
                    <div class="decks-stat-card">
                        <div class="decks-stat-value">
                            {statistics?.cardStats?.new || 0}
                        </div>
                        <div class="decks-stat-label">New Cards</div>
                    </div>
                    <div class="decks-stat-card">
                        <div class="decks-stat-value" style="display: none;">
                            0
                        </div>
                        <div class="decks-stat-label" style="display: none;">
                            Learning
                        </div>
                    </div>
                    <div class="decks-stat-card">
                        <div class="decks-stat-value">
                            {statistics?.cardStats?.review || 0}
                        </div>
                        <div class="decks-stat-label">Review</div>
                    </div>
                    <div class="decks-stat-card">
                        <div class="decks-stat-value">
                            {statistics?.cardStats?.mature || 0}
                        </div>
                        <div class="decks-stat-label">Mature</div>
                    </div>
                    <div class="decks-stat-card">
                        <div class="decks-stat-value">{getDueToday()}</div>
                        <div class="decks-stat-label">Due Today</div>
                    </div>
                </div>
            </div>

            <!-- Pace Statistics -->
            <div class="decks-stats-section">
                <h3>Review Pace</h3>
                <div class="decks-stats-grid">
                    <div class="decks-stat-card">
                        <div class="decks-stat-value">
                            {statistics?.averagePace
                                ? formatPace(statistics.averagePace)
                                : "N/A"}
                        </div>
                        <div class="decks-stat-label">Average per Card</div>
                    </div>
                    <div class="decks-stat-card">
                        <div class="decks-stat-value">
                            {statistics?.totalReviewTime
                                ? formatTime(statistics.totalReviewTime)
                                : "N/A"}
                        </div>
                        <div class="decks-stat-label">Total Review Time</div>
                    </div>
                </div>
            </div>

            <!-- Today's Statistics -->
            <div class="decks-stats-section">
                <h3>Today's Statistics</h3>
                {#if todayStats}
                    <div class="decks-stats-grid">
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {todayStats.reviews}
                            </div>
                            <div class="decks-stat-label">Cards Studied</div>
                        </div>
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {formatTime(todayStats.timeSpent)}
                            </div>
                            <div class="decks-stat-label">Time Spent</div>
                        </div>
                    </div>

                    <h4>Breakdown by Card Type</h4>
                    <div class="decks-stats-grid">
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {todayStats.newCards}
                            </div>
                            <div class="decks-stat-label">New Cards</div>
                        </div>
                        <div class="decks-stat-card" style="display: none;">
                            <div class="decks-stat-value">0</div>
                            <div class="decks-stat-label">Learning</div>
                        </div>
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {todayStats.reviewCards}
                            </div>
                            <div class="decks-stat-label">Review</div>
                        </div>
                    </div>
                {:else}
                    <div class="decks-no-data-message">
                        <p>No reviews today yet.</p>
                        <p class="decks-help-text">
                            Start reviewing flashcards to see your daily
                            statistics here!
                        </p>
                    </div>
                {/if}
            </div>

            <!-- Week/Month/Year Statistics -->
            <div class="decks-stats-section">
                <h3>This Week</h3>
                {#if weekStats && weekStats.reviews > 0}
                    <div class="decks-stats-grid">
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {weekStats.reviews}
                            </div>
                            <div class="decks-stat-label">Cards Studied</div>
                        </div>
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {formatTime(weekStats.timeSpent)}
                            </div>
                            <div class="decks-stat-label">Time Spent</div>
                        </div>
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {weekStats.correctRate.toFixed(1)}%
                            </div>
                            <div class="decks-stat-label">Success Rate</div>
                        </div>
                    </div>
                {:else}
                    <div class="decks-no-data-message">
                        <p>No reviews this week yet.</p>
                    </div>
                {/if}

                <h3>This Month</h3>
                {#if monthStats && monthStats.reviews > 0}
                    <div class="decks-stats-grid">
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {monthStats.reviews}
                            </div>
                            <div class="decks-stat-label">Cards Studied</div>
                        </div>
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {formatTime(monthStats.timeSpent)}
                            </div>
                            <div class="decks-stat-label">Time Spent</div>
                        </div>
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {monthStats.correctRate.toFixed(1)}%
                            </div>
                            <div class="decks-stat-label">Success Rate</div>
                        </div>
                    </div>
                {:else}
                    <div class="decks-no-data-message">
                        <p>No reviews this month yet.</p>
                    </div>
                {/if}

                <h3>This Year</h3>
                {#if yearStats && yearStats.reviews > 0}
                    <div class="decks-stats-grid">
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {yearStats.reviews}
                            </div>
                            <div class="decks-stat-label">Cards Studied</div>
                        </div>
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {formatTime(yearStats.timeSpent)}
                            </div>
                            <div class="decks-stat-label">Time Spent</div>
                        </div>
                        <div class="decks-stat-card">
                            <div class="decks-stat-value">
                                {yearStats.correctRate.toFixed(1)}%
                            </div>
                            <div class="decks-stat-label">Success Rate</div>
                        </div>
                    </div>
                {:else}
                    <div class="decks-no-data-message">
                        <p>No reviews this year yet.</p>
                    </div>
                {/if}
            </div>

            <!-- Deck Statistics & Metrics -->
            <div class="decks-stats-section">
                <h3>Deck Statistics & Metrics</h3>
                <div class="decks-metrics-grid">
                    <div class="decks-metric-card">
                        <div class="decks-metric-value">
                            {(statistics?.retentionRate || 0).toFixed(1)}%
                        </div>
                        <div class="decks-metric-label">Retention Rate</div>
                        <div class="decks-metric-description">
                            % of reviews answered correctly (excluding "Again")
                        </div>
                    </div>
                    <div class="decks-metric-card">
                        <div class="decks-metric-value">
                            {calculateAverageEase()}
                        </div>
                        <div class="decks-metric-label">Average Ease</div>
                        <div class="decks-metric-description">
                            Mean of ease button values
                        </div>
                    </div>
                    <div class="decks-metric-card">
                        <div class="decks-metric-value">
                            {calculateAverageInterval()}
                        </div>
                        <div class="decks-metric-label">Avg Interval</div>
                        <div class="decks-metric-description">
                            Mean interval of all review cards
                        </div>
                    </div>
                    <div class="decks-metric-card">
                        <div class="decks-metric-value">{getDueToday()}</div>
                        <div class="decks-metric-label">Due Today</div>
                        <div class="decks-metric-description">
                            Number of cards due today
                        </div>
                    </div>
                    <div class="decks-metric-card">
                        <div class="decks-metric-value">{getDueTomorrow()}</div>
                        <div class="decks-metric-label">Due Tomorrow</div>
                        <div class="decks-metric-description">
                            Number of cards due tomorrow
                        </div>
                    </div>
                    <div class="decks-metric-card">
                        <div class="decks-metric-value" style="display: none;">
                            0
                        </div>
                        <div class="decks-metric-label" style="display: none;">
                            Learning Cards
                        </div>
                        <div
                            class="decks-metric-description"
                            style="display: none;"
                        >
                            Number of cards in the learning queue
                        </div>
                    </div>
                    <div class="decks-metric-card">
                        <div class="decks-metric-value">
                            {getMaturityRatio()}
                        </div>
                        <div class="decks-metric-label">Maturity Ratio</div>
                        <div class="decks-metric-description">
                            Mature cards ÷ total cards
                        </div>
                    </div>
                    <div class="decks-metric-card">
                        <div class="decks-metric-value">
                            {statisticsService.getTotalCards(statistics)}
                        </div>
                        <div class="decks-metric-label">Total Cards</div>
                        <div class="decks-metric-description">
                            All cards in collection
                        </div>
                    </div>
                </div>

                <h4>Card Status Breakdown</h4>
                <div class="decks-stats-grid">
                    <div class="decks-stat-card">
                        <div class="decks-stat-value">
                            {statistics?.cardStats?.new || 0}
                        </div>
                        <div class="decks-stat-label">New Cards</div>
                    </div>
                    <div class="decks-stat-card">
                        <div class="decks-stat-value" style="display: none;">
                            0
                        </div>
                        <div class="decks-stat-label" style="display: none;">
                            Learning
                        </div>
                    </div>
                    <div class="decks-stat-card">
                        <div class="decks-stat-value">
                            {statistics?.cardStats?.mature || 0}
                        </div>
                        <div class="decks-stat-label">Mature</div>
                    </div>
                </div>
            </div>

            <!-- Answer Button Usage -->
            <div class="decks-stats-section">
                <h3>Answer Button Usage</h3>
                {#if statistics?.answerButtons && (statistics.answerButtons.again > 0 || statistics.answerButtons.hard > 0 || statistics.answerButtons.good > 0 || statistics.answerButtons.easy > 0)}
                    <div class="decks-button-stats">
                        <div class="decks-button-bar decks-again">
                            <div class="decks-button-label">Again</div>
                            <div class="decks-button-count">
                                {statistics.answerButtons.again}
                            </div>
                            <div class="decks-button-percentage">
                                {(
                                    (statistics.answerButtons.again /
                                        (statistics.answerButtons.again +
                                            statistics.answerButtons.hard +
                                            statistics.answerButtons.good +
                                            statistics.answerButtons.easy)) *
                                    100
                                ).toFixed(1)}%
                            </div>
                        </div>
                        <div class="decks-button-bar decks-hard">
                            <div class="decks-button-label">Hard</div>
                            <div class="decks-button-count">
                                {statistics.answerButtons.hard}
                            </div>
                            <div class="decks-button-percentage">
                                {(
                                    (statistics.answerButtons.hard /
                                        (statistics.answerButtons.again +
                                            statistics.answerButtons.hard +
                                            statistics.answerButtons.good +
                                            statistics.answerButtons.easy)) *
                                    100
                                ).toFixed(1)}%
                            </div>
                        </div>
                        <div class="decks-button-bar decks-good">
                            <div class="decks-button-label">Good</div>
                            <div class="decks-button-count">
                                {statistics.answerButtons.good}
                            </div>
                            <div class="decks-button-percentage">
                                {(
                                    (statistics.answerButtons.good /
                                        (statistics.answerButtons.again +
                                            statistics.answerButtons.hard +
                                            statistics.answerButtons.good +
                                            statistics.answerButtons.easy)) *
                                    100
                                ).toFixed(1)}%
                            </div>
                        </div>
                        <div class="decks-button-bar decks-easy">
                            <div class="decks-button-label">Easy</div>
                            <div class="decks-button-count">
                                {statistics.answerButtons.easy}
                            </div>
                            <div class="decks-button-percentage">
                                {(
                                    (statistics.answerButtons.easy /
                                        (statistics.answerButtons.again +
                                            statistics.answerButtons.hard +
                                            statistics.answerButtons.good +
                                            statistics.answerButtons.easy)) *
                                    100
                                ).toFixed(1)}%
                            </div>
                        </div>
                    </div>
                {:else}
                    <div class="decks-no-data-message">
                        <p>No answer button data available yet.</p>
                        <p class="decks-help-text">
                            Complete some reviews to see answer button
                            statistics.
                        </p>
                    </div>
                {/if}
            </div>

            <!-- Forecast -->
            <div class="decks-stats-section">
                <FutureDueChart {logger} {statistics} {statisticsService} />
            </div>

            <!-- Reviews Over Time -->
            <div class="decks-stats-section">
                <ReviewsOverTimeChart
                    {logger}
                    {statisticsService}
                    {selectedDeckIds}
                />
            </div>

            <!-- Card Counts -->
            <div class="decks-stats-section">
                <CardCountsChart
                    {logger}
                    {statisticsService}
                    {selectedDeckIds}
                />
            </div>

            <!-- Review Intervals -->
            <div class="decks-stats-section">
                <ReviewIntervalsChart
                    {logger}
                    {statisticsService}
                    {selectedDeckIds}
                />
            </div>

            <!-- Card Stability -->
            <div class="decks-stats-section">
                <CardStabilityChart
                    {logger}
                    {statisticsService}
                    {selectedDeckIds}
                />
            </div>

            <!-- Card Difficulty -->
            <div class="decks-stats-section">
                <CardDifficultyChart
                    {logger}
                    {statisticsService}
                    {selectedDeckIds}
                />
            </div>

            <!-- Card Retrievability -->
            <div class="decks-stats-section">
                <CardRetrievabilityChart
                    {logger}
                    {statisticsService}
                    {selectedDeckIds}
                />
            </div>

            <!-- Hourly Breakdown -->
            <div class="decks-stats-section">
                <HourlyBreakdownChart
                    {logger}
                    {statisticsService}
                    {selectedDeckIds}
                />
            </div>

            <!-- Cards Added -->
            <div class="decks-stats-section">
                <CardsAddedChart
                    {logger}
                    {statisticsService}
                    {selectedDeckIds}
                />
            </div>

            <!-- True Retention -->
            <div class="decks-stats-section">
                <TrueRetentionTable
                    {logger}
                    {statisticsService}
                    {selectedDeckIds}
                />
            </div>

            <!-- Review Heatmap -->
            <div class="decks-stats-section">
                <h3>Review Heatmap</h3>
                <p>Daily review activity over time</p>
                <ReviewHeatmap
                    bind:this={heatmapComponent}
                    getReviewCounts={async (days) => {
                        const counts =
                            await statisticsService.getReviewCountsByDate(
                                days,
                                selectedDeckIds
                            );
                        return new Map(Object.entries(counts));
                    }}
                />
            </div>
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
                on:click={(e) => handleTouchClick(() => dispatch("close"), e)}
                on:touchend={(e) =>
                    handleTouchClick(() => dispatch("close"), e)}
            >
                Close
            </button>
        </div>
    {/if}
</div>
{#if false}
    <div
        class="decks-deck-filter-container decks-timeframe-filter-container"
    ></div>
    <div class="decks-deck-filter-container">
        <div class="decks-setting-item-control">
            <div class="decks-dropdown"></div>
        </div>
    </div>
{/if}

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

    .decks-stats-section h4 {
        margin: 24px 0 12px 0;
        color: var(--text-normal);
        font-size: 16px;
        font-weight: 500;
    }

    .decks-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 16px;
        margin-bottom: 20px;
    }

    .decks-stat-card {
        background: var(--background-secondary);
        padding: 16px;
        border-radius: 8px;
        text-align: center;
        border: 1px solid var(--background-modifier-border);
        min-height: 80px;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .decks-stat-value {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-normal);
        margin-bottom: 4px;
    }

    .decks-stat-label {
        font-size: 12px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .decks-metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
    }

    .decks-metric-card {
        background: var(--background-secondary);
        padding: 20px;
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
        min-height: 100px;
    }

    .decks-metric-value {
        font-size: 28px;
        font-weight: 700;
        color: var(--text-accent);
        margin-bottom: 8px;
    }

    .decks-metric-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-normal);
        margin-bottom: 4px;
    }

    .decks-metric-description {
        font-size: 11px;
        color: var(--text-muted);
        line-height: 1.3;
    }

    .decks-button-stats {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .decks-button-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-radius: 6px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
    }

    .decks-button-bar.decks-again {
        border-left: 4px solid #ef4444;
    }

    .decks-button-bar.decks-hard {
        border-left: 4px solid #f97316;
    }

    .decks-button-bar.decks-good {
        border-left: 4px solid #22c55e;
    }

    .decks-button-bar.decks-easy {
        border-left: 4px solid #3b82f6;
    }

    .decks-button-label {
        font-weight: 500;
        color: var(--text-normal);
    }

    .decks-button-count {
        font-weight: 600;
        color: var(--text-normal);
        font-size: 18px;
    }

    .decks-button-percentage {
        font-size: 12px;
        color: var(--text-muted);
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

    .decks-no-data-message {
        text-align: center;
        padding: 24px;
        background: var(--background-secondary);
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
    }

    .decks-no-data-message p {
        margin: 0 0 8px 0;
        color: var(--text-muted);
    }

    .decks-help-text {
        font-size: 12px !important;
        color: var(--text-faint) !important;
        margin: 0 !important;
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

        .decks-stats-grid {
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 12px;
        }

        .decks-stat-card {
            padding: 12px;
            min-height: 70px;
        }

        .decks-stat-value {
            font-size: 20px;
        }

        .decks-metrics-grid {
            grid-template-columns: 1fr;
            gap: 12px;
        }

        .decks-metric-card {
            padding: 16px;
            min-height: 80px;
        }

        .decks-metric-value {
            font-size: 24px;
        }

        .decks-button-bar {
            padding: 10px 12px;
            flex-direction: column;
            gap: 8px;
            text-align: center;
        }

        .decks-button-count {
            font-size: 16px;
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

        .decks-stats-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }

        .decks-stat-card {
            padding: 10px;
            min-height: 60px;
        }

        .decks-stat-value {
            font-size: 18px;
        }

        .decks-stat-label {
            font-size: 11px;
        }

        .decks-metric-card {
            padding: 12px;
        }

        .decks-metric-value {
            font-size: 20px;
        }

        .decks-modal-actions {
            padding: 8px 12px;
            margin-left: -8px;
            margin-right: -8px;
        }
    }

    /* Chart controls and descriptions */
    .decks-chart-controls {
        margin: 1rem 0;
        display: flex;
        gap: 1rem;
        align-items: center;
    }

    .decks-chart-controls label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        color: var(--text-normal);
    }

    .decks-chart-controls select {
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        background: var(--background-primary);
        color: var(--text-normal);
        font-size: 0.9rem;
        min-width: 120px;
    }

    .decks-chart-controls select:focus {
        outline: none;
        border-color: var(--interactive-accent);
        box-shadow: 0 0 0 2px var(--interactive-accent-hover);
    }

    .decks-chart-description {
        margin: 0.5rem 0 1rem 0;
        font-size: 0.9rem;
        color: var(--text-muted);
        line-height: 1.4;
    }

    /* Mobile responsiveness for charts */
    @media (max-width: 768px) {
        .decks-chart-controls {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5rem;
        }

        .decks-chart-controls select {
            min-width: 100px;
        }
    }

    @media (max-width: 390px) {
        .decks-timeframe-filter-container {
            flex-direction: column;
        }

        .decks-deck-filter-container {
            flex-direction: column;
        }

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

            .decks-stats-grid {
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                gap: 12px;
            }

            .decks-stat-card {
                padding: 12px;
                min-height: 70px;
            }

            .decks-stat-value {
                font-size: 20px;
            }

            .decks-stat-label {
                font-size: 11px;
            }

            .decks-metrics-grid {
                grid-template-columns: 1fr;
                gap: 12px;
            }

            .decks-metric-card {
                padding: 16px;
                min-height: 80px;
            }

            .decks-metric-value {
                font-size: 24px;
            }

            .decks-metric-label {
                font-size: 13px;
            }

            .decks-metric-description {
                font-size: 10px;
            }

            .decks-button-bar {
                padding: 10px 12px;
            }

            .decks-button-label {
                font-size: 13px;
            }

            .decks-button-count {
                font-size: 14px;
            }

            .decks-button-percentage {
                font-size: 11px;
            }

            .decks-no-data-message {
                padding: 20px;
            }

            .decks-help-text {
                font-size: 11px;
            }

            .decks-close-button {
                padding: 12px 20px;
                font-size: 16px;
                min-height: 44px;
            }
        }
    }
</style>
