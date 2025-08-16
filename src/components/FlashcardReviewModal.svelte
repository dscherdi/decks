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

    export let deck: Deck;
    export let initialCard: Flashcard | null = null;
    export let onClose: () => void;
    export let onReview: (
        card: Flashcard,
        rating: RatingLabel,
        timeElapsed?: number,
    ) => Promise<void>;
    export let renderMarkdown: (content: string, el: HTMLElement) => void;
    export let settings: FlashcardsSettings;
    export let scheduler: Scheduler;
    export let onCardReviewed:
        | ((reviewedCard: Flashcard) => Promise<void>)
        | undefined = undefined;

    const dispatch = createEventDispatcher();

    let showAnswer = false;
    let isLoading = false;
    let frontEl: HTMLElement;
    let backEl: HTMLElement;
    let schedulingInfo: SchedulingPreview | null = null;
    let reviewedCount = 0;
    let cardStartTime: number = 0;
    let currentCard: Flashcard | null = initialCard;
    let sessionId: string | null = null;
    let sessionProgress: SessionProgress | null = null;

    // Track last event to prevent double execution
    let lastEventTime = 0;
    let lastEventType = "";

    $: progress = sessionProgress ? sessionProgress.progress : 0;

    onMount(async () => {
        // Initialize review session
        sessionId = await scheduler.startFreshSession(deck.id);
        scheduler.setCurrentSession(sessionId);
        sessionProgress = await scheduler.getSessionProgress(sessionId);

        // If no initial card provided, get the first card from scheduler
        if (!currentCard) {
            currentCard = await scheduler.getNext(new Date(), deck.id, {
                allowNew: true,
            });
        }

        if (currentCard) {
            await loadCard();
        } else {
            // No cards available
            dispatch("complete", {
                reason: "no-more-cards",
                reviewed: 0,
            });
        }

        // Add keydown event listener
        window.addEventListener("keydown", handleKeydown);
    });

    onDestroy(() => {
        // Clean up keydown event listener
        window.removeEventListener("keydown", handleKeydown);
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
            renderMarkdown(currentCard.front, frontEl);
        }

        // Pre-render back side but keep it hidden
        // Use tick() to ensure DOM is updated before rendering
        tick().then(() => {
            if (backEl && currentCard) {
                backEl.empty();
                renderMarkdown(currentCard.back, backEl);
            }
        });
    }

    function revealAnswer() {
        showAnswer = true;
        // Ensure back element is rendered after showAnswer becomes true
        tick().then(() => {
            if (backEl && currentCard) {
                backEl.empty();
                renderMarkdown(currentCard.back, backEl);
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
            }

            // Get the next card from the scheduler
            currentCard = await scheduler.getNext(new Date(), deck.id, {
                allowNew: true,
            });

            if (currentCard) {
                await loadCard();
            } else {
                // End the review session
                if (sessionId) {
                    await scheduler.endReviewSession(sessionId);
                    scheduler.setCurrentSession(null);
                }

                // Review session complete
                dispatch("complete", {
                    reason: "no-more-cards",
                    reviewed: sessionProgress
                        ? sessionProgress.doneUnique
                        : reviewedCount,
                });
                onClose();
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

    $: if (currentCard) {
        loadCard();
    }
</script>

<div class="review-modal">
    <div class="modal-header">
        <h3>Review Session - {deck.name}</h3>
        <div class="progress-info">
            <span
                >Reviewed: {sessionProgress
                    ? sessionProgress.doneUnique
                    : reviewedCount}</span
            >
            <span class="remaining"
                >({sessionProgress
                    ? `${sessionProgress.goalTotal - sessionProgress.doneUnique} remaining`
                    : currentCard
                      ? "More cards available"
                      : "Session complete"})</span
            >
        </div>
    </div>

    {#if settings?.review?.showProgress !== false}
        <div class="review-progress-bar">
            <div class="progress-fill" style="width: {progress}%"></div>
        </div>
    {/if}

    {#if currentCard}
        <div class="card-content">
            <div class="question-section">
                <div class="card-side front" bind:this={frontEl}></div>
            </div>

            <div class="answer-section" class:hidden={!showAnswer}>
                <div class="separator"></div>
                <div class="card-side back" bind:this={backEl}></div>
            </div>
        </div>

        <div class="action-buttons">
            {#if !showAnswer}
                <button
                    class="show-answer-button"
                    on:click={(e) => handleTouchClick(revealAnswer, e)}
                    on:touchend={(e) => handleTouchClick(revealAnswer, e)}
                >
                    <span>Show Answer</span>
                    <span class="shortcut">Space</span>
                </button>
            {/if}

            {#if showAnswer && schedulingInfo}
                <div class="difficulty-buttons">
                    <button
                        class="difficulty-button again"
                        on:click={(e) =>
                            handleTouchClick(() => handleReview("again"), e)}
                        on:touchend={(e) =>
                            handleTouchClick(() => handleReview("again"), e)}
                        disabled={isLoading}
                    >
                        <div class="button-label">Again</div>
                        <div class="interval">
                            {getIntervalDisplay(schedulingInfo.again.interval)}
                        </div>
                        <div class="shortcut">1</div>
                    </button>

                    <button
                        class="difficulty-button hard"
                        on:click={(e) =>
                            handleTouchClick(() => handleReview("hard"), e)}
                        on:touchend={(e) =>
                            handleTouchClick(() => handleReview("hard"), e)}
                        disabled={isLoading}
                    >
                        <div class="button-label">Hard</div>
                        <div class="interval">
                            {getIntervalDisplay(schedulingInfo.hard.interval)}
                        </div>
                        <div class="shortcut">2</div>
                    </button>

                    <button
                        class="difficulty-button good"
                        on:click={(e) =>
                            handleTouchClick(() => handleReview("good"), e)}
                        on:touchend={(e) =>
                            handleTouchClick(() => handleReview("good"), e)}
                        disabled={isLoading}
                    >
                        <div class="button-label">Good</div>
                        <div class="interval">
                            {getIntervalDisplay(schedulingInfo.good.interval)}
                        </div>
                        <div class="shortcut">3</div>
                    </button>

                    <button
                        class="difficulty-button easy"
                        on:click={(e) =>
                            handleTouchClick(() => handleReview("easy"), e)}
                        on:touchend={(e) =>
                            handleTouchClick(() => handleReview("easy"), e)}
                        disabled={isLoading}
                    >
                        <div class="button-label">Easy</div>
                        <div class="interval">
                            {getIntervalDisplay(schedulingInfo.easy.interval)}
                        </div>
                        <div class="shortcut">4</div>
                    </button>
                </div>
            {/if}
        </div>
    {:else}
        <div class="empty-state">
            <p>No cards to review</p>
        </div>
    {/if}
</div>

<style>
    .review-modal {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--background-primary);
        color: var(--text-normal);
        overflow: hidden;
        width: 100%;
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--background-modifier-border);
    }

    .modal-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
    }

    .progress-info {
        display: flex;
        gap: 8px;
        font-size: 14px;
    }

    .remaining {
        color: var(--text-muted);
    }

    .review-progress-bar {
        height: 4px;
        background: var(--background-modifier-border);
        position: relative;
    }

    .progress-fill {
        height: 100%;
        background: var(--interactive-accent);
        transition: width 0.3s ease;
    }

    .card-content {
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

    .question-section,
    .answer-section {
        width: 100%;
        display: flex;
        justify-content: center;
    }

    .card-side {
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        padding: 24px;
        min-height: 100px;
        width: 100%;
        max-width: 600px;
        box-sizing: border-box;
        word-wrap: break-word;
        overflow-wrap: break-word;
    }

    .card-side.front {
        text-align: center;
        font-size: 20px;
        font-weight: 500;
    }

    .card-side.back {
        font-size: 16px;
        line-height: 1.6;
    }

    .answer-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    }

    .answer-section.hidden {
        display: none;
    }

    .separator {
        height: 1px;
        background: var(--background-modifier-border);
        margin: 16px auto;
        width: 100%;
        max-width: 600px;
    }

    .action-buttons {
        padding: 20px;
        border-top: 1px solid var(--background-modifier-border);
        flex-shrink: 0;
        width: 100%;
        box-sizing: border-box;
    }

    .show-answer-button {
        width: 100%;
        max-width: 400px;
        margin: 0 auto;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: 500;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border: none;
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

    .show-answer-button:hover,
    .show-answer-button:active {
        background: var(--interactive-accent-hover);
    }

    .shortcut {
        font-size: 12px;
        opacity: 0.8;
        padding: 2px 6px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
        margin-left: 8px;
        display: inline-block;
    }

    .difficulty-buttons {
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

    .difficulty-button {
        flex: 1;
        min-width: 0;
        padding: 12px 8px;
        border: 2px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        font-family: inherit;
        min-height: 60px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
        user-select: none;
    }

    .difficulty-button:hover,
    .difficulty-button:active {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .difficulty-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
    }

    .difficulty-button.again {
        border-color: #e74c3c;
    }

    .difficulty-button.again:hover:not(:disabled) {
        background: #e74c3c;
        color: white;
    }

    .difficulty-button.hard {
        border-color: #f39c12;
    }

    .difficulty-button.hard:hover:not(:disabled) {
        background: #f39c12;
        color: white;
    }

    .difficulty-button.good {
        border-color: #27ae60;
    }

    .difficulty-button.good:hover:not(:disabled) {
        background: #27ae60;
        color: white;
    }

    .difficulty-button.easy {
        border-color: #3498db;
    }

    .difficulty-button.easy:hover:not(:disabled) {
        background: #3498db;
        color: white;
    }

    .button-label {
        font-weight: 600;
        font-size: 13px;
    }

    .interval {
        font-size: 11px;
        color: var(--text-muted);
    }

    .difficulty-button:hover .interval {
        color: inherit;
    }

    .difficulty-button .shortcut {
        position: absolute;
        top: 2px;
        right: 2px;
        font-size: 9px;
        padding: 1px 3px;
        background: var(--background-modifier-border);
        border-radius: 2px;
        opacity: 0.7;
    }

    .empty-state {
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
        .modal-header {
            padding: 12px 16px;
        }

        .modal-header h3 {
            font-size: 16px;
        }

        .card-content {
            padding: 20px 12px;
            gap: 20px;
        }

        .card-side {
            padding: 20px 16px;
            max-width: none;
        }

        .card-side.front {
            font-size: 18px;
        }

        .card-side.back {
            font-size: 15px;
        }

        .action-buttons {
            padding: 16px;
        }

        .show-answer-button {
            padding: 14px 24px;
            font-size: 16px;
            min-height: 44px; /* Touch-friendly */
        }

        .difficulty-buttons {
            gap: 6px;
            padding: 0 8px;
        }

        .difficulty-button {
            padding: 10px 6px;
            min-height: 48px; /* Touch-friendly */
        }

        .button-label {
            font-size: 13px;
        }

        .interval {
            font-size: 11px;
        }
    }

    @media (max-width: 500px) {
        .modal-header {
            padding: 10px 12px;
            flex-direction: column;
            gap: 8px;
            align-items: flex-start;
        }

        .modal-header h3 {
            font-size: 14px;
        }

        .progress-info {
            align-self: flex-end;
        }

        .card-content {
            padding: 16px 8px;
            gap: 16px;
        }

        .card-side {
            padding: 16px 12px;
        }

        .card-side.front {
            font-size: 16px;
        }

        .card-side.back {
            font-size: 14px;
        }

        .action-buttons {
            padding: 12px;
        }

        .show-answer-button {
            padding: 12px 20px;
            font-size: 15px;
            min-height: 52px;
        }

        .difficulty-buttons {
            gap: 4px;
            padding: 0 5px;
        }

        .difficulty-button {
            padding: 8px 4px;
            min-height: 40px;
        }

        .button-label {
            font-size: 12px;
        }

        .interval {
            font-size: 10px;
        }

        .difficulty-button .shortcut {
            font-size: 8px;
            padding: 1px 2px;
        }
    }

    @media (max-width: 390px) {
        .modal-header {
            padding: 8px 10px;
        }

        .modal-header h3 {
            font-size: 13px;
        }

        .progress-info {
            font-size: 12px;
        }

        .card-content {
            padding: 14px 8px;
            gap: 14px;
        }

        .card-side {
            padding: 14px 12px;
        }

        .card-side.front {
            font-size: 15px;
        }

        .card-side.back {
            font-size: 13px;
        }

        .action-buttons {
            padding: 10px 8px;
        }

        .show-answer-button {
            padding: 10px 16px;
            font-size: 14px;
        }

        .difficulty-buttons {
            gap: 3px;
            padding: 0 4px;
            max-width: 374px; /* Fit within 390px with padding */
        }

        .difficulty-button {
            padding: 8px 3px;
            min-height: 42px;
        }

        .button-label {
            font-size: 11px;
        }

        .interval {
            font-size: 9px;
        }

        .difficulty-button .shortcut {
            font-size: 7px;
            padding: 1px 2px;
        }
    }

    @media (max-width: 380px) {
        .card-content {
            padding: 12px 6px;
        }

        .difficulty-buttons {
            gap: 2px;
            padding: 0 3px;
        }

        .difficulty-button {
            padding: 6px 2px;
            min-height: 40px;
        }
    }
</style>
