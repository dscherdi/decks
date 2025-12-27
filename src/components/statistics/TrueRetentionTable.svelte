<script lang="ts">
  import { onMount } from "svelte";
  import { StatisticsService } from "@/services/StatisticsService";
  import { Logger } from "@/utils/logging";

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
    await loadData();
  });

  $: if (selectedDeckIds) {
    loadData();
  }

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
  <h4>True Retention</h4>
  <div class="decks-retention-description">
    Pass rates for review cards (rating ≥ Good). Cards with intervals > 1 day
    only.
  </div>

  <div class="decks-retention-table-container">
    <table class="decks-retention-table">
      <thead>
        <tr>
          <th>Card Type</th>
          <th>Passed</th>
          <th>Total</th>
          <th>Pass Rate</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="decks-card-type young">Young (&lt; 21 days)</td>
          <td class="decks-count">{retentionStats.young.passed}</td>
          <td class="decks-count">{retentionStats.young.total}</td>
          <td class="decks-rate young-rate"
            >{formatRate(retentionStats.young.rate)}</td
          >
        </tr>
        <tr>
          <td class="decks-card-type mature">Mature (≥ 21 days)</td>
          <td class="decks-count">{retentionStats.mature.passed}</td>
          <td class="decks-count">{retentionStats.mature.total}</td>
          <td class="decks-rate mature-rate"
            >{formatRate(retentionStats.mature.rate)}</td
          >
        </tr>
        <tr class="decks-total-row">
          <td class="decks-card-type all">All Cards</td>
          <td class="decks-count">{retentionStats.all.passed}</td>
          <td class="decks-count">{retentionStats.all.total}</td>
          <td class="decks-rate all-rate"
            >{formatRate(retentionStats.all.rate)}</td
          >
        </tr>
      </tbody>
    </table>
  </div>

  {#if retentionStats.all.total === 0}
    <div class="decks-no-data">
      No review data available yet. Complete some reviews to see retention
      statistics.
    </div>
  {/if}
</div>

<style>
  .decks-true-retention-table {
    margin: 1rem 0;
    padding: 1rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-secondary);
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
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-retention-table th {
    background: var(--background-primary);
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text-normal);
  }

  .decks-retention-table td {
    font-size: 0.9rem;
  }

  .decks-card-type {
    font-weight: 500;
  }

  .decks-card-type.young {
    color: #f59e0b;
  }

  .decks-card-type.mature {
    color: #22c55e;
  }

  .decks-card-type.all {
    color: var(--text-accent);
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
    color: #f59e0b;
  }

  .mature-rate {
    color: #22c55e;
  }

  .all-rate {
    color: var(--text-accent);
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
