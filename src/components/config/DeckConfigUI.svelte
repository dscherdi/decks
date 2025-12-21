<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { Setting } from "obsidian";
    import type { Deck, DeckConfig, ReviewOrder } from "../../database/types";
    import type { FSRSProfile } from "../../algorithm/fsrs-weights";

    export let deck: Deck;
    export let config: DeckConfig;

    const dispatch = createEventDispatcher<{
        save: DeckConfig;
        cancel: void;
        configChange: DeckConfig;
    }>();

    let newCardsLimit = config.newCardsPerDay;
    let reviewCardsLimit = config.reviewCardsPerDay;
    let enableNewCardsLimit = config.hasNewCardsLimitEnabled;
    let enableReviewCardsLimit = config.hasReviewCardsLimitEnabled;
    let reviewOrder: ReviewOrder = config.reviewOrder;
    let headerLevel = config.headerLevel;
    let requestRetention = config.fsrs.requestRetention;
    let profile: FSRSProfile = config.fsrs.profile;
    let saving = false;
    let newCardsLimitContainer: HTMLElement;
    let enableNewCardsContainer: HTMLElement;
    let reviewCardsLimitContainer: HTMLElement;
    let enableReviewCardsContainer: HTMLElement;
    let reviewOrderContainer: HTMLElement;
    let headerLevelContainer: HTMLElement;
    let requestRetentionContainer: HTMLElement;
    let profileContainer: HTMLElement;
    let fsrsResetContainer: HTMLElement;

    // Track last event to prevent double execution
    let lastEventTime = 0;
    let lastEventType = "";

    // Reactive statement to update config when values change
    $: {
        const newConfig = {
            hasNewCardsLimitEnabled: enableNewCardsLimit,
            newCardsPerDay: Number(newCardsLimit) || 20,
            hasReviewCardsLimitEnabled: enableReviewCardsLimit,
            reviewCardsPerDay: Number(reviewCardsLimit) || 100,
            reviewOrder,
            headerLevel: Number(headerLevel) || 2,
            fsrs: {
                requestRetention: Number(requestRetention) || 0.9,
                profile: profile,
            },
        };
        dispatch("configChange", newConfig);
    }

    function handleSave() {
        saving = true;
        const finalConfig: DeckConfig = {
            hasNewCardsLimitEnabled: enableNewCardsLimit,
            newCardsPerDay: Number(newCardsLimit) || 20,
            hasReviewCardsLimitEnabled: enableReviewCardsLimit,
            reviewCardsPerDay: Number(reviewCardsLimit) || 100,
            reviewOrder,
            headerLevel: Number(headerLevel) || 2,
            fsrs: {
                requestRetention: Number(requestRetention) || 0.9,
                profile: profile,
            },
        };
        dispatch("save", finalConfig);
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
                    "Limit how many new cards (never seen before) can be shown per day"
                )
                .addToggle((toggle) =>
                    toggle.setValue(enableNewCardsLimit).onChange((value) => {
                        enableNewCardsLimit = value;
                    })
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
                        })
                );
        }

        // Enable Review Cards Limit Toggle
        if (enableReviewCardsContainer) {
            new Setting(enableReviewCardsContainer)
                .setName("Enable Review Cards Limit")
                .setDesc(
                    "Limit how many review cards (due for repetition) can be shown per day"
                )
                .addToggle((toggle) =>
                    toggle
                        .setValue(enableReviewCardsLimit)
                        .onChange((value) => {
                            enableReviewCardsLimit = value;
                        })
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
                        })
                );
        }

        // Review Order Dropdown
        if (reviewOrderContainer) {
            new Setting(reviewOrderContainer)
                .setName("Review Order")
                .setDesc(
                    "Order in which review cards are presented during study"
                )
                .addDropdown((dropdown) =>
                    dropdown
                        .addOption("due-date", "Oldest due first")
                        .addOption("random", "Random order")
                        .setValue(reviewOrder)
                        .onChange((value: ReviewOrder) => {
                            reviewOrder = value;
                        })
                );
        }

        // Header Level Dropdown
        if (headerLevelContainer) {
            new Setting(headerLevelContainer)
                .setName("Header Level for Flashcards")
                .setDesc(
                    "Which header level to use for header-paragraph flashcards"
                )
                .addDropdown((dropdown) =>
                    dropdown
                        .addOption("1", "H1 (#)")
                        .addOption("2", "H2 (##)")
                        .addOption("3", "H3 (###)")
                        .addOption("4", "H4 (####)")
                        .addOption("5", "H5 (#####)")
                        .addOption("6", "H6 (######)")
                        .setValue(headerLevel.toString())
                        .onChange((value) => {
                            headerLevel = parseInt(value);
                        })
                );
        }

        // FSRS Settings
        if (requestRetentionContainer) {
            new Setting(requestRetentionContainer)
                .setName("Request Retention")
                .setDesc("Target recall rate for reviews (0.5-0.995)")
                .addSlider((slider) =>
                    slider
                        .setLimits(0.5, 0.995, 0.01)
                        .setValue(requestRetention)
                        .setDynamicTooltip()
                        .onChange((value) => {
                            requestRetention = value;
                        })
                );
        }

        if (profileContainer) {
            new Setting(profileContainer)
                .setName("FSRS Profile")
                .setDesc(
                    "INTENSIVE: Sub-day intervals (1m/5m/10m/1d). STANDARD: Day-based intervals (≥1 day minimum)"
                )
                .addDropdown((dropdown) =>
                    dropdown
                        .addOption("INTENSIVE", "Intensive (Sub-day)")
                        .addOption("STANDARD", "Standard (Day-based)")
                        .setValue(profile)
                        .onChange((value: string) => {
                            if (value === "INTENSIVE" || value === "STANDARD") {
                                profile = value;
                            }
                        })
                );
        }

        if (fsrsResetContainer) {
            new Setting(fsrsResetContainer)
                .setName("Reset FSRS Settings")
                .setDesc("Reset all FSRS parameters to default values")
                .setName("Reset to Defaults")
                .addButton((button) =>
                    button.setButtonText("Reset to Defaults").onClick(() => {
                        requestRetention = 0.9;
                        profile = "STANDARD";
                    })
                );
        }
    });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="decks-deck-config-ui">
    <h2 class="">Configure Deck: {deck.name}</h2>
    <!-- Deck Information Section -->
    <div class="decks-deck-info-section">
        <h3>Deck Information</h3>
        <ul class="decks-deck-info-list">
            <li><strong>Name:</strong> {deck.name}</li>
            <li><strong>Tag:</strong> {deck.tag}</li>
            <li><strong>File:</strong> {deck.filepath}</li>
        </ul>
    </div>

    <!-- Settings Section -->
    <div class="decks-deck-settings-section">
        <h3>Daily Card Limits</h3>
        <div class="decks-setting-item-description-global">
            New cards are subject to daily limits when enabled.
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

    <!-- Parsing Settings -->
    <div class="decks-deck-settings-section">
        <h3>Parsing Settings</h3>
        <div class="decks-setting-item-description-global">
            Configure how flashcards are parsed from your notes for this deck.
        </div>

        <div bind:this={headerLevelContainer}></div>
    </div>

    <!-- FSRS Algorithm Settings -->
    <div class="decks-deck-settings-section">
        <h3>FSRS Algorithm Settings</h3>
        <div class="decks-setting-item-description-global">
            These settings control the spaced repetition algorithm for this
            deck.
        </div>

        <div bind:this={requestRetentionContainer}></div>
        <div bind:this={profileContainer}></div>
        <div bind:this={fsrsResetContainer}></div>
    </div>

    <!-- Action Buttons -->
    <div class="decks-modal-footer">
        <button
            class="mod-cta"
            on:click={(e) => handleTouchClick(handleSave, e)}
            on:touchend={(e) => handleTouchClick(handleSave, e)}
            disabled={saving}
        >
            {saving ? "Saving..." : "Save"}
        </button>
        <button
            on:click={(e) => handleTouchClick(handleCancel, e)}
            on:touchend={(e) => handleTouchClick(handleCancel, e)}
            disabled={saving}>Cancel</button
        >
    </div>
