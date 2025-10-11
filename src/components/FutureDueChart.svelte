<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import {
        Chart,
        CategoryScale,
        LinearScale,
        BarElement,
        BarController,
        LineElement,
        LineController,
        PointElement,
        Title,
        Tooltip,
        Legend,
        Filler,
    } from "chart.js";
    import type { Statistics, Flashcard } from "../database/types";
    import {
        FutureDueData,
        StatisticsService,
        type BacklogForecastData,
    } from "../services/StatisticsService";
    import { Logger } from "@/utils/logging";

    // Register Chart.js components
    Chart.register(
        CategoryScale,
        LinearScale,
        BarElement,
        BarController,
        LineElement,
        LineController,
        PointElement,
        Title,
        Tooltip,
        Legend,
        Filler
    );

    export let statistics: Statistics | null = null;
    export let allFlashcards: Flashcard[] = [];
    export let statisticsService: StatisticsService;
    export let logger: Logger;

    let canvas: HTMLCanvasElement;
    let chart: Chart | null = null;
    let showBacklog: boolean = true;
    let timeframe: string = "3m"; // "1m", "3m", "1y", "all"

    onMount(async () => {
        await createChart();
    });

    onDestroy(() => {
        if (chart) {
            chart.destroy();
        }
    });

    $: if (chart && (statistics || showBacklog !== undefined || timeframe)) {
        updateChart();
    }

    function getTimeframeDays(): number {
        switch (timeframe) {
            case "1m":
                return 30;
            case "3m":
                return 90;
            case "1y":
                return 365;
            case "all":
                return 730; // 2 years for "all"
            default:
                return 90;
        }
    }

    /**
     * Process chart data for display using StatisticsService for calculations
     */
    async function processChartData() {
        const maxDays = getTimeframeDays();

        // Get filtered forecast data from service
        const displayData = statisticsService.getFilteredForecastData(
            statistics,
            maxDays,
            true // onlyNonZero = true to filter out zero days
        );

        if (displayData.length === 0) {
            return {
                labels: [],
                datasets: [],
            };
        }

        // Create chart labels
        const labels = displayData.map((_, index) => {
            if (index === 0) return "Today";
            if (index === 1) return "Tomorrow";
            return index.toString();
        });

        const barData = displayData.map((day) => day.dueCount);

        // Calculate backlog forecast data if needed
        let backlogData: BacklogForecastData[] = [];
        if (showBacklog && allFlashcards.length > 0) {
            // Get the deck ID from the first flashcard
            const deckId = allFlashcards[0]?.deckId;
            if (deckId) {
                backlogData = await statisticsService.simulateFutureDueLoad(
                    [deckId], // TODO: should not use deckid for simulation
                    maxDays
                );
            }
        }

        const cumulativeData = backlogData
            .slice(0, displayData.length)
            .map((day) => day.projectedBacklog);

        // Create chart datasets
        const datasets = [
            {
                type: "bar" as const,
                label: "Due Cards",
                data: barData,
                backgroundColor: "#22c55e",
                borderColor: "#22c55e",
                borderWidth: 0,
                yAxisID: "y",
                barPercentage: 0.9,
                categoryPercentage: 0.9,
            },
        ];

        // Add backlog curve if enabled
        if (showBacklog && backlogData.length > 0) {
            datasets.push({
                type: "line" as const,
                label: "Cumulative",
                data: cumulativeData,
                backgroundColor: "rgba(156, 163, 175, 0.3)",
                borderColor: "rgba(156, 163, 175, 0.7)",
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointBackgroundColor: "rgba(156, 163, 175, 0.7)",
                pointBorderColor: "#ffffff",
                pointBorderWidth: 2,
                yAxisID: "y1",
            } as any);
        }

        return {
            labels,
            datasets,
        };
    }

    async function createChart() {
        if (!canvas) return;

        // const data = await processChartData();
        const data = { labels: [], datasets: [] };
        try {
            // TODO: Bug causes obsidian to hang
            // chart = new Chart(canvas, {
            //     type: "line",
            //     data: data,
            //     options: {
            //         responsive: true,
            //         maintainAspectRatio: false,
            //         interaction: {
            //             mode: "index",
            //             intersect: false,
            //         },
            //         scales: {
            //             x: {
            //                 display: true,
            //                 grid: {
            //                     display: false,
            //                 },
            //                 ticks: {
            //                     color: "#9ca3af",
            //                     font: {
            //                         size: 12,
            //                     },
            //                     maxTicksLimit: 20,
            //                 },
            //             },
            //             y: {
            //                 type: "linear",
            //                 display: true,
            //                 position: "left",
            //                 beginAtZero: true,
            //                 grid: {
            //                     color: "rgba(156, 163, 175, 0.2)",
            //                 },
            //                 ticks: {
            //                     color: "#9ca3af",
            //                     font: {
            //                         size: 12,
            //                     },
            //                     precision: 0,
            //                 },
            //             },
            //             y1: {
            //                 type: "linear",
            //                 display: showBacklog,
            //                 position: "right",
            //                 beginAtZero: true,
            //                 grid: {
            //                     drawOnChartArea: false,
            //                 },
            //                 ticks: {
            //                     color: "#9ca3af",
            //                     font: {
            //                         size: 12,
            //                     },
            //                     precision: 0,
            //                 },
            //             },
            //         },
            //         plugins: {
            //             title: {
            //                 display: false,
            //             },
            //             legend: {
            //                 display: false,
            //             },
            //             tooltip: {
            //                 backgroundColor: "rgba(0, 0, 0, 0.8)",
            //                 titleColor: "#ffffff",
            //                 bodyColor: "#ffffff",
            //                 borderColor: "rgba(156, 163, 175, 0.3)",
            //                 borderWidth: 1,
            //                 cornerRadius: 8,
            //                 displayColors: false,
            //                 callbacks: {
            //                     title: function (tooltipItems) {
            //                         const label = tooltipItems[0].label;
            //                         if (label === "Today") return "Today";
            //                         if (label === "Tomorrow") return "Tomorrow";
            //                         return `Day ${label}`;
            //                     },
            //                     label: function (context) {
            //                         const value = context.raw as number;
            //                         const datasetLabel =
            //                             context.dataset.label || "";
            //                         if (datasetLabel.includes("Cumulative")) {
            //                             return `Total: ${value} reviews`;
            //                         } else {
            //                             return `Due: ${value} reviews`;
            //                         }
            //                     },
            //                 },
            //             },
            //         },
            //     },
            // });
        } catch (error) {
            console.error("[FutureDueChart] Error creating chart:", error);
        }
    }

    async function updateChart() {
        if (!chart) return;

        const data = await processChartData();
        chart.data = data;

        // Update scale visibility
        if (chart.options.scales?.y1) {
            chart.options.scales.y1.display = showBacklog;
        }

        chart.update();
    }

    function getForecastStats() {
        const maxDays = getTimeframeDays();
        return statisticsService.calculateForecastStats(
            statistics,
            allFlashcards,
            maxDays
        );
    }

    // Reactive updates when data changes
    $: if (statistics || allFlashcards || showBacklog || timeframe) {
        if (chart) {
            updateChart();
        }
    }
