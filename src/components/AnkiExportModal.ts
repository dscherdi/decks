import { Modal, Notice } from "obsidian";
import type { Deck, AnkiExportConfig } from "../database/types";
import type { DatabaseService } from "../database/DatabaseService";
import AnkiExportUI from "./AnkiExportUI.svelte";

export class AnkiExportModal extends Modal {
  private deck: Deck;
  private db: DatabaseService;
  private component: AnkiExportUI | null = null;
  private resizeHandler?: () => void;

  constructor(app: any, deck: Deck, db: DatabaseService) {
    super(app);
    this.deck = deck;
    this.db = db;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Add mobile-specific classes
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement && window.innerWidth <= 768) {
      modalEl.addClass("decks-modal");
      if (window.innerWidth <= 768) {
        modalEl.addClass("decks-modal-mobile");
      } else {
        modalEl.removeClass("decks-modal-mobile");
      }
    }

    // Add CSS class for styling
    contentEl.addClass("decks-anki-export-container");

    // Mount Svelte component
    this.component = new AnkiExportUI({
      target: contentEl,
      props: {
        deck: this.deck,
      },
    });

    // Listen to component events
    this.component.$on("export", (event) => {
      this.handleExport(event.detail);
    });

    this.component.$on("cancel", () => {
      this.close();
    });

    // Handle window resize for mobile adaptation
    const handleResize = () => {
      const modalEl = this.containerEl.querySelector(".modal");
      if (modalEl instanceof HTMLElement) {
        if (window.innerWidth <= 768) {
          modalEl.addClass("decks-modal-mobile");
        } else {
          modalEl.removeClass("decks-modal-mobile");
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Store resize handler for cleanup
    this.resizeHandler = handleResize;
  }

  private async handleExport(config: AnkiExportConfig) {
    try {
      // Get flashcards for this deck
      const flashcards = await this.db.getFlashcardsByDeck(this.deck.id);

      if (flashcards.length === 0) {
        new Notice("No flashcards found in this deck to export");
        return;
      }

      // Generate Anki package format
      const ankiData = this.generateAnkiData(flashcards, config);

      // Create and download file
      await this.downloadAnkiFile(ankiData, config.ankiDeckName);

      new Notice(
        `Successfully exported ${flashcards.length} flashcards to Anki format`,
      );
      this.close();
    } catch (error) {
      console.error("Error exporting to Anki:", error);
      new Notice("Failed to export deck to Anki format");
    }
  }

  private generateAnkiData(
    flashcards: any[],
    config: AnkiExportConfig,
  ): string {
    // Create Anki-compatible format with configurable separators
    const headers = ["Front", "Back"];
    const rows = [headers.join(config.separator)];

    flashcards.forEach((card) => {
      const front = this.sanitizeForAnki(card.front, config.separator);
      const back = this.sanitizeForAnki(card.back, config.separator);

      rows.push([front, back].join(config.separator));
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
        `\\${separator}`,
      );
    }

    return sanitized;
  }

  private async downloadAnkiFile(data: string, deckName: string) {
    const fileName = `${deckName.replace(/[^a-zA-Z0-9-_]/g, "_")}_export.txt`;

    // Create blob and download
    const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  onClose() {
    const { contentEl } = this;

    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }

    // Destroy Svelte component
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }

    contentEl.empty();
  }
}
