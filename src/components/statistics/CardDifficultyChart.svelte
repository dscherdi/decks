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
  import { I18n } from "@decks/core";
  import {
    BAR_DATASET_DEFAULTS,
    getCategoryXAxis,
    getLinearYAxis,
    getNativeTooltip,
    getObsidianColor,
    interpolateColor,
    PALETTE,
  } from "./chartTheme";

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
      const mutedColor = getObsidianColor("--text-muted");
      return {
        labels: [t.statistics.noData],
        datasets: [
          {
            label: t.statistics.cardPlural,
            data: [0],
            backgroundColor: mutedColor,
            borderColor: mutedColor,
            borderWidth: 1,
          },
        ],
      };
    }

    const dd = difficultyData;
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
      const count = dd.get(label) || 0;
      if (count > 0) {
        labels.push(label);
        data.push(count);
      }
    });

    const colors = labels.map((_, index) => {
      const ratio = index / Math.max(labels.length - 1, 1);
      return interpolateColor(PALETTE.green, PALETTE.red, ratio);
    });

    return {
      labels,
      datasets: [
        {
          ...BAR_DATASET_DEFAULTS,
          label: t.statistics.numberOfCards,
          data,
          backgroundColor: colors,
          borderColor: colors,
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
            ...getCategoryXAxis(),
            title: {
              display: true,
              text: t.statistics.cardDifficultyRange,
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
            text: t.statistics.cardDifficultyDistribution,
          },
          legend: {
            display: true,
            position: "top",
          },
          tooltip: {
            ...getNativeTooltip(),
            callbacks: {
              label: function (context: TooltipItem<"bar">) {
                const value = context.parsed.y;
                const dataset = context.dataset;
                const total = (dataset.data as number[]).reduce(
                  (sum: number, val: number) => sum + val,
                  0
                );
                const percentage =
                  total > 0 ? (((value ?? 0) / total) * 100).toFixed(1) : "0";
                return I18n.format(t.statistics.cardCountsTooltip, {
                  label: dataset.label ?? "",
                  count: value ?? 0,
                  percent: percentage,
                });
              },
              afterLabel: function (_context: TooltipItem<"bar">) {
                return t.statistics.higherDifficultyTip;
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

<h3>{t.statistics.cardDifficultyDistribution}</h3>
<p class="decks-chart-subtitle">
  {#if selectedDeckIds.length === 0}
    <span class="decks-loading-indicator">{t.statistics.selectDeckCardDifficulty}</span>
  {:else}
    <span class="decks-chart-description">
      {t.statistics.cardDifficultySubtitle}
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
