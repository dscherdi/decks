import { App, Modal, Notice } from "obsidian";
import type { DeckWithProfile } from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { I18n } from "@decks/core";

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

    this.setTitle(I18n.t.modals.deckReset.title);

    contentEl.createEl("p", {
      text: I18n.format(I18n.t.modals.deckReset.intro, { name: this.deck.name }),
    });

    const ul = contentEl.createEl("ul");
    ul.createEl("li", { text: I18n.t.modals.deckReset.listCardsReset });
    ul.createEl("li", { text: I18n.t.modals.deckReset.listHistoryDeleted });
    ul.createEl("li", { text: I18n.t.modals.deckReset.listSessionsDeleted });

    contentEl.createEl("p", {
      text: I18n.t.modals.deckReset.cannotUndo,
      cls: "decks-reset-warning",
    });

    const buttonContainer = contentEl.createDiv({
      cls: "decks-modal-button-container",
    });

    const cancelButton = buttonContainer.createEl("button", {
      text: I18n.t.modals.deckReset.cancel,
    });
    cancelButton.onclick = () => this.close();

    const confirmButton = buttonContainer.createEl("button", {
      text: I18n.t.modals.deckReset.resetButton,
      cls: "mod-warning",
    });
    confirmButton.onclick = () => {
      this.close();
      this.performReset().catch(console.error);
    };
  }

  private async performReset(): Promise<void> {
    const notice = new Notice(I18n.t.modals.deckReset.resetting, 0);
    try {
      await this.db.resetDeckProgress(this.deck.id);
      await this.db.save();
      notice.hide();
      new Notice(I18n.t.modals.deckReset.resetSuccess);
      await this.onComplete();
    } catch (error) {
      notice.hide();
      console.error("Failed to reset deck progress:", error);
      new Notice(I18n.t.modals.deckReset.resetFailed);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
