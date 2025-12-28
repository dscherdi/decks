<script lang="ts">
  import type { Statistics } from "@/database/types";

  export let statistics: Statistics | null;
  export let todayStats: {
    reviews: number;
    timeSpent: number;
    newCards: number;
    reviewCards: number;
    correctRate: number;
  } | null = null;
  export let weekStats: {
    reviews: number;
    timeSpent: number;
    newCards: number;
    reviewCards: number;
    correctRate: number;
  } | null = null;
  export let monthStats: {
    reviews: number;
    timeSpent: number;
    newCards: number;
    reviewCards: number;
    correctRate: number;
  } | null = null;
  export let yearStats: {
    reviews: number;
    timeSpent: number;
    newCards: number;
    reviewCards: number;
    correctRate: number;
  } | null = null;

  function getDueToday(): number {
    if (!statistics?.dailyStats) return 0;
    const today = new Date().toISOString().split("T")[0];
    const todayStat = statistics.dailyStats.find((s) => s.date === today);
    return todayStat?.dueCards || 0;
  }

  function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }

  function formatPace(seconds: number): string {
    if (seconds < 1) return "<1s";
    return `${Math.round(seconds)}s`;
  }

  function formatPercentage(value: number): string {
    return `${Math.round(value, 2)}%`;
  }
</script>

