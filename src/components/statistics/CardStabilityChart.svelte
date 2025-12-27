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

  export const showPercentiles = "50"; // "50", "95", "all"

  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;
  let stabilityData: Map<string, number> | null = null;

  onMount(async () => {
    await loadData();
    createChart();
  });

  onDestroy(() => {
    if (chart) {
      chart.destroy();
    }
  });

  $: if (selectedDeckIds) {
    loadData().then(() => updateChart());
  }

  async function loadData() {
    try {
      stabilityData = await statisticsService.getStabilityDistribution(selectedDeckIds);
      logger.debug("[CardStabilityChart] Loaded stability data:", stabilityData.size);
    } catch (error) {
      logger.error("[CardStabilityChart] Error loading stability data:", error);
      stabilityData = new Map();
    }
  }

  function processChartData() {
    if (!stabilityData || stabilityData.size === 0) {
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

    // Define bucket ranges to match database aggregation
    const bucketRanges = [
      "0-1d",
      "1-3d",
      "3-7d",
      "1-2w",
      "2-4w",
      "1-3m",
      "3-6m",
      "6m-1y",
      "1y+",
    ];

    // Filter out empty buckets and get data
    const labels: string[] = [];
    const data: number[] = [];

    bucketRanges.forEach((label) => {
      const count = stabilityData.get(label) || 0;
      if (count > 0) {
        labels.push(label);
        data.push(count);
      }
    });

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
              label: function (context: TooltipItem<"bar">) {
                const value = context.parsed.y;
                const dataset = context.dataset;
                const total = (dataset.data as number[]).reduce(
                  (sum: number, val: number) => sum + val,
                  0
                );
                const percentage =
                  total > 0 ? ((value / total) * 100).toFixed(1) : "0";
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
