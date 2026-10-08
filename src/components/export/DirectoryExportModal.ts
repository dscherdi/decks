import { Modal, Notice, Setting, type App } from "obsidian";
import { I18n, isValidDirectoryPublisherId,
  isValidDirectorySlug, type DeckWithProfile } from "@decks/core";
import {
  planExportDecks,
  type DirectoryExporter,
  type DirectoryExportOutput,
  type DirectoryExportPlan,
} from "../../services/DirectoryExporter";
import type { DirectoryExportDetails } from "../../settings";
import { makeModalResponsive, type ResponsiveModalHandle } from "../../utils/responsive-modal";

/** Collects a package's details, then builds it from one deck or from every deck of a folder. */
export class DirectoryExportModal extends Modal {
  private handle: ResponsiveModalHandle | null = null;
  private details: DirectoryExportDetails;
  private decks: DeckWithProfile[];
  private plan: DirectoryExportPlan | null = null;
  private busy = false;

  constructor(
    app: App,
    decks: DeckWithProfile[],
    private exporter: DirectoryExporter,
    initial: DirectoryExportDetails,
    private onExported: (details: DirectoryExportDetails, output: DirectoryExportOutput) => Promise<void>
  ) {
    super(app);
    this.details = { ...initial };
    // A remembered order comes first; decks it does not know follow in their own order.
    const order = initial.deckOrder ?? [];
    const rank = (deck: DeckWithProfile): number => {
      const index = order.indexOf(deck.filepath);
      return index < 0 ? order.length : index;
    };
    this.decks = [...decks].sort((a, b) => rank(a) - rank(b));
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

  private move(index: number, by: number): void {
    const target = index + by;
    if (target < 0 || target >= this.decks.length) return;
    const next = [...this.decks];
    [next[index], next[target]] = [next[target], next[index]];
    this.decks = next;
    this.render().catch(console.error);
  }

  private async render(): Promise<void> {
    const t = I18n.t.directory;
    const { contentEl } = this;
    this.plan ??= await this.exporter.plan(this.decks, this.details);
    contentEl.empty();

    contentEl.createEl("p", {
      text: I18n.format(t.exportSummary, { cards: this.plan.cardCount, media: this.plan.mediaCount }),
    });
    if (this.plan.missingMedia.length > 0) {
      contentEl.createEl("p", {
        cls: "decks-directory-export-warning",
        text: I18n.format(t.exportMissing, {
          count: this.plan.missingMedia.length,
          list: this.plan.missingMedia.slice(0, 5).join(", "),
        }),
      });
    }

    if (this.decks.length > 1) {
      new Setting(contentEl).setName(t.exportDecksName).setDesc(t.exportDecksDesc).setHeading();
      planExportDecks(this.decks, this.details.deckKeys).forEach(({ deck, key, title }, index) => {
        const exam = deck.profile.examEnabled === true ? ` · ${I18n.t.views.exam}` : "";
        new Setting(contentEl)
          .setName(title)
          .setDesc(`${key}${exam}`)
          .addExtraButton((button) =>
            button
              .setIcon("arrow-up")
              .setTooltip(t.moveUp)
              .setDisabled(index === 0)
              .onClick(() => this.move(index, -1))
          )
          .addExtraButton((button) =>
            button
              .setIcon("arrow-down")
              .setTooltip(t.moveDown)
              .setDisabled(index === this.decks.length - 1)
              .onClick(() => this.move(index, 1))
          );
      });
    }

    new Setting(contentEl)
      .setName(t.slugName)
      .setDesc(t.slugDesc)
      .addText((text) => text.setValue(this.details.slug).onChange((value) => (this.details.slug = value.trim())));
    const publisher = this.details.publisher ?? { id: "", name: "" };
    this.details.publisher = publisher;
    new Setting(contentEl)
      .setName(t.publisherName)
      .setDesc(t.publisherNameDesc)
      .addText((text) => text.setValue(publisher.name).onChange((value) => (publisher.name = value.trim())));
    new Setting(contentEl)
      .setName(t.publisherHandle)
      .setDesc(t.publisherHandleDesc)
      .addText((text) => text.setValue(publisher.id).onChange((value) => (publisher.id = value.trim())));
    new Setting(contentEl)
      .setName(t.titleName)
      .addText((text) => text.setValue(this.details.title).onChange((value) => (this.details.title = value)));
    const description = new Setting(contentEl)
      .setName(t.descriptionName)
      .setDesc(t.descriptionDesc)
      .addTextArea((area) => {
        area.inputEl.rows = 8;
        area.setValue(this.details.description).onChange((value) => (this.details.description = value));
      });
    description.settingEl.addClass("decks-directory-export-description");
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
    if (!isValidDirectoryPublisherId(this.details.publisher?.id ?? "")) {
      new Notice(t.publisherHandleDesc);
      return;
    }
    this.busy = true;
    try {
      const output = await this.exporter.export(this.decks, this.details);
      await this.onExported(
        {
          ...this.details,
          deckKeys: { ...this.details.deckKeys, ...output.deckKeys },
          deckOrder: this.decks.map((deck) => deck.filepath),
        },
        output
      );
      this.close();
    } catch (error) {
      new Notice(I18n.format(t.exportFailed, { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      this.busy = false;
    }
  }
}
