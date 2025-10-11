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
    } from "chart.js";
    import "chartjs-adapter-date-fns";
    import type { ReviewLog } from "../database/types";
    import { Logger } from "@/utils/logging";
    import { StatisticsService } from "@/services/StatisticsService";

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

    let canvas: HTMLCanvasElement;
    let chart: Chart | null = null;

    let selectedTimeframe: string = "1m"; // "1m", "3m", "1y", "all"
    let reviewLogs: ReviewLog[] = [];

    onMount(() => {
        createChart();
    });

    onDestroy(() => {
        if (chart) {
            chart.destroy();
        }
    });

    $: if (chart && reviewLogs) {
        console.log(
            "[ReviewsOverTimeChart] Updating chart with reviewLogs:",
            reviewLogs.length
        );
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

        // Group by date and rating
        const dateGroups = new Map<
            string,
            { again: number; hard: number; good: number; easy: number }
        >();

        filteredLogs.forEach((log) => {
            const date = new Date(log.reviewedAt).toISOString().split("T")[0];
            if (!dateGroups.has(date)) {
                dateGroups.set(date, { again: 0, hard: 0, good: 0, easy: 0 });
            }

            const group = dateGroups.get(date)!;
            switch (log.rating) {
                case 1:
                    group.again++;
                    break;
                case 2:
                    group.hard++;
                    break;
                case 3:
                    group.good++;
                    break;
                case 4:
                    group.easy++;
                    break;
            }
        });

        // Sort dates and prepare data
        const sortedDates = Array.from(dateGroups.keys()).sort();

        return {
            labels: sortedDates,
            datasets: [
                {
                    label: "Again",
                    data: sortedDates.map(
                        (date) => dateGroups.get(date)!.again
                    ),
                    backgroundColor: "#ef4444",
                    borderColor: "#dc2626",
                    borderWidth: 1,
                },
                {
                    label: "Hard",
                    data: sortedDates.map((date) => dateGroups.get(date)!.hard),
                    backgroundColor: "#f97316",
                    borderColor: "#ea580c",
                    borderWidth: 1,
                },
                {
                    label: "Good",
                    data: sortedDates.map((date) => dateGroups.get(date)!.good),
                    backgroundColor: "#22c55e",
                    borderColor: "#16a34a",
                    borderWidth: 1,
                },
                {
                    label: "Easy",
                    data: sortedDates.map((date) => dateGroups.get(date)!.easy),
                    backgroundColor: "#3b82f6",
                    borderColor: "#2563eb",
                    borderWidth: 1,
                },
            ],
        };
    }

    function createChart() {
        if (!canvas) {
            console.log("[ReviewsOverTimeChart] Canvas not available");
            return;
        }

        const data = processChartData();
        console.log("[ReviewsOverTimeChart] Creating chart with data:", data);

        chart = new Chart(canvas, {
            type: "bar",
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        title: {
                            display: true,
                            text: "Date",
                        },
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: "Reviews",
                        },
                        ticks: {
                            precision: 0,
                        },
                    },
                },
                plugins: {
                    title: {
                        display: true,
                        text: "Reviews Over Time",
                    },
                    legend: {
                        display: true,
                        position: "top",
                    },
                    tooltip: {
                        mode: "index",
                        intersect: false,
                        callbacks: {
                            afterLabel: function (context) {
                                const datasetIndex = context.datasetIndex;
                                const dataIndex = context.dataIndex;
                                const data = context.chart.data;

                                let total = 0;
                                for (let i = 0; i < data.datasets.length; i++) {
                                    total +=
                                        (data.datasets[i].data[
                                            dataIndex
                                        ] as number) || 0;
                                }

                                const percentage =
                                    total > 0
                                        ? (
                                              ((context.raw as number) /
                                                  total) *
                                              100
                                          ).toFixed(1)
                                        : "0";
                                return `${percentage}%`;
                            },
                        },
                    },
                },
                interaction: {
                    mode: "index",
                    intersect: false,
                },
            },
        });
    }

    function updateChart() {
        if (!chart) {
            console.log(
                "[ReviewsOverTimeChart] Chart not available for update"
            );
            return;
        }

        const data = processChartData();
        console.log("[ReviewsOverTimeChart] Updating chart with data:", data);
        chart.data = data;
        chart.update();
    }

    async function handleFilterChange() {
        logger.debug("[StatisticsUI] Filter changed, reloading data...");
        try {
            updateChart();
        } catch (error) {
            logger.error("[StatisticsUI] Error during filter change:", error);
        }
    }
</script>

<h3>Reviews Over Time</h3>
<div class="decks-chart-controls">
    <label>
        Timeframe:
        <select bind:value={selectedTimeframe} on:change={handleFilterChange}>
            <option value="1m">1 Month</option>
            <option value="3m">3 Months</option>
            <option value="1y">1 Year</option>
            <option value="all">All Time</option>
        </select>
    </label>
</div>
<div class="decks-reviews-over-time-chart">
    <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
    .decks-reviews-over-time-chart {
        width: 100%;
        height: 300px;
        margin: 1rem 0;
    }

    .decks-reviews-over-time-chart canvas {
        max-width: 100%;
        max-height: 300px;
    }
</style>
