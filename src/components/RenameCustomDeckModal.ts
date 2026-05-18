import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import { I18n } from "@/i18n/I18n";

export class RenameCustomDeckModal extends Modal {
  private newName: string;
  private existingNames: string[];
  private onConfirm: (name: string) => void;

  constructor(
    app: App,
    currentName: string,
    existingNames: string[],
    onConfirm: (name: string) => void,
  ) {
    super(app);
    this.newName = currentName;
    this.existingNames = existingNames;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName(I18n.t.modals.renameCustomDeck.title).setHeading();

    new Setting(contentEl)
      .setName(I18n.t.modals.renameCustomDeck.label)
      .addText((text) =>
        text
          .setValue(this.newName)
          .setPlaceholder(I18n.t.modals.renameCustomDeck.placeholder)
          .onChange((value) => {
            this.newName = value;
          })
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText(I18n.t.modals.renameCustomDeck.cancel)
          .onClick(() => {
            this.close();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText(I18n.t.modals.renameCustomDeck.rename)
          .setCta()
          .onClick(() => {
            const name = this.newName.trim();
            if (!name) return;
            if (this.existingNames.includes(name)) return;
            this.onConfirm(name);
            this.close();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
