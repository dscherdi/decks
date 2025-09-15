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
    } from "chart.js";
    import type { ReviewLog } from "../database/types";

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
    );

    export let reviewLogs: ReviewLog[] = [];
    export let timeframe: string = "1m"; // "1m", "3m", "1y", "all"

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
                    now.getTime() - 365 * 24 * 60 * 60 * 1000,
                );
                break;
            default:
                return reviewLogs;
        }

        return reviewLogs.filter(
            (log) => new Date(log.reviewedAt) >= cutoffDate,
        );
    }

    function processChartData() {
        const filteredLogs = getTimeframeData();

        if (filteredLogs.length === 0) {
            return {
                labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
                datasets: [
                    {
                        type: "bar" as const,
                        label: "Review Count",
                        data: new Array(24).fill(0),
                        backgroundColor: "rgba(59, 130, 246, 0.7)",
                        borderColor: "rgb(59, 130, 246)",
                        borderWidth: 1,
                        yAxisID: "y",
                    },
                    {
                        type: "line" as const,
                        label: "Success Rate (%)",
                        data: new Array(24).fill(0),
                        backgroundColor: "rgba(34, 197, 94, 0.7)",
                        borderColor: "rgb(34, 197, 94)",
                        borderWidth: 2,
                        fill: false,
                        yAxisID: "y1",
                    },
                ],
            };
        }

        // Group reviews by hour of day
        const hourlyData: {
            [hour: number]: { total: number; successful: number };
        } = {};

        // Initialize all hours
        for (let hour = 0; hour < 24; hour++) {
            hourlyData[hour] = { total: 0, successful: 0 };
        }

        // Count reviews and success rates by hour
        filteredLogs.forEach((log) => {
            const reviewDate = new Date(log.reviewedAt);
            const hour = reviewDate.getHours();

            hourlyData[hour].total++;

            // Rating 3 (Good) and 4 (Easy) are considered successful
            if (log.rating >= 3) {
                hourlyData[hour].successful++;
            }
        });

        // Prepare chart data
        const labels = Array.from(
            { length: 24 },
            (_, i) => `${i.toString().padStart(2, "0")}:00`,
        );
        const reviewCounts = Array.from(
            { length: 24 },
            (_, i) => hourlyData[i].total,
        );
        const successRates = Array.from({ length: 24 }, (_, i) => {
            const total = hourlyData[i].total;
            return total > 0
                ? Math.round((hourlyData[i].successful / total) * 100)
                : 0;
        });

        return {
            labels,
            datasets: [
                {
                    type: "bar" as const,
                    label: "Review Count",
                    data: reviewCounts,
                    backgroundColor: "rgba(59, 130, 246, 0.7)",
                    borderColor: "rgb(59, 130, 246)",
                    borderWidth: 1,
                    yAxisID: "y",
                },
                {
                    type: "line" as const,
                    label: "Success Rate (%)",
                    data: successRates,
                    backgroundColor: "rgba(34, 197, 94, 0.7)",
                    borderColor: "rgb(34, 197, 94)",
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    yAxisID: "y1",
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
                interaction: {
                    mode: "index",
                    intersect: false,
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Hour of Day",
                        },
                    },
                    y: {
                        type: "linear",
                        display: true,
                        position: "left",
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: "Number of Reviews",
                        },
                        ticks: {
                            precision: 0,
                        },
                    },
                    y1: {
                        type: "linear",
                        display: true,
                        position: "right",
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: "Success Rate (%)",
                        },
                        grid: {
                            drawOnChartArea: false,
                        },
                        ticks: {
                            callback: function (value: any) {
                                return value + "%";
                            },
                        },
                    },
                },
                plugins: {
                    title: {
                        display: true,
                        text: "Review Activity by Hour of Day",
                    },
                    legend: {
                        display: true,
                        position: "top",
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context: any) {
                                const datasetLabel =
                                    context.dataset.label || "";
                                const value = context.raw as number;

                                if (datasetLabel.includes("Success Rate")) {
                                    return `${datasetLabel}: ${value}%`;
                                } else {
                                    return `${datasetLabel}: ${value} reviews`;
                                }
                            },
                            afterBody: function (tooltipItems: any) {
                                const hour = parseInt(
                                    tooltipItems[0].label.split(":")[0],
                                );
                                let timeDescription = "";

                                if (hour >= 6 && hour < 12) {
                                    timeDescription = "Morning";
                                } else if (hour >= 12 && hour < 18) {
                                    timeDescription = "Afternoon";
                                } else if (hour >= 18 && hour < 22) {
                                    timeDescription = "Evening";
                                } else {
                                    timeDescription = "Night";
                                }

                                return `Time period: ${timeDescription}`;
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
</script>

<div class="decks-hourly-breakdown-chart">
    <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
    .decks-hourly-breakdown-chart {
        width: 100%;
        height: 300px;
        margin: 1rem 0;
    }

    .decks-hourly-breakdown-chart canvas {
        max-width: 100%;
        max-height: 300px;
    }
</style>
