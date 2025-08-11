<script lang="ts">
    import type DecksPlugin from "../main";
    import { onMount, createEventDispatcher, tick } from "svelte";
    import { Setting } from "obsidian";
    import ReviewHeatmap from "./ReviewHeatmap.svelte";
    import type { Statistics } from "../database/types";

    export let plugin: DecksPlugin;

    const dispatch = createEventDispatcher();

    let loading = true;
    let statistics: Statistics | null = null;
    let selectedDeckFilter = "all"; // "all", "tag:tagname", or "deck:deckid"
    let selectedTimeframe = "12months"; // "12months" or "all"
    let availableDecks: any[] = [];
    let availableTags: string[] = [];
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
        await loadDecksAndTags();
        await loadStatistics();

        // Mount filter components after data is loaded
        tick().then(() => {
            mountFilterComponents();
        });
    });

    function mountFilterComponents() {
        // Deck filter dropdown
        if (deckFilterContainer) {
            new Setting(deckFilterContainer)
                .setName("Select Deck(s):")
                .setClass("deck-filter-container")
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
                .setClass("timeframe-filter-container")
                .addDropdown((dropdown) =>
                    dropdown
                        .addOption("12months", "Last 12 Months")
                        .addOption("all", "All History")
                        .setValue(selectedTimeframe)
                        .onChange((value: string) => {
                            selectedTimeframe = value;
                            handleFilterChange();
                        }),
                );
        }
    }

    async function loadDecksAndTags() {
        try {
            availableDecks = await plugin.getDecks();
            availableTags = [
                ...new Set(availableDecks.map((deck) => deck.tag)),
            ];
        } catch (error) {
            console.error("Error loading decks and tags:", error);
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
            statistics = await plugin.getOverallStatistics(
                selectedDeckFilter,
                selectedTimeframe,
            );
            plugin.debugLog("Loaded statistics:", statistics);

            // Compute derived statistics once data is loaded
            todayStats = getTodayStats();
            weekStats = getTimeframeStats(7);
            monthStats = getTimeframeStats(30);
            yearStats = getTimeframeStats(365);
        } catch (error) {
            console.error("Error loading statistics:", error);
            statistics = {
                dailyStats: [],
                cardStats: { new: 0, mature: 0 },
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
            loading = false;
        }
    }

    async function handleFilterChange() {
        await loadStatistics();
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

    function getTodayStats() {
        if (!statistics?.dailyStats || statistics.dailyStats.length === 0)
            return null;
        const today = new Date().toISOString().split("T")[0];
        // First try to find today's stats, if not available use the most recent
        return (
            statistics.dailyStats.find((day) => day.date === today) ||
            statistics.dailyStats[0] ||
            null
        );
    }

    function getTimeframeStats(days: number) {
        if (!statistics?.dailyStats) {
            return {
                reviews: 0,
                timeSpent: 0,
                newCards: 0,
                learningCards: 0,
                reviewCards: 0,
                correctRate: 0,
            };
        }
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffStr = cutoffDate.toISOString().split("T")[0];

        const filteredStats = statistics.dailyStats.filter(
            (day) => day.date >= cutoffStr,
        );

        if (filteredStats.length === 0) {
            return {
                reviews: 0,
                timeSpent: 0,
                newCards: 0,
                learningCards: 0,
                reviewCards: 0,
                correctRate: 0,
            };
        }

        return filteredStats.reduce(
            (acc, day) => ({
                reviews: acc.reviews + day.reviews,
                timeSpent: acc.timeSpent + day.timeSpent,
                newCards: acc.newCards + day.newCards,
                learningCards: 0, // No learning cards in pure FSRS
                reviewCards: acc.reviewCards + day.reviewCards,
                correctRate:
                    acc.reviews + day.reviews > 0
                        ? (acc.correctRate * acc.reviews +
                              day.correctRate * day.reviews) /
                          (acc.reviews + day.reviews)
                        : 0,
            }),
            {
                reviews: 0,
                timeSpent: 0,
                newCards: 0,
                learningCards: 0,
                reviewCards: 0,
                correctRate: 0,
            },
        );
    }

    function calculateAverageEase() {
        if (!statistics?.answerButtons) return "0.00";
        const { again, hard, good, easy } = statistics.answerButtons;
        const total = again + hard + good + easy;
        if (total === 0) return "0.00";
        // Map buttons to values: Again=1, Hard=2, Good=3, Easy=4
        const weightedSum = again * 1 + hard * 2 + good * 3 + easy * 4;
        return (weightedSum / total).toFixed(2);
    }

    function calculateAverageInterval() {
        if (!statistics?.intervals || statistics.intervals.length === 0)
            return 0;
        let totalInterval = 0;
        let totalCards = 0;

        statistics.intervals.forEach((interval) => {
            // Convert interval string to minutes
            const intervalStr = interval.interval;
            let minutes = 0;

            if (intervalStr.endsWith("h")) {
                minutes = parseInt(intervalStr) * 60;
            } else if (intervalStr.endsWith("d")) {
                minutes = parseInt(intervalStr) * 1440;
            } else if (intervalStr.endsWith("m")) {
                minutes = parseInt(intervalStr) * 43200; // months
            }

            totalInterval += minutes * interval.count;
            totalCards += interval.count;
        });

        if (totalCards === 0) return 0;
        const avgMinutes = totalInterval / totalCards;

        // Convert back to days for display
        return Math.round(avgMinutes / 1440);
    }

    function getDueToday() {
        if (!statistics?.forecast || statistics.forecast.length === 0) return 0;
        const today = new Date().toISOString().split("T")[0];
        const todayForecast = statistics.forecast.find(
            (day) => day.date === today,
        );
        return todayForecast ? todayForecast.dueCount : 0;
    }

    function getDueTomorrow() {
        if (!statistics?.forecast || statistics.forecast.length === 0) return 0;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split("T")[0];
        const tomorrowForecast = statistics.forecast.find(
            (day) => day.date === tomorrowStr,
        );
        return tomorrowForecast ? tomorrowForecast.dueCount : 0;
    }

    function calculateBarHeight(dueCount: number, maxDueCount: number): number {
        const barHeight = 400; // Maximum height in pixels (leaving room in 150px container)

        if (maxDueCount === 0) return 0;

        const proportion = dueCount / maxDueCount;
        return Math.max(proportion * barHeight - 80, 10);
    }

    function getMaturityRatio() {
        if (!statistics?.cardStats) return "0.0";
        const { new: newCards, mature } = statistics.cardStats;
        const total = newCards + mature;
        if (total === 0) return "0.0";
        return ((mature / total) * 100).toFixed(1);
    }
</script>

<div class="statistics-container">
    {#if loading}
        <div class="loading">Loading statistics...</div>
    {:else if !statistics}
        <div class="error">
            <p>Failed to load statistics</p>
            <button
                class="retry-button"
                on:click={(e) => handleTouchClick(loadStatistics, e)}
                on:touchend={(e) => handleTouchClick(loadStatistics, e)}
            >
                Retry
            </button>
        </div>
    {:else}
        <div class="filters">
            <div bind:this={deckFilterContainer}></div>
            <div bind:this={timeframeFilterContainer}></div>
        </div>

        <!-- Current Status -->
        <div class="stats-section">
            <h3>Current Status</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">
                        {statistics?.cardStats?.new || 0}
                    </div>
                    <div class="stat-label">New Cards</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" style="display: none;">0</div>
                    <div class="stat-label" style="display: none;">
                        Learning
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">
                        {statistics?.cardStats?.mature || 0}
                    </div>
                    <div class="stat-label">Mature</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">{getDueToday()}</div>
                    <div class="stat-label">Due Today</div>
                </div>
            </div>
        </div>

        <!-- Pace Statistics -->
        <div class="stats-section">
            <h3>Review Pace</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">
                        {statistics?.averagePace
                            ? formatPace(statistics.averagePace)
                            : "N/A"}
                    </div>
                    <div class="stat-label">Average per Card</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">
                        {statistics?.totalReviewTime
                            ? formatTime(statistics.totalReviewTime)
                            : "N/A"}
                    </div>
                    <div class="stat-label">Total Review Time</div>
                </div>
            </div>
        </div>

        <!-- Today's Statistics -->
        <div class="stats-section">
            <h3>Today's Statistics</h3>
            {#if todayStats}
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">{todayStats.reviews}</div>
                        <div class="stat-label">Cards Studied</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">
                            {formatTime(todayStats.timeSpent)}
                        </div>
                        <div class="stat-label">Time Spent</div>
                    </div>
                </div>

                <h4>Breakdown by Card Type</h4>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">{todayStats.newCards}</div>
                        <div class="stat-label">New Cards</div>
                    </div>
                    <div class="stat-card" style="display: none;">
                        <div class="stat-value">0</div>
                        <div class="stat-label">Learning</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">{todayStats.reviewCards}</div>
                        <div class="stat-label">Review</div>
                    </div>
                </div>
            {:else}
                <div class="no-data-message">
                    <p>No reviews today yet.</p>
                    <p class="help-text">
                        Start reviewing flashcards to see your daily statistics
                        here!
                    </p>
                </div>
            {/if}
        </div>

        <!-- Week/Month/Year Statistics -->
        <div class="stats-section">
            <h3>This Week</h3>
            {#if weekStats && weekStats.reviews > 0}
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">{weekStats.reviews}</div>
                        <div class="stat-label">Cards Studied</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">
                            {formatTime(weekStats.timeSpent)}
                        </div>
                        <div class="stat-label">Time Spent</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">
                            {weekStats.correctRate.toFixed(1)}%
                        </div>
                        <div class="stat-label">Success Rate</div>
                    </div>
                </div>
            {:else}
                <div class="no-data-message">
                    <p>No reviews this week yet.</p>
                </div>
            {/if}

            <h3>This Month</h3>
            {#if monthStats && monthStats.reviews > 0}
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">{monthStats.reviews}</div>
                        <div class="stat-label">Cards Studied</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">
                            {formatTime(monthStats.timeSpent)}
                        </div>
                        <div class="stat-label">Time Spent</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">
                            {monthStats.correctRate.toFixed(1)}%
                        </div>
                        <div class="stat-label">Success Rate</div>
                    </div>
                </div>
            {:else}
                <div class="no-data-message">
                    <p>No reviews this month yet.</p>
                </div>
            {/if}

            <h3>This Year</h3>
            {#if yearStats && yearStats.reviews > 0}
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">{yearStats.reviews}</div>
                        <div class="stat-label">Cards Studied</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">
                            {formatTime(yearStats.timeSpent)}
                        </div>
                        <div class="stat-label">Time Spent</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">
                            {yearStats.correctRate.toFixed(1)}%
                        </div>
                        <div class="stat-label">Success Rate</div>
                    </div>
                </div>
            {:else}
                <div class="no-data-message">
                    <p>No reviews this year yet.</p>
                </div>
            {/if}
        </div>

        <!-- Deck Statistics & Metrics -->
        <div class="stats-section">
            <h3>Deck Statistics & Metrics</h3>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value">
                        {(statistics?.retentionRate || 0).toFixed(1)}%
                    </div>
                    <div class="metric-label">Retention Rate</div>
                    <div class="metric-description">
                        % of reviews answered correctly (excluding "Again")
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{calculateAverageEase()}</div>
                    <div class="metric-label">Average Ease</div>
                    <div class="metric-description">
                        Mean of ease button values
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">
                        {calculateAverageInterval()}d
                    </div>
                    <div class="metric-label">Avg Interval</div>
                    <div class="metric-description">
                        Mean interval of all review cards
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{getDueToday()}</div>
                    <div class="metric-label">Due Today</div>
                    <div class="metric-description">
                        Number of cards due today
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{getDueTomorrow()}</div>
                    <div class="metric-label">Due Tomorrow</div>
                    <div class="metric-description">
                        Number of cards due tomorrow
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" style="display: none;">0</div>
                    <div class="metric-label" style="display: none;">
                        Learning Cards
                    </div>
                    <div class="metric-description" style="display: none;">
                        Number of cards in the learning queue
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{getMaturityRatio()}%</div>
                    <div class="metric-label">Maturity Ratio</div>
                    <div class="metric-description">
                        Mature cards ÷ total cards
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">
                        {(statistics?.cardStats?.new || 0) +
                            (statistics?.cardStats?.mature || 0)}
                    </div>
                    <div class="metric-label">Total Cards</div>
                    <div class="metric-description">
                        All cards in collection
                    </div>
                </div>
            </div>

            <h4>Card Status Breakdown</h4>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">
                        {statistics?.cardStats?.new || 0}
                    </div>
                    <div class="stat-label">New Cards</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" style="display: none;">0</div>
                    <div class="stat-label" style="display: none;">
                        Learning
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">
                        {statistics?.cardStats?.mature || 0}
                    </div>
                    <div class="stat-label">Mature</div>
                </div>
            </div>
        </div>

        <!-- Answer Button Usage -->
        <div class="stats-section">
            <h3>Answer Button Usage</h3>
            {#if statistics?.answerButtons && (statistics.answerButtons.again > 0 || statistics.answerButtons.hard > 0 || statistics.answerButtons.good > 0 || statistics.answerButtons.easy > 0)}
                <div class="button-stats">
                    <div class="button-bar again">
                        <div class="button-label">Again</div>
                        <div class="button-count">
                            {statistics.answerButtons.again}
                        </div>
                        <div class="button-percentage">
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
                    <div class="button-bar hard">
                        <div class="button-label">Hard</div>
                        <div class="button-count">
                            {statistics.answerButtons.hard}
                        </div>
                        <div class="button-percentage">
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
                    <div class="button-bar good">
                        <div class="button-label">Good</div>
                        <div class="button-count">
                            {statistics.answerButtons.good}
                        </div>
                        <div class="button-percentage">
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
                    <div class="button-bar easy">
                        <div class="button-label">Easy</div>
                        <div class="button-count">
                            {statistics.answerButtons.easy}
                        </div>
                        <div class="button-percentage">
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
                <div class="no-data-message">
                    <p>No answer button data available yet.</p>
                    <p class="help-text">
                        Complete some reviews to see answer button statistics.
                    </p>
                </div>
            {/if}
        </div>

        <!-- Forecast -->
        <div class="stats-section">
            <h3>Review Load Forecast</h3>
            {#if statistics?.forecast && statistics.forecast.length > 0 && statistics.forecast.some((day) => day.dueCount > 0)}
                {@const filteredForecast = statistics.forecast
                    .filter((day) => day.dueCount > 0)
                    .slice(0, 20)}
                {@const maxDueCount = Math.max(
                    ...filteredForecast.map((day) => day.dueCount),
                )}
                <div class="forecast-chart">
                    {#each filteredForecast as day, index}
                        {@const originalIndex =
                            statistics.forecast.indexOf(day)}
                        <div
                            class="forecast-bar"
                            title="{originalIndex === 0
                                ? 'Today'
                                : originalIndex === 1
                                  ? 'Tomorrow'
                                  : `Day ${originalIndex} (in ${originalIndex} days)`}: {day.dueCount} card{day.dueCount !==
                            1
                                ? 's'
                                : ''} due"
                        >
                            <div
                                class="bar"
                                style="height: {calculateBarHeight(
                                    day.dueCount,
                                    maxDueCount,
                                )}px"
                            ></div>
                            <div class="bar-label">
                                {originalIndex}
                            </div>
                            <div class="bar-value">{day.dueCount}</div>
                        </div>
                    {/each}
                </div>
                <p class="forecast-note">
                    Showing days with scheduled reviews based on FSRS intervals.
                </p>
            {:else}
                <div class="no-data-message">
                    <p>No upcoming reviews scheduled.</p>
                    <p class="help-text">
                        Add flashcards to your decks to see future review
                        forecasts.
                    </p>
                </div>
            {/if}
        </div>

        <!-- Review Heatmap -->
        <div class="stats-section">
            <h3>Review Heatmap</h3>
            <p>Daily review activity over time</p>
            <ReviewHeatmap
                bind:this={heatmapComponent}
                getReviewCounts={async (days) => {
                    return await plugin.getReviewCounts(days);
                }}
            />
        </div>

        <div class="modal-actions">
            <button
                class="close-button"
                on:click={(e) => handleTouchClick(() => dispatch("close"), e)}
                on:touchend={(e) =>
                    handleTouchClick(() => dispatch("close"), e)}
            >
                Close
            </button>
        </div>
    {/if}
    <div class="stats-section buymeacoffee-badge">
        <a href="https://www.buymeacoffee.com/dscherdil0">
            <img
                src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
                alt="Buy Me A Coffee"
                height="40"
            />
        </a>
    </div>
</div>
{#if false}
    <div class="deck-filter-container timeframe-filter-container"></div>
{/if}

<style>
    .statistics-container {
        padding: 20px;
        font-family: var(--font-interface);
        width: 100%;
        overflow-x: hidden;
    }

    .loading,
    .error {
        text-align: center;
        padding: 40px;
        color: var(--text-muted);
    }

    .filters {
        display: flex;
        gap: 24px;
        margin-bottom: 24px;
        padding: 20px;
        background: var(--background-secondary);
        border-radius: 10px;
        flex-wrap: wrap;
        justify-content: center;
    }

    .filters > div {
        min-width: 200px;
    }

    .stats-section {
        margin-bottom: 32px;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--background-modifier-border);
    }

    .stats-section:last-of-type {
        border-bottom: none;
    }

    .stats-section h3 {
        margin: 0 0 20px 0;
        color: var(--text-normal);
        font-size: 18px;
        font-weight: 600;
    }

    .stats-section h4 {
        margin: 24px 0 12px 0;
        color: var(--text-normal);
        font-size: 16px;
        font-weight: 500;
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 16px;
        margin-bottom: 20px;
    }

    .stat-card {
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

    .stat-value {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-normal);
        margin-bottom: 4px;
    }

    .stat-label {
        font-size: 12px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
    }

    .metric-card {
        background: var(--background-secondary);
        padding: 20px;
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
        min-height: 100px;
    }

    .metric-value {
        font-size: 28px;
        font-weight: 700;
        color: var(--text-accent);
        margin-bottom: 8px;
    }

    .metric-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-normal);
        margin-bottom: 4px;
    }

    .metric-description {
        font-size: 11px;
        color: var(--text-muted);
        line-height: 1.3;
    }

    .forecast-chart {
        display: flex;
        gap: 4px;
        align-items: flex-end;
        padding: 16px;
        background: var(--background-secondary);
        border-radius: 8px;
        height: 400px;
        overflow-x: auto;
        overflow-y: hidden;
        max-width: 100%;
        box-sizing: border-box;
    }

    .forecast-bar {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        min-width: 40px;
        flex-shrink: 0;
    }

    .bar {
        background: var(--text-accent);
        width: 24px;
        border-radius: 4px 4px 0 0;
        transition: background 0.2s;
    }

    .bar-label {
        font-size: 12px;
        color: var(--text-muted);
        font-weight: 500;
    }

    .bar-value {
        font-size: 12px;
        color: var(--text-normal);
        font-weight: 600;
    }

    .forecast-note {
        margin-top: 8px;
        font-size: 12px;
        color: var(--text-muted);
        text-align: center;
    }

    .button-stats {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .button-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-radius: 6px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
    }

    .button-bar.again {
        border-left: 4px solid #ef4444;
    }

    .button-bar.hard {
        border-left: 4px solid #f97316;
    }

    .button-bar.good {
        border-left: 4px solid #22c55e;
    }

    .button-bar.easy {
        border-left: 4px solid #3b82f6;
    }

    .button-label {
        font-weight: 500;
        color: var(--text-normal);
    }

    .button-count {
        font-weight: 600;
        color: var(--text-normal);
        font-size: 18px;
    }

    .button-percentage {
        font-size: 12px;
        color: var(--text-muted);
    }

    .intervals-chart {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 16px;
        background: var(--background-secondary);
        border-radius: 8px;
        max-width: 100%;
        overflow-x: hidden;
    }

    .interval-bar {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px 8px;
        background: var(--background-primary);
        border-radius: 6px;
        min-width: 60px;
        border: 1px solid var(--background-modifier-border);
    }

    .interval-label {
        font-size: 12px;
        color: var(--text-muted);
        margin-bottom: 4px;
    }

    .interval-value {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-normal);
    }

    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 24px;
        padding: 16px 20px;
        border-top: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        position: sticky;
        bottom: 0;
        margin-left: -20px;
        margin-right: -20px;
    }

    .close-button {
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

    .close-button:hover,
    .close-button:active {
        background: var(--interactive-accent-hover);
    }

    .forecast-bar {
        cursor: pointer;
        position: relative;
    }

    .forecast-bar:hover .bar {
        opacity: 0.8;
        transition: opacity 0.2s ease;
    }

    .no-data-message {
        text-align: center;
        padding: 24px;
        background: var(--background-secondary);
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
    }

    .no-data-message p {
        margin: 0 0 8px 0;
        color: var(--text-muted);
    }

    .help-text {
        font-size: 12px !important;
        color: var(--text-faint) !important;
        margin: 0 !important;
    }

    .retry-button {
        margin-top: 12px;
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

    .retry-button:hover,
    .retry-button:active {
        background: var(--interactive-accent-hover);
    }
    .buymeacoffee-badge {
        width: 100%;
        height: 40px;
        display: flex;
        justify-content: center;
    }

    /* Mobile responsive styles */
    @media (max-width: 768px) {
        .statistics-container {
            padding: 12px;
        }

        .filters {
            gap: 16px;
            padding: 16px;
            flex-direction: column;
        }

        .filters > div {
            min-width: unset;
            width: 100%;
        }

        .stats-grid {
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 12px;
        }

        .stat-card {
            padding: 12px;
            min-height: 70px;
        }

        .stat-value {
            font-size: 20px;
        }

        .metrics-grid {
            grid-template-columns: 1fr;
            gap: 12px;
        }

        .metric-card {
            padding: 16px;
            min-height: 80px;
        }

        .metric-value {
            font-size: 24px;
        }

        .forecast-chart {
            height: 300px;
            padding: 12px;
        }

        .forecast-bar {
            min-width: 32px;
        }

        .bar {
            width: 20px;
        }

        .bar-label,
        .bar-value {
            font-size: 11px;
        }

        .button-bar {
            padding: 10px 12px;
            flex-direction: column;
            gap: 8px;
            text-align: center;
        }

        .button-count {
            font-size: 16px;
        }

        .modal-actions {
            padding: 12px 16px;
            margin-left: -12px;
            margin-right: -12px;
        }

        .close-button {
            padding: 12px 24px;
            font-size: 16px;
            min-height: 44px; /* Touch-friendly size */
        }

        .intervals-chart {
            padding: 12px;
            gap: 8px;
        }

        .interval-bar {
            min-width: 50px;
            padding: 8px 6px;
        }
    }

    @media (max-width: 480px) {
        .statistics-container {
            padding: 8px;
        }

        .filters {
            padding: 12px;
            gap: 12px;
        }

        .stats-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }

        .stat-card {
            padding: 10px;
            min-height: 60px;
        }

        .stat-value {
            font-size: 18px;
        }

        .stat-label {
            font-size: 11px;
        }

        .metric-card {
            padding: 12px;
        }

        .metric-value {
            font-size: 20px;
        }

        .forecast-chart {
            height: 250px;
            padding: 8px;
        }

        .forecast-bar {
            min-width: 28px;
            gap: 4px;
        }

        .bar {
            width: 16px;
        }

        .bar-label,
        .bar-value {
            font-size: 10px;
        }

        .modal-actions {
            padding: 8px 12px;
            margin-left: -8px;
            margin-right: -8px;
        }

        .buymeacoffee-badge {
            height: 35px;
        }
    }

    @media (max-width: 390px) {
        .timeframe-filter-container {
            flex-direction: column;
        }

        .deck-filter-container {
            flex-direction: column;
        }

        .statistics-container {
            padding: 6px;
            max-width: 390px;
        }

        .filters {
            padding: 8px;
            gap: 8px;
        }

        .filters > div {
            min-width: unset;
        }

        .stats-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 6px;
        }

        .stat-card {
            padding: 8px;
            min-height: 55px;
        }

        .stat-value {
            font-size: 16px;
        }

        .stat-label {
            font-size: 10px;
        }

        .metrics-grid {
            grid-template-columns: 1fr;
            gap: 8px;
        }

        .metric-card {
            padding: 10px;
            min-height: 70px;
        }

        .metric-value {
            font-size: 18px;
        }

        .metric-label {
            font-size: 12px;
        }

        .metric-description {
            font-size: 10px;
        }

        .forecast-chart {
            height: 220px;
            padding: 6px;
        }

        .forecast-bar {
            min-width: 24px;
            gap: 2px;
        }

        .bar {
            width: 14px;
        }

        .bar-label,
        .bar-value {
            font-size: 9px;
        }

        .button-stats {
            gap: 8px;
        }

        .button-bar {
            padding: 8px 10px;
        }

        .button-label {
            font-size: 11px;
        }

        .button-count {
            font-size: 14px;
        }

        .button-percentage {
            font-size: 10px;
        }

        .modal-actions {
            padding: 6px 8px;
            margin-left: -6px;
            margin-right: -6px;
        }

        .close-button {
            padding: 10px 20px;
            font-size: 14px;
        }

        .intervals-chart {
            padding: 8px;
            gap: 6px;
        }

        .interval-bar {
            min-width: 45px;
            padding: 6px 4px;
        }

        .interval-label {
            font-size: 10px;
        }

        .interval-value {
            font-size: 14px;
        }
    }
</style>
