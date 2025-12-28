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
  let fullMaturityData: Array<{
    date: string;
    newCards: number;
    learningCards: number;
    matureCards: number;
  }> | null = null; // Store full simulation data
  let daysToMaturity: number | null = null;
  let maintenanceLevel: number | null = null; // NEW: Percentage (0-100)
  let equilibriumDay: number | null = null; // NEW: Day index when equilibrium detected
  let totalCards = 0; // NEW: Total card count
  let lapseRate = 0; // NEW: Empirical lapse rate (0-100 for display)
  let theoreticalMaintenanceLevel = 0;
  let isLoading = false;

  onMount(async () => {
    // Always create chart, load data only if decks are selected
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
      isLoading = true;

      // Automatically determine simulation length based on equilibrium detection
      // Maximum 5 years (1825 days)
      const MAX_SIMULATION_DAYS = 1825;
      let simulationDays = 365; // Start with 1 year

      // Progressive simulation to find equilibrium
      let result = await statisticsService.simulateMaturityProgression(
        selectedDeckIds,
        simulationDays
      );

      // If equilibrium not detected, try progressively longer simulations
      if (result.equilibriumDetectedAt === null) {
        simulationDays = 730; // Try 2 years
        result = await statisticsService.simulateMaturityProgression(
          selectedDeckIds,
          simulationDays
        );

        if (result.equilibriumDetectedAt === null) {
          // Try full 5 years
          simulationDays = MAX_SIMULATION_DAYS;
          result = await statisticsService.simulateMaturityProgression(
            selectedDeckIds,
            simulationDays
          );
        }
      }

      // If equilibrium detected, add 10% buffer after equilibrium day (but cap at max)
      let displayDays = simulationDays;
      if (result.equilibriumDetectedAt !== null) {
        displayDays = Math.min(
          Math.ceil(result.equilibriumDetectedAt * 1.1),
          MAX_SIMULATION_DAYS
        );
      }

      // Store full simulation data and display the relevant portion
      fullMaturityData = result.dailySnapshots;
      maturityData = fullMaturityData.slice(0, displayDays + 1);
      maintenanceLevel = result.maintenanceLevel;
      equilibriumDay = result.equilibriumDetectedAt;
      totalCards = result.totalCards;
      lapseRate = result.empiricalLapseRate * 100; // Convert to percentage for display
      theoreticalMaintenanceLevel = result.theoreticalMaintenanceLevel;

      // Calculate days to maturity (when all cards are mature)
      daysToMaturity = calculateDaysToMaturity(fullMaturityData);

      logger.debug("[MaturityProgressionChart] Loaded maturity data:", {
        simulationDays,
        displayDays,
        dataPoints: maturityData.length,
        daysToMaturity,
        maintenanceLevel,
        equilibriumDay,
        totalCards,
        lapseRate,
      });
    } catch (error) {
      logger.error(
        "[MaturityProgressionChart] Error loading maturity data:",
        error
      );
      maturityData = [];
      fullMaturityData = [];
      daysToMaturity = null;
      maintenanceLevel = null;
      equilibriumDay = null;
      totalCards = 0;
      lapseRate = 0;
      theoreticalMaintenanceLevel = 0;
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
    // NOTE: With equilibrium detection, this may never happen if maintenance level > 0
    for (let i = 0; i < data.length; i++) {
      if (data[i].newCards === 0 && data[i].learningCards === 0) {
        return i;
      }
    }

    // If we never reach full maturity (e.g., due to maintenance level plateau), return null
    return null;
  }

  function formatDaysNaturally(days: number): string {
    if (days < 30) {
      return days === 1 ? "1 day" : `${days} days`;
    }

    const years = Math.floor(days / 365);
    const remainingDaysAfterYears = days % 365;
    const months = Math.floor(remainingDaysAfterYears / 30);
    const remainingDays = remainingDaysAfterYears % 30;

    const parts: string[] = [];

    if (years > 0) {
      parts.push(years === 1 ? "1 year" : `${years} years`);
    }

    if (months > 0) {
      parts.push(months === 1 ? "1 month" : `${months} months`);
    }

    if (remainingDays > 0 && years === 0) {
      // Only show remaining days if less than a year
      parts.push(remainingDays === 1 ? "1 day" : `${remainingDays} days`);
    }

    return parts.join(" and ");
  }

  function processChartData() {
    if (!maturityData || maturityData.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    // Sample data points if there are too many to prevent chart overflow
    // Target ~100-150 data points maximum for readability
    const maxDataPoints = 150;
    let sampledData = maturityData;

    if (maturityData.length > maxDataPoints) {
      const sampleInterval = Math.ceil(maturityData.length / maxDataPoints);
      sampledData = maturityData.filter(
        (_, index) => index % sampleInterval === 0
      );

      // Always include the last data point to show final state
      if (
        sampledData[sampledData.length - 1] !==
        maturityData[maturityData.length - 1]
      ) {
        sampledData.push(maturityData[maturityData.length - 1]);
      }
    }

    const labels = sampledData.map((d) => d.date);
    const newCards = sampledData.map((d) => d.newCards);
    const learningCards = sampledData.map((d) => d.learningCards);
    const matureCards = sampledData.map((d) => d.matureCards);

    const baseDatasets = [
      {
        label: "New Cards",
        data: newCards,
        backgroundColor: "rgba(59, 130, 246, 0.5)",
        borderColor: "rgb(59, 130, 246)",
        borderWidth: 1,
        fill: true,
        tension: 0.4,
        stack: "stack0",
        order: 2,
      },
      {
        label: "Learning Cards",
        data: learningCards,
        backgroundColor: "rgba(245, 158, 11, 0.5)",
        borderColor: "rgb(245, 158, 11)",
        borderWidth: 1,
        fill: true,
        tension: 0.4,
        stack: "stack0",
        order: 2,
      },
      {
        label: "Mature Cards",
        data: matureCards,
        backgroundColor: "rgba(34, 197, 94, 0.5)",
        borderColor: "rgb(34, 197, 94)",
        borderWidth: 1,
        fill: true,
        tension: 0.4,
        stack: "stack0",
        order: 2,
      },
    ];

    // Add maintenance level lines if equilibrium was detected
    if (maintenanceLevel !== null && totalCards > 0) {
      const standardMaintenanceCardCount = Math.round(
        (theoreticalMaintenanceLevel / 100) * totalCards
      );
      const standardMaintenanceLine = new Array(labels.length).fill(
        standardMaintenanceCardCount
      );

      baseDatasets.push({
        label: `Standard Maintenance Level (${Math.round(theoreticalMaintenanceLevel)}%)`,
        data: standardMaintenanceLine,
        borderColor: "rgba(168, 85, 247, 1)", // Bright purple for better visibility
        borderWidth: 3, // Same thickness as user's line
        borderDash: [4, 8], // Different dash pattern to differentiate
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        yAxisID: "y",
        type: "line",
        stack: "standard-maintenance", // Separate stack to prevent stacking with card counts
        order: 1,
      });

      // User's actual maintenance level (based on empirical retention rate)
      const maintenanceCardCount = Math.round(
        (maintenanceLevel / 100) * totalCards
      );
      const maintenanceLine = new Array(labels.length).fill(
        maintenanceCardCount
      );

      baseDatasets.push({
        label: `Your Maintenance Level (${Math.round(maintenanceLevel)}%)`,
        data: maintenanceLine,
        borderColor: "rgba(239, 68, 68, 1)", // Fully opaque red dashed line
        borderWidth: 3, // Thicker line to be more visible
        borderDash: [8, 4], // Longer dashes for better visibility
        fill: false,
        tension: 0,
        pointRadius: 0, // No points on the line
        pointHoverRadius: 0,
        yAxisID: "y",
        type: "line",
        stack: "personal-maintenance", // Separate stack to prevent stacking with card counts
        order: 1, // Draw on top (lower order = drawn later = on top)
      });
    }

    return {
      labels,
      datasets: baseDatasets,
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

                  const total = tooltipItems.reduce(
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
</script>

<div class="maturity-progression-chart-container">
  <h3>Maturity Progression Forecast</h3>
  <p class="decks-chart-subtitle">
    {#if selectedDeckIds.length === 0}
      <span class="decks-loading-indicator"
        >Select a deck to view maturity progression forecast.</span
      >
    {:else}
      Projection of how cards will progress to maturity over time based on
      current review pace.
      {#if isLoading}
        <span class="decks-loading-indicator">Calculating...</span>
      {:else if maintenanceLevel !== null && lapseRate > 0}
        <strong
          >Based on your historical retention rate of {Math.round(
            100 - lapseRate
          )}%, approximately {Math.round(maintenanceLevel)}% of cards (~{Math.round(
            (maintenanceLevel / 100) * totalCards
          )} cards) will always be in the learning phase due to natural lapses.</strong
        >
        {#if equilibriumDay !== null}
          Equilibrium reached in {formatDaysNaturally(equilibriumDay)}.
        {/if}
      {:else if daysToMaturity !== null}
        <strong
          >All cards will be mature in approximately {formatDaysNaturally(
            daysToMaturity
          )}</strong
        > at current pace.
      {/if}
    {/if}
  </p>

  <div class="chart-wrapper">
    <canvas bind:this={canvas}></canvas>
  </div>
</div>

<style>
  .maturity-progression-chart-container {
    margin: 1rem 0;
    padding: 1rem;
    background: var(--background-primary);
    border-radius: 8px;
  }

  .maturity-progression-chart-container h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .decks-chart-subtitle {
    margin: 0 0 1rem 0;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.5;
  }

  .decks-chart-subtitle strong {
    color: var(--text-accent);
    font-weight: 600;
  }

  .chart-wrapper {
    width: 100%;
    height: 400px;
    margin: 1.5rem 0;
    background: var(--background-secondary);
    border-radius: 8px;
    padding: 1rem;
  }

  .chart-wrapper canvas {
    max-width: 100%;
    max-height: 400px;
  }

  .decks-loading-indicator {
    color: var(--text-muted);
    font-style: italic;
  }
</style>
