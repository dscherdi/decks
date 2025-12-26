<script lang="ts">
  import { onMount } from "svelte";

  export let getReviewCounts: (days: number) => Promise<Map<string, number>>;

  let reviewCounts = new Map<string, number>();
  let days: Array<{ date: string; count: number; dayOfWeek: number }> = [];
  let weeks: Array<Array<{ date: string; count: number; dayOfWeek: number }>> =
    [];
  let maxCount = 0;
  let isLoading = true;
  let containerElement: HTMLElement;
  let maxWeeks = 52; // Default to full year
  let containerWidth = 0;
  let currentYear = new Date().getFullYear();

  // Track last event to prevent double execution
  let lastEventTime = 0;
  let lastEventType = "";

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  function generateDays() {
    // Always show full year from January 1 to December 31
    const yearStart = new Date(currentYear, 0, 1); // January 1st
    const yearEnd = new Date(currentYear, 11, 31); // December 31st

    // Start from Sunday of the week containing January 1st
    const startDate = new Date(yearStart);
    const startDayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - startDayOfWeek);

    // End on Saturday of the week containing December 31st
    const endDate = new Date(yearEnd);
    const endDayOfWeek = endDate.getDay();
    endDate.setDate(endDate.getDate() + (6 - endDayOfWeek));

    const daysArray: Array<{
      date: string;
      count: number;
      dayOfWeek: number;
    }> = [];
    const current = new Date(startDate);

    // Generate complete weeks but only include days within the selected year
    while (current <= endDate) {
      const dateStr = current.toISOString().split("T")[0];
      const currentDateYear = current.getFullYear();

      // Only include days that belong to the selected year
      if (currentDateYear === currentYear) {
        const count = reviewCounts.get(dateStr) || 0;

        daysArray.push({
          date: dateStr,
          count,
          dayOfWeek: current.getDay(),
        });

        if (count > maxCount) {
          maxCount = count;
        }
      } else {
        // Add placeholder for days outside the year to maintain grid structure
        daysArray.push({
          date: dateStr,
          count: 0,
          dayOfWeek: current.getDay(),
        });
      }

      current.setDate(current.getDate() + 1);
    }

    days = daysArray;

    // Group into weeks
    weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
  }

  function getIntensityClass(count: number): string {
    if (count === 0) return "decks-intensity-0";
    const intensity = Math.min(Math.ceil((count / maxCount) * 4), 4);
    return `decks-intensity-${intensity}`;
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function isToday(dateStr: string): boolean {
    const today = new Date().toISOString().split("T")[0];
    return dateStr === today;
  }

  function getMonthsData(): Array<{
    month: string;
    weeks: Array<Array<{ date: string; count: number; dayOfWeek: number }>>;
  }> {
    if (weeks.length === 0) return [];

    const monthsData: Array<{
      month: string;
      weeks: Array<Array<{ date: string; count: number; dayOfWeek: number }>>;
    }> = [];
    let currentMonth = -1;
    let currentMonthWeeks: Array<
      Array<{ date: string; count: number; dayOfWeek: number }>
    > = [];

    weeks.forEach((week) => {
      const firstDay = week[0];
      if (firstDay) {
        const date = new Date(firstDay.date);
        const month = date.getMonth();
        const year = date.getFullYear();

        // Only process weeks within the selected year
        if (year === currentYear) {
          if (month !== currentMonth) {
            // Save previous month if it exists
            if (currentMonth !== -1 && currentMonthWeeks.length > 0) {
              monthsData.push({
                month: months[currentMonth],
                weeks: currentMonthWeeks,
              });
            }

            // Start new month
            currentMonth = month;
            currentMonthWeeks = [week];
          } else {
            // Add week to current month
            currentMonthWeeks.push(week);
          }
        }
      }
    });

    // Don't forget the last month
    if (currentMonth !== -1 && currentMonthWeeks.length > 0) {
      monthsData.push({
        month: months[currentMonth],
        weeks: currentMonthWeeks,
      });
    }

    return monthsData;
  }

  function calculateMaxWeeks(width: number) {
    if (width === 0) return 20; // Not yet rendered

    const availableWidth = width - 50; // Account for padding and day labels
    const weekWidth = 12; // 10px square + 2px gap
    const calculatedWeeks = Math.floor(availableWidth / weekWidth);

    // Ensure we show at least 8 weeks (2 months) and at most 52 weeks (1 year)
    return Math.min(Math.max(calculatedWeeks, 8), 52);
  }

  // Reactive statement to update maxWeeks when container width changes
  $: if (containerWidth > 0) {
    const newMaxWeeks = calculateMaxWeeks(containerWidth);
    if (newMaxWeeks !== maxWeeks) {
      maxWeeks = newMaxWeeks;
      // Refresh with new week count
      refresh();
    }
  }

  function updateContainerWidth() {
    if (containerElement) {
      containerWidth = containerElement.clientWidth;
    }
  }

  function navigateYear(direction: "prev" | "next") {
    if (direction === "prev") {
      currentYear--;
    } else {
      currentYear++;
    }
    generateDays();
    refresh();
  }

  function handleTouchClick(callback: () => void, event: Event) {
    const now = Date.now();
    const eventType = event.type;

    // Prevent double execution within 100ms
    if (now - lastEventTime < 100 && lastEventType !== eventType) {
      return;
    }

    lastEventTime = now;
    lastEventType = eventType;

    callback();
  }

  export async function refresh() {
    isLoading = true;
    try {
      // Fetch full year data (365-366 days)
      reviewCounts = await getReviewCounts(366);
      maxCount = 0;
      generateDays();
    } catch (error) {
      console.error("Failed to load review counts:", error);
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    // Initial setup with proper timing
    setTimeout(() => {
      updateContainerWidth();
      refresh();
    }, 100);
  });
</script>

<div class="decks-heatmap-container" bind:this={containerElement}>
  <div class="decks-heatmap-header">
    <div class="decks-header-left">
      <h4>Review Activity</h4>
      {#if !isLoading}
        <span class="decks-total-reviews">
          {Array.from(reviewCounts.values()).reduce(
            (sum, count) => sum + count,
            0
          )} reviews
        </span>
      {/if}
    </div>
    <div class="decks-year-navigation">
      <button
        class="decks-nav-button"
        on:click={(e) => handleTouchClick(() => navigateYear("prev"), e)}
        on:touchend={(e) => handleTouchClick(() => navigateYear("prev"), e)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>
      <span class="decks-current-year">{currentYear}</span>
      <button
        class="decks-nav-button"
        on:click={(e) => handleTouchClick(() => navigateYear("next"), e)}
        on:touchend={(e) => handleTouchClick(() => navigateYear("next"), e)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
        </svg>
      </button>
    </div>
  </div>

  {#if isLoading}
    <div class="decks-loading">Loading...</div>
  {:else}
    <div class="decks-heatmap">
      <div class="decks-months-container">
        {#each getMonthsData() as { month, weeks: monthWeeks }}
          <div class="decks-month-container">
            <div class="decks-month-label">{month}</div>
            <div class="decks-month-grid">
              {#each monthWeeks as week}
                <div class="decks-week">
                  {#each week as day}
                    {@const dayYear = new Date(day.date).getFullYear()}
                    <div
                      class="decks-day {getIntensityClass(day.count)}"
                      class:decks-today={isToday(day.date)}
                      class:outside-year={dayYear !== currentYear}
                      title="{day.count} reviews on {formatDate(day.date)}"
                    ></div>
                  {/each}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <div class="decks-legend">
      <span class="decks-legend-label">Less</span>
      <div class="decks-legend-colors">
        <div class="decks-legend-square decks-intensity-0"></div>
        <div class="decks-legend-square decks-intensity-1"></div>
        <div class="decks-legend-square decks-intensity-2"></div>
        <div class="decks-legend-square decks-intensity-3"></div>
        <div class="decks-legend-square decks-intensity-4"></div>
      </div>
      <span class="decks-legend-label">More</span>
    </div>
  {/if}
</div>

<style>
  .decks-heatmap-container {
    padding: 12px;
    border-top: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    touch-action: manipulation;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }

  .decks-heatmap-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    width: 100%;
  }

  .decks-header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .decks-year-navigation {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .decks-nav-button {
    background: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 8px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .decks-nav-button:hover,
  .decks-nav-button:active {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
    border-color: var(--background-modifier-border-hover);
  }

  .decks-current-year {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-normal);
    min-width: 40px;
    text-align: center;
  }

  .decks-heatmap-header h4 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .decks-total-reviews {
    font-size: 12px;
    color: var(--text-muted);
  }

  .decks-loading {
    text-align: center;
    padding: 20px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .decks-heatmap {
    position: relative;
    margin-top: 12px;
    overflow-x: auto;
    overflow-y: hidden;
    max-width: 100%;
    padding-bottom: 8px;
    display: flex;
    /*justify-content: center;*/
  }

  .decks-months-container {
    display: flex;
    gap: 2px;
    min-width: fit-content;
    align-items: flex-start;
  }

  .decks-month-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
  }

  .decks-month-grid {
    display: flex;
    gap: 2px;
  }

  .decks-month-labels {
    position: relative;
    height: 12px;
    margin-bottom: 2px;
    margin-left: 18px;
  }

  .decks-month-label {
    font-size: 9px;
    color: var(--text-muted);
  }

  .day-labels {
    position: absolute;
    left: -18px;
    top: 16px;
  }

  .day-label {
    position: absolute;
    font-size: 9px;
    color: var(--text-muted);
    width: 16px;
    text-align: right;
  }

  .decks-week {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .decks-day {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.1s ease;
    flex-shrink: 0;
  }

  .decks-day:hover {
    transform: scale(1.3);
    outline: 1px solid var(--text-muted);
    z-index: 10;
    position: relative;
  }

  .decks-day.decks-today {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 1px;
  }

  .day.today:hover {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 1px;
  }

  /* Intensity colors - GitHub style */
  .decks-intensity-0 {
    background-color: var(--background-modifier-border);
  }

  .decks-intensity-1 {
    background-color: #0e4429;
  }

  .decks-intensity-2 {
    background-color: #006d32;
  }

  .decks-intensity-3 {
    background-color: #26a641;
  }

  .decks-intensity-4 {
    background-color: #39d353;
  }

  .decks-legend {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    margin-top: 6px;
  }

  .decks-legend-label {
    font-size: 8px;
    color: var(--text-muted);
  }

  .decks-legend-colors {
    display: flex;
    gap: 2px;
  }

  .decks-legend-square {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }

  .decks-day.outside-year {
    opacity: 0.3;
    pointer-events: none;
  }

  /* Custom scrollbar styling */
  .decks-heatmap::-webkit-scrollbar {
    height: 8px;
  }

  .decks-heatmap::-webkit-scrollbar-track {
    background: var(--background-primary);
    border-radius: 4px;
  }

  .decks-heatmap::-webkit-scrollbar-thumb {
    background: var(--background-modifier-border);
    border-radius: 4px;
  }

  .decks-heatmap::-webkit-scrollbar-thumb:hover {
    background: var(--text-muted);
  }

  /* Mobile responsive styles */
  @media (max-width: 768px) {
    .decks-heatmap-container {
      padding: 8px;
    }

    .decks-heatmap-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }

    .decks-header-left h4 {
      width: 100%;
    }

    .decks-year-navigation {
      width: 100%;
    }

    .decks-nav-button {
      padding: 6px;
      width: 44px;
      height: 44px;
      min-width: 44px;
      min-height: 44px;
    }

    .decks-day-labels {
      left: 0;
    }

    .decks-day-label {
      font-size: 8px;
    }

    .decks-months-container {
      gap: 2px;
    }

    .decks-month-label {
      font-size: 9px;
    }

    .decks-heatmap::-webkit-scrollbar {
      height: 4px;
    }
  }

  @media (max-width: 480px) {
    .decks-heatmap-container {
      padding: 6px;
    }

    .decks-heatmap-header h4 {
      font-size: 14px;
    }

    .decks-total-reviews {
      font-size: 10px;
    }

    .decks-current-year {
      font-size: 12px;
      padding: 4px 8px;
    }

    .decks-nav-button {
      padding: 4px;
      width: 40px;
      height: 40px;
      min-width: 40px;
      min-height: 40px;
    }

    .decks-nav-button svg {
      width: 14px;
      height: 14px;
    }

    .decks-month-label {
      font-size: 8px;
      min-width: 40px;
    }

    .decks-day-label {
      font-size: 7px;
      width: 12px;
    }

    .decks-day-labels {
      left: 0;
    }

    .decks-month-container {
      gap: 2px;
    }

    .decks-month-grid {
      gap: 1px;
    }

    .decks-legend {
      margin-top: 8px;
    }

    .decks-legend-label {
      font-size: 8px;
    }

    .decks-legend-square {
      width: 8px;
      height: 8px;
    }

    .decks-day {
      width: 8px;
      height: 8px;
      border-radius: 1px;
    }

    .decks-week {
      gap: 1px;
    }
  }

  @media (max-width: 390px) {
    /* iPhone 12 Pro and similar 390px width phones */
    .decks-heatmap-container {
      padding: 6px;
      max-width: 390px;
    }

    .decks-heatmap-header {
      margin-bottom: 8px;
    }

    .decks-heatmap-header h4 {
      font-size: 12px;
    }

    .decks-total-reviews {
      font-size: 10px;
    }

    .decks-current-year {
      font-size: 12px;
      min-width: 30px;
    }

    .decks-nav-button {
      width: 24px;
      height: 24px;
      min-height: 24px;
      min-width: 24px;
    }

    .decks-nav-button svg {
      width: 8px;
      height: 8px;
    }

    .decks-month-label {
      font-size: 7px;
    }

    .decks-day-label {
      font-size: 7px;
      width: 10px;
    }

    .decks-day-labels {
      left: -12px;
    }

    .decks-day {
      width: 7px;
      height: 7px;
    }

    .decks-legend-square {
      width: 7px;
      height: 7px;
    }

    .decks-legend-label {
      font-size: 6px;
    }

    .decks-week {
      gap: 1px;
    }

    .decks-heatmap-grid {
      gap: 1px;
      padding-right: 8px;
    }

    .decks-heatmap {
      margin-top: 8px;
    }
  }
</style>
