<script lang="ts">
    import { createEventDispatcher } from "svelte";
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

        <!-- New Cards Section -->
        <div class="setting-item">
            <div class="setting-item-info">
                <div class="setting-item-name">Enable New Cards Limit</div>
                <div class="setting-item-description">
                    Limit how many new cards (never seen before) can be shown
                    per day
                </div>
            </div>
            <div class="setting-item-control">
                <label class="checkbox-container">
                    <input
                        type="checkbox"
                        bind:checked={enableNewCardsLimit}
                        class="checkbox-input"
                    />
                    <div class="checkbox-slider"></div>
                </label>
            </div>
        </div>

        <div class="setting-item" class:disabled={!enableNewCardsLimit}>
            <div class="setting-item-info">
                <div class="setting-item-name">New Cards per Day</div>
                <div class="setting-item-description">
                    Maximum number of new cards to introduce per day
                </div>
            </div>
            <div class="setting-item-control">
                <input
                    type="number"
                    bind:value={newCardsLimit}
                    min="0"
                    max="999"
                    disabled={!enableNewCardsLimit}
                    class="session-limit-input"
                    placeholder="20"
                />
            </div>
        </div>

        <!-- Review Cards Section -->
        <div class="setting-item">
            <div class="setting-item-info">
                <div class="setting-item-name">Enable Review Cards Limit</div>
                <div class="setting-item-description">
                    Limit how many review cards (due for repetition) can be
                    shown per day
                </div>
            </div>
            <div class="setting-item-control">
                <label class="checkbox-container">
                    <input
                        type="checkbox"
                        bind:checked={enableReviewCardsLimit}
                        class="checkbox-input"
                    />
                    <div class="checkbox-slider"></div>
                </label>
            </div>
        </div>

        <div class="setting-item" class:disabled={!enableReviewCardsLimit}>
            <div class="setting-item-info">
                <div class="setting-item-name">Review Cards per Day</div>
                <div class="setting-item-description">
                    Maximum number of review cards to show per day
                </div>
            </div>
            <div class="setting-item-control">
                <input
                    type="number"
                    bind:value={reviewCardsLimit}
                    min="0"
                    max="9999"
                    disabled={!enableReviewCardsLimit}
                    class="session-limit-input"
                    placeholder="100"
                />
            </div>
        </div>

        <!-- Review Order Section -->
        <div class="setting-item">
            <div class="setting-item-info">
                <div class="setting-item-name">Review Order</div>
                <div class="setting-item-description">
                    Order in which review cards are presented during study
                </div>
            </div>
            <div class="setting-item-control">
                <select bind:value={reviewOrder} class="review-order-select">
                    <option value="due-date">Oldest due first</option>
                    <option value="random">Random order</option>
                </select>
            </div>
        </div>
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
        border-bottom: 1px solid var(--background-modifier-border);
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

    .checkbox-container {
        position: relative;
        display: inline-block;
        cursor: pointer;
    }

    .checkbox-input {
        position: absolute;
        opacity: 0;
        cursor: pointer;
    }

    .checkbox-slider {
        width: 42px;
        height: 24px;
        background: var(--background-modifier-border);
        border-radius: 12px;
        position: relative;
        transition: background-color 0.2s ease;
    }

    .checkbox-slider::before {
        content: "";
        position: absolute;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: white;
        top: 3px;
        left: 3px;
        transition: transform 0.2s ease;
    }

    .checkbox-input:checked + .checkbox-slider {
        background: var(--interactive-accent);
    }

    .checkbox-input:checked + .checkbox-slider::before {
        transform: translateX(18px);
    }

    .session-limit-input {
        width: 80px;
        padding: 6px 8px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        background: var(--background-primary);
        color: var(--text-normal);
        font-size: 0.9em;
    }

    .session-limit-input:focus {
        outline: none;
        border-color: var(--interactive-accent);
        box-shadow: 0 0 0 2px var(--interactive-accent-hover);
    }

    .session-limit-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--background-modifier-border-hover);
    }

    .review-order-select {
        padding: 6px 8px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        background: var(--background-primary);
        color: var(--text-normal);
        font-size: 0.9em;
        min-width: 140px;
    }

    .review-order-select:focus {
        outline: none;
        border-color: var(--interactive-accent);
        box-shadow: 0 0 0 2px var(--interactive-accent-hover);
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
</style>
