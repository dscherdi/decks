<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { Setting } from "obsidian";
    import type { Deck, AnkiExportConfig } from "../database/types";
    import type DecksPlugin from "../main";

    export let deck: Deck;
    export let plugin: DecksPlugin;

    const dispatch = createEventDispatcher<{
        export: AnkiExportConfig;
        cancel: void;
    }>();

    let ankiDeckName = deck.name;
    let separator = "tab";
    let exporting = false;

    // Container references for Obsidian Settings
    let deckNameContainer: HTMLElement;
    let separatorContainer: HTMLElement;

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
                    "Name of the deck in Anki where cards will be imported",
                )
                .addText((text) =>
                    text
                        .setPlaceholder("Enter deck name...")
                        .setValue(ankiDeckName)
                        .onChange((value) => {
                            ankiDeckName = value;
                        }),
                );
        }

        // Separator Dropdown
        if (separatorContainer) {
            new Setting(separatorContainer)
                .setName("Field Separator")
                .setDesc(
                    "Character used to separate fields in the exported file",
                )
                .addDropdown((dropdown) =>
                    dropdown
                        .addOption("tab", "Tab")
                        .addOption("semicolon", "Semicolon (;)")
                        .addOption("colon", "Colon (:)")
                        .addOption("pipe", "Pipe (|)")
                        .addOption("comma", "Comma (,)")
                        .addOption("space", "Space")
                        .setValue(separator)
                        .onChange((value) => {
                            separator = value;
                        }),
                );
        }
    });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="anki-export-ui">
    <!-- Deck Information Section -->
    <div class="deck-info-section">
        <h3>Export Information</h3>
        <ul class="deck-info-list">
            <li><strong>Source Deck:</strong> {deck.name}</li>
            <li><strong>Source Tag:</strong> {deck.tag}</li>
            <li><strong>Source File:</strong> {deck.filepath}</li>
        </ul>
    </div>

    <!-- Export Instructions -->
    <div class="instructions-section">
        <h3>How to Import</h3>
        <ol class="instructions-list">
            <li>This will download a text file compatible with Anki</li>
            <li>Open Anki and go to <strong>File → Import</strong></li>
            <li>Select the downloaded file</li>
            <li>Choose your target deck and import settings</li>
            <li>Click <strong>Import</strong> to add the cards</li>
        </ol>
    </div>

    <!-- Export Settings Section -->
    <div class="export-settings-section">
        <h3>Export Settings</h3>

        <!-- Obsidian Native Components -->
        <div bind:this={deckNameContainer}></div>
        <div bind:this={separatorContainer}></div>
    </div>

    <!-- Action Buttons -->
    <div class="modal-footer">
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
    .anki-export-ui {
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

    .instructions-section {
        margin-bottom: 24px;
        padding: 16px;
        background: var(--background-secondary);
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        border-left: 3px solid var(--interactive-accent);
    }

    .instructions-section h3 {
        margin: 0 0 12px 0;
        font-size: 1.1em;
        color: var(--text-normal);
        font-weight: 600;
    }

    .instructions-list {
        margin: 0;
        padding-left: 20px;
        color: var(--text-muted);
        font-size: 0.9em;
        line-height: 1.5;
    }

    .instructions-list li {
        margin-bottom: 8px;
    }

    .instructions-list li:last-child {
        margin-bottom: 0;
    }

    .instructions-list strong {
        color: var(--text-normal);
    }

    .export-settings-section {
        margin-bottom: 24px;
    }

    .export-settings-section h3 {
        margin: 0 0 16px 0;
        font-size: 1.1em;
        color: var(--text-normal);
        font-weight: 600;
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
        transition: all 0.2s ease;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
        user-select: none;
        min-height: 44px;
        min-width: 100px;
    }

    .modal-footer button:hover:not(:disabled),
    .modal-footer button:active:not(:disabled) {
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

    .modal-footer button.mod-cta:hover:not(:disabled),
    .modal-footer button.mod-cta:active:not(:disabled) {
        background: var(--interactive-accent-hover);
        border-color: var(--interactive-accent-hover);
    }

    .modal-footer button:focus {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 2px;
    }

    /* Mobile responsive styles */
    @media (max-width: 768px) {
        .anki-export-ui {
            padding: 0;
        }

        .deck-info-section,
        .instructions-section {
            margin-bottom: 20px;
            padding: 12px;
        }

        .deck-info-section h3,
        .instructions-section h3 {
            font-size: 1em;
        }

        .export-settings-section h3 {
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
            min-height: 44px;
        }
    }

    @media (max-width: 480px) {
        .deck-info-section,
        .instructions-section {
            padding: 10px;
        }

        .deck-info-list li {
            font-size: 0.85em;
        }

        .instructions-list {
            font-size: 0.85em;
        }

        .modal-footer button {
            padding: 14px 20px;
            min-height: 52px;
        }
    }

    @media (max-width: 390px) {
        .anki-export-ui {
            padding: 0;
            max-width: 390px;
        }

        .deck-info-section,
        .instructions-section {
            padding: 8px;
            margin-bottom: 16px;
        }

        .deck-info-section h3,
        .instructions-section h3 {
            font-size: 0.9em;
        }

        .deck-info-list li {
            font-size: 0.8em;
        }

        .instructions-list {
            font-size: 0.8em;
        }

        .export-settings-section h3 {
            font-size: 0.9em;
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
