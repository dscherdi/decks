<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { Setting } from "obsidian";
    import type { Deck, AnkiExportConfig } from "../../database/types";

    export let deck: Deck;

    const dispatch = createEventDispatcher<{
        export: AnkiExportConfig;
        cancel: void;
    }>();

    let ankiDeckName = deck.name;
    const separator = "tab";
    let exporting = false;

    // Container references for Obsidian Settings
    let deckNameContainer: HTMLElement;

    // Track last event to prevent double execution
    let lastEventTime = 0;
    let lastEventType = "";

    function handleExport() {
        exporting = true;

        // Map separator selection to actual character
        const separatorMap: { [key: string]: string } = {
            tab: "\t",
            semicolon: ";",
            colon: ":",
            pipe: "|",
            comma: ",",
            space: " ",
        };

        const config: AnkiExportConfig = {
            ankiDeckName: ankiDeckName.trim() || deck.name,
            separator: separatorMap[separator] || "\t",
            noteType: "",
            tags: [deck.tag],
        };

        dispatch("export", config);
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
            handleExport();
        }
    }

    onMount(async () => {
        // Anki Deck Name
        if (deckNameContainer) {
            new Setting(deckNameContainer)
                .setName("Anki Deck Name")
                .setDesc(
                    "Name of the deck in Anki where cards will be imported"
                )
                .addText((text) =>
                    text
                        .setPlaceholder("Enter deck name...")
                        .setValue(ankiDeckName)
                        .onChange((value) => {
                            ankiDeckName = value;
                        })
                );
        }
    });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="decks-anki-export-ui">
    <h2 class="">Export to Anki: {deck.name}`</h2>
    <!-- Deck Information Section -->
    <div class="decks-deck-info-section">
        <h3>Export Information</h3>
        <ul class="decks-deck-info-list">
            <li><strong>Source Deck:</strong> {deck.name}</li>
            <li><strong>Source Tag:</strong> {deck.tag}</li>
            <li><strong>Source File:</strong> {deck.filepath}</li>
        </ul>
    </div>

    <!-- Export Instructions -->
    <div class="decks-instructions-section">
        <h3>How to Import</h3>
        <ol class="decks-instructions-list">
            <li>This will download a text file compatible with Anki</li>
            <li>Open Anki and go to <strong>File → Import</strong></li>
            <li>Select the downloaded file</li>
            <li>Choose your target deck and import settings</li>
            <li>Click <strong>Import</strong> to add the cards</li>
        </ol>
    </div>

    <!-- Export Settings Section -->
    <div class="decks-export-settings-section">
        <h3>Export Settings</h3>

        <!-- Obsidian Native Components -->
        <div bind:this={deckNameContainer}></div>
    </div>

    <!-- Action Buttons -->
    <div class="decks-modal-footer">
        <button
            class="mod-cta"
            on:click={(e) => handleTouchClick(handleExport, e)}
            on:touchend={(e) => handleTouchClick(handleExport, e)}
            disabled={exporting || !ankiDeckName.trim()}
        >
            {exporting ? "Exporting..." : "Export to Anki"}
        </button>
        <button
            on:click={(e) => handleTouchClick(handleCancel, e)}
            on:touchend={(e) => handleTouchClick(handleCancel, e)}
            disabled={exporting}>Cancel</button
        >
    </div>
</div>

<style>
    .decks-anki-export-ui {
        padding: 20px;
    }

    .decks-deck-info-section {
        margin-bottom: 24px;
        padding: 16px;
        background: var(--background-secondary);
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
    }

    .decks-deck-info-section h3 {
        margin: 0 0 16px 0;
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

    .decks-deck-info-list strong {
        color: var(--text-normal);
    }

    .decks-instructions-section {
        margin-bottom: 24px;
        padding: 16px;
        background: var(--background-secondary);
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
    }

    .decks-instructions-section h3 {
        margin: 0 0 16px 0;
        font-size: 1.1em;
        color: var(--text-normal);
        font-weight: 600;
    }

    .decks-instructions-list {
        margin: 0;
        padding-left: 20px;
    }

    .decks-instructions-list li {
        margin: 0 0 8px 0;
        font-size: 0.9em;
        color: var(--text-muted);
        line-height: 1.4;
    }

    .decks-export-settings-section {
        margin-bottom: 24px;
    }

    .decks-export-settings-section h3 {
        margin: 0 0 16px 0;
        font-size: 1.1em;
        color: var(--text-normal);
        font-weight: 600;
    }

    .decks-modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        padding-top: 24px;
        margin-top: 24px;
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
        min-width: 100px;
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
        .decks-deck-info-section,
        .decks-instructions-section {
            margin-bottom: 20px;
            padding: 12px;
        }

        .decks-deck-info-section h3,
        .decks-instructions-section h3,
        .decks-export-settings-section h3 {
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
            min-height: 44px;
        }
    }

    @media (max-width: 480px) {
        .decks-deck-info-section,
        .decks-instructions-section {
            padding: 10px;
        }

        .decks-deck-info-list li {
            font-size: 0.85em;
        }

        .decks-instructions-list {
            font-size: 0.85em;
        }

        .decks-modal-footer button {
            padding: 14px 20px;
            min-height: 52px;
        }
    }

    @media (max-width: 390px) {
        .decks-anki-export-ui {
            max-width: 390px;
        }

        .decks-deck-info-section,
        .decks-instructions-section {
            padding: 8px;
            margin-bottom: 16px;
        }

        .decks-deck-info-section h3,
        .decks-instructions-section h3 {
            font-size: 0.9em;
        }

        .decks-deck-info-list li {
            font-size: 0.8em;
        }

        .decks-instructions-list {
            font-size: 0.8em;
        }

        .decks-export-settings-section h3 {
            font-size: 0.9em;
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
