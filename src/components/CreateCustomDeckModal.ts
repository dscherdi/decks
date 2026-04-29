import { Modal, Setting, Notice } from "obsidian";
import type { App } from "obsidian";
import type { FilterDefinition, CustomDeckType } from "../database/types";
import type { CustomDeckService } from "../services/CustomDeckService";
import type { IDatabaseService } from "../database/DatabaseFactory";
import FilterBuilder from "./FilterBuilder.svelte";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";

export class CreateCustomDeckModal extends Modal {
  private deckName = "";
  private deckType: CustomDeckType = "filter";
  private filterDefinition: FilterDefinition = { version: 1, logic: "AND", rules: [] };
  private previewTimeout: ReturnType<typeof setTimeout> | null = null;
  private filterComponent: Svelte5MountedComponent | null = null;
  private filterContainer: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private existingNames: string[];
  private customDeckService: CustomDeckService;
  private db: IDatabaseService;
  private onCreated: () => void;

  constructor(
    app: App,
    existingNames: string[],
    customDeckService: CustomDeckService,
    db: IDatabaseService,
    onCreated: () => void,
  ) {
    super(app);
    this.existingNames = existingNames;
    this.customDeckService = customDeckService;
    this.db = db;
    this.onCreated = onCreated;
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
      .setName("Deck type")
      .setDesc("Filter decks dynamically match cards based on rules")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("filter", "Filter (dynamic)")
          .addOption("manual", "Manual (static)")
          .setValue(this.deckType)
          .onChange((value) => {
            this.deckType = value as CustomDeckType;
            this.renderFilterSection();
          })
      );

    this.filterContainer = contentEl.createDiv("decks-create-deck-filter-section");
    this.renderFilterSection();

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
            this.handleCreate();
          })
      );
  }

  private renderFilterSection() {
    if (!this.filterContainer) return;

    if (this.filterComponent) {
      void unmount(this.filterComponent);
      this.filterComponent = null;
    }
    this.filterContainer.empty();
    this.previewEl = null;

    if (this.deckType !== "filter") return;

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

  private handleCreate() {
    const name = this.deckName.trim();
    if (!name) {
      new Notice("Please enter a deck name");
      return;
    }
    if (this.existingNames.includes(name)) {
      new Notice(`A deck named "${name}" already exists`);
      return;
    }

    if (this.deckType === "filter") {
      this.customDeckService.createFilterDeck(name, this.filterDefinition)
        .then(() => {
          new Notice(`Created filter deck "${name}"`);
          this.onCreated();
          this.close();
        })
        .catch((err: Error) => {
          new Notice(`Failed to create deck: ${err.message}`);
        });
    } else {
      this.customDeckService.createCustomDeck(name)
        .then(() => {
          new Notice(`Created custom deck "${name}"`);
          this.onCreated();
          this.close();
        })
        .catch((err: Error) => {
          new Notice(`Failed to create deck: ${err.message}`);
        });
    }
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
