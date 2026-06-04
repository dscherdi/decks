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
    type ChartDataset,
  } from "chart.js";
  import { StatisticsService } from "@/services/StatisticsService";
  import { Logger } from "@/utils/logging";
  import { I18n } from "@decks/core";
  import {
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
      theoreticalMaintenanceLevel = result.theoreticalMaintenanceLevel ?? 0;

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

    const blueColor = getObsidianColor(PALETTE.blue);
    const orangeColor = getObsidianColor(PALETTE.orange);
    const greenColor = getObsidianColor(PALETTE.green);

    const baseDatasets: ChartDataset<"bar" | "line">[] = [
      {
        label: t.statistics.newCardsLabel,
        data: newCards,
        backgroundColor: withAlpha(PALETTE.blue, 0.4),
        borderColor: blueColor,
        borderWidth: 1,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        stack: "stack0",
        order: 2,
      },
      {
        label: t.statistics.learningCardsLabel,
        data: learningCards,
        backgroundColor: withAlpha(PALETTE.orange, 0.4),
        borderColor: orangeColor,
        borderWidth: 1,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        stack: "stack0",
        order: 2,
      },
      {
        label: t.statistics.matureCardsLabel,
        data: matureCards,
        backgroundColor: withAlpha(PALETTE.green, 0.4),
        borderColor: greenColor,
        borderWidth: 1,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
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
        label: I18n.format(t.statistics.standardMaintenanceLine, {
          percent: Math.round(theoreticalMaintenanceLevel),
        }),
        data: standardMaintenanceLine,
        backgroundColor: "transparent",
        borderColor: getObsidianColor(PALETTE.purple),
        borderWidth: 3,
        borderDash: [4, 8],
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        yAxisID: "y",
        type: "line",
        stack: "standard-maintenance",
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
        label: I18n.format(t.statistics.yourMaintenanceLine, {
          percent: Math.round(maintenanceLevel),
        }),
        data: maintenanceLine,
        backgroundColor: "transparent",
        borderColor: getObsidianColor(PALETTE.red),
        borderWidth: 3,
        borderDash: [8, 4],
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        yAxisID: "y",
        type: "line",
        stack: "personal-maintenance",
        order: 1,
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
              text: t.statistics.cardMaturityProgression,
            },
            legend: {
              display: true,
              position: "bottom",
            },
            tooltip: {
              ...getNativeTooltip(),
              callbacks: {
                footer: function (tooltipItems) {
                  if (tooltipItems.length === 0) return "";

                  const total = tooltipItems.reduce(
                    (sum, item) => sum + (item.raw as number),
                    0
                  );
                  return I18n.format(t.statistics.maturityTotalCards, { count: total });
                },
              },
            },
          },
          scales: {
            x: {
              ...getCategoryXAxis(),
              title: {
                display: true,
                text: t.statistics.daysFromNow,
              },
            },
            y: {
              ...getLinearYAxis(),
              stacked: true,
              title: {
                display: true,
                text: t.statistics.numberOfCards,
              },
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
  <h3>{t.statistics.maturityForecast}</h3>
  <p class="decks-chart-subtitle">
    {#if selectedDeckIds.length === 0}
      <span class="decks-loading-indicator"
        >{t.statistics.selectDeckMaturity}</span
      >
    {:else}
      {t.statistics.maturitySubtitle}
      {#if isLoading}
        <span class="decks-loading-indicator">{t.statistics.calculating}</span>
      {:else if maintenanceLevel !== null && lapseRate > 0}
        <strong
          >{I18n.format(t.statistics.maturityRetentionDetail, {
            retention: Math.round(100 - lapseRate),
            maintenance: Math.round(maintenanceLevel),
            count: Math.round((maintenanceLevel / 100) * totalCards),
          })}</strong
        >
        {#if equilibriumDay !== null}
          {I18n.format(t.statistics.maturityEquilibrium, { days: formatDaysNaturally(equilibriumDay) })}
        {/if}
      {:else if daysToMaturity !== null}
        <strong
          >{I18n.format(t.statistics.maturityAllMatureAtPace, {
            days: formatDaysNaturally(daysToMaturity),
          })}</strong
        >
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
