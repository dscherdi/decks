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
  let difficultyData: Map<string, number> | null = null;


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
      difficultyData = await statisticsService.getDifficultyDistribution(selectedDeckIds);
      logger.debug("[CardDifficultyChart] Loaded difficulty data:", difficultyData.size);
    } catch (error) {
      logger.error("[CardDifficultyChart] Error loading difficulty data:", error);
      difficultyData = new Map();
    }
  }

  function processChartData() {
    if (!difficultyData || difficultyData.size === 0) {
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
      const count = difficultyData.get(label) || 0;
      if (count > 0) {
        labels.push(label);
        data.push(count);
      }
    });

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
          label: "Number of cards",
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
              afterLabel: function (_context: TooltipItem<"bar">) {
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
<p class="decks-chart-subtitle">
  {#if selectedDeckIds.length === 0}
    <span class="decks-loading-indicator">Select a deck to view card difficulty distribution.</span>
  {:else}
    <span class="decks-chart-description">
      FSRS difficulty values indicate how hard cards are to remember
    </span>
  {/if}
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
