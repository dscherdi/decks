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
  } from "chart.js";
  import { StatisticsService } from "@/services/StatisticsService";
  import { Logger } from "@/utils/logging";

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

  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;
  let maturityData: Array<{
    date: string;
    newCards: number;
    learningCards: number;
    matureCards: number;
  }> | null = null;
  let daysToMaturity: number | null = null;
  let isLoading = false;
  let selectedTimeframe = "1y"; // "1y", "2y", "3y", "5y", "auto"
  let maxDays = 365;

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

  $: if (selectedTimeframe) {
    updateMaxDays();
    loadData().then(() => updateChart());
  }

  function updateMaxDays() {
    switch (selectedTimeframe) {
      case "1y":
        maxDays = 365;
        break;
      case "2y":
        maxDays = 730;
        break;
      case "3y":
        maxDays = 1095;
        break;
      case "5y":
        maxDays = 1825;
        break;
      case "auto":
        maxDays = 3650; // 10 years max for auto
        break;
      default:
        maxDays = 365;
    }
  }

  async function loadData() {
    try {
      isLoading = true;

      // First, do a quick simulation to estimate days to maturity
      if (selectedTimeframe === "auto") {
        const quickSim = await statisticsService.simulateMaturityProgression(
          selectedDeckIds,
          365
        );
        const quickDays = calculateDaysToMaturity(quickSim);

        if (quickDays === null) {
          // Not mature within 1 year, extend the simulation
          // Try progressively longer simulations
          maxDays = 730; // Start with 2 years
          const sim2y = await statisticsService.simulateMaturityProgression(
            selectedDeckIds,
            maxDays
          );
          const days2y = calculateDaysToMaturity(sim2y);

          if (days2y === null) {
            maxDays = 1825; // 5 years
          } else {
            maxDays = Math.min(Math.ceil(days2y * 1.1), 1825); // 10% buffer, max 5 years
          }
        } else {
          maxDays = Math.min(Math.ceil(quickDays * 1.1), 365); // 10% buffer
        }
      }

      maturityData = await statisticsService.simulateMaturityProgression(
        selectedDeckIds,
        maxDays
      );

      // Calculate days to maturity (when all cards are mature)
      daysToMaturity = calculateDaysToMaturity(maturityData);

      logger.debug("[MaturityProgressionChart] Loaded maturity data:", {
        dataPoints: maturityData.length,
        daysToMaturity,
        maxDays,
        timeframe: selectedTimeframe,
      });
    } catch (error) {
      logger.error("[MaturityProgressionChart] Error loading maturity data:", error);
      maturityData = [];
      daysToMaturity = null;
    } finally {
      isLoading = false;
    }
  }

  function calculateDaysToMaturity(
    data: Array<{
      date: string;
      newCards: number;
      learningCards: number;
      matureCards: number;
    }>
  ): number | null {
    if (!data || data.length === 0) return null;

    // Find the day when new cards + learning cards = 0 (all mature)
    for (let i = 0; i < data.length; i++) {
      if (data[i].newCards === 0 && data[i].learningCards === 0) {
        return i;
      }
    }

    // If we never reach full maturity in the projection, return null
    return null;
  }

  function processChartData() {
    if (!maturityData || maturityData.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const labels = maturityData.map((d) => d.date);
    const newCards = maturityData.map((d) => d.newCards);
    const learningCards = maturityData.map((d) => d.learningCards);
    const matureCards = maturityData.map((d) => d.matureCards);

    return {
      labels,
      datasets: [
        {
          label: "New Cards",
          data: newCards,
          backgroundColor: "rgba(59, 130, 246, 0.5)",
          borderColor: "rgb(59, 130, 246)",
          borderWidth: 2,
          fill: true,
          tension: 0.4,
        },
        {
          label: "Learning Cards",
          data: learningCards,
          backgroundColor: "rgba(245, 158, 11, 0.5)",
          borderColor: "rgb(245, 158, 11)",
          borderWidth: 2,
          fill: true,
          tension: 0.4,
        },
        {
          label: "Mature Cards",
          data: matureCards,
          backgroundColor: "rgba(34, 197, 94, 0.5)",
          borderColor: "rgb(34, 197, 94)",
          borderWidth: 2,
          fill: true,
          tension: 0.4,
        },
      ],
    };
  }

  function createChart() {
    if (!canvas) {
      return;
    }

    const data = processChartData();

    if (data.datasets.length === 0) {
      return;
    }

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
          plugins: {
            title: {
              display: true,
              text: "Card Maturity Progression",
            },
            legend: {
              display: true,
              position: "bottom",
            },
            tooltip: {
              callbacks: {
                footer: function (tooltipItems) {
                  if (tooltipItems.length === 0) return "";

                  const total =
                    tooltipItems.reduce(
                      (sum, item) => sum + (item.raw as number),
                      0
                    );
                  return `Total: ${total} cards`;
                },
              },
            },
          },
          scales: {
            x: {
              title: {
                display: true,
                text: "Days from Now",
              },
              ticks: {
                maxTicksLimit: 12,
              },
            },
            y: {
              stacked: true,
              title: {
                display: true,
                text: "Number of Cards",
              },
              beginAtZero: true,
            },
          },
        },
      });
    } catch (error) {
      logger.error("[MaturityProgressionChart] Error creating chart:", error);
    }
  }

  function updateChart() {
    if (!chart) return;

    const data = processChartData();
    chart.data = data;
    chart.update();
  }
</script>

<h3>Maturity Progression Forecast</h3>
<div class="decks-chart-controls">
  <label>
    Timeframe:
    <select bind:value={selectedTimeframe} disabled={isLoading}>
      <option value="1y">1 Year</option>
      <option value="2y">2 Years</option>
      <option value="3y">3 Years</option>
      <option value="5y">5 Years</option>
      <option value="auto">Auto (fit to maturity)</option>
    </select>
  </label>
</div>
<p class="decks-chart-description">
  Projection of how cards will progress to maturity over time based on current review pace.
  {#if isLoading}
    <span class="decks-loading-indicator">Calculating...</span>
  {:else if daysToMaturity !== null}
    <strong>All cards will be mature in approximately {daysToMaturity} days ({Math.round(daysToMaturity / 30.44)} months, {(daysToMaturity / 365.25).toFixed(1)} years)</strong> at current pace.
  {:else if maturityData && maturityData.length > 0}
    <strong>Full maturity will take longer than {selectedTimeframe === "auto" ? "10 years" : selectedTimeframe.replace("y", " year" + (selectedTimeframe === "1y" ? "" : "s"))}</strong> at current pace.
  {/if}
</p>
<div class="decks-maturity-chart">
  <canvas bind:this={canvas} height="400"></canvas>
</div>

<style>
  .decks-maturity-chart {
    width: 100%;
    height: 400px;
    margin: 1rem 0;
  }

  .decks-maturity-chart canvas {
    max-width: 100%;
    max-height: 400px;
  }

  .decks-chart-controls {
    display: flex;
    gap: 1rem;
    margin: 0.5rem 0;
    flex-wrap: wrap;
  }

  .decks-chart-controls label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 14px;
    color: var(--text-normal);
  }

  .decks-chart-controls select {
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    border-radius: 4px;
    cursor: pointer;
  }

  .decks-chart-controls select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-chart-description {
    margin: 0.5rem 0 1rem 0;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.5;
  }

  .decks-chart-description strong {
    color: var(--text-accent);
    font-weight: 600;
  }

  .decks-loading-indicator {
    color: var(--text-muted);
    font-style: italic;
  }
</style>
