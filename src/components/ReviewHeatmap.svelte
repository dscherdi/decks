<script lang="ts">
    import { onMount, onDestroy } from "svelte";

    export let getReviewCounts: () => Promise<Map<string, number>>;

    let reviewCounts = new Map<string, number>();
    let days: Array<{ date: string; count: number; dayOfWeek: number }> = [];
    let weeks: Array<
        Array<{ date: string; count: number; dayOfWeek: number }>
    > = [];
    let maxCount = 0;
    let isLoading = true;
    let containerElement: HTMLElement;
    let maxWeeks = 52; // Default to full year

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
        const today = new Date();

        // Start from Sunday of the current week
        const currentWeekStart = new Date(today);
        const currentDayOfWeek = today.getDay();
        currentWeekStart.setDate(today.getDate() - currentDayOfWeek);

        // Go back the desired number of weeks, but end at current week
        const startDate = new Date(currentWeekStart);
        startDate.setDate(currentWeekStart.getDate() - (maxWeeks - 1) * 7);

        const daysArray: Array<{
            date: string;
            count: number;
            dayOfWeek: number;
        }> = [];
        const current = new Date(startDate);

        // Generate complete weeks up to and including current week
        const endDate = new Date(currentWeekStart);
        endDate.setDate(currentWeekStart.getDate() + 6); // End of current week

        while (current <= endDate) {
            const dateStr = current.toISOString().split("T")[0];
            const count = reviewCounts.get(dateStr) || 0;

            daysArray.push({
                date: dateStr,
                count,
                dayOfWeek: current.getDay(),
            });

            if (count > maxCount) {
                maxCount = count;
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

    function getMonthLabels(): Array<{ month: string; offset: number }> {
        if (weeks.length === 0) return [];

        const labels: Array<{ month: string; offset: number }> = [];
        let currentMonth = -1;

        weeks.forEach((week, weekIndex) => {
            const firstDay = week[0];
            if (firstDay) {
                const date = new Date(firstDay.date);
                const month = date.getMonth();

                if (month !== currentMonth) {
                    currentMonth = month;
                    labels.push({
                        month: months[month],
                        offset: weekIndex * 12, // 12px per week (10px square + 2px gap)
                    });
                }
            }
        });

        return labels;
    }

    function calculateMaxWeeks() {
        if (!containerElement) return 20; // Conservative default

        const containerWidth = containerElement.clientWidth;
        if (containerWidth === 0) return 20; // Not yet rendered

        const availableWidth = containerWidth - 50; // Account for padding and day labels
        const weekWidth = 12; // 10px square + 2px gap
        const calculatedWeeks = Math.floor(availableWidth / weekWidth);

        // Ensure we show at least 8 weeks (2 months) and at most 52 weeks (1 year)
        return Math.min(Math.max(calculatedWeeks, 8), 52);
    }

    function handleResize() {
        const newMaxWeeks = calculateMaxWeeks();
        if (newMaxWeeks !== maxWeeks && newMaxWeeks > 0) {
            maxWeeks = newMaxWeeks;
            // Debounce the refresh to avoid too many updates
            setTimeout(() => {
                refresh();
            }, 100);
        }
    }

    export async function refresh() {
        isLoading = true;
        try {
            const daysToFetch = maxWeeks * 7;
            reviewCounts = await getReviewCounts(daysToFetch);
            maxCount = 0;
            generateDays();
        } catch (error) {
            console.error("Failed to load review counts:", error);
        } finally {
            isLoading = false;
        }
    }

    onMount(() => {
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
            maxWeeks = calculateMaxWeeks();
            refresh();
        }, 0);

        // Use ResizeObserver for better container resize detection
        let resizeObserver: ResizeObserver;

        if (containerElement && window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                handleResize();
            });
            resizeObserver.observe(containerElement);
        } else {
            // Fallback to window resize
            window.addEventListener("resize", handleResize);
        }

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            } else {
                window.removeEventListener("resize", handleResize);
            }
        };
    });
</script>

<div class="heatmap-container" bind:this={containerElement}>
    <div class="heatmap-header">
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

    {#if isLoading}
        <div class="loading">Loading...</div>
    {:else}
        <div class="heatmap">
            <div class="month-labels">
                {#each getMonthLabels() as { month, offset }}
                    <span class="month-label" style="left: {offset}px"
                        >{month}</span
                    >
                {/each}
            </div>

            <div class="day-labels">
                <span class="day-label" style="top: 0px">S</span>
                <span class="day-label" style="top: 18px">T</span>
                <span class="day-label" style="top: 36px">T</span>
                <span class="day-label" style="top: 54px">S</span>
            </div>

            <div class="heatmap-grid">
                {#each weeks as week}
                    <div class="week">
                        {#each week as day}
                            <div
                                class="day {getIntensityClass(day.count)}"
                                class:today={isToday(day.date)}
                                title="{day.count} reviews on {formatDate(
                                    day.date,
                                )}"
                            ></div>
                        {/each}
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
        align-items: center;
    }

    .heatmap-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        width: 100%;
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
    }

    .month-labels {
        position: relative;
        height: 12px;
        margin-bottom: 2px;
        margin-left: 18px;
    }

    .month-label {
        position: absolute;
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

    .heatmap-grid {
        display: flex;
        gap: 2px;
        min-width: fit-content;
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

    /* Dark mode adjustments */
    .theme-dark .intensity-0 {
        background-color: #161b22;
    }

    .theme-dark .intensity-1 {
        background-color: #0e4429;
    }

    .theme-dark .intensity-2 {
        background-color: #006d32;
    }

    .theme-dark .intensity-3 {
        background-color: #26a641;
    }

    .theme-dark .intensity-4 {
        background-color: #39d353;
    }

    /* Light mode adjustments */
    .theme-light .intensity-0 {
        background-color: #ebedf0;
    }

    .theme-light .intensity-1 {
        background-color: #9be9a8;
    }

    .theme-light .intensity-2 {
        background-color: #40c463;
    }

    .theme-light .intensity-3 {
        background-color: #30a14e;
    }

    .theme-light .intensity-4 {
        background-color: #216e39;
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
</style>