</script>

<div class="future-due-chart-container">
    <h3>Future Due</h3>
    <p class="chart-subtitle">The number of reviews due in the future.</p>

    <div class="chart-controls">
        <label class="backlog-control">
            <input type="checkbox" bind:checked={showBacklog} />
            Backlog
        </label>

        <div class="timeframe-controls">
            <label>
                <input type="radio" bind:group={timeframe} value="1m" />
                1 month
            </label>
            <label>
                <input type="radio" bind:group={timeframe} value="3m" />
                3 months
            </label>
            <label>
                <input type="radio" bind:group={timeframe} value="1y" />
                1 year
            </label>
            <label>
                <input type="radio" bind:group={timeframe} value="all" />
                all
            </label>
        </div>
    </div>

    <div class="chart-wrapper">
        <canvas bind:this={canvas} height="300"></canvas>
    </div>

    <div class="chart-stats">
        <!-- <div class="stat">
            <span class="stat-label">Total Reviews:</span>
            <span class="stat-value">{getForecastStats().totalReviews}</span>
        </div>
        <div class="stat">
            <span class="stat-label">Avg/Day:</span>
            <span class="stat-value">{getForecastStats().averagePerDay}</span>
        </div>
        <div class="stat">
            <span class="stat-label">Due Tomorrow: </span>
            <span class="stat-value" style="color: #f97316;"
                >{getForecastStats().dueTomorrow}</span
            >
        </div>
        <div class="stat">
            <span class="stat-label">Daily Load:</span>
            <span class="stat-value">{getForecastStats().dailyLoad}</span>
        </div> -->
    </div>

    {#if !statistics?.forecast || statistics.forecast.length === 0 || !statistics.forecast.some((day) => day.dueCount > 0)}
        <div class="no-data">
            No upcoming reviews scheduled. Add flashcards to your decks to see
            forecast.
        </div>
    {/if}
</div>

<style>
    .future-due-chart-container {
        margin: 1rem 0;
        padding: 1rem;
        background: var(--background-primary);
        border-radius: 8px;
    }

    .future-due-chart-container h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-normal);
    }

    .chart-subtitle {
        margin: 0 0 1.5rem 0;
        font-size: 0.95rem;
        color: var(--text-muted);
        text-align: center;
    }

    .chart-controls {
        display: flex;
        align-items: center;
        gap: 2rem;
        margin-bottom: 1.5rem;
        justify-content: center;
        flex-wrap: wrap;
    }

    .backlog-control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        color: var(--text-normal);
    }

    .backlog-control input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: #3b82f6;
    }

    .timeframe-controls {
        display: flex;
        gap: 1.5rem;
        align-items: center;
    }

    .timeframe-controls label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        color: var(--text-normal);
        cursor: pointer;
    }

    .timeframe-controls input[type="radio"] {
        width: 16px;
        height: 16px;
        accent-color: #3b82f6;
    }

    .chart-wrapper {
        width: 100%;
        height: 300px;
        margin: 1.5rem 0;
        background: var(--background-secondary);
        border-radius: 8px;
        padding: 1rem;
    }

    .chart-wrapper canvas {
        max-width: 100%;
        max-height: 300px;
    }

    .chart-stats {
        display: flex;
        justify-content: center;
        gap: 2rem;
        margin-top: 1.5rem;
        flex-wrap: wrap;
    }

    .stat {
        text-align: center;
        font-size: 0.9rem;
    }

    .stat-label {
        color: var(--text-muted);
        display: block;
    }

    .stat-value {
        color: var(--text-normal);
        font-weight: 500;
        display: block;
        margin-top: 0.25rem;
    }

    .no-data {
        text-align: center;
        color: var(--text-muted);
        font-style: italic;
        margin-top: 2rem;
        padding: 2rem;
        background: var(--background-secondary);
        border-radius: 8px;
        border: 2px dashed var(--background-modifier-border);
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
        .chart-controls {
            gap: 1rem;
        }

        .timeframe-controls {
            gap: 1rem;
        }

        .chart-stats {
            gap: 1rem;
        }

        .stat {
            font-size: 0.8rem;
        }
    }

    @media (max-width: 480px) {
        .future-due-chart-container {
            padding: 0.75rem;
        }

        .future-due-chart-container h3 {
            font-size: 1.3rem;
        }

        .chart-wrapper {
            height: 250px;
            padding: 0.75rem;
        }

        .chart-controls {
            flex-direction: column;
            gap: 1rem;
            align-items: center;
        }

        .timeframe-controls {
            gap: 0.75rem;
        }

        .timeframe-controls label {
            font-size: 0.8rem;
        }

        .chart-stats {
            flex-direction: column;
            gap: 0.5rem;
        }
    }
</style>
