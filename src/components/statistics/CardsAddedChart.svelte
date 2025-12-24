<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import {
        Chart,
        CategoryScale,
        LinearScale,
        BarElement,
        BarController,
        Title,
        Tooltip,
        Legend,
        type TooltipItem,
    } from "chart.js";
    import type { ReviewLog } from "../../database/types";
    import { StatisticsService } from "@/services/StatisticsService";
    import { Logger } from "@/utils/logging";

    // Register Chart.js components
    Chart.register(
        CategoryScale,
        LinearScale,
        BarElement,
        BarController,
        Title,
        Tooltip,
        Legend
    );

    export let selectedDeckIds: string[] = [];
    export let statisticsService: StatisticsService;
    export let logger: Logger;

    export let reviewLogs: ReviewLog[] = [];
    export let timeframe = "1m"; // "1m", "3m", "1y", "all"

    let canvas: HTMLCanvasElement;
    let chart: Chart | null = null;

    onMount(() => {
        createChart();
    });

    onDestroy(() => {
        if (chart) {
            chart.destroy();
        }
    });

    $: if (chart && reviewLogs) {
        updateChart();
    }

    function getTimeframeData(): ReviewLog[] {
        if (timeframe === "all") {
            return reviewLogs;
        }

        const now = new Date();
        let cutoffDate: Date;

        switch (timeframe) {
            case "1m":
                cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case "3m":
                cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case "1y":
                cutoffDate = new Date(
                    now.getTime() - 365 * 24 * 60 * 60 * 1000
                );
                break;
            default:
                return reviewLogs;
        }

        return reviewLogs.filter(
            (log) => new Date(log.reviewedAt) >= cutoffDate
        );
    }

    function processChartData() {
        const filteredLogs = getTimeframeData();

        if (filteredLogs.length === 0) {
            return {
                labels: ["No Data"],
                datasets: [
                    {
                        label: "Cards Added",
                        data: [0],
                        backgroundColor: "#6b7280",
                        borderColor: "#4b5563",
                        borderWidth: 1,
                    },
                ],
            };
        }

        // Find first review for each card (when it was "added" to the system)
        const firstReviews = new Map<string, ReviewLog>();

        filteredLogs.forEach((log) => {
            if (
                !firstReviews.has(log.flashcardId) ||
                new Date(log.reviewedAt) <
                    new Date(firstReviews.get(log.flashcardId)!.reviewedAt)
            ) {
                firstReviews.set(log.flashcardId, log);
            }
        });

        // Group first reviews by date
        const dateGroups = new Map<string, number>();

        firstReviews.forEach((log) => {
            const dateKey = log.reviewedAt.split("T")[0];
            dateGroups.set(dateKey, (dateGroups.get(dateKey) || 0) + 1);
        });

        if (dateGroups.size === 0) {
            return {
                labels: ["No Data"],
                datasets: [
                    {
                        label: "Cards Added",
                        data: [0],
                        backgroundColor: "#6b7280",
                        borderColor: "#4b5563",
                        borderWidth: 1,
                    },
                ],
            };
        }

        // Sort dates and prepare chart data
        const sortedDates = Array.from(dateGroups.keys()).sort();
        const labels = sortedDates.map((date) => {
            const d = new Date(date);
            return d.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
            });
        });
        const data = sortedDates.map((date) => dateGroups.get(date) || 0);

        return {
            labels,
            datasets: [
                {
                    label: "Cards Added",
                    data,
                    backgroundColor: "#10b981",
                    borderColor: "#059669",
                    borderWidth: 1,
                },
            ],
        };
    }

    function createChart() {
        if (!canvas) return;

        const data = processChartData();

        chart = new Chart(canvas, {
            type: "bar",
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Date Added",
                        },
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: "Number of Cards",
                        },
                        ticks: {
                            precision: 0,
                        },
                    },
                },
                plugins: {
                    title: {
                        display: true,
                        text: "Cards Added Over Time",
                    },
                    legend: {
                        display: true,
                        position: "top",
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context: TooltipItem<"bar">) {
                                const value = context.parsed.y;
                                const plural = value === 1 ? "card" : "cards";
                                return `${context.dataset.label}: ${value} ${plural}`;
                            },
                            afterLabel: function (_context: TooltipItem<"bar">) {
                                return "Based on first review date";
                            },
                        },
                    },
                },
            },
        });
    }

    function updateChart() {
        if (!chart) return;

        const data = processChartData();
        chart.data = data;
        chart.update();
    }

    async function handleFilterChange() {
        logger.debug("[StatisticsUI] Filter changed, reloading data...");
        try {
            await updateChart();
        } catch (error) {
            logger.error("[StatisticsUI] Error during filter change:", error);
        }
    }
</script>

<h3>Cards Added Over Time</h3>
<div class="decks-chart-controls">
    <label>
        Timeframe:
        <select bind:value={timeframe} on:change={handleFilterChange}>
            <option value="1m">1 Month</option>
            <option value="3m">3 Months</option>
            <option value="1y">1 Year</option>
            <option value="all">All Time</option>
        </select>
    </label>
</div>
<div class="decks-cards-added-chart">
    <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
    .decks-cards-added-chart {
        width: 100%;
        height: 300px;
        margin: 1rem 0;
    }

    .decks-cards-added-chart canvas {
        max-width: 100%;
        max-height: 300px;
    }
</style>
