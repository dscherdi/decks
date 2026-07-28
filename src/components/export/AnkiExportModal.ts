import { App, Modal, Notice } from "obsidian";
import type { Deck, Flashcard, AnkiExportConfig } from "../../database/types";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type {
  AnkiExportComponent,
  ExportEventDetail,
} from "../../types/svelte-components";
import AnkiExportUI from "./AnkiExportUI.svelte";
import { mount, unmount } from "svelte";
import { I18n } from "@decks/core";
import { makeModalResponsive, type ResponsiveModalHandle } from "../../utils/responsive-modal";

export class AnkiExportModal extends Modal {
  private deck: Deck;
  private db: IDatabaseService;
  private component: AnkiExportComponent | null = null;
  private responsiveHandle?: ResponsiveModalHandle;
  public deckIds?: string[]; // For deck group exports
  public isGroupExport?: boolean;

  constructor(app: App, deck: Deck, db: IDatabaseService) {
    super(app);
    this.deck = deck;
    this.db = db;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.responsiveHandle = makeModalResponsive(this);

    // Add CSS class for styling
    contentEl.addClass("decks-anki-export-container");

    // Mount Svelte component using Svelte 5 API
    this.component = mount(AnkiExportUI, {
      target: contentEl,
      props: {
        deck: this.deck,
        onexport: async (detail: ExportEventDetail) => {
          const ankiConfig: AnkiExportConfig = {
            noteType: detail.noteType,
            tags: detail.tags,
            ankiDeckName: detail.ankiDeckName,
            separator: detail.separator,
          };
          await this.handleExport(ankiConfig);
        },
        oncancel: () => {
          this.close();
        },
      },
    }) as AnkiExportComponent;
  }

  private async handleExport(config: AnkiExportConfig) {
    try {
      let flashcards: Flashcard[];

      // Check if this is a deck group export
      if (this.isGroupExport && this.deckIds && this.deckIds.length > 0) {
        // Get flashcards from all decks in the group
        const allFlashcards: Flashcard[] = [];
        for (const deckId of this.deckIds) {
          const deckCards = await this.db.getFlashcardsByDeck(deckId);
          allFlashcards.push(...deckCards);
        }
        flashcards = allFlashcards;
      } else {
        // Get flashcards for single deck
        flashcards = await this.db.getFlashcardsByDeck(this.deck.id);
      }

      if (flashcards.length === 0) {
        new Notice(I18n.t.notices.noFlashcardsToExport);
        return;
      }

      // Generate Anki package format
      const ankiData = this.generateAnkiData(flashcards, config);

      // Create and download file
      this.downloadAnkiFile(ankiData, config.ankiDeckName);

      const exportType = this.isGroupExport
        ? I18n.t.notices.ankiExportTypeTagGroup
        : I18n.t.notices.ankiExportTypeDeck;
      new Notice(
        I18n.format(I18n.t.notices.ankiExportSuccess, {
          count: flashcards.length,
          type: exportType,
        })
      );
      this.close();
    } catch (error) {
      console.error("Error exporting to Anki:", error);
      new Notice(I18n.t.notices.ankiExportFailed);
    }
  }

  private generateAnkiData(
    flashcards: Flashcard[],
    config: AnkiExportConfig
  ): string {
    // Create Anki-compatible format with configurable separators
    const hasNotes = flashcards.some(
      (card) => card.notes && card.notes.trim() !== ""
    );
    const headers = hasNotes
      ? ["Front", "Back", "Notes"]
      : ["Front", "Back"];
    const rows = [headers.join(config.separator)];

    flashcards.forEach((card) => {
      const front = this.sanitizeForAnki(card.front, config.separator);
      const back = this.sanitizeForAnki(card.back, config.separator);
      const fields = [front, back];
      if (hasNotes) {
        fields.push(this.sanitizeForAnki(card.notes || "", config.separator));
      }
      rows.push(fields.join(config.separator));
    });

    return rows.join("\n");
  }

  private sanitizeForAnki(text: string, separator: string): string {
    // Remove markdown formatting and escape special characters
    let sanitized = text
      .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>") // Bold
      .replace(/\*(.*?)\*/g, "<i>$1</i>") // Italic
      .replace(/`(.*?)`/g, "<code>$1</code>") // Code
      .replace(/\n/g, "<br>") // Replace newlines with HTML breaks
      .trim();

    // Escape the field separator
    if (separator === "\t") {
      sanitized = sanitized.replace(/\t/g, " "); // Replace tabs with spaces
    } else {
      sanitized = sanitized.replace(
        new RegExp(`\\${separator}`, "g"),
        `\\${separator}`
      );
    }

    return sanitized;
  }

  private downloadAnkiFile(data: string, deckName: string) {
    const fileName = `${deckName.replace(/[^a-zA-Z0-9-_]/g, "_")}_export.txt`;

    // Create blob and download
    const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = activeDocument.createElement("a");
    link.href = url;
    link.download = fileName;
    activeDocument.body.appendChild(link);
    link.click();
    activeDocument.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  onClose() {
    const { contentEl } = this;

    this.responsiveHandle?.dispose();
    this.responsiveHandle = undefined;

    // Unmount Svelte component using Svelte 5 API
    if (this.component) {
      void unmount(this.component);
      this.component = null;
    }

    contentEl.empty();
  }
}
