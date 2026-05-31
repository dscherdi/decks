<script lang="ts">
  import { onMount } from "svelte";
  import { StatisticsService } from "@/services/StatisticsService";
  import { Logger } from "@/utils/logging";
  import { I18n } from "@decks/core";

  const t = I18n.t;
  const YOUNG_MATURE_THRESHOLD = 21;

  export let selectedDeckIds: string[] = [];
  export let statisticsService: StatisticsService;
  export let logger: Logger;

  interface RetentionStats {
    young: { passed: number; total: number; rate: number };
    mature: { passed: number; total: number; rate: number };
    all: { passed: number; total: number; rate: number };
  }

  let retentionStats: RetentionStats = {
    young: { passed: 0, total: 0, rate: 0 },
    mature: { passed: 0, total: 0, rate: 0 },
    all: { passed: 0, total: 0, rate: 0 },
  };

  onMount(async () => {
    if (selectedDeckIds.length > 0) {
      await loadData();
    }
  });

  async function loadData() {
    try {
      retentionStats = await statisticsService.getTrueRetentionStats(selectedDeckIds);
      logger.debug("[TrueRetentionTable] Loaded retention stats:", retentionStats);
    } catch (error) {
      logger.error("[TrueRetentionTable] Error loading retention stats:", error);
      retentionStats = {
        young: { passed: 0, total: 0, rate: 0 },
        mature: { passed: 0, total: 0, rate: 0 },
        all: { passed: 0, total: 0, rate: 0 },
      };
    }
  }

  function formatRate(rate: number): string {
    return rate.toFixed(1) + "%";
  }
</script>

<div class="decks-true-retention-table">
  <h4>{t.statistics.trueRetentionTitle}</h4>
  {#if selectedDeckIds.length === 0}
    <p class="decks-chart-subtitle">
      <span class="decks-loading-indicator">{t.statistics.selectDeckRetention}</span>
    </p>
  {:else}
    <div class="decks-retention-description">
      {t.statistics.retentionDescription}
    </div>
  {/if}

  <div class="decks-retention-table-container">
    <table class="decks-retention-table">
    <thead>
      <tr>
        <th>{t.statistics.columnCardType}</th>
        <th>{t.statistics.columnPassed}</th>
        <th>{t.statistics.columnTotalLabel}</th>
        <th>{t.statistics.columnPassRate}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="decks-card-type young">{I18n.format(t.statistics.youngWithDays, { count: YOUNG_MATURE_THRESHOLD })}</td>
        <td class="decks-count">{retentionStats.young.passed}</td>
        <td class="decks-count">{retentionStats.young.total}</td>
        <td class="decks-rate young-rate"
          >{formatRate(retentionStats.young.rate)}</td
        >
      </tr>
      <tr>
        <td class="decks-card-type mature">{I18n.format(t.statistics.matureWithDays, { count: YOUNG_MATURE_THRESHOLD })}</td>
        <td class="decks-count">{retentionStats.mature.passed}</td>
        <td class="decks-count">{retentionStats.mature.total}</td>
        <td class="decks-rate mature-rate"
          >{formatRate(retentionStats.mature.rate)}</td
        >
      </tr>
      <tr class="decks-total-row">
        <td class="decks-card-type all">{t.statistics.allCards}</td>
        <td class="decks-count">{retentionStats.all.passed}</td>
        <td class="decks-count">{retentionStats.all.total}</td>
        <td class="decks-rate all-rate"
          >{formatRate(retentionStats.all.rate)}</td
        >
      </tr>
    </tbody>
    </table>
  </div>

  {#if selectedDeckIds.length > 0 && retentionStats.all.total === 0}
    <div class="decks-no-data">
      {t.statistics.noReviewDataYet}
    </div>
  {/if}
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

  .decks-true-retention-table {
    margin: 1rem 0;
    padding: 1rem;
    background-color: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
  }

  .decks-true-retention-table h4 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .decks-retention-description {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-bottom: 1rem;
    font-style: italic;
  }

  .decks-retention-table-container {
    overflow-x: auto;
  }

  .decks-retention-table {
    width: 100%;
    border-collapse: collapse;
    margin: 0;
  }

  .decks-retention-table th,
  .decks-retention-table td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--background-modifier-border-hover);
  }

  .decks-retention-table thead th {
    background-color: transparent;
    color: var(--text-muted);
    font-size: 0.85em;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-retention-table td {
    font-size: 0.9rem;
  }

  .decks-card-type {
    font-weight: 500;
  }

  .decks-card-type.young {
    color: var(--color-orange);
  }

  .decks-card-type.mature {
    color: var(--color-green);
  }

  .decks-card-type.all {
    color: var(--color-blue);
    font-weight: 600;
  }

  .decks-count {
    text-align: center;
    color: var(--text-normal);
  }

  .decks-rate {
    text-align: center;
    font-weight: 600;
  }

  .young-rate {
    color: var(--color-orange);
  }

  .mature-rate {
    color: var(--color-green);
  }

  .all-rate {
    color: var(--color-blue);
    font-size: 1rem;
  }

  .decks-total-row {
    border-top: 2px solid var(--background-modifier-border);
    background: var(--background-primary-alt);
  }

  .decks-total-row td {
    padding: 12px;
    font-weight: 600;
  }

  .decks-no-data {
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
    margin-top: 1rem;
    padding: 1rem;
    background: var(--background-primary);
    border-radius: 4px;
    border: 1px dashed var(--background-modifier-border);
  }

  /* Mobile responsive */
  @media (max-width: 480px) {
    .decks-retention-table th,
    .decks-retention-table td {
      padding: 6px 8px;
      font-size: 0.8rem;
    }

    .decks-retention-table th:first-child,
    .decks-retention-table td:first-child {
      min-width: 120px;
    }
  }
</style>
