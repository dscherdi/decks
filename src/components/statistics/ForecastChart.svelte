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
    import type { Statistics } from "../../database/types";

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
        Legend
    );

    export let statistics: Statistics | null = null;
    export let timeframe: string = "1m"; // "1m", "3m", "1y", "all"

    let canvas: HTMLCanvasElement;
    let chart: Chart | null = null;
    let showBacklogCurve: boolean = true;

    onMount(() => {
        createChart();
    });

    onDestroy(() => {
        if (chart) {
            chart.destroy();
        }
    });

    $: if (chart && statistics) {
        updateChart();
    }

    $: if (chart && showBacklogCurve !== undefined) {
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
            default:
                return 90; // Default fallback
        }
    }

    function processChartData() {
        if (!statistics?.forecast || statistics.forecast.length === 0) {
            return {
                labels: [],
                datasets: [
                    {
                        label: "Due Cards",
                        data: [],
                        backgroundColor: "rgba(59, 130, 246, 0.7)",
                        borderColor: "rgb(59, 130, 246)",
                        borderWidth: 1,
                    },
                ],
            };
        }

        const maxDays = getTimeframeDays();
        const forecastData = statistics.forecast
            .filter((day) => day.dueCount > 0)
            .slice(0, Math.min(maxDays, 30)); // Limit to 30 bars for readability

        if (forecastData.length === 0) {
            return {
                labels: [],
                datasets: [
                    {
                        label: "Due Cards",
                        data: [],
                        backgroundColor: "rgba(59, 130, 246, 0.7)",
                        borderColor: "rgb(59, 130, 246)",
                        borderWidth: 1,
                    },
                ],
            };
        }

        const labels = forecastData.map((day, index) => {
            const originalIndex = statistics!.forecast.indexOf(day);
            if (originalIndex === 0) return "Today";
            if (originalIndex === 1) return "Tomorrow";
            return `in ${originalIndex}d`;
        });

        const data = forecastData.map((day) => day.dueCount);

        // Calculate cumulative backlog curve
        const cumulativeData = [];
        let cumulative = 0;
        for (let i = 0; i < data.length; i++) {
            cumulative += data[i];
            cumulativeData.push(cumulative);
        }

        const datasets = [
            {
                type: "bar" as const,
                label: "Due Cards",
                data,
                backgroundColor: "rgba(59, 130, 246, 0.7)",
                borderColor: "rgb(59, 130, 246)",
                borderWidth: 1,
                yAxisID: "y",
            },
        ];

        // Add backlog curve if enabled
        if (showBacklogCurve) {
            datasets.push({
                type: "line" as const,
                label: "Cumulative Backlog",
                data: cumulativeData,
                backgroundColor: "rgba(239, 68, 68, 0.2)",
                borderColor: "rgb(239, 68, 68)",
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                pointRadius: 3,
                pointHoverRadius: 5,
                pointBackgroundColor: "rgb(239, 68, 68)",
                pointBorderColor: "rgb(255, 255, 255)",
                pointBorderWidth: 1,
                yAxisID: "y1",
            } as any);
        }

        return {
            labels,
            datasets,
        };
    }

    function createChart() {
        if (!canvas) {
            return;
        }

        const data = processChartData();

        try {
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
                                text: "Time",
                            },
                        },
                        y: {
                            type: "linear",
                            display: true,
                            position: "left",
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: "Cards Due",
                            },
                            ticks: {
                                precision: 0,
                            },
                        },
                        y1: {
                            type: "linear",
                            display: showBacklogCurve,
                            position: "right",
                            beginAtZero: true,
                            title: {
                                display: showBacklogCurve,
                                text: "Cumulative Backlog",
                            },
                            grid: {
                                drawOnChartArea: false,
                            },
                            ticks: {
                                precision: 0,
                            },
                        },
                    },
                    plugins: {
                        title: {
                            display: false,
                        },
                        legend: {
                            display: showBacklogCurve,
                            position: "top",
                        },
                        tooltip: {
                            mode: "index",
                            intersect: false,
                            callbacks: {
                                label: function (context) {
                                    const value = context.raw as number;
                                    const datasetLabel =
                                        context.dataset.label || "";

                                    if (datasetLabel.includes("Cumulative")) {
                                        const plural =
                                            value === 1 ? "card" : "cards";
                                        return `${datasetLabel}: ${value} total ${plural}`;
                                    } else {
                                        const plural =
                                            value === 1 ? "card" : "cards";
                                        return `${datasetLabel}: ${value} ${plural} due`;
                                    }
                                },
                                title: function (tooltipItems) {
                                    const label = tooltipItems[0].label;
                                    if (label === "Today") return "Today";
                                    if (label === "Tomorrow") return "Tomorrow";
                                    return label;
                                },
                            },
                        },
                    },
                },
            });
        } catch (error) {
            console.error("[ForecastChart] Error creating chart:", error);
        }
    }

    function updateChart() {
        if (!chart) return;

        const data = processChartData();
        chart.data = data;
        chart.update();
    }
</script>

<div class="decks-forecast-chart-container">
    <h3>Review Load Forecast</h3>
    <div class="decks-chart-controls">
        <label>
            Timeframe:
            <select bind:value={timeframe}>
                <option value="1m">1 Month</option>
                <option value="3m">3 Months</option>
                <option value="1y">1 Year</option>
            </select>
        </label>
        <label>
            <input type="checkbox" bind:checked={showBacklogCurve} />
            Show backlog curve
        </label>
    </div>
    <div class="decks-forecast-chart">
        <canvas bind:this={canvas} height="300"></canvas>
    </div>
    {#if !statistics?.forecast || statistics.forecast.length === 0 || !statistics.forecast.some((day) => day.dueCount > 0)}
        <div class="decks-no-data">
            No upcoming reviews scheduled. Add flashcards to your decks to see
            forecast.
        </div>
    {/if}
</div>

<style>
    .decks-forecast-chart-container {
        margin: 1rem 0;
    }

    .decks-forecast-chart-container h3 {
        margin: 0 0 1rem 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--text-normal);
    }

    .decks-chart-controls {
        margin-bottom: 1rem;
    }

    .decks-chart-controls {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex-wrap: wrap;
    }

    .decks-chart-controls label {
        font-size: 0.9rem;
        color: var(--text-normal);
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .decks-chart-controls select,
    .decks-chart-controls input[type="checkbox"] {
        padding: 4px 8px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        background: var(--background-primary);
        color: var(--text-normal);
        font-size: 0.9rem;
    }

    .decks-chart-controls input[type="checkbox"] {
        padding: 0;
        width: auto;
        height: auto;
    }

    .decks-forecast-chart {
        width: 100%;
        height: 300px;
        margin: 1rem 0;
    }

    .decks-forecast-chart canvas {
        max-width: 100%;
        max-height: 300px;
    }

    .decks-no-data {
        text-align: center;
        color: var(--text-muted);
        font-style: italic;
        margin-top: 1rem;
        padding: 1rem;
        background: var(--background-primary);
        border-radius: 4px;
        border: 1px dashed var(--background-modifier-border);
    }

    /* Mobile responsive */
    @media (max-width: 480px) {
        .decks-forecast-chart {
            height: 250px;
        }

        .decks-chart-controls {
            font-size: 0.8rem;
        }

        .decks-chart-controls select {
            font-size: 0.8rem;
            padding: 3px 6px;
        }
    }
</style>
