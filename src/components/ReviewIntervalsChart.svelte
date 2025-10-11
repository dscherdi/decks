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
    import type { Flashcard } from "../database/types";
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

    export let flashcards: Flashcard[] = [];
    export const showPercentiles: string = "50"; // "50", "95", "all"

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

    $: if (chart && flashcards) {
        updateChart();
    }

    function processChartData() {
        // Filter to only review cards (new cards don't have meaningful intervals)
        const reviewCards = flashcards.filter(
            (card) => card.state === "review" && card.interval > 0
        );

        if (reviewCards.length === 0) {
            return {
                labels: ["No Data"],
                datasets: [
                    {
                        label: "Cards",
                        data: [0],
                        backgroundColor: "#6b7280",
                        borderColor: "#4b5563",
                        borderWidth: 1,
                    },
                ],
            };
        }

        // Convert intervals from minutes to days for better readability
        const intervalDays = reviewCards.map((card) =>
            Math.round(card.interval / (24 * 60))
        );

        // Create histogram buckets
        const maxInterval = Math.max(...intervalDays);
        const buckets: { [key: string]: number } = {};

        // Define bucket ranges (in days)
        const bucketRanges = [
            { label: "1d", min: 1, max: 1 },
            { label: "2-3d", min: 2, max: 3 },
            { label: "4-7d", min: 4, max: 7 },
            { label: "1-2w", min: 8, max: 14 },
            { label: "2-3w", min: 15, max: 21 },
            { label: "1-2m", min: 22, max: 60 },
            { label: "2-4m", min: 61, max: 120 },
            { label: "4-6m", min: 121, max: 180 },
            { label: "6m-1y", min: 181, max: 365 },
            { label: "1y+", min: 366, max: Infinity },
        ];

        // Initialize buckets
        bucketRanges.forEach((bucket) => {
            buckets[bucket.label] = 0;
        });

        // Count intervals in each bucket
        intervalDays.forEach((days) => {
            for (const bucket of bucketRanges) {
                if (days >= bucket.min && days <= bucket.max) {
                    buckets[bucket.label]++;
                    break;
                }
            }
        });

        // Filter out empty buckets
        const labels = bucketRanges
            .map((b) => b.label)
            .filter((label) => buckets[label] > 0);
        const data = labels.map((label) => buckets[label]);

        // Calculate percentiles if requested
        const sortedIntervals = intervalDays.sort((a, b) => a - b);
        let annotations: any[] = [];

        if (showPercentiles !== "all") {
            const percentile = parseInt(showPercentiles);
            const percentileIndex = Math.floor(
                (percentile / 100) * sortedIntervals.length
            );
            const percentileValue = sortedIntervals[percentileIndex];

            if (percentileValue !== undefined) {
                annotations.push({
                    type: "line",
                    mode: "vertical",
                    scaleID: "x",
                    value: percentileValue,
                    borderColor: "#ef4444",
                    borderWidth: 2,
                    label: {
                        content: `${percentile}th percentile: ${percentileValue}d`,
                        enabled: true,
                        position: "top",
                    },
                });
            }
        }

        return {
            labels,
            datasets: [
                {
                    label: "Number of Cards",
                    data,
                    backgroundColor: "#3b82f6",
                    borderColor: "#2563eb",
                    borderWidth: 1,
                },
            ],
            annotations,
        };
    }

    function createChart() {
        if (!canvas) return;

        const data = processChartData();

        chart = new Chart(canvas, {
            type: "bar",
            data: {
                labels: data.labels,
                datasets: data.datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Interval Range",
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
                        text: "Review Interval Distribution",
                    },
                    legend: {
                        display: true,
                        position: "top",
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context: any) {
                                const value = context.raw as number;
                                const dataset = context.dataset;
                                const total = dataset.data.reduce(
                                    (sum: number, val: any) =>
                                        sum + (val as number),
                                    0
                                );
                                const percentage =
                                    total > 0
                                        ? ((value / total) * 100).toFixed(1)
                                        : "0";
                                return `${dataset.label}: ${value} cards (${percentage}%)`;
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
        chart.data.labels = data.labels;
        chart.data.datasets = data.datasets;
        chart.update();
    }
</script>

<h3>Review Intervals</h3>
<div class="decks-chart-controls">
    <label>
        Show percentiles:
        <select>
            <option value="50">50th percentile</option>
            <option value="95">95th percentile</option>
            <option value="all">All data</option>
        </select>
    </label>
</div>
<div class="decks-review-intervals-chart">
    <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
    .decks-review-intervals-chart {
        width: 100%;
        height: 300px;
        margin: 1rem 0;
    }

    .decks-review-intervals-chart canvas {
        max-width: 100%;
        max-height: 300px;
    }
</style>
