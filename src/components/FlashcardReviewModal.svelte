<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, tick } from "svelte";
    import type { Deck, Flashcard } from "../database/types";
    import type { FlashcardsSettings } from "../settings";
    import { FSRS, type RatingLabel } from "../algorithm/fsrs";
    import type {
        Scheduler,
        SchedulingPreview,
        SessionProgress,
    } from "../services/Scheduler";
    import { yieldToUI } from "@/utils/ui";

    export let deck: Deck;
    export let initialCard: Flashcard | null = null;
    export let onReview: (
        card: Flashcard,
        rating: RatingLabel,
        timeElapsed?: number,
    ) => Promise<void>;
    export let renderMarkdown: (
        content: string,
        el: HTMLElement,
        deckFilePath: string | undefined,
    ) => void;
    export let settings: FlashcardsSettings;
    export let scheduler: Scheduler;
    export let onCardReviewed:
        | ((reviewedCard: Flashcard) => Promise<void>)
        | undefined = undefined;

    const dispatch = createEventDispatcher();

    let showAnswer = false;
    let isLoading = false;
    let reviewFinished = false;
    let frontEl: HTMLElement;
    let backEl: HTMLElement;
    let schedulingInfo: SchedulingPreview | null = null;
    let reviewedCount = 0;
    let cardStartTime: number = 0;
    let currentCard: Flashcard | null = initialCard;
    let sessionId: string | null = null;
    let deckFilePath: string = "";
    let sessionProgress: SessionProgress | null = null;

    // Session timer variables
    let sessionStartTime: number = 0;
    let sessionTimeRemaining: number = 0;
    let sessionTimer: NodeJS.Timeout | null = null;

    // Track last event to prevent double execution
    let lastEventTime = 0;
    let lastEventType = "";

    $: progress = sessionProgress ? sessionProgress.progress : 0;
    $: timeRemainingDisplay = formatTimeRemaining(sessionTimeRemaining);

    onMount(async () => {
        // Initialize review session
        var { sessionId, deckFilePath } = await scheduler.startFreshSession(
            deck.id,
            new Date(),
            settings.review.sessionDuration,
        );
        scheduler.setCurrentSession(sessionId);
        sessionProgress = await scheduler.getSessionProgress(sessionId);

        // Initialize session timer
        startSessionTimer();

        // If no initial card provided, get the first card from scheduler
        if (!currentCard) {
            currentCard = await scheduler.getNext(new Date(), deck.id, {
                allowNew: true,
            });
        }

        if (currentCard) {
            await loadCard();
        } else {
            await endReview();
        }

        // Add keydown event listener
        window.addEventListener("keydown", handleKeydown);
    });

    async function loadCard() {
        if (!currentCard) return;

        showAnswer = false;
        try {
            schedulingInfo = await scheduler.preview(currentCard.id);
        } catch (error) {
            console.error("Error getting scheduling preview:", error);
            schedulingInfo = null;
        }
        cardStartTime = Date.now(); // Track when card is displayed

        // Render front side
        if (frontEl) {
            frontEl.empty();
            renderMarkdown(currentCard.front, frontEl, deckFilePath);
        }

        // Pre-render back side but keep it hidden
        // Use tick() to ensure DOM is updated before rendering
        tick().then(() => {
            if (backEl && currentCard) {
                backEl.empty();
                console.log(currentCard.back);
                renderMarkdown(currentCard.back, backEl, deckFilePath);
            }
        });
    }

    function revealAnswer() {
        showAnswer = true;
        // Ensure back element is rendered after showAnswer becomes true
        tick().then(() => {
            if (backEl && currentCard) {
                backEl.empty();
                renderMarkdown(currentCard.back, backEl, deckFilePath);
            }
        });
    }

    async function handleReview(rating: RatingLabel) {
        if (!currentCard || isLoading) return;

        isLoading = true;
        try {
            const timeElapsed = Date.now() - cardStartTime;
            await onReview(currentCard, rating, timeElapsed);
            reviewedCount++;

            // Update session progress after review
            if (sessionId) {
                sessionProgress = await scheduler.getSessionProgress(sessionId);
            }

            // Trigger stats refresh after each card review
            if (onCardReviewed) {
                await onCardReviewed(currentCard);
                await yieldToUI();
            }

            // Get the next card from the scheduler
            currentCard = await scheduler.getNext(new Date(), deck.id, {
                allowNew: true,
            });
            await yieldToUI();

            if (currentCard) {
                await loadCard();
            } else {
                await endReview();
            }
        } catch (error) {
            console.error("Error reviewing card:", error);
        } finally {
            isLoading = false;
        }
    }

    function getIntervalDisplay(minutes: number): string {
        if (minutes < 60) {
            return `${Math.round(minutes)}m`;
        } else if (minutes < 1440) {
            const hours = Math.round(minutes / 60);
            return `${hours}h`;
        } else {
            const days = Math.round(minutes / 1440);
            return `${days}d`;
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (isLoading) return;

        const now = Date.now();
        const eventType = "keyboard";

        // Prevent double execution within 100ms (same as touch protection)
        if (now - lastEventTime < 100 && lastEventType === eventType) {
            return;
        }

        if (!showAnswer && event.key === " ") {
            event.preventDefault();
            lastEventTime = now;
            lastEventType = eventType;
            revealAnswer();
        } else if (showAnswer) {
            // Update timing before handling review
            lastEventTime = now;
            lastEventType = eventType;

            switch (event.key) {
                case "1":
                    handleReview("again");
                    break;
                case "2":
                    handleReview("hard");
                    break;
                case "3":
                case " ":
                    handleReview("good");
                    break;
                case "4":
                    handleReview("easy");
                    break;
            }
        }
    }

    async function rate(v: 1 | 2 | 3 | 4) {
        if (v === 1) await handleReview("again");
        else if (v === 2) await handleReview("hard");
        else if (v === 3) await handleReview("good");
        else if (v === 4) await handleReview("easy");
    }

    const onShowAnswer = async (e: PointerEvent) => {
        e.preventDefault();
        revealAnswer();
        await yieldToUI();
    };

    const onRating = async (e: PointerEvent, v: 1 | 2 | 3 | 4) => {
        e.preventDefault();
        await rate(v);
        await yieldToUI();
    };

    onDestroy(async () => {
        // Clean up keydown event listener
        window.removeEventListener("keydown", handleKeydown);

        // Clean up session timer
        if (sessionTimer) {
            clearInterval(sessionTimer);
            sessionTimer = null;
        }

        // Review session complete
        await endReview();
    });

    const endReview = async () => {
        if (reviewFinished) return;

        // Clean up session timer
        if (sessionTimer) {
            clearInterval(sessionTimer);
            sessionTimer = null;
        }

        // End the review session
        if (sessionId) {
            await scheduler.endReviewSession(sessionId);
            scheduler.setCurrentSession(null);
        }

        dispatch("complete", {
            reason: "end-review",
            reviewed: sessionProgress
                ? sessionProgress.doneUnique
                : reviewedCount,
        });
        reviewFinished = true;
    };

    function startSessionTimer() {
        const sessionDurationMs = settings.review.sessionDuration * 60 * 1000; // Convert minutes to milliseconds
        sessionStartTime = Date.now();
        sessionTimeRemaining = sessionDurationMs;

        // Update timer every second
        sessionTimer = setInterval(() => {
            const elapsed = Date.now() - sessionStartTime;
            sessionTimeRemaining = Math.max(0, sessionDurationMs - elapsed);

            // Auto-close when time is up
            if (sessionTimeRemaining <= 0) {
                endReview();
            }
        }, 1000);
    }

    function formatTimeRemaining(ms: number): string {
        const totalSeconds = Math.ceil(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    $: if (currentCard) {
        loadCard();
    }
</script>

<div class="decks-review-modal">
    <div class="decks-modal-header">
        <h3>Review Session - {deck.name}</h3>
        <div class="decks-header-stats">
            <div class="decks-progress-info">
                <span
                    >Reviewed: {sessionProgress
                        ? sessionProgress.doneUnique
                        : reviewedCount}</span
                >
                <span class="decks-remaining"
                    >({sessionProgress
                        ? `${sessionProgress.goalTotal - sessionProgress.doneUnique} remaining`
                        : currentCard
                          ? "More cards available"
                          : "Session complete"})</span
                >
            </div>
            <div class="decks-timer-display">
                <span class="decks-timer-label">Time Remaining:</span>
                <span
                    class="decks-timer-value"
                    class:decks-timer-warning={sessionTimeRemaining < 60000}
                >
                    {timeRemainingDisplay}
                </span>
            </div>
        </div>
    </div>

    {#if settings?.review?.showProgress !== false}
        <div class="decks-review-progress-bar">
            <div class="decks-progress-fill" style="width: {progress}%"></div>
        </div>
    {/if}

    {#if currentCard}
        <div class="decks-card-content">
            <div class="decks-question-section">
                <div
                    class="decks-card-side decks-front"
                    bind:this={frontEl}
                ></div>
            </div>

            <div class="decks-answer-section" class:hidden={!showAnswer}>
                <div class="decks-separator"></div>
                <div
                    class="decks-card-side decks-back"
                    bind:this={backEl}
                ></div>
            </div>
        </div>

        <div class="decks-action-buttons">
            {#if !showAnswer}
                <button
                    class="decks-show-answer-button"
                    disabled={isLoading}
                    on:pointerup={async (e) => await onShowAnswer(e)}
                    style="touch-action: manipulation;"
                    type="button"
                >
                    <span>Show Answer</span>
                    <span class="decks-shortcut">Space</span>
                </button>
            {/if}

            {#if showAnswer && schedulingInfo}
                <div class="decks-difficulty-buttons">
                    <button
                        class="decks-difficulty-button decks-again decks-rate-btn"
                        disabled={isLoading}
                        on:pointerup={async (e) => await onRating(e, 1)}
                        style="touch-action: manipulation;"
                        type="button"
                    >
                        <div class="decks-button-label">Again</div>
                        <div class="decks-interval">
                            {getIntervalDisplay(schedulingInfo.again.interval)}
                        </div>
                        <div class="decks-shortcut">1</div>
                    </button>

                    <button
                        class="decks-difficulty-button decks-hard decks-rate-btn"
                        on:pointerup={async (e) => await onRating(e, 2)}
                        style="touch-action: manipulation;"
                        disabled={isLoading}
                        type="button"
                    >
                        <div class="decks-button-label">Hard</div>
                        <div class="decks-interval">
                            {getIntervalDisplay(schedulingInfo.hard.interval)}
                        </div>
                        <div class="decks-shortcut">2</div>
                    </button>

                    <button
                        class="decks-difficulty-button decks-good decks-rate-btn"
                        on:pointerup={async (e) => await onRating(e, 3)}
                        disabled={isLoading}
                        type="button"
                    >
                        <div class="decks-button-label">Good</div>
                        <div class="decks-interval">
                            {getIntervalDisplay(schedulingInfo.good.interval)}
                        </div>
                        <div class="decks-shortcut">3</div>
                    </button>

                    <button
                        class="decks-difficulty-button decks-easy decks-rate-btn"
                        on:pointerup={async (e) => await onRating(e, 4)}
                        disabled={isLoading}
                        type="button"
                    >
                        <div class="decks-button-label">Easy</div>
                        <div class="decks-interval">
                            {getIntervalDisplay(schedulingInfo.easy.interval)}
                        </div>
                        <div class="decks-shortcut">4</div>
                    </button>
                </div>
            {/if}
        </div>
    {:else}
        <div class="decks-empty-state">
            <p>No cards to review</p>
        </div>
    {/if}
</div>

<style>
    .decks-review-modal {
        display: flex;
        flex-direction: column;
        height: 98%;
        background: var(--background-primary);
        color: var(--text-normal);
        overflow: hidden;
        width: 100%;
        margin-top: 15px;
        justify-content: space-between;
    }

    .decks-modal-header {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 16px 20px;
        border-bottom: 1px solid var(--background-modifier-border);
    }

    .decks-modal-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
    }

    .decks-header-stats {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
    }

    .decks-progress-info {
        display: flex;
        gap: 8px;
        font-size: 14px;
    }

    .decks-timer-display {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 14px;
    }

    .decks-timer-label {
        color: var(--text-muted);
    }

    .decks-timer-value {
        font-weight: 600;
        color: var(--text-normal);
        font-family: monospace;
    }

    .decks-timer-value.decks-timer-warning {
        color: var(--text-error);
    }

    .decks-remaining {
        color: var(--text-muted);
    }

    .decks-review-progress-bar {
        height: 4px;
        background: var(--background-modifier-border);
        position: relative;
    }

    .decks-progress-fill {
        height: 100%;
        background: var(--interactive-accent);
        transition: width 0.3s ease;
    }

    .decks-card-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 32px 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 24px;
        width: 100%;
        box-sizing: border-box;
        min-height: 0;
    }

    .decks-question-section,
    .decks-answer-section {
        width: 100%;
        display: flex;
        justify-content: center;
    }

    .decks-card-side {
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        padding: 24px;
        min-height: 100px;
        width: 100%;
        max-width: 900px;
        box-sizing: border-box;
        word-wrap: break-word;
        overflow-wrap: break-word;
    }

    .decks-card-side.decks-front {
        text-align: center;
        font-size: 20px;
        font-weight: 500;
    }

    .decks-card-side.decks-back {
        font-size: 16px;
        line-height: 1.6;
    }

    .decks-answer-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    }

    .decks-answer-section.hidden {
        display: none;
    }

    .decks-separator {
        height: 1px;
        background: var(--background-modifier-border);
        margin: 16px auto;
        width: 100%;
        max-width: 600px;
    }

    .decks-action-buttons {
        padding: 20px;
        border-top: 1px solid var(--background-modifier-border);
        flex-shrink: 0;
        width: 100%;
        box-sizing: border-box;
    }

    .decks-show-answer-button {
        width: 100%;
        max-width: 400px;
        margin: 0 auto;
        padding: 12px 24px;
        min-height: 44px;
        min-width: 44px;
        font-size: 16px;
        font-weight: 500;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border: none;
        pointer-events: auto !important;
        touch-action: manipulation;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        box-sizing: border-box;
        min-height: 48px;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
        user-select: none;
    }

    .decks-show-answer-button:hover,
    .decks-show-answer-button:active {
        background: var(--interactive-accent-hover);
    }

    .decks-shortcut {
        font-size: 12px;
        opacity: 0.8;
        padding: 2px 6px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
        margin-left: 8px;
        display: inline-block;
    }

    .decks-difficulty-buttons {
        display: flex;
        gap: 8px;
        justify-content: center;
        flex-wrap: nowrap;
        padding: 0 10px;
        box-sizing: border-box;
        width: 100%;
        max-width: 600px;
        margin: 0 auto;
    }

    .decks-difficulty-button,
    .decks-rate-btn {
        flex: 1;
        min-width: 44px;
        min-height: 44px;
        padding: 12px 8px;
        pointer-events: auto !important;
        touch-action: manipulation !important;
        border: 2px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        text-align: center;
        overflow: hidden;
        opacity: 1 !important;
        -webkit-tap-highlight-color: transparent !important;
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        user-select: none;
    }

    .decks-difficulty-button:hover,
    .decks-difficulty-button:active {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .decks-difficulty-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
    }

    .decks-difficulty-button.decks-again {
        border-color: #e74c3c;
    }

    .decks-difficulty-button.decks-again:hover,
    .decks-difficulty-button.decks-again:active {
        background: #e74c3c;
        color: white;
    }

    .decks-difficulty-button.decks-hard {
        border-color: #f39c12;
    }

    .decks-difficulty-button.decks-hard:hover,
    .decks-difficulty-button.decks-hard:active {
        background: #f39c12;
        color: white;
    }

    .decks-difficulty-button.decks-good {
        border-color: #27ae60;
    }

    .decks-difficulty-button.decks-good:hover,
    .decks-difficulty-button.decks-good:active {
        background: #27ae60;
        color: white;
    }

    .decks-difficulty-button.decks-easy {
        border-color: #3498db;
    }

    .decks-difficulty-button.decks-easy:hover,
    .decks-difficulty-button.decks-easy:active {
        background: #3498db;
        color: white;
    }

    .decks-button-label {
        font-weight: 600;
        font-size: 13px;
    }

    .decks-interval {
        font-size: 11px;
        color: var(--text-muted);
    }

    .decks-difficulty-button:hover .decks-interval {
        color: inherit;
    }

    .decks-difficulty-button .decks-shortcut {
        position: absolute;
        top: 2px;
        right: 2px;
        font-size: 9px;
        padding: 1px 3px;
        background: var(--background-modifier-border);
        border-radius: 2px;
        opacity: 0.7;
    }

    .decks-empty-state {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
        color: var(--text-muted);
    }

    /* Markdown content styling */
    :global(.card-side h1),
    :global(.card-side h2),
    :global(.card-side h3),
    :global(.card-side h4),
    :global(.card-side h5),
    :global(.card-side h6) {
        margin-top: 0;
        margin-bottom: 16px;
    }

    :global(.card-side p) {
        margin-bottom: 16px;
    }

    :global(.card-side p:last-child) {
        margin-bottom: 0;
    }

    :global(.card-side > *:first-child) {
        margin-top: 0;
    }

    :global(.card-side ul),
    :global(.card-side ol) {
        margin-bottom: 16px;
        padding-left: 24px;
    }

    :global(.card-side code) {
        background: var(--code-background);
        padding: 2px 4px;
        border-radius: 3px;
        font-size: 0.9em;
    }

    :global(.card-side pre) {
        background: var(--code-background);
        padding: 16px;
        border-radius: 6px;
        overflow-x: auto;
        margin-bottom: 16px;
        max-width: 100%;
    }

    :global(.card-side blockquote) {
        border-left: 3px solid var(--blockquote-border);
        padding-left: 16px;
        margin-left: 0;
        margin-right: 0;
        color: var(--text-muted);
    }

    /* Mobile responsive styles */
    @media (max-width: 768px) {
        .decks-review-modal {
            padding-bottom: env(safe-area-inset-bottom);
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
            padding-top: env(safe-area-inset-top);
            box-sizing: border-box;
            /*width: 90vw;*/
            /*height: 90vh;*/
            overflow-x: hidden;
        }
        .decks-modal-header {
            padding: 12px 16px;
        }

        .decks-modal-header h3 {
            font-size: 16px;
        }

        .decks-card-content {
            padding: 20px 12px;
            gap: 20px;
        }

        .decks-card-side {
            padding: 20px 16px;
            max-width: none;
        }

        .decks-card-side.decks-front {
            font-size: 18px;
        }

        .decks-card-side.decks-back {
            font-size: 15px;
        }

        .decks-action-buttons {
            padding: 16px;
        }

        .decks-show-answer-button {
            padding: 14px 24px;
            font-size: 16px;
            min-height: 44px;
        }

        .decks-difficulty-buttons {
            gap: 6px;
            padding: 0 8px;
        }

        .decks-difficulty-button {
            padding: 10px 6px;
            min-height: 48px;
        }

        .decks-button-label {
            font-size: 13px;
        }

        .decks-interval {
            font-size: 11px;
        }

        .decks-header-stats {
            flex-direction: column;
            gap: 8px;
            align-items: flex-start;
        }

        .decks-timer-display {
            align-self: flex-end;
            font-size: 13px;
        }
    }

    @media (max-width: 480px) {
        .decks-timer-display {
            font-size: 12px;
        }

        .decks-progress-info {
            font-size: 13px;
        }
    }

    /*@media (max-width: 500px) {
        .modal-header {
            padding: 10px 12px;
            flex-direction: column;
            gap: 8px;
            align-items: flex-start;
        }

        .modal-header h3 {
            font-size: 14px;
        }

        .decks-progress-info {
            align-self: flex-end;
        }

        .decks-card-content {
            padding: 16px 8px;
            gap: 16px;
        }

        .decks-card-side {
            padding: 16px 12px;
        }

        .decks-card-side.decks-front {
            font-size: 16px;
        }

        .decks-card-side.decks-back {
            font-size: 14px;
        }

        .decks-action-buttons {
            padding: 12px;
        }

        .decks-show-answer-button {
            padding: 12px 20px;
            font-size: 15px;
            min-height: 52px;
        }

        .decks-difficulty-buttons {
            gap: 4px;
            padding: 0 5px;
        }

        .decks-difficulty-button {
            padding: 8px 4px;
            min-height: 40px;
        }

        .decks-button-label {
            font-size: 12px;
        }

        .decks-interval {
            font-size: 10px;
        }

        .decks-difficulty-button .decks-shortcut {
            font-size: 8px;
            padding: 1px 2px;
        }
    }*/

    /* Mobile modal overlay protection - Blocker #3 */
    .decks-review-modal {
        position: relative;
        pointer-events: auto;
    }

    /* Prevent form submission issues - Blocker #5 */
    /* No submit buttons present in this modal */

    /* Override Obsidian mobile CSS interference - Blocker #12 */
    .decks-rate-btn,
    .decks-difficulty-button,
    .decks-show-answer-button {
        pointer-events: auto !important;
        opacity: 1 !important;
        touch-action: manipulation !important;
        -webkit-tap-highlight-color: transparent !important;
        position: relative !important;
        z-index: 10 !important;
    }

    /* Disabled state override - Blocker #4 */
    .decks-rate-btn:disabled,
    .decks-difficulty-button:disabled,
    .decks-show-answer-button:disabled {
        opacity: 0.6 !important;
        pointer-events: none !important;
        cursor: not-allowed !important;
    }

    /* Focus trap compatibility - Blocker #8 */
    .decks-action-buttons {
        pointer-events: auto;
        position: relative;
        z-index: 5;
    }

    /* Prevent parent event blocking - Blocker #7 */
    .decks-difficulty-buttons {
        pointer-events: auto;
        position: relative;
        z-index: 5;
    }

    /* Mobile responsive styles */
    /*@media (max-width: 768px) {
        .decks-review-modal {
            padding: 16px 12px;
            font-size: 14px;
        }

        .modal-header h3 {
            font-size: 18px;
            margin-bottom: 8px;
        }

        .progress-info {
            font-size: 13px;
            margin-bottom: 12px;
        }

        .card-front,
        .card-back {
            font-size: 16px;
            padding: 16px 12px;
            margin: 12px 0;
        }

        .difficulty-buttons {
            gap: 6px;
            padding: 0 8px;
        }

        .difficulty-button,
        .rate-btn {
            padding: 10px 6px;
            font-size: 13px;
            min-height: 44px;
        }

        .shortcut {
            font-size: 11px;
            padding: 1px 4px;
        }
    }

    @media (max-width: 480px) {
        .review-modal {
            padding: 12px 8px;
            font-size: 13px;
        }

        .modal-header h3 {
            font-size: 16px;
            text-align: center;
        }

        .progress-info {
            font-size: 12px;
            text-align: center;
        }

        .card-front,
        .card-back {
            font-size: 15px;
            padding: 12px 8px;
            margin: 10px 0;
        }

        .difficulty-buttons {
            gap: 4px;
            padding: 0 4px;
            flex-wrap: wrap;
        }

        .difficulty-button,
        .rate-btn {
            flex: 1;
            min-width: calc(25% - 3px);
            padding: 8px 4px;
            font-size: 12px;
            min-height: 40px;
        }

        .shortcut {
            display: none; /* Hide shortcuts on small screens
        }
    }

    @media (max-width: 390px) {
        .review-modal {
            padding: 8px 4px;
            font-size: 12px;
        }

        .modal-header h3 {
            font-size: 14px;
        }

        .progress-info {
            font-size: 11px;
        }

        .card-front,
        .card-back {
            font-size: 14px;
            padding: 10px 6px;
            margin: 8px 0;
        }

        .difficulty-button,
        .rate-btn {
            padding: 6px 2px;
            font-size: 11px;
            min-height: 36px;
        }
    }

    /* Mobile safe area and viewport optimizations */
    /*@media screen and (max-height: 600px) {
        .review-modal {
            max-height: 90vh;
            overflow-y: auto;
        }

        .action-buttons {
            padding-bottom: calc(20px + env(safe-area-inset-bottom));
        }
    }*/

    /* Mobile keyboard and safe area protection - Blocker #9 */
    .decks-action-buttons {
        padding-bottom: calc(20px + env(safe-area-inset-bottom));
        padding-left: env(safe-area-inset-left);
        padding-right: env(safe-area-inset-right);
        position: relative;
        bottom: 0;
    }

    /*
    @media (orientation: landscape) and (max-height: 500px) {
        .action-buttons {
            padding: 8px 16px;
            padding-bottom: calc(8px + env(safe-area-inset-bottom));
        }

        .difficulty-button,
        .rate-btn {
            min-height: 40px;
            padding: 8px 4px;
        }
    }*/

    /* Mobile safe area insets - Blocker #9 */
    .decks-review-modal {
        padding-bottom: env(safe-area-inset-bottom);
        padding-left: env(safe-area-inset-left);
        padding-right: env(safe-area-inset-right);
        padding-top: env(safe-area-inset-top);
        box-sizing: border-box;
        /*max-width: 100vw;*/
        /*max-height: 100vh;*/
        overflow-x: hidden;
    }

    /* Additional mobile optimizations */
    /*@media (hover: none) and (pointer: coarse) {
        .rate-btn,
        .difficulty-button,
        .show-answer-button {
            min-height: 48px !important;
            min-width: 48px !important;
            font-size: 16px !important;
            line-height: 1.2;
        }
    }*/

    /*@media (max-width: 390px) {
        .modal-header {
            padding: 12px 16px;
        }

        .modal-header h3 {
            font-size: 14px;
        }

        .progress-info {
            font-size: 11px;
        }

        .card-content {
            padding: 12px 16px;
            min-height: 150px;
        }

        .card-side {
            min-height: 120px;
        }

        .card-side.front {
            min-height: 120px;
        }

        .card-side.back {
            min-height: 120px;
        }

        .action-buttons {
            padding: 12px 16px;
            padding-bottom: calc(12px + env(safe-area-inset-bottom));
        }

        .show-answer-button {
            padding: 10px 16px;
            font-size: 14px;
        }

        .difficulty-buttons {
            gap: 4px;
            padding: 0 4px;
        }

        .difficulty-button {
            padding: 8px 4px;
            font-size: 11px;
        }

        .button-label {
            font-size: 11px;
        }

        .interval {
            font-size: 10px;
        }

        .difficulty-button .shortcut {
            display: none;
        }
    }*/

    /*@media (max-width: 380px) {
        .card-content {
            min-height: 120px;
        }

        .difficulty-buttons {
            gap: 2px;
            padding: 0 2px;
        }

        .difficulty-button {
            padding: 6px 2px;
            font-size: 10px;
        }

        .action-buttons {
            padding-bottom: calc(12px + env(safe-area-inset-bottom));
        }
    }*/
</style>
