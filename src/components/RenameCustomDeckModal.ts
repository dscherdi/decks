import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";

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

    new Setting(contentEl).setName("Rename custom deck").setHeading();

    new Setting(contentEl)
      .setName("Deck name")
      .addText((text) =>
        text
          .setValue(this.newName)
          .setPlaceholder("Enter new name")
          .onChange((value) => {
            this.newName = value;
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
          .setButtonText("Rename")
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
