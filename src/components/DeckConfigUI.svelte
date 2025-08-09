<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { Setting } from "obsidian";
    import type { Deck, DeckConfig, ReviewOrder } from "../database/types";

    export let deck: Deck;
    export let config: DeckConfig;

    const dispatch = createEventDispatcher<{
        save: DeckConfig;
        cancel: void;
        configChange: DeckConfig;
    }>();

    let newCardsLimit = config.newCardsLimit;
    let reviewCardsLimit = config.reviewCardsLimit;
    let enableNewCardsLimit = config.enableNewCardsLimit;
    let enableReviewCardsLimit = config.enableReviewCardsLimit;
    let reviewOrder: ReviewOrder = config.reviewOrder;
    let saving = false;
    let newCardsLimitContainer: HTMLElement;
    let reviewCardsLimitContainer: HTMLElement;
    let enableNewCardsContainer: HTMLElement;
    let enableReviewCardsContainer: HTMLElement;
    let reviewOrderContainer: HTMLElement;

    // Reactive statement to update config when values change
    $: {
        const newConfig = {
            newCardsLimit: Number(newCardsLimit) || 0,
            reviewCardsLimit: Number(reviewCardsLimit) || 0,
            enableNewCardsLimit,
            enableReviewCardsLimit,
            reviewOrder,
        };
        dispatch("configChange", newConfig);
    }

    function handleSave() {
        saving = true;
        const finalConfig: DeckConfig = {
            newCardsLimit: Number(newCardsLimit) || 0,
            reviewCardsLimit: Number(reviewCardsLimit) || 0,
            enableNewCardsLimit,
            enableReviewCardsLimit,
            reviewOrder,
        };
        dispatch("save", finalConfig);
    }

    function handleCancel() {
        dispatch("cancel");
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            handleSave();
        }
    }

    onMount(() => {
        // Enable New Cards Limit Toggle
        if (enableNewCardsContainer) {
            new Setting(enableNewCardsContainer)
                .setName("Enable New Cards Limit")
                .setDesc(
                    "Limit how many new cards (never seen before) can be shown per day",
                )
                .addToggle((toggle) =>
                    toggle.setValue(enableNewCardsLimit).onChange((value) => {
                        enableNewCardsLimit = value;
                    }),
                );
        }

        // New Cards Limit Input
        if (newCardsLimitContainer) {
            new Setting(newCardsLimitContainer)
                .setName("New Cards per Day")
                .setDesc("Maximum number of new cards to introduce per day")
                .addText((text) =>
                    text
                        .setPlaceholder("20")
                        .setValue(newCardsLimit.toString())
                        .onChange((value) => {
                            const num = parseInt(value);
                            if (!isNaN(num) && num >= 0) {
                                newCardsLimit = num;
                            }
                        }),
                );
        }

        // Enable Review Cards Limit Toggle
        if (enableReviewCardsContainer) {
            new Setting(enableReviewCardsContainer)
                .setName("Enable Review Cards Limit")
                .setDesc(
                    "Limit how many review cards (due for repetition) can be shown per day",
                )
                .addToggle((toggle) =>
                    toggle
                        .setValue(enableReviewCardsLimit)
                        .onChange((value) => {
                            enableReviewCardsLimit = value;
                        }),
                );
        }

        // Review Cards Limit Input
        if (reviewCardsLimitContainer) {
            new Setting(reviewCardsLimitContainer)
                .setName("Review Cards per Day")
                .setDesc("Maximum number of review cards to show per day")
                .addText((text) =>
                    text
                        .setPlaceholder("100")
                        .setValue(reviewCardsLimit.toString())
                        .onChange((value) => {
                            const num = parseInt(value);
                            if (!isNaN(num) && num >= 0) {
                                reviewCardsLimit = num;
                            }
                        }),
                );
        }

        // Review Order Dropdown
        if (reviewOrderContainer) {
            new Setting(reviewOrderContainer)
                .setName("Review Order")
                .setDesc(
                    "Order in which review cards are presented during study",
                )
                .addDropdown((dropdown) =>
                    dropdown
                        .addOption("due-date", "Oldest due first")
                        .addOption("random", "Random order")
                        .setValue(reviewOrder)
                        .onChange((value: ReviewOrder) => {
                            reviewOrder = value;
                        }),
                );
        }
    });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="deck-config-ui">
    <!-- Deck Information Section -->
    <div class="deck-info-section">
        <h3>Deck Information</h3>
        <ul class="deck-info-list">
            <li><strong>Name:</strong> {deck.name}</li>
            <li><strong>Tag:</strong> {deck.tag}</li>
            <li><strong>File:</strong> {deck.filepath}</li>
        </ul>
    </div>

    <!-- Settings Section -->
    <div class="deck-settings-section">
        <h3>Daily Card Limits</h3>
        <div class="setting-item-description-global">
            Learning/relearning cards are always shown and not subject to these
            limits.
        </div>

        <!-- Obsidian Native Components -->
        <div bind:this={enableNewCardsContainer}></div>
        <div
            bind:this={newCardsLimitContainer}
            class:disabled={!enableNewCardsLimit}
        ></div>
        <div bind:this={enableReviewCardsContainer}></div>
        <div
            bind:this={reviewCardsLimitContainer}
            class:disabled={!enableReviewCardsLimit}
        ></div>
        <div bind:this={reviewOrderContainer}></div>
    </div>

    <!-- Action Buttons -->
    <div class="modal-footer">
        <button class="mod-cta" on:click={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
        </button>
        <button on:click={handleCancel} disabled={saving}>Cancel</button>
    </div>
</div>

<style>
    .deck-config-ui {
        padding: 0;
    }

    .deck-info-section {
        margin-bottom: 24px;
        padding: 16px;
        background: var(--background-secondary);
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
    }

    .deck-info-section h3 {
        margin: 0 0 12px 0;
        font-size: 1.1em;
        color: var(--text-normal);
        font-weight: 600;
    }

    .deck-info-list {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .deck-info-list li {
        margin: 0 0 8px 0;
        font-size: 0.9em;
        color: var(--text-muted);
    }

    .deck-info-list li:last-child {
        margin-bottom: 0;
    }

    .deck-info-list strong {
        color: var(--text-normal);
    }

    .deck-settings-section {
        margin-bottom: 24px;
    }

    .deck-settings-section h3 {
        margin: 0 0 16px 0;
        font-size: 1.1em;
        color: var(--text-normal);
        font-weight: 600;
    }

    .setting-item-description-global {
        font-size: 0.8em;
        color: var(--text-muted);
        line-height: 1.4;
        margin-bottom: 20px;
        padding: 12px;
        background: var(--background-secondary);
        border-radius: 4px;
        border-left: 3px solid var(--interactive-accent);
    }

    .setting-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: 20px;
        padding: 12px 0;
    }

    .setting-item:last-child {
        border-bottom: none;
        margin-bottom: 0;
    }

    .setting-item.disabled {
        opacity: 0.5;
    }

    .setting-item-info {
        flex: 1;
        margin-right: 16px;
    }

    .setting-item-name {
        font-weight: 500;
        color: var(--text-normal);
        margin-bottom: 4px;
        font-size: 0.9em;
    }

    .setting-item-description {
        font-size: 0.8em;
        color: var(--text-muted);
        line-height: 1.4;
    }

    .setting-item-control {
        flex-shrink: 0;
    }

    /* Disabled state for Obsidian Setting containers */
    .disabled {
        opacity: 0.5;
        pointer-events: none;
    }

    .modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid var(--background-modifier-border);
    }

    .modal-footer button {
        padding: 8px 16px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        cursor: pointer;
        font-size: 0.9em;
        transition: all 0.2s ease;
    }

    .modal-footer button:hover:not(:disabled) {
        background: var(--background-modifier-hover);
    }

    .modal-footer button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .modal-footer button.mod-cta {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border-color: var(--interactive-accent);
    }

    .modal-footer button.mod-cta:hover:not(:disabled) {
        background: var(--interactive-accent-hover);
        border-color: var(--interactive-accent-hover);
    }

    .modal-footer button:focus {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 2px;
    }

    /* Mobile responsive styles */
    @media (max-width: 768px) {
        .deck-config-ui {
            padding: 0;
        }

        .deck-info-section {
            margin-bottom: 20px;
            padding: 12px;
        }

        .deck-info-section h3 {
            font-size: 1em;
        }

        .deck-settings-section h3 {
            font-size: 1em;
        }

        .modal-footer {
            padding-top: 20px;
            flex-direction: column-reverse;
            gap: 8px;
        }

        .modal-footer button {
            width: 100%;
            padding: 12px 16px;
            font-size: 16px;
            min-height: 44px; /* Touch-friendly */
        }
    }

    @media (max-width: 480px) {
        .deck-info-section {
            padding: 10px;
        }

        .deck-info-list li {
            font-size: 0.85em;
        }

        .setting-item-description-global {
            font-size: 0.75em;
            padding: 10px;
        }

        .modal-footer button {
            padding: 14px 20px;
        }
    }

    @media (max-width: 390px) {
        /* iPhone 12 Pro and similar 390px width phones */
        .deck-config-ui {
            padding: 0;
            max-width: 390px;
        }

        .deck-info-section {
            padding: 8px;
            margin-bottom: 16px;
        }

        .deck-info-section h3 {
            font-size: 0.9em;
        }

        .deck-info-list li {
            font-size: 0.8em;
        }

        .deck-settings-section h3 {
            font-size: 0.9em;
        }

        .setting-item-description-global {
            font-size: 0.7em;
            padding: 8px;
        }

        .modal-footer {
            padding-top: 16px;
        }

        .modal-footer button {
            padding: 12px 16px;
            font-size: 14px;
        }
    }
</style>
