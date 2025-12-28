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
    Filler,
    type TooltipItem,
  } from "chart.js";
  import type { Statistics } from "../../database/types";
  import {
    StatisticsService,
    type BacklogForecastData,
  } from "../../services/StatisticsService";
  import { Logger } from "@/utils/logging";
  import { toLocalDateString } from "@/utils/date-utils";

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
    Legend,
    Filler
  );

  export let selectedDeckIds: string[] = [];
  export let statistics: Statistics | null = null;
  export let statisticsService: StatisticsService;
  export let logger: Logger;

  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;
  let showBacklog = false; // Disabled by default to prevent hanging
  let timeframe = "3m"; // "1m", "3m", "1y", "all"
  let isUpdating = false; // Prevent concurrent updates
  let updateTimeout: number | null = null; // Debounce timeout

  // Track previous values for internal state changes only
  let prevTimeframe = "";
  let prevShowBacklog = false;

  onMount(async () => {
    // Only create chart if decks are selected
    if (selectedDeckIds.length > 0) {
      await createChart();
    }
    // Initialize tracking variables after first render
    prevTimeframe = timeframe;
    prevShowBacklog = showBacklog;
  });

  onDestroy(() => {
    if (chart) {
      chart.destroy();
    }
    if (updateTimeout !== null) {
      clearTimeout(updateTimeout);
    }
  });

  // Debounced reactive update for internal state changes only (selectedDeckIds handled by parent {#key} block)
  $: {
    // Clear chart if no decks selected
    if (selectedDeckIds.length === 0) {
      if (chart) {
        chart.data = { labels: [], datasets: [] };
        chart.update();
      }
    } else {
      const hasChanges =
        chart &&
        statistics &&
        (timeframe !== prevTimeframe || showBacklog !== prevShowBacklog);

      if (hasChanges) {
        prevTimeframe = timeframe;
        prevShowBacklog = showBacklog;

        if (updateTimeout !== null) {
          clearTimeout(updateTimeout);
        }
        updateTimeout = window.setTimeout(() => {
          void updateChart();
          updateTimeout = null;
        }, 150); // 150ms debounce
      }
    }
  }

  function getTimeframeDays(): number {
    switch (timeframe) {
      case "1m":
        return 30;
      case "3m":
        return 90;
      case "1y":
        return 365;
      case "all":
        return 730; // 2 years for "all"
      default:
        return 90;
    }
  }

  /**
   * Process chart data for display using StatisticsService for calculations
   */
  async function processChartData() {
    const maxDays = getTimeframeDays();

    // Get filtered forecast data from service
    const displayData = statisticsService.getFilteredForecastData(
      statistics,
      maxDays,
      true // onlyNonZero = true to filter out zero days
    );

    if (displayData.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    // Create chart labels based on actual dates, not array indices
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day
    const todayStr = toLocalDateString(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = toLocalDateString(tomorrow);

    const labels = displayData.map((day) => {
      if (day.date === todayStr) return "Today";
      if (day.date === tomorrowStr) return "Tomorrow";

      // Calculate days from today
      const dayDate = new Date(day.date);
      const diffTime = dayDate.getTime() - today.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      return diffDays.toString();
    });

    const barData = displayData.map((day) => day.dueCount);

    // Calculate backlog forecast data if needed
    let backlogData: BacklogForecastData[] = [];
    if (showBacklog && selectedDeckIds.length > 0) {
      try {
        backlogData = await statisticsService.simulateFutureDueLoad(
          selectedDeckIds,
          maxDays
        );
        logger.debug(
          "[FutureDueChart] Simulated backlog data:",
          backlogData.length
        );
      } catch (error) {
        logger.error("[FutureDueChart] Error simulating backlog:", error);
        backlogData = [];
      }
    }

    const cumulativeData = backlogData
      .slice(0, displayData.length)
      .map((day) => day.projectedBacklog);

    // Create chart datasets - using bar chart with fill
    const datasets = [
      {
        type: "line" as const,
        label: "Due Cards",
        data: barData,
        backgroundColor: "rgba(34, 197, 94, 0.3)",
        borderColor: "rgb(34, 197, 94)",
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
        yAxisID: "y",
      },
    ];

    // Add backlog curve if enabled
    if (showBacklog && backlogData.length > 0) {
      datasets.push({
        type: "line" as const,
        label: "Cumulative",
        data: cumulativeData,
        backgroundColor: "rgba(156, 163, 175, 0.3)",
        borderColor: "rgba(156, 163, 175, 0.7)",
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: "rgba(156, 163, 175, 0.7)",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        yAxisID: "y1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }

    return {
      labels,
      datasets,
    };
  }

  async function createChart() {
    if (!canvas) return;

    const data = await processChartData();

    try {
      chart = new Chart(canvas, {
        type: "line",
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
              display: true,
              grid: {
                display: false,
              },
              ticks: {
                maxTicksLimit: 20,
              },
            },
            y: {
              type: "linear",
              display: true,
              position: "left",
              beginAtZero: true,
              title: {
                display: true,
                text: "Due Cards",
              },
              ticks: {
                precision: 0,
              },
            },
            y1: {
              type: "linear",
              display: showBacklog,
              position: "right",
              beginAtZero: true,
              title: {
                display: true,
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
              display: true,
              position: "bottom",
            },
            tooltip: {
              callbacks: {
                title: function (tooltipItems: TooltipItem<"bar" | "line">[]) {
                  const label = tooltipItems[0].label;
                  if (label === "Today") return "Today";
                  if (label === "Tomorrow") return "Tomorrow";
                  return `Day ${label}`;
                },
                label: function (context: TooltipItem<"bar" | "line">) {
                  const value = context.parsed.y;
                  const datasetLabel = context.dataset.label || "";
                  if (datasetLabel.includes("Cumulative")) {
                    return `Total backlog: ${value} reviews`;
                  } else {
                    return `Due: ${value} cards`;
                  }
                },
              },
            },
          },
        },
      });
      logger.debug("[FutureDueChart] Chart created successfully");
    } catch (error) {
      logger.error("[FutureDueChart] Error creating chart:", error);
    }
  }

  async function updateChart() {
    if (!chart || isUpdating) return;

    try {
      isUpdating = true;
      const data = await processChartData();

      if (!chart) return; // Chart might have been destroyed while processing

      chart.data = data;

      // Update scale visibility
      if (chart.options.scales?.y1) {
        chart.options.scales.y1.display = showBacklog;
      }

      chart.update();
    } catch (error) {
      logger.error("[FutureDueChart] Error updating chart:", error);
    } finally {
      isUpdating = false;
    }
  }

  // Reactive calculation - only recomputes when dependencies change
  $: forecastStats = (() => {
    const maxDays = getTimeframeDays();
    if (!statistics || !statistics.forecast) {
      return {
        totalReviews: 0,
        averagePerDay: 0,
        dueTomorrow: 0,
      };
    }

    const forecast = statistics.forecast.slice(0, maxDays);
    const totalReviews = forecast.reduce((sum, day) => sum + day.dueCount, 0);
    const averagePerDay =
      forecast.length > 0 ? Math.round(totalReviews / forecast.length) : 0;
    const dueTomorrow = forecast.length > 1 ? forecast[1].dueCount : 0;

    return {
      totalReviews,
      averagePerDay,
      dueTomorrow,
    };
  })();
</script>

<div class="future-due-chart-container">
  <h3>Future Due</h3>
  <p class="decks-chart-subtitle">
    {#if selectedDeckIds.length === 0}
      <span class="decks-loading-indicator"
        >Select a deck to view future due reviews.</span
      >
    {:else}
      The number of reviews due in the future.
    {/if}
  </p>

  {#if selectedDeckIds.length > 0}
    <div class="chart-controls">
      <label class="backlog-control">
        <input type="checkbox" bind:checked={showBacklog} />
        Backlog
      </label>

      <div class="timeframe-controls">
        <label>
          <input type="radio" bind:group={timeframe} value="1m" />
          1 month
        </label>
        <label>
          <input type="radio" bind:group={timeframe} value="3m" />
          3 months
        </label>
        <label>
          <input type="radio" bind:group={timeframe} value="1y" />
          1 year
        </label>
        <label>
          <input type="radio" bind:group={timeframe} value="all" />
          all
        </label>
      </div>
    </div>
  {/if}

  <div class="chart-wrapper">
    <canvas bind:this={canvas} height="300"></canvas>
  </div>

  {#if selectedDeckIds.length > 0}
    <div class="chart-stats">
      <div class="stat">
        <span class="stat-label">Total Reviews:</span>
        <span class="stat-value">{forecastStats.totalReviews}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Avg/Day:</span>
        <span class="stat-value">{forecastStats.averagePerDay}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Due Tomorrow: </span>
        <span class="stat-value" style="color: #f97316;"
          >{forecastStats.dueTomorrow}</span
        >
      </div>
    </div>

    {#if !statistics?.forecast || statistics.forecast.length === 0 || !statistics.forecast.some((day) => day.dueCount > 0)}
      <div class="no-data">
        No upcoming reviews scheduled. Add flashcards to your decks to see
        forecast.
      </div>
    {/if}
  {/if}
</div>

<style>
  .future-due-chart-container {
    margin: 1rem 0;
    padding: 1rem;
    background: var(--background-primary);
    border-radius: 8px;
  }

  .future-due-chart-container h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .chart-subtitle {
    margin: 0 0 1.5rem 0;
    font-size: 0.95rem;
    color: var(--text-muted);
    text-align: center;
  }

  .chart-controls {
    display: flex;
    align-items: center;
    gap: 2rem;
    margin-bottom: 1.5rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .backlog-control {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--text-normal);
  }

  .backlog-control input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: #3b82f6;
  }

  .timeframe-controls {
    display: flex;
    gap: 1.5rem;
    align-items: center;
  }

  .timeframe-controls label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--text-normal);
    cursor: pointer;
  }

  .timeframe-controls input[type="radio"] {
    width: 16px;
    height: 16px;
    accent-color: #3b82f6;
  }

  .chart-wrapper {
    width: 100%;
    height: 300px;
    margin: 1.5rem 0;
    background: var(--background-secondary);
    border-radius: 8px;
    padding: 1rem;
  }

  .chart-wrapper canvas {
    max-width: 100%;
    max-height: 300px;
  }

  .chart-stats {
    display: flex;
    justify-content: center;
    gap: 2rem;
    margin-top: 1.5rem;
    flex-wrap: wrap;
  }

  .stat {
    text-align: center;
    font-size: 0.9rem;
  }

  .stat-label {
    color: var(--text-muted);
    display: block;
  }

  .stat-value {
    color: var(--text-normal);
    font-weight: 500;
    display: block;
    margin-top: 0.25rem;
  }

  .no-data {
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
    margin-top: 2rem;
    padding: 2rem;
    background: var(--background-secondary);
    border-radius: 8px;
    border: 2px dashed var(--background-modifier-border);
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .chart-controls {
      gap: 1rem;
    }

    .timeframe-controls {
      gap: 1rem;
    }

    .chart-stats {
      gap: 1rem;
    }

    .stat {
      font-size: 0.8rem;
    }
  }

  @media (max-width: 480px) {
    .future-due-chart-container {
      padding: 0.75rem;
    }

    .future-due-chart-container h3 {
      font-size: 1.3rem;
    }

    .chart-wrapper {
      height: 250px;
      padding: 0.75rem;
    }

    .chart-controls {
      flex-direction: column;
      gap: 1rem;
      align-items: center;
    }

    .timeframe-controls {
      gap: 0.75rem;
    }

    .timeframe-controls label {
      font-size: 0.8rem;
    }

    .chart-stats {
      flex-direction: column;
      gap: 0.5rem;
    }
  }
</style>
