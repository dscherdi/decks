import { App, Modal, Notice } from "obsidian";
import type { DeckWithProfile } from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";

export class DeckResetModal extends Modal {
  private deck: DeckWithProfile;
  private db: IDatabaseService;
  private onComplete: () => Promise<void>;

  constructor(
    app: App,
    deck: DeckWithProfile,
    db: IDatabaseService,
    onComplete: () => Promise<void>
  ) {
    super(app);
    this.deck = deck;
    this.db = db;
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.setTitle("Reset deck progress");

    contentEl.createEl("p", {
      text: `This will reset all progress for "${this.deck.name}":`,
    });

    const ul = contentEl.createEl("ul");
    ul.createEl("li", { text: "All flashcards reset to new state" });
    ul.createEl("li", { text: "Review history deleted" });
    ul.createEl("li", { text: "Review sessions deleted" });

    contentEl.createEl("p", {
      text: "This action cannot be undone.",
      cls: "decks-reset-warning",
    });

    const buttonContainer = contentEl.createDiv({
      cls: "decks-modal-button-container",
    });

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.onclick = () => this.close();

    const confirmButton = buttonContainer.createEl("button", {
      text: "Reset progress",
      cls: "mod-warning",
    });
    confirmButton.onclick = () => {
      this.close();
      this.performReset().catch(console.error);
    };
  }

  private async performReset(): Promise<void> {
    const notice = new Notice("Resetting deck progress...", 0);
    try {
      await this.db.resetDeckProgress(this.deck.id);
      await this.db.save();
      notice.hide();
      new Notice("Deck progress reset successfully");
      await this.onComplete();
    } catch (error) {
      notice.hide();
      console.error("Failed to reset deck progress:", error);
      new Notice("Failed to reset deck progress");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