<div class="decks-stats">
  <!-- Current Status -->
  <div class="decks-stats-section">
    <h3>Current Status</h3>
    <div class="decks-stats-grid">
      <div class="decks-stat-card">
        <div class="decks-stat-value">
          {statistics?.cardStats?.new || 0}
        </div>
        <div class="decks-stat-label">New Cards</div>
      </div>
      <div class="decks-stat-card">
        <div class="decks-stat-value" style="display: none;">0</div>
        <div class="decks-stat-label" style="display: none;">Learning</div>
      </div>
      <div class="decks-stat-card">
        <div class="decks-stat-value">
          {statistics?.cardStats?.review || 0}
        </div>
        <div class="decks-stat-label">Review</div>
      </div>
      <div class="decks-stat-card">
        <div class="decks-stat-value">
          {statistics?.cardStats?.mature || 0}
        </div>
        <div class="decks-stat-label">Mature</div>
      </div>
      <div class="decks-stat-card">
        <div class="decks-stat-value">{getDueToday()}</div>
        <div class="decks-stat-label">Due Today</div>
      </div>
    </div>
  </div>

  <!-- Review Pace -->
  <div class="decks-stats-section">
    <h3>Review Pace</h3>
    <div class="decks-stats-grid">
      <div class="decks-stat-card">
        <div class="decks-stat-value">
          {statistics?.averagePace ? formatPace(statistics.averagePace) : "N/A"}
        </div>
        <div class="decks-stat-label">Average per Card</div>
      </div>
      <div class="decks-stat-card">
        <div class="decks-stat-value">
          {statistics?.totalReviewTime
            ? formatTime(statistics.totalReviewTime)
            : "N/A"}
        </div>
        <div class="decks-stat-label">Total Time</div>
      </div>
      <div class="decks-stat-card">
        <div class="decks-stat-value">
          {statistics?.totalReviews || 0}
        </div>
        <div class="decks-stat-label">Total Reviews</div>
      </div>
    </div>
  </div>

  <!-- Time Period Statistics -->
  <div class="decks-stats-section">
    <h3>Activity Summary</h3>
    <div class="decks-timeframe-stats">
      {#if todayStats}
        <div class="decks-timeframe-card">
          <h4>Today</h4>
          <div class="decks-timeframe-grid">
            <div>
              <span class="decks-timeframe-value">{todayStats.reviews}</span>
              <span class="decks-timeframe-label">reviews</span>
            </div>
            <div>
              <span class="decks-timeframe-value"
                >{formatTime(todayStats.timeSpent)}</span
              >
              <span class="decks-timeframe-label">time</span>
            </div>
            <div>
              <span class="decks-timeframe-value"
                >{formatPercentage(todayStats.correctRate)}</span
              >
              <span class="decks-timeframe-label">correct</span>
            </div>
          </div>
        </div>
      {/if}

      {#if weekStats}
        <div class="decks-timeframe-card">
          <h4>This Week</h4>
          <div class="decks-timeframe-grid">
            <div>
              <span class="decks-timeframe-value">{weekStats.reviews}</span>
              <span class="decks-timeframe-label">reviews</span>
            </div>
            <div>
              <span class="decks-timeframe-value"
                >{formatTime(weekStats.timeSpent)}</span
              >
              <span class="decks-timeframe-label">time</span>
            </div>
            <div>
              <span class="decks-timeframe-value"
                >{formatPercentage(weekStats.correctRate)}</span
              >
              <span class="decks-timeframe-label">correct</span>
            </div>
          </div>
        </div>
      {/if}

      {#if monthStats}
        <div class="decks-timeframe-card">
          <h4>This Month</h4>
          <div class="decks-timeframe-grid">
            <div>
              <span class="decks-timeframe-value">{monthStats.reviews}</span>
              <span class="decks-timeframe-label">reviews</span>
            </div>
            <div>
              <span class="decks-timeframe-value"
                >{formatTime(monthStats.timeSpent)}</span
              >
              <span class="decks-timeframe-label">time</span>
            </div>
            <div>
              <span class="decks-timeframe-value"
                >{formatPercentage(monthStats.correctRate)}</span
              >
              <span class="decks-timeframe-label">correct</span>
            </div>
          </div>
        </div>
      {/if}

      {#if yearStats}
        <div class="decks-timeframe-card">
          <h4>This Year</h4>
          <div class="decks-timeframe-grid">
            <div>
              <span class="decks-timeframe-value">{yearStats.reviews}</span>
              <span class="decks-timeframe-label">reviews</span>
            </div>
            <div>
              <span class="decks-timeframe-value"
                >{formatTime(yearStats.timeSpent)}</span
              >
              <span class="decks-timeframe-label">time</span>
            </div>
            <div>
              <span class="decks-timeframe-value"
                >{formatPercentage(yearStats.correctRate)}</span
              >
              <span class="decks-timeframe-label">correct</span>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Answer Buttons -->
  <div class="decks-stats-section">
    <h3>Answer Buttons</h3>
    {#if statistics?.answerButtons && (statistics.answerButtons.again > 0 || statistics.answerButtons.hard > 0 || statistics.answerButtons.good > 0 || statistics.answerButtons.easy > 0)}
      <div class="decks-answer-buttons">
        <div class="decks-button-stat again">
          <div class="decks-button-label">Again</div>
          <div class="decks-button-value">
            {statistics.answerButtons.again}
          </div>
          <div class="decks-button-percentage">
            {formatPercentage(
              (statistics.answerButtons.again /
                (statistics.answerButtons.again +
                  statistics.answerButtons.hard +
                  statistics.answerButtons.good +
                  statistics.answerButtons.easy)) *
                100
            )}
          </div>
        </div>
        <div class="decks-button-stat hard">
          <div class="decks-button-label">Hard</div>
          <div class="decks-button-value">{statistics.answerButtons.hard}</div>
          <div class="decks-button-percentage">
            {formatPercentage(
              (statistics.answerButtons.hard /
                (statistics.answerButtons.again +
                  statistics.answerButtons.hard +
                  statistics.answerButtons.good +
                  statistics.answerButtons.easy)) *
                100
            )}
          </div>
        </div>
        <div class="decks-button-stat good">
          <div class="decks-button-label">Good</div>
          <div class="decks-button-value">{statistics.answerButtons.good}</div>
          <div class="decks-button-percentage">
            {formatPercentage(
              (statistics.answerButtons.good /
                (statistics.answerButtons.again +
                  statistics.answerButtons.hard +
                  statistics.answerButtons.good +
                  statistics.answerButtons.easy)) *
                100
            )}
          </div>
        </div>
        <div class="decks-button-stat easy">
          <div class="decks-button-label">Easy</div>
          <div class="decks-button-value">{statistics.answerButtons.easy}</div>
          <div class="decks-button-percentage">
            {formatPercentage(
              (statistics.answerButtons.easy /
                (statistics.answerButtons.again +
                  statistics.answerButtons.hard +
                  statistics.answerButtons.good +
                  statistics.answerButtons.easy)) *
                100
            )}
          </div>
        </div>
      </div>
    {:else}
      <div class="decks-no-data-message">
        <p>No answer button data available yet.</p>
        <p class="decks-help-text">
          Complete some reviews to see answer button statistics.
        </p>
      </div>
    {/if}
  </div>
</div>

<style>
  .decks-stats {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .decks-stats-section {
    background: var(--background-secondary);
    padding: 20px;
    border-radius: 10px;
  }

  .decks-stats-section h3 {
    margin: 0 0 16px 0;
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .decks-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px;
  }

  .decks-stat-card {
    background: var(--background-primary);
    padding: 16px;
    border-radius: 8px;
    text-align: center;
    border: 1px solid var(--background-modifier-border);
  }

  .decks-stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-accent);
    margin-bottom: 8px;
  }

  .decks-stat-label {
    font-size: 0.9rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .decks-timeframe-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }

  .decks-timeframe-card {
    background: var(--background-primary);
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
  }

  .decks-timeframe-card h4 {
    margin: 0 0 12px 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .decks-timeframe-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .decks-timeframe-grid > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .decks-timeframe-value {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .decks-timeframe-label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .decks-answer-buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
  }

  .decks-button-stat {
    background: var(--background-primary);
    padding: 16px;
    border-radius: 8px;
    text-align: center;
    border: 2px solid;
  }

  .decks-button-stat.again {
    border-color: #ef4444;
  }

  .decks-button-stat.hard {
    border-color: #f59e0b;
  }

  .decks-button-stat.good {
    border-color: #10b981;
  }

  .decks-button-stat.easy {
    border-color: #3b82f6;
  }

  .decks-button-label {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .decks-button-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-normal);
    margin-bottom: 4px;
  }

  .decks-button-percentage {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .decks-no-data-message {
    text-align: center;
    padding: 32px;
    color: var(--text-muted);
  }

  .decks-no-data-message p {
    margin: 8px 0;
  }

  .decks-help-text {
    font-size: 0.9rem;
    font-style: italic;
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .decks-stats-grid {
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    }

    .decks-timeframe-stats {
      grid-template-columns: 1fr;
    }

    .decks-answer-buttons {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
