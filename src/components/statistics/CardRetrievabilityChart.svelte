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
    export const showPercentiles = "50"; // "50", "95", "all"

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

    function processChartData() {
        // Filter to reviews that have retrievability values
        const reviewsWithRetrievability = reviewLogs.filter(
            (log) =>
                log.retrievability !== undefined &&
                log.retrievability !== null &&
                log.retrievability >= 0
        );

        if (reviewsWithRetrievability.length === 0) {
            return {
                labels: ["No Data"],
                datasets: [
                    {
                        label: "Reviews",
                        data: [0],
                        backgroundColor: "#6b7280",
                        borderColor: "#4b5563",
                        borderWidth: 1,
                    },
                ],
            };
        }

        // Get retrievability values (0-1 range, convert to 0-100%)
        const retrievabilityValues = reviewsWithRetrievability.map(
            (log) => log.retrievability * 100
        );

        // Create histogram buckets for retrievability percentage
        const buckets: { [key: string]: number } = {};
        const bucketRanges = [
            { label: "0-10%", min: 0, max: 10 },
            { label: "10-20%", min: 10, max: 20 },
            { label: "20-30%", min: 20, max: 30 },
            { label: "30-40%", min: 30, max: 40 },
            { label: "40-50%", min: 40, max: 50 },
            { label: "50-60%", min: 50, max: 60 },
            { label: "60-70%", min: 60, max: 70 },
            { label: "70-80%", min: 70, max: 80 },
            { label: "80-90%", min: 80, max: 90 },
            { label: "90-100%", min: 90, max: 100 },
        ];

        // Initialize buckets
        bucketRanges.forEach((bucket) => {
            buckets[bucket.label] = 0;
        });

        // Count retrievability values in each bucket
        retrievabilityValues.forEach((retrievability) => {
            for (const bucket of bucketRanges) {
                if (
                    retrievability >= bucket.min &&
                    retrievability < bucket.max
                ) {
                    buckets[bucket.label]++;
                    break;
                } else if (
                    retrievability === 100 &&
                    bucket.label === "90-100%"
                ) {
                    // Include 100% in the last bucket
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

        // Create gradient colors from red (low retrievability) to green (high retrievability)
        const colors = labels.map((_, index) => {
            const ratio = index / Math.max(labels.length - 1, 1);
            const r = Math.round(239 - (239 - 34) * ratio); // 239 (red) to 34 (green)
            const g = Math.round(197 * ratio); // 0 (red) to 197 (green)
            const b = 94; // Keep blue constant
            return `rgb(${r}, ${g}, ${b})`;
        });

        return {
            labels,
            datasets: [
                {
                    label: "Number of Reviews",
                    data,
                    backgroundColor: colors,
                    borderColor: colors.map((color) =>
                        color.replace("rgb", "rgba").replace(")", ", 0.8)")
                    ),
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
                            text: "Retrievability Range",
                        },
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: "Number of Reviews",
                        },
                        ticks: {
                            precision: 0,
                        },
                    },
                },
                plugins: {
                    title: {
                        display: true,
                        text: "Card Retrievability Distribution",
                    },
                    legend: {
                        display: true,
                        position: "top",
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context: TooltipItem<"bar">) {
                                const value = context.parsed.y;
                                const dataset = context.dataset;
                                const total = (dataset.data as number[]).reduce(
                                    (sum: number, val: number) =>
                                        sum + val,
                                    0
                                );
                                const percentage =
                                    total > 0
                                        ? ((value / total) * 100).toFixed(1)
                                        : "0";
                                return `${dataset.label}: ${value} reviews (${percentage}%)`;
                            },
                            afterLabel: function (_context: TooltipItem<"bar">) {
                                return "Higher retrievability = easier to recall";
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

<h3>Card Retrievability Distribution</h3>
<p class="decks-chart-description">
    FSRS retrievability values show likelihood of recall today (0-100%)
</p>
<div class="decks-card-retrievability-chart">
    <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
    .decks-card-retrievability-chart {
        width: 100%;
        height: 300px;
        margin: 1rem 0;
    }

    .decks-card-retrievability-chart canvas {
        max-width: 100%;
        max-height: 300px;
    }
</style>
