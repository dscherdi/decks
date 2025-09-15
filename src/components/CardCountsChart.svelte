<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import {
        Chart,
        ArcElement,
        DoughnutController,
        PieController,
        Tooltip,
        Legend,
        type ChartConfiguration,
    } from "chart.js";
    import type { Flashcard } from "../database/types";
    import { getCardMaturityType } from "../database/types";

    // Register Chart.js components with force re-registration
    try {
        Chart.unregister(
            ArcElement,
            DoughnutController,
            PieController,
            Tooltip,
            Legend,
        );
    } catch (e) {
        console.log("[CardCountsChart] First registration, skip unregister");
    }

    Chart.register(
        ArcElement,
        DoughnutController,
        PieController,
        Tooltip,
        Legend,
    );

    export let flashcards: Flashcard[] = [];
    export let showSuspended: boolean = true;

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
        const counts = {
            new: 0,
            young: 0, // Review cards with interval <= 21 days
            mature: 0, // Review cards with interval > 21 days
            suspended: 0, // Could be added later if suspension feature is implemented
        };

        flashcards.forEach((card) => {
            const maturityType = getCardMaturityType(card);
            switch (maturityType) {
                case "new":
                    counts.new++;
                    break;
                case "review":
                    counts.young++;
                    break;
                case "mature":
                    counts.mature++;
                    break;
            }
        });

        const data = [];
        const labels = [];
        const backgroundColor = [];
        const borderColor = [];

        if (counts.new > 0) {
            data.push(counts.new);
            labels.push("New");
            backgroundColor.push("#3b82f6");
            borderColor.push("#2563eb");
        }

        if (counts.young > 0) {
            data.push(counts.young);
            labels.push("Young");
            backgroundColor.push("#f59e0b");
            borderColor.push("#d97706");
        }

        if (counts.mature > 0) {
            data.push(counts.mature);
            labels.push("Mature");
            backgroundColor.push("#22c55e");
            borderColor.push("#16a34a");
        }

        if (showSuspended && counts.suspended > 0) {
            data.push(counts.suspended);
            labels.push("Suspended");
            backgroundColor.push("#6b7280");
            borderColor.push("#4b5563");
        }

        return {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor,
                    borderColor,
                    borderWidth: 1,
                },
            ],
        };
    }

    function createChart() {
        if (!canvas) {
            return;
        }

        const data = processChartData();

        if (data.datasets[0].data.length === 0) {
            return;
        }

        try {
            chart = new Chart(canvas, {
                type: "pie",
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: "Card Distribution by State",
                        },
                        legend: {
                            display: true,
                            position: "bottom",
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const label = context.label || "";
                                    const value = context.raw as number;
                                    const total = context.dataset.data.reduce(
                                        (sum: number, val) =>
                                            sum + (val as number),
                                        0,
                                    );
                                    const percentage = (
                                        (value / total) *
                                        100
                                    ).toFixed(1);
                                    return `${label}: ${value} cards (${percentage}%)`;
                                },
                            },
                        },
                    },
                },
            });
        } catch (error) {
            console.error("[CardCountsChart] Error creating chart:", error);

            // Try fallback to doughnut chart
            try {
                chart = new Chart(canvas, {
                    type: "doughnut",
                    data: data,
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            title: {
                                display: true,
                                text: "Card Distribution by State (Doughnut)",
                            },
                            legend: {
                                display: true,
                                position: "bottom",
                            },
                        },
                    },
                });
            } catch (fallbackError) {
                console.error(
                    "[CardCountsChart] Doughnut fallback also failed:",
                    fallbackError,
                );
            }
        }
    }

    function updateChart() {
        if (!chart) {
            return;
        }

        const data = processChartData();
        chart.data = data;
        chart.update();
    }
</script>

<div class="decks-card-counts-chart">
    <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
    .decks-card-counts-chart {
        width: 100%;
        height: 300px;
        margin: 1rem 0;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .decks-card-counts-chart canvas {
        max-width: 100%;
        max-height: 300px;
    }
</style>
