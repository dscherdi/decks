import { Modal, Setting, Notice } from "obsidian";
import type { App } from "obsidian";
import type { FilterDefinition, CustomDeckGroup } from "../database/types";
import type { CustomDeckService } from "../services/CustomDeckService";
import type { IDatabaseService } from "../database/DatabaseFactory";
import FilterBuilder from "./FilterBuilder.svelte";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";

export class EditFilterModal extends Modal {
  private filterDefinition: FilterDefinition;
  private previewTimeout: ReturnType<typeof setTimeout> | null = null;
  private filterComponent: Svelte5MountedComponent | null = null;
  private filterContainer: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private customDeck: CustomDeckGroup;
  private customDeckService: CustomDeckService;
  private db: IDatabaseService;
  private onSaved: () => void;

  constructor(
    app: App,
    customDeck: CustomDeckGroup,
    customDeckService: CustomDeckService,
    db: IDatabaseService,
    onSaved: () => void,
  ) {
    super(app);
    this.customDeck = customDeck;
    this.customDeckService = customDeckService;
    this.db = db;
    this.onSaved = onSaved;
    this.filterDefinition = customDeck.filterDefinition
      ? JSON.parse(customDeck.filterDefinition) as FilterDefinition
      : { version: 1, logic: "AND" as const, rules: [] };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl)
      .setName(`Edit filter: ${this.customDeck.name}`)
      .setHeading();

    this.filterContainer = contentEl.createDiv("decks-edit-filter-section");
    this.renderFilterBuilder();

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
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            this.handleSave();
          })
      );
  }

  private renderFilterBuilder() {
    if (!this.filterContainer) return;

    if (this.filterComponent) {
      void unmount(this.filterComponent);
      this.filterComponent = null;
    }
    this.filterContainer.empty();
    this.previewEl = null;

    this.loadFilterData()
      .then(({ decks, tags, cardTags }) => {
        if (!this.filterContainer) return;
        this.filterComponent = mount(FilterBuilder, {
          target: this.filterContainer,
          props: {
            filterDefinition: this.filterDefinition,
            onChange: (def: FilterDefinition) => {
              this.filterDefinition = def;
              this.schedulePreview();
            },
            previewCount: null,
            availableDecks: decks,
            availableTags: tags,
            availableCardTags: cardTags,
          },
        }) as Svelte5MountedComponent;
        this.previewEl = this.filterContainer.createDiv("decks-filter-preview-count");
        this.schedulePreview();
      })
      .catch(console.error);
  }

  private async loadFilterData(): Promise<{ decks: { id: string; name: string }[]; tags: string[]; cardTags: string[] }> {
    const allDecks = await this.db.getAllDecks();
    const decks = allDecks.map(d => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name));
    const tags = [...new Set(allDecks.map(d => d.tag))].sort();
    const cardTags = await this.db.getAllFlashcardTags();
    return { decks, tags, cardTags };
  }

  private schedulePreview() {
    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
    }
    this.previewTimeout = setTimeout(() => {
      this.updatePreview();
    }, 300);
  }

  private updatePreview() {
    this.customDeckService.previewFilter(this.filterDefinition)
      .then((count) => {
        if (this.previewEl) {
          this.previewEl.empty();
          this.previewEl.appendText(`${count} card${count !== 1 ? "s" : ""} match`);
        }
      })
      .catch(console.error);
  }

  private handleSave() {
    this.customDeckService.updateFilter(this.customDeck.id, this.filterDefinition)
      .then(() => {
        new Notice(`Filter updated for "${this.customDeck.name}"`);
        this.onSaved();
        this.close();
      })
      .catch((err: Error) => {
        new Notice(`Failed to update filter: ${err.message}`);
      });
  }

  onClose() {
    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
    }
    if (this.filterComponent) {
      void unmount(this.filterComponent);
      this.filterComponent = null;
    }
    this.contentEl.empty();
  }
}