</div>

<style>
    .decks-deck-config-ui {
        padding: 20px;
    }

    .decks-deck-info-section {
        margin-bottom: 24px;
        padding: 16px;
        background: var(--background-secondary);
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
    }

    .decks-deck-info-section h3 {
        margin: 0 0 12px 0;
        font-size: 1.1em;
        color: var(--text-normal);
        font-weight: 600;
    }

    .decks-deck-info-list {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .decks-deck-info-list li {
        margin: 0 0 8px 0;
        font-size: 0.9em;
        color: var(--text-muted);
    }

    .decks-deck-info-list li:last-child {
        margin-bottom: 0;
    }

    .decks-deck-info-list strong {
        color: var(--text-normal);
    }

    .decks-deck-settings-section {
        margin-bottom: 24px;
    }

    .decks-deck-settings-section h3 {
        margin: 0 0 16px 0;
        font-size: 1.1em;
        color: var(--text-normal);
        font-weight: 600;
    }

    .decks-setting-item-description-global {
        font-size: 0.8em;
        color: var(--text-muted);
        line-height: 1.4;
        margin-bottom: 20px;
        padding: 12px;
        background: var(--background-secondary);
        border-radius: 4px;
        border-left: 3px solid var(--interactive-accent);
    }

    /* Disabled state for Obsidian Setting containers */
    .disabled {
        opacity: 0.5;
        pointer-events: none;
    }

    .decks-modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid var(--background-modifier-border);
    }

    .decks-modal-footer button {
        padding: 8px 16px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        cursor: pointer;
        transition: all 0.2s ease;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
        user-select: none;
        min-height: 44px;
        min-width: 80px;
    }

    .decks-modal-footer button:hover:not(:disabled),
    .decks-modal-footer button:active:not(:disabled) {
        background: var(--background-modifier-hover);
    }

    .decks-modal-footer button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .decks-modal-footer button.mod-cta {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border-color: var(--interactive-accent);
    }

    .decks-modal-footer button.mod-cta:hover:not(:disabled),
    .decks-modal-footer button.mod-cta:active:not(:disabled) {
        background: var(--interactive-accent-hover);
        border-color: var(--interactive-accent-hover);
    }

    .decks-modal-footer button:focus {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 2px;
    }

    /* Mobile responsive styles */
    @media (max-width: 768px) {
        .decks-deck-info-section {
            margin-bottom: 20px;
            padding: 12px;
        }

        .decks-deck-info-section h3 {
            font-size: 1em;
        }

        .decks-deck-settings-section h3 {
            font-size: 1em;
        }

        .decks-modal-footer {
            padding-top: 20px;
            flex-direction: column-reverse;
            gap: 8px;
        }

        .decks-modal-footer button {
            width: 100%;
            padding: 12px 16px;
            font-size: 16px;
            min-height: 44px; /* Touch-friendly */
        }
    }

    @media (max-width: 480px) {
        .decks-deck-info-section {
            padding: 10px;
        }

        .decks-deck-info-list li {
            font-size: 0.85em;
        }

        .decks-setting-item-description-global {
            font-size: 0.75em;
            padding: 10px;
        }

        .decks-modal-footer button {
            padding: 14px 20px;
            min-height: 52px;
        }
    }

    @media (max-width: 390px) {
        /* iPhone 12 Pro and similar 390px width phones */
        .decks-deck-config-ui {
            max-width: 390px;
        }

        .decks-deck-info-section {
            padding: 8px;
            margin-bottom: 16px;
        }

        .decks-deck-info-section h3 {
            font-size: 0.9em;
        }

        .decks-deck-info-list li {
            font-size: 0.8em;
        }

        .decks-deck-settings-section h3 {
            font-size: 0.9em;
        }

        .decks-setting-item-description-global {
            font-size: 0.7em;
            padding: 8px;
        }

        .decks-modal-footer {
            padding-top: 16px;
        }

        .decks-modal-footer button {
            padding: 12px 16px;
            font-size: 14px;
        }
    }
</style>
