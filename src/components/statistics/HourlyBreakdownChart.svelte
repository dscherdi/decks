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
    type TooltipItem,
  } from "chart.js";
  import { StatisticsService } from "@/services/StatisticsService";
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
    Legend
  );

  export let selectedDeckIds: string[] = [];
  export let statisticsService: StatisticsService;
  export let logger: Logger;

  let hourlyData: Map<number, number> | null = null;
  let successRatesData: Map<number, number> | null = null;

  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;


  onMount(async () => {
    createChart();
    if (selectedDeckIds.length > 0) {
      await loadData();
      updateChart();
    }
  });

  onDestroy(() => {
    if (chart) {
      chart.destroy();
    }
  });


  async function loadData() {
    try {
      hourlyData = await statisticsService.getReviewsByHour(selectedDeckIds);
      successRatesData = await statisticsService.getSuccessRatesByHour(selectedDeckIds);
      logger.debug("[HourlyBreakdownChart] Loaded hourly data:", hourlyData.size);
      logger.debug("[HourlyBreakdownChart] Loaded success rates:", successRatesData.size);
    } catch (error) {
      logger.error("[HourlyBreakdownChart] Error loading hourly data:", error);
      hourlyData = new Map();
      successRatesData = new Map();
    }
  }

  function processChartData() {
    // Create array of counts for each hour (0-23)
    const hourlyCounts = hourlyData
      ? Array.from({ length: 24 }, (_, hour) => hourlyData.get(hour) || 0)
      : new Array(24).fill(0);

    // Create array of success rates for each hour (0-23)
    const successRates = successRatesData
      ? Array.from({ length: 24 }, (_, hour) => successRatesData.get(hour) || 0)
      : new Array(24).fill(0);

    // Prepare chart data
    const labels = Array.from(
      { length: 24 },
      (_, i) => `${i.toString().padStart(2, "0")}:00`
    );

    return {
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Review Count",
          data: hourlyCounts,
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
              callback: function (value: string | number) {
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
              label: function (context: TooltipItem<"bar" | "line">) {
                const datasetLabel = context.dataset.label || "";
                const value = context.parsed.y;

                if (datasetLabel.includes("Success Rate")) {
                  return `${datasetLabel}: ${value}%`;
                } else {
                  return `${datasetLabel}: ${value} reviews`;
                }
              },
              afterBody: function (
                tooltipItems: TooltipItem<"bar" | "line">[]
              ) {
                const hour = parseInt(tooltipItems[0].label.split(":")[0]);
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

<h3>Review Activity by Hour</h3>
<p class="decks-chart-subtitle">
  {#if selectedDeckIds.length === 0}
    <span class="decks-loading-indicator">Select a deck to view review activity by hour.</span>
  {/if}
</p>
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

  .decks-chart-subtitle {
    margin: 0 0 1rem 0;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.5;
  }

  .decks-loading-indicator {
    color: var(--text-muted);
    font-style: italic;
  }
</style>
