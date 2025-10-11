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
        // Filter to cards that have stability values (reviewed cards)
        const cardsWithStability = flashcards.filter(
            (card) => card.stability > 0 && card.state === "review"
        );

        if (cardsWithStability.length === 0) {
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

        // Get stability values
        const stabilityValues = cardsWithStability.map(
            (card) => card.stability
        );
        const maxStability = Math.max(...stabilityValues);

        // Create histogram buckets for stability
        const buckets: { [key: string]: number } = {};
        const bucketRanges = [
            { label: "0-1d", min: 0, max: 1 },
            { label: "1-3d", min: 1, max: 3 },
            { label: "3-7d", min: 3, max: 7 },
            { label: "1-2w", min: 7, max: 14 },
            { label: "2-4w", min: 14, max: 28 },
            { label: "1-3m", min: 28, max: 90 },
            { label: "3-6m", min: 90, max: 180 },
            { label: "6m-1y", min: 180, max: 365 },
            { label: "1y+", min: 365, max: Infinity },
        ];

        // Initialize buckets
        bucketRanges.forEach((bucket) => {
            buckets[bucket.label] = 0;
        });

        // Count stability values in each bucket
        stabilityValues.forEach((stability) => {
            for (const bucket of bucketRanges) {
                if (stability >= bucket.min && stability < bucket.max) {
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

        return {
            labels,
            datasets: [
                {
                    label: "Number of Cards",
                    data,
                    backgroundColor: "#8b5cf6",
                    borderColor: "#7c3aed",
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
                            text: "Stability Range",
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
                        text: "Card Stability Distribution",
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

<h3>Card Stability Distribution</h3>
<p class="decks-chart-description">
    FSRS stability values show how well cards are retained in memory
</p>
<div class="decks-card-stability-chart">
    <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
    .decks-card-stability-chart {
        width: 100%;
        height: 300px;
        margin: 1rem 0;
    }

    .decks-card-stability-chart canvas {
        max-width: 100%;
        max-height: 300px;
    }
</style>
