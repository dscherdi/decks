<script lang="ts">
    import { onMount, createEventDispatcher, tick } from "svelte";
    import type { Flashcard } from "../database/types";
    import {
        FSRS,
        type SchedulingInfo,
        type Difficulty,
    } from "../algorithm/fsrs";

    export let flashcards: Flashcard[] = [];
    export let currentIndex: number = 0;
    export let onClose: () => void;
    export let onReview: (
        card: Flashcard,
        difficulty: Difficulty,
    ) => Promise<void>;
    export let renderMarkdown: (content: string, el: HTMLElement) => void;

    const dispatch = createEventDispatcher();
    const fsrs = new FSRS();

    let showAnswer = false;
    let isLoading = false;
    let frontEl: HTMLElement;
    let backEl: HTMLElement;
    let schedulingInfo: SchedulingInfo | null = null;

    $: currentCard = flashcards[currentIndex] || null;
    $: progress =
        flashcards.length > 0
            ? ((currentIndex + 1) / flashcards.length) * 100
            : 0;
    $: remainingCards = flashcards.length - currentIndex - 1;

    function loadCard() {
        if (!currentCard) return;

        showAnswer = false;
        schedulingInfo = fsrs.getSchedulingInfo(currentCard);

        // Render front side
        if (frontEl) {
            frontEl.innerHTML = "";
            renderMarkdown(currentCard.front, frontEl);
        }

        // Pre-render back side but keep it hidden
        // Use tick() to ensure DOM is updated before rendering
        tick().then(() => {
            if (backEl) {
                backEl.innerHTML = "";
                renderMarkdown(currentCard.back, backEl);
            }
        });
    }

    function revealAnswer() {
        showAnswer = true;
        // Ensure back element is rendered after showAnswer becomes true
        tick().then(() => {
            if (backEl && currentCard) {
                backEl.innerHTML = "";
                renderMarkdown(currentCard.back, backEl);
            }
        });
    }

    async function handleDifficulty(difficulty: Difficulty) {
        if (!currentCard || isLoading) return;

        isLoading = true;
        try {
            await onReview(currentCard, difficulty);

            // Move to next card
            if (currentIndex < flashcards.length - 1) {
                currentIndex++;
                loadCard();
            } else {
                // Review session complete
                dispatch("complete");
                onClose();
            }
        } catch (error) {
            console.error("Error reviewing card:", error);
        } finally {
            isLoading = false;
        }
    }

    function getIntervalDisplay(minutes: number): string {
        return FSRS.getIntervalDisplay(minutes);
    }

    function handleKeydown(event: KeyboardEvent) {
        if (isLoading) return;

        if (!showAnswer && event.key === " ") {
            event.preventDefault();
            revealAnswer();
        } else if (showAnswer) {
            switch (event.key) {
                case "1":
                    handleDifficulty("again");
                    break;
                case "2":
                    handleDifficulty("hard");
                    break;
                case "3":
                case " ":
                    handleDifficulty("good");
                    break;
                case "4":
                    handleDifficulty("easy");
                    break;
            }
        }
    }

    onMount(() => {
        loadCard();
        window.addEventListener("keydown", handleKeydown);

        return () => {
            window.removeEventListener("keydown", handleKeydown);
        };
    });

    $: if (currentCard) {
        loadCard();
    }
</script>

<div class="review-modal">
    <div class="modal-header">
        <h3>Review Session</h3>
        <div class="progress-info">
            <span>{currentIndex + 1} / {flashcards.length}</span>
            <span class="remaining">({remainingCards} remaining)</span>
        </div>
        <button class="close-button" on:click={onClose}>&times;</button>
    </div>

    <div class="progress-bar">
        <div class="progress-fill" style="width: {progress}%"></div>
    </div>

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
                <button class="show-answer-button" on:click={revealAnswer}>
                    <span>Show Answer</span>
                    <span class="shortcut">Space</span>
                </button>
            {/if}

            {#if showAnswer && schedulingInfo}
                <div class="difficulty-buttons">
                    <button
                        class="difficulty-button again"
                        on:click={() => handleDifficulty("again")}
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
                        on:click={() => handleDifficulty("hard")}
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
                        on:click={() => handleDifficulty("good")}
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
                        on:click={() => handleDifficulty("easy")}
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

    .close-button {
        background: none;
        border: none;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        color: var(--text-muted);
        border-radius: 4px;
    }

    .close-button:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
    }

    .progress-bar {
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
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-sizing: border-box;
    }

    .show-answer-button:hover {
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
        padding: 10px 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        transition: all 0.2s ease;
        position: relative;
        box-sizing: border-box;
        white-space: nowrap;
    }

    .difficulty-button:hover {
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

    /* Responsive adjustments */
    @media (max-width: 500px) {
        .difficulty-buttons {
            gap: 4px;
            padding: 0 5px;
        }

        .difficulty-button {
            padding: 8px 4px;
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

        .card-content {
            padding: 16px 8px;
        }
    }
</style>
