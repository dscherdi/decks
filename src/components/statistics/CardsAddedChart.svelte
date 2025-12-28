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

  export let timeframe = "1m"; // "1m", "3m", "1y", "all"

  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;
  let cardsAddedData: Map<string, number> | null = null;


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
      const days = getTimeframeDays();
      cardsAddedData = await statisticsService.getCardsAddedByDate(days, selectedDeckIds);
      logger.debug("[CardsAddedChart] Loaded cards added data:", cardsAddedData.size);
    } catch (error) {
      logger.error("[CardsAddedChart] Error loading cards added data:", error);
      cardsAddedData = new Map();
    }
  }

  function getTimeframeDays(): number {
    switch (timeframe) {
      case "1m": return 30;
      case "3m": return 90;
      case "1y": return 365;
      case "all": return 3650; // 10 years
      default: return 30;
    }
  }

  function processChartData() {
    if (!cardsAddedData || cardsAddedData.size === 0) {
      return {
        labels: ["No Data"],
        datasets: [
          {
            label: "Cards Added",
            data: [0],
            backgroundColor: "#6b7280",
            borderColor: "#4b5563",
            borderWidth: 1,
          },
        ],
      };
    }

    // Sort dates and prepare chart data
    const sortedDates = Array.from(cardsAddedData.keys()).sort();
    const labels = sortedDates.map((date) => {
      const d = new Date(date);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    });
    const data = sortedDates.map((date) => cardsAddedData.get(date) || 0);

    return {
      labels,
      datasets: [
        {
          label: "Cards Added",
          data,
          backgroundColor: "#10b981",
          borderColor: "#059669",
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
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: {
              display: true,
              text: "Date Added",
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
            text: "Cards Added Over Time",
          },
          legend: {
            display: true,
            position: "top",
          },
          tooltip: {
            callbacks: {
              label: function (context: TooltipItem<"bar">) {
                const value = context.parsed.y;
                const plural = value === 1 ? "card" : "cards";
                return `${context.dataset.label}: ${value} ${plural}`;
              },
              afterLabel: function (_context: TooltipItem<"bar">) {
                return "Based on first review date";
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

  async function handleFilterChange() {
    logger.debug("[CardsAddedChart] Timeframe changed, reloading data...");
    try {
      await loadData();
      updateChart();
    } catch (error) {
      logger.error("[CardsAddedChart] Error during filter change:", error);
    }
  }
</script>

<h3>Cards Added Over Time</h3>
<p class="decks-chart-subtitle">
  {#if selectedDeckIds.length === 0}
    <span class="decks-loading-indicator">Select a deck to view cards added over time.</span>
  {/if}
</p>
{#if selectedDeckIds.length > 0}
  <div class="decks-chart-controls">
    <label>
      Timeframe:
      <select bind:value={timeframe} on:change={handleFilterChange}>
        <option value="1m">1 Month</option>
        <option value="3m">3 Months</option>
        <option value="1y">1 Year</option>
        <option value="all">All Time</option>
      </select>
    </label>
  </div>
{/if}
<div class="decks-cards-added-chart">
  <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
  .decks-cards-added-chart {
    width: 100%;
    height: 300px;
    margin: 1rem 0;
  }

  .decks-cards-added-chart canvas {
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
