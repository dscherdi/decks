<script lang="ts">
    import { onMount, onDestroy } from "svelte";

    export let getReviewCounts: (days: number) => Promise<Map<string, number>>;

    let reviewCounts = new Map<string, number>();
    let days: Array<{ date: string; count: number; dayOfWeek: number }> = [];
    let weeks: Array<
        Array<{ date: string; count: number; dayOfWeek: number }>
    > = [];
    let maxCount = 0;
    let isLoading = true;
    let containerElement: HTMLElement;
    let maxWeeks = 52; // Default to full year
    let containerWidth = 0;
    let currentYear = new Date().getFullYear();

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
        if (count === 0) return "intensity-0";
        const intensity = Math.min(Math.ceil((count / maxCount) * 4), 4);
        return `intensity-${intensity}`;
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
            weeks: Array<
                Array<{ date: string; count: number; dayOfWeek: number }>
            >;
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
                        if (
                            currentMonth !== -1 &&
                            currentMonthWeeks.length > 0
                        ) {
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
        refresh();
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

<div class="heatmap-container" bind:this={containerElement}>
    <div class="heatmap-header">
        <div class="header-left">
            <h4>Review Activity</h4>
            {#if !isLoading}
                <span class="total-reviews">
                    {Array.from(reviewCounts.values()).reduce(
                        (sum, count) => sum + count,
                        0,
                    )} reviews
                </span>
            {/if}
        </div>
        <div class="year-navigation">
            <button class="nav-button" on:click={() => navigateYear("prev")}>
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                >
                    <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                </svg>
            </button>
            <span class="current-year">{currentYear}</span>
            <button class="nav-button" on:click={() => navigateYear("next")}>
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                >
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                </svg>
            </button>
        </div>
    </div>

    {#if isLoading}
        <div class="loading">Loading...</div>
    {:else}
        <div class="heatmap">
            <div class="months-container">
                {#each getMonthsData() as { month, weeks: monthWeeks }}
                    <div class="month-container">
                        <div class="month-label">{month}</div>
                        <div class="month-grid">
                            {#each monthWeeks as week}
                                <div class="week">
                                    {#each week as day}
                                        {@const dayYear = new Date(
                                            day.date,
                                        ).getFullYear()}
                                        <div
                                            class="day {getIntensityClass(
                                                day.count,
                                            )}"
                                            class:today={isToday(day.date)}
                                            class:outside-year={dayYear !==
                                                currentYear}
                                            title="{day.count} reviews on {formatDate(
                                                day.date,
                                            )}"
                                        ></div>
                                    {/each}
                                </div>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>
        </div>

        <div class="legend">
            <span class="legend-label">Less</span>
            <div class="legend-colors">
                <div class="legend-square intensity-0"></div>
                <div class="legend-square intensity-1"></div>
                <div class="legend-square intensity-2"></div>
                <div class="legend-square intensity-3"></div>
                <div class="legend-square intensity-4"></div>
            </div>
            <span class="legend-label">More</span>
        </div>
    {/if}
</div>

<style>
    .heatmap-container {
        padding: 16px;
        border-top: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        display: flex;
        flex-direction: column;
        align-items: stretch;
    }

    .heatmap-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        width: 100%;
    }

    .header-left {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
    }

    .year-navigation {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .nav-button {
        background: none;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        padding: 4px;
        cursor: pointer;
        color: var(--text-muted);
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
    }

    .nav-button:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
        border-color: var(--text-muted);
    }

    .current-year {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-normal);
        min-width: 40px;
        text-align: center;
    }

    .heatmap-header h4 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-normal);
    }

    .total-reviews {
        font-size: 12px;
        color: var(--text-muted);
    }

    .loading {
        text-align: center;
        padding: 20px;
        color: var(--text-muted);
        font-size: 12px;
    }

    .heatmap {
        position: relative;
        margin-top: 12px;
        overflow-x: auto;
        overflow-y: hidden;
        max-width: 100%;
        padding-bottom: 8px;
        display: flex;
        /*justify-content: center;*/
    }

    .months-container {
        display: flex;
        gap: 16px;
        min-width: fit-content;
        align-items: flex-start;
    }

    .month-container {
        display: flex;
        flex-direction: column;
        gap: 4px;
        align-items: center;
    }

    .month-grid {
        display: flex;
        gap: 2px;
    }

    .month-labels {
        position: relative;
        height: 12px;
        margin-bottom: 2px;
        margin-left: 18px;
    }

    .month-label {
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

    .week {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .day {
        width: 10px;
        height: 10px;
        border-radius: 2px;
        cursor: pointer;
        transition: all 0.1s ease;
        flex-shrink: 0;
    }

    .day:hover {
        transform: scale(1.3);
        outline: 1px solid var(--text-muted);
        z-index: 10;
        position: relative;
    }

    .day.today {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 1px;
    }

    .day.today:hover {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 1px;
    }

    /* Intensity colors - GitHub style */
    .intensity-0 {
        background-color: var(--background-modifier-border);
    }

    .intensity-1 {
        background-color: #0e4429;
    }

    .intensity-2 {
        background-color: #006d32;
    }

    .intensity-3 {
        background-color: #26a641;
    }

    .intensity-4 {
        background-color: #39d353;
    }

    .legend {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
        margin-top: 6px;
    }

    .legend-label {
        font-size: 8px;
        color: var(--text-muted);
    }

    .legend-colors {
        display: flex;
        gap: 2px;
    }

    .legend-square {
        width: 10px;
        height: 10px;
        border-radius: 2px;
    }

    .day.outside-year {
        opacity: 0.3;
        pointer-events: none;
    }

    /* Custom scrollbar styling */
    .heatmap::-webkit-scrollbar {
        height: 8px;
    }

    .heatmap::-webkit-scrollbar-track {
        background: var(--background-primary);
        border-radius: 4px;
    }

    .heatmap::-webkit-scrollbar-thumb {
        background: var(--background-modifier-border);
        border-radius: 4px;
    }

    .heatmap::-webkit-scrollbar-thumb:hover {
        background: var(--text-muted);
    }

    /* Mobile responsive styles */
    @media (max-width: 768px) {
        .heatmap-container {
            padding: 8px;
        }

        .heatmap-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
        }

        .header-left {
            width: 100%;
        }

        .year-navigation {
            width: 100%;
        }

        .nav-button {
            padding: 6px;
            width: 36px;
            height: 36px;
        }

        .day-labels {
            left: 0;
        }

        .day-label {
            font-size: 8px;
        }

        .months-container {
            gap: 8px;
        }

        .month-label {
            font-size: 9px;
        }

        .heatmap::-webkit-scrollbar {
            height: 4px;
        }
    }

    @media (max-width: 480px) {
        .heatmap-container {
            padding: 6px;
        }

        .heatmap-header h4 {
            font-size: 14px;
        }

        .total-reviews {
            font-size: 10px;
        }

        .current-year {
            font-size: 12px;
            padding: 4px 8px;
        }

        .nav-button {
            padding: 4px;
            width: 28px;
            height: 28px;
        }

        .nav-button svg {
            width: 14px;
            height: 14px;
        }

        .month-label {
            font-size: 8px;
            min-width: 40px;
        }

        .day-label {
            font-size: 7px;
            width: 12px;
        }

        .day-labels {
            left: 0;
        }

        .months-container {
            gap: 6px;
        }

        .month-grid {
            gap: 1px;
        }

        .legend {
            margin-top: 8px;
        }

        .legend-label {
            font-size: 8px;
        }

        .legend-square {
            width: 8px;
            height: 8px;
        }

        .day {
            width: 8px;
            height: 8px;
            border-radius: 1px;
        }

        .week {
            gap: 1px;
        }
    }

    @media (max-width: 390px) {
        /* iPhone 12 Pro and similar 390px width phones */
        .heatmap-container {
            padding: 6px;
            max-width: 390px;
        }

        .heatmap-header {
            margin-bottom: 8px;
        }

        .heatmap-header h4 {
            font-size: 12px;
        }

        .total-reviews {
            font-size: 10px;
        }

        .current-year {
            font-size: 12px;
            min-width: 30px;
        }

        .nav-button {
            width: 24px;
            height: 24px;
            min-height: 24px;
            min-width: 24px;
        }

        .nav-button svg {
            width: 8px;
            height: 8px;
        }

        .month-label {
            font-size: 7px;
        }

        .day-label {
            font-size: 7px;
            width: 10px;
        }

        .day-labels {
            left: -12px;
        }

        .day {
            width: 7px;
            height: 7px;
        }

        .legend-square {
            width: 7px;
            height: 7px;
        }

        .legend-label {
            font-size: 6px;
        }

        .week {
            gap: 1px;
        }

        .heatmap-grid {
            gap: 1px;
            padding-right: 8px;
        }

        .heatmap {
            margin-top: 8px;
        }
    }
</style>
