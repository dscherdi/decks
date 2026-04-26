import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";

export class CreateCustomDeckModal extends Modal {
  private deckName = "";
  private existingNames: string[];
  private onConfirm: (name: string) => void;

  constructor(
    app: App,
    existingNames: string[],
    onConfirm: (name: string) => void,
  ) {
    super(app);
    this.existingNames = existingNames;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("Create custom deck").setHeading();

    new Setting(contentEl)
      .setName("Deck name")
      .addText((text) =>
        text
          .setPlaceholder("Enter deck name")
          .onChange((value) => {
            this.deckName = value;
          })
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .onClick(() => {
            this.close();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Create")
          .setCta()
          .onClick(() => {
            const name = this.deckName.trim();
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
