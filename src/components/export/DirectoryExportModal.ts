import { Modal, Notice, Setting, type App } from "obsidian";
import { I18n, isValidDirectorySlug, type DeckWithProfile } from "@decks/core";
import type { DirectoryExporter, DirectoryExportOutput } from "../../services/DirectoryExporter";
import type { DirectoryExportDetails } from "../../settings";
import { makeModalResponsive, type ResponsiveModalHandle } from "../../utils/responsive-modal";

/** Collects a package's details, then builds it from the deck. */
export class DirectoryExportModal extends Modal {
  private handle: ResponsiveModalHandle | null = null;
  private details: DirectoryExportDetails;
  private busy = false;

  constructor(
    app: App,
    private deck: DeckWithProfile,
    private exporter: DirectoryExporter,
    initial: DirectoryExportDetails,
    private onExported: (details: DirectoryExportDetails, output: DirectoryExportOutput) => Promise<void>
  ) {
    super(app);
    this.details = { ...initial };
  }

  onOpen(): void {
    this.handle = makeModalResponsive(this);
    this.setTitle(I18n.t.directory.exportTitle);
    this.render().catch(console.error);
  }

  onClose(): void {
    this.handle?.dispose();
    this.handle = null;
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    const t = I18n.t.directory;
    const { contentEl } = this;
    contentEl.empty();

    const plan = await this.exporter.plan(this.deck);
    contentEl.createEl("p", {
      text: I18n.format(t.exportSummary, { cards: plan.cards.length, media: plan.mediaCount }),
    });
    if (plan.missingMedia.length > 0) {
      contentEl.createEl("p", {
        cls: "decks-directory-export-warning",
        text: I18n.format(t.exportMissing, {
          count: plan.missingMedia.length,
          list: plan.missingMedia.slice(0, 5).join(", "),
        }),
      });
    }

    new Setting(contentEl)
      .setName(t.slugName)
      .setDesc(t.slugDesc)
      .addText((text) => text.setValue(this.details.slug).onChange((value) => (this.details.slug = value.trim())));
    new Setting(contentEl)
      .setName(t.titleName)
      .addText((text) => text.setValue(this.details.title).onChange((value) => (this.details.title = value)));
    new Setting(contentEl)
      .setName(t.descriptionName)
      .addTextArea((area) =>
        area.setValue(this.details.description).onChange((value) => (this.details.description = value))
      );
    new Setting(contentEl)
      .setName(t.languageName)
      .addText((text) => text.setValue(this.details.language).onChange((value) => (this.details.language = value.trim())));
    new Setting(contentEl)
      .setName(t.subjectName)
      .addText((text) => text.setValue(this.details.subject).onChange((value) => (this.details.subject = value.trim())));
    new Setting(contentEl)
      .setName(t.versionName)
      .setDesc(t.versionDesc)
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.setValue(String(this.details.version)).onChange((value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isInteger(parsed) && parsed >= 1) this.details.version = parsed;
        });
      });
    new Setting(contentEl)
      .setName(t.licenseName)
      .addText((text) => text.setValue(this.details.license).onChange((value) => (this.details.license = value.trim())));

    contentEl.createEl("p", { cls: "setting-item-description", text: t.exportStamp });

    const buttons = contentEl.createDiv({ cls: "decks-modal-button-container" });
    buttons.createEl("button", { text: I18n.t.modals.confirm.cancel }).onclick = () => this.close();
    const exportButton = buttons.createEl("button", { text: t.exportButton, cls: "mod-cta" });
    exportButton.onclick = () => {
      exportButton.disabled = true;
      void this.runExport().finally(() => (exportButton.disabled = false));
    };
  }

  private async runExport(): Promise<void> {
    const t = I18n.t.directory;
    if (this.busy) return;
    if (!isValidDirectorySlug(this.details.slug)) {
      new Notice(t.slugDesc);
      return;
    }
    this.busy = true;
    try {
      const output = await this.exporter.export(this.deck, this.details);
      await this.onExported(this.details, output);
      this.close();
    } catch (error) {
      new Notice(I18n.format(t.exportFailed, { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      this.busy = false;
    }
  }
}
