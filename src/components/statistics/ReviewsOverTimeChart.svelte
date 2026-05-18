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
  import "chartjs-adapter-date-fns";
  import { Logger } from "@/utils/logging";
  import { StatisticsService } from "@/services/StatisticsService";
  import { I18n } from "@/i18n/I18n";

  const t = I18n.t;

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

  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;

  let selectedTimeframe = "1m"; // "1m", "3m", "1y", "all"
  let reviewData: Map<string, { again: number; hard: number; good: number; easy: number }> | null = null;

  let prevTimeframe = "";

  onMount(async () => {
    createChart();
    if (selectedDeckIds.length > 0) {
      await loadData();
      updateChart();
    }
    prevTimeframe = selectedTimeframe;
  });

  onDestroy(() => {
    if (chart) {
      chart.destroy();
    }
  });

  // Only track internal timeframe changes (selectedDeckIds handled by parent {#key} block)
  $: {
    if (selectedTimeframe !== prevTimeframe) {
      prevTimeframe = selectedTimeframe;

      if (selectedDeckIds.length > 0) {
        loadData().then(() => updateChart());
      } else {
        reviewData = null;
        if (chart) {
          chart.data = { labels: [], datasets: [] };
          chart.update();
        }
      }
    }
  }

  function getTimeframeDays(): number {
    switch (selectedTimeframe) {
      case "1m":
        return 30;
      case "3m":
        return 90;
      case "1y":
        return 365;
      case "all":
        return 3650; // 10 years
      default:
        return 30;
    }
  }

  async function loadData() {
    try {
      const days = getTimeframeDays();
      reviewData = await statisticsService.getReviewsByDateAndRating(days, selectedDeckIds);
      logger.debug("[ReviewsOverTimeChart] Loaded review data:", reviewData.size);
    } catch (error) {
      logger.error("[ReviewsOverTimeChart] Error loading review data:", error);
      reviewData = new Map();
    }
  }

  function processChartData() {
    if (!reviewData) {
      return {
        labels: [],
        datasets: [],
      };
    }

    // Sort dates and prepare data
    const sortedDates = Array.from(reviewData.keys()).sort();

    return {
      labels: sortedDates,
      datasets: [
        {
          label: t.statistics.againSeries,
          data: sortedDates.map((date) => reviewData.get(date)!.again),
          backgroundColor: "#ef4444",
          borderColor: "#dc2626",
          borderWidth: 1,
        },
        {
          label: t.statistics.hardSeries,
          data: sortedDates.map((date) => reviewData.get(date)!.hard),
          backgroundColor: "#f97316",
          borderColor: "#ea580c",
          borderWidth: 1,
        },
        {
          label: t.statistics.goodSeries,
          data: sortedDates.map((date) => reviewData.get(date)!.good),
          backgroundColor: "#22c55e",
          borderColor: "#16a34a",
          borderWidth: 1,
        },
        {
          label: t.statistics.easySeries,
          data: sortedDates.map((date) => reviewData.get(date)!.easy),
          backgroundColor: "#3b82f6",
          borderColor: "#2563eb",
          borderWidth: 1,
        },
      ],
    };
  }

  function createChart() {
    if (!canvas) {
      logger.debug("[ReviewsOverTimeChart] Canvas not available");
      return;
    }

    const data = processChartData();
    logger.debug("[ReviewsOverTimeChart] Creating chart with data:", data);

    chart = new Chart(canvas, {
      type: "bar",
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            title: {
              display: true,
              text: t.statistics.dateAxisLabel,
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            title: {
              display: true,
              text: t.statistics.reviewsLabel,
            },
            ticks: {
              precision: 0,
            },
          },
        },
        plugins: {
          title: {
            display: true,
            text: t.statistics.reviewsOverTimeTitle,
          },
          legend: {
            display: true,
            position: "top",
          },
          tooltip: {
            mode: "index",
            intersect: false,
            callbacks: {
              afterLabel: function (context: TooltipItem<"bar">) {
                const dataIndex = context.dataIndex;
                const data = context.chart.data;

                let total = 0;
                for (let i = 0; i < data.datasets.length; i++) {
                  total += (data.datasets[i].data[dataIndex] as number) || 0;
                }

                const percentage =
                  total > 0
                    ? ((context.parsed.y / total) * 100).toFixed(1)
                    : "0";
                return `${percentage}%`;
              },
            },
          },
        },
        interaction: {
          mode: "index",
          intersect: false,
        },
      },
    });
  }

  function updateChart() {
    if (!chart) {
      logger.debug("[ReviewsOverTimeChart] Chart not available for update");
      return;
    }

    const data = processChartData();
    logger.debug("[ReviewsOverTimeChart] Updating chart with data:", data);
    chart.data = data;
    chart.update();
  }

  async function handleFilterChange() {
    logger.debug("[StatisticsUI] Filter changed, reloading data...");
    try {
      updateChart();
    } catch (error) {
      logger.error("[StatisticsUI] Error during filter change:", error);
    }
  }
</script>

<h3>{t.statistics.reviewsOverTimeTitle}</h3>
<p class="decks-chart-subtitle">
  {#if selectedDeckIds.length === 0}
    <span class="decks-loading-indicator">{t.statistics.selectDeckReviewsOverTime}</span>
  {/if}
</p>
{#if selectedDeckIds.length > 0}
  <div class="decks-chart-controls">
    <label>
      {t.statistics.timeframeLabel}
      <select bind:value={selectedTimeframe} on:change={handleFilterChange}>
        <option value="1m">{t.statistics.timeframe1Month}</option>
        <option value="3m">{t.statistics.timeframe3Months}</option>
        <option value="1y">{t.statistics.timeframe1Year}</option>
        <option value="all">{t.statistics.allTime}</option>
      </select>
    </label>
  </div>
{/if}
<div class="decks-reviews-over-time-chart">
  <canvas bind:this={canvas} height="300"></canvas>
</div>

<style>
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

  .decks-reviews-over-time-chart {
    width: 100%;
    height: 300px;
    margin: 1rem 0;
  }

  .decks-reviews-over-time-chart canvas {
    max-width: 100%;
    max-height: 300px;
  }
</style>
