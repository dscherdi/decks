<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    Chart,
    ArcElement,
    DoughnutController,
    PieController,
    Tooltip,
    Legend,
  } from "chart.js";
  import { StatisticsService } from "@/services/StatisticsService";
  import { Logger } from "@/utils/logging";
  import { I18n } from "@/i18n/I18n";

  const t = I18n.t;

  export let selectedDeckIds: string[] = [];
  export let statisticsService: StatisticsService;
  export let logger: Logger;

  let counts: { new: number; young: number; mature: number } | null = null;
  // Register Chart.js components with force re-registration
  try {
    Chart.unregister(
      ArcElement,
      DoughnutController,
      PieController,
      Tooltip,
      Legend
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    logger.debug("[CardCountsChart] First registration, skip unregister");
  }

  Chart.register(
    ArcElement,
    DoughnutController,
    PieController,
    Tooltip,
    Legend
  );

  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;

  onMount(async () => {
    if (selectedDeckIds.length > 0) {
      await loadData();
      createChart();
    }
  });

  onDestroy(() => {
    if (chart) {
      chart.destroy();
    }
  });

  async function loadData() {
    try {
      logger.debug(
        `[CardCountsChart] loadData() called with selectedDeckIds: [${selectedDeckIds.join(",")}]`
      );
      counts = await statisticsService.getCardCountsByMaturity(selectedDeckIds);
      logger.debug("[CardCountsChart] Loaded counts:", counts);
    } catch (error) {
      logger.error("[CardCountsChart] Error loading counts:", error);
      counts = { new: 0, young: 0, mature: 0 };
    }
  }

  function processChartData() {
    if (!counts) {
      return {
        labels: [],
        datasets: [
          { data: [], backgroundColor: [], borderColor: [], borderWidth: 1 },
        ],
      };
    }

    const data = [];
    const labels = [];
    const backgroundColor = [];
    const borderColor = [];

    if (counts.new > 0) {
      data.push(counts.new);
      labels.push(t.statistics.cardCountsNew);
      backgroundColor.push("#3b82f6");
      borderColor.push("#2563eb");
    }

    if (counts.young > 0) {
      data.push(counts.young);
      labels.push(t.statistics.cardCountsYoung);
      backgroundColor.push("#f59e0b");
      borderColor.push("#d97706");
    }

    if (counts.mature > 0) {
      data.push(counts.mature);
      labels.push(t.statistics.cardCountsMature);
      backgroundColor.push("#22c55e");
      borderColor.push("#16a34a");
    }

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor,
          borderColor,
          borderWidth: 1,
        },
      ],
    };
  }

  function createChart() {
    if (!canvas) {
      return;
    }

    const data = processChartData();

    if (data.datasets[0].data.length === 0) {
      return;
    }

    try {
      chart = new Chart(canvas, {
        type: "pie",
        data: data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: t.statistics.cardDistributionByState,
            },
            legend: {
              display: true,
              position: "bottom",
            },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const label = context.label || "";
                  const value = context.raw as number;
                  const total = context.dataset.data.reduce(
                    (sum: number, val) => sum + (val as number),
                    0
                  );
                  const percentage = ((value / total) * 100).toFixed(1);
                  return I18n.format(t.statistics.cardCountsTooltip, {
                    label,
                    count: value,
                    percent: percentage,
                  });
                },
              },
            },
          },
        },
      });
    } catch (error) {
      console.error("[CardCountsChart] Error creating chart:", error);

      // Try fallback to doughnut chart
      try {
        chart = new Chart(canvas, {
          type: "doughnut",
          data: data,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              title: {
                display: true,
                text: t.statistics.cardDistributionByStateDoughnut,
              },
              legend: {
                display: true,
                position: "bottom",
              },
            },
          },
        });
      } catch (fallbackError) {
        console.error(
          "[CardCountsChart] Doughnut fallback also failed:",
          fallbackError
        );
      }
    }
  }
</script>

<h3>{t.statistics.cardDistribution}</h3>
<p class="decks-chart-subtitle">
  {#if selectedDeckIds.length === 0}
    <span class="decks-loading-indicator"
      >{t.statistics.selectDeckCardDistribution}</span
    >
  {/if}
</p>
<div class="decks-card-counts-chart">
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

  .decks-card-counts-chart {
    width: 100%;
    height: 300px;
    margin: 1rem 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .decks-card-counts-chart canvas {
    max-width: 100%;
    max-height: 300px;
  }
</style>
