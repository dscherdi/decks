<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    Chart,
    CategoryScale,
    LinearScale,
    LineElement,
    LineController,
    PointElement,
    Filler,
    Title,
    Tooltip,
    Legend,
    type TooltipItem,
  } from "chart.js";
  import { StatisticsService } from "@/services/StatisticsService";
  import { Logger } from "@/utils/logging";
  import { I18n } from "@/i18n/I18n";
  import {
    LINE_DATASET_DEFAULTS,
    getCategoryXAxis,
    getLinearYAxis,
    getNativeTooltip,
    getObsidianColor,
    withAlpha,
    PALETTE,
  } from "./chartTheme";

  const t = I18n.t;

  // Register Chart.js components
  Chart.register(
    CategoryScale,
    LinearScale,
    LineElement,
    LineController,
    PointElement,
    Filler,
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
      const mutedColor = getObsidianColor("--text-muted");
      return {
        labels: ["No Data"],
        datasets: [
          {
            ...LINE_DATASET_DEFAULTS,
            label: "Cards Added",
            data: [0],
            backgroundColor: withAlpha("--text-muted", 0.2),
            borderColor: mutedColor,
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
          ...LINE_DATASET_DEFAULTS,
          label: t.statistics.cardsAddedSeries,
          data,
          backgroundColor: withAlpha(PALETTE.green, 0.25),
          borderColor: getObsidianColor(PALETTE.green),
        },
      ],
    };
  }

  function createChart() {
    if (!canvas) return;

    const data = processChartData();

    chart = new Chart(canvas, {
      type: "line",
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ...getCategoryXAxis(),
            title: {
              display: true,
              text: t.statistics.dateAdded,
            },
          },
          y: {
            ...getLinearYAxis(),
            title: {
              display: true,
              text: t.statistics.numberOfCards,
            },
          },
        },
        plugins: {
          title: {
            display: true,
            text: t.statistics.cardsAddedOverTime,
          },
          legend: {
            display: true,
            position: "top",
          },
          tooltip: {
            ...getNativeTooltip(),
            callbacks: {
              label: function (context: TooltipItem<"line">) {
                const value = context.parsed.y ?? 0;
                const plural = value === 1 ? t.statistics.cardSingular : t.statistics.cardPlural;
                return I18n.format(t.statistics.cardsAddedTooltip, {
                  label: context.dataset.label ?? "",
                  count: value,
                  plural,
                });
              },
              afterLabel: function (_context: TooltipItem<"line">) {
                return t.statistics.basedOnFirstReview;
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

<h3>{t.statistics.cardsAddedOverTime}</h3>
<p class="decks-chart-subtitle">
  {#if selectedDeckIds.length === 0}
    <span class="decks-loading-indicator">{t.statistics.selectDeckCardsAdded}</span>
  {/if}
</p>
{#if selectedDeckIds.length > 0}
  <div class="decks-chart-controls">
    <label>
      {t.statistics.timeframeLabel}
      <select bind:value={timeframe} on:change={handleFilterChange}>
        <option value="1m">{t.statistics.timeframe1Month}</option>
        <option value="3m">{t.statistics.timeframe3Months}</option>
        <option value="1y">{t.statistics.timeframe1Year}</option>
        <option value="all">{t.statistics.allTime}</option>
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
