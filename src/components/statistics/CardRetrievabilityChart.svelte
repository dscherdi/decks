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
  let retrievabilityData: Map<string, number> | null = null;

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
      retrievabilityData = await statisticsService.getRetrievabilityDistribution(selectedDeckIds);
      logger.debug("[CardRetrievabilityChart] Loaded retrievability data:", retrievabilityData.size);
    } catch (error) {
      logger.error("[CardRetrievabilityChart] Error loading retrievability data:", error);
      retrievabilityData = new Map();
    }
  }

  function processChartData() {
    if (!retrievabilityData || retrievabilityData.size === 0) {
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

    // Define bucket ranges to match database aggregation
    const bucketRanges = [
      "0-10%",
      "10-20%",
      "20-30%",
      "30-40%",
      "40-50%",
      "50-60%",
      "60-70%",
      "70-80%",
      "80-90%",
      "90-100%",
    ];

    // Filter out empty buckets and get data
    const labels: string[] = [];
    const data: number[] = [];

    bucketRanges.forEach((label) => {
      const count = retrievabilityData.get(label) || 0;
      if (count > 0) {
        labels.push(label);
        data.push(count);
      }
    });

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
                  (sum: number, val: number) => sum + val,
                  0
                );
                const percentage =
                  total > 0 ? ((value / total) * 100).toFixed(1) : "0";
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
