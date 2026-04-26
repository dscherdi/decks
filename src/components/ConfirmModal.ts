import { Modal } from "obsidian";
import type { App } from "obsidian";

export class ConfirmModal extends Modal {
  private title: string;
  private message: string;
  private confirmText: string;
  private onConfirm: () => void;
  private isDanger: boolean;

  constructor(
    app: App,
    options: {
      title: string;
      message: string;
      confirmText?: string;
      isDanger?: boolean;
      onConfirm: () => void;
    },
  ) {
    super(app);
    this.title = options.title;
    this.message = options.message;
    this.confirmText = options.confirmText ?? "Confirm";
    this.isDanger = options.isDanger ?? false;
    this.onConfirm = options.onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.setTitle(this.title);

    contentEl.createEl("p", { text: this.message });

    const buttonContainer = contentEl.createDiv({
      cls: "decks-modal-button-container",
    });

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.onclick = () => this.close();

    const confirmButton = buttonContainer.createEl("button", {
      text: this.confirmText,
      cls: this.isDanger ? "mod-warning" : "mod-cta",
    });
    confirmButton.onclick = () => {
      this.close();
      this.onConfirm();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
