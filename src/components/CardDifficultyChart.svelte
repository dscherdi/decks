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
        // Filter to cards that have difficulty values (reviewed cards)
        const cardsWithDifficulty = flashcards.filter(
            (card) => card.difficulty > 0 && card.state === "review"
        );

        if (cardsWithDifficulty.length === 0) {
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

        // Get difficulty values and convert to percentage (0-100%)
        const difficultyValues = cardsWithDifficulty.map((card) => {
            // FSRS difficulty is 1-10, convert to 0-100%
            return ((card.difficulty - 1) / 9) * 100;
        });

        // Create histogram buckets for difficulty percentage
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

        // Count difficulty values in each bucket
        difficultyValues.forEach((difficulty) => {
            for (const bucket of bucketRanges) {
                if (difficulty >= bucket.min && difficulty < bucket.max) {
                    buckets[bucket.label]++;
                    break;
                } else if (difficulty === 100 && bucket.label === "90-100%") {
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

        // Create gradient colors from green (easy) to red (difficult)
        const colors = labels.map((_, index) => {
            const ratio = index / Math.max(labels.length - 1, 1);
            const r = Math.round(34 + (239 - 34) * ratio); // 34 (green) to 239 (red)
            const g = Math.round(197 - 197 * ratio); // 197 (green) to 0 (red)
            const b = 94; // Keep blue constant
            return `rgb(${r}, ${g}, ${b})`;
        });

        return {
            labels,
            datasets: [
                {
                    label: "Number of Cards",
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
                            text: "Difficulty Range",
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
                        text: "Card Difficulty Distribution",
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
                            afterLabel: function (context: any) {
                                return "Higher difficulty = harder to remember";
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

<h3>Card Difficulty Distribution</h3>
<p class="decks-chart-description">
    FSRS difficulty values indicate how hard cards are to remember
</p>
<div class="decks-card-difficulty-chart">
    <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
    .decks-card-difficulty-chart {
        width: 100%;
        height: 300px;
        margin: 1rem 0;
    }

    .decks-card-difficulty-chart canvas {
        max-width: 100%;
        max-height: 300px;
    }
</style>
