<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { Deck, DeckStats } from "../database/types";

    export let decks: Deck[] = [];
    export let deckStats: Map<string, DeckStats> = new Map();
    export let onDeckClick: (deck: Deck) => void;
    export let onRefresh: () => void;

    let isRefreshing = false;

    function getDeckStats(deckId: string): DeckStats {
        return (
            deckStats.get(deckId) || {
                deckId,
                newCount: 0,
                learningCount: 0,
                dueCount: 0,
                totalCount: 0,
            }
        );
    }

    function formatDeckName(deck: Deck): string {
        // Remove #flashcards/ prefix for display
        return deck.name;
    }

    async function handleRefresh() {
        console.log("Refresh button clicked");
        isRefreshing = true;
        try {
            await onRefresh();
        } catch (error) {
            console.error("Error during refresh:", error);
        } finally {
            isRefreshing = false;
        }
    }

    function handleDeckClick(deck: Deck) {
        onDeckClick(deck);
    }

    onMount(() => {
        console.log("DeckListPanel mounted");
        // Initial load
        handleRefresh();
    });
</script>

<div class="deck-list-panel">
    <div class="panel-header">
        <h3 class="panel-title">Flashcard Decks</h3>
        <button
            class="refresh-button"
            class:refreshing={isRefreshing}
            on:click={handleRefresh}
            disabled={isRefreshing}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path d="M23 4v6h-6"></path>
                <path d="M1 20v-6h6"></path>
                <path
                    d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
                ></path>
            </svg>
        </button>
    </div>

    {#if decks.length === 0}
        <div class="empty-state">
            <p>No flashcard decks found.</p>
            <p class="help-text">
                Tag your notes with #flashcards to create decks.
            </p>
        </div>
    {:else}
        <div class="deck-table">
            <div class="table-header">
                <div class="col-deck">Deck</div>
                <div class="col-stat">New</div>
                <div class="col-stat">Learn</div>
                <div class="col-stat">Due</div>
            </div>

            <div class="table-body">
                {#each decks as deck}
                    {@const stats = getDeckStats(deck.id)}
                    <button
                        class="deck-row"
                        on:click={() => handleDeckClick(deck)}
                        title="Click to review {deck.name}"
                    >
                        <div class="col-deck">{formatDeckName(deck)}</div>
                        <div
                            class="col-stat"
                            class:has-cards={stats.newCount > 0}
                        >
                            {stats.newCount}
                        </div>
                        <div
                            class="col-stat"
                            class:has-cards={stats.learningCount > 0}
                        >
                            {stats.learningCount}
                        </div>
                        <div
                            class="col-stat"
                            class:has-cards={stats.dueCount > 0}
                        >
                            {stats.dueCount}
                        </div>
                    </button>
                {/each}
            </div>
        </div>
    {/if}
</div>

<style>
    .deck-list-panel {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--background-primary);
        color: var(--text-normal);
    }

    .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid var(--background-modifier-border);
    }

    .panel-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
    }

    .refresh-button {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        color: var(--text-muted);
        transition: all 0.2s ease;
        position: relative;
        z-index: 1;
    }

    .refresh-button:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
    }

    .refresh-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .refresh-button.refreshing svg {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: 32px;
        text-align: center;
    }

    .empty-state p {
        margin: 8px 0;
    }

    .help-text {
        font-size: 14px;
        color: var(--text-muted);
    }

    .deck-table {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .table-header {
        display: flex;
        padding: 8px 16px;
        font-weight: 600;
        font-size: 14px;
        border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
    }

    .table-body {
        flex: 1;
        overflow-y: auto;
    }

    .deck-row {
        display: flex;
        padding: 12px 16px;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        cursor: pointer;
        transition: background-color 0.1s ease;
        border-bottom: 1px solid var(--background-modifier-border);
    }

    .deck-row:hover {
        background: var(--background-modifier-hover);
    }

    .deck-row:active {
        background: var(--background-modifier-active);
    }

    .col-deck {
        flex: 1;
        font-size: 14px;
        color: var(--text-normal);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .col-stat {
        width: 50px;
        text-align: center;
        font-size: 14px;
        color: var(--text-muted);
    }

    .col-stat.has-cards {
        color: #4aa3df;
        font-weight: 500;
    }

    /* Scrollbar styling */
    .table-body::-webkit-scrollbar {
        width: 8px;
    }

    .table-body::-webkit-scrollbar-track {
        background: transparent;
    }

    .table-body::-webkit-scrollbar-thumb {
        background: var(--background-modifier-border);
        border-radius: 4px;
    }

    .table-body::-webkit-scrollbar-thumb:hover {
        background: var(--background-modifier-border-hover);
    }
</style>
