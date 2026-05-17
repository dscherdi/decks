import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { CustomDeckService } from "../services/CustomDeckService";
import type { FilterDefinition } from "../database/types";
import type { DecksSettings } from "../settings";
import FlashcardManagerPanel from "./FlashcardManagerPanel.svelte";
import type {
  EditTarget,
  EditCommitPayload,
} from "./FlashcardManagerEditTypes";
import { mount, unmount } from "svelte";
import {
  FlashcardManagerModal,
  type FlashcardManagerComponent,
  type FlashcardManagerThresholds,
} from "./FlashcardManagerModal";

export const VIEW_TYPE_FLASHCARD_MANAGER = "flashcard-manager-view";

export class FlashcardManagerView extends ItemView {
  private db: IDatabaseService;
  private customDeckService: CustomDeckService;
  private settings: DecksSettings;

  private editingCustomDeck: EditTarget | null = null;
  private thresholds: FlashcardManagerThresholds;
  private onDeckListChanged?: () => void | Promise<void>;

  private component: FlashcardManagerComponent | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    db: IDatabaseService,
    customDeckService: CustomDeckService,
    settings: DecksSettings,
  ) {
    super(leaf);
    this.db = db;
    this.customDeckService = customDeckService;
    this.settings = settings;
    this.thresholds = {
      leechThreshold: settings.review.leechThreshold,
      denseCardCharThreshold: settings.review.denseCardCharThreshold,
    };
  }

  getViewType(): string {
    return VIEW_TYPE_FLASHCARD_MANAGER;
  }

  getDisplayText(): string {
    if (this.editingCustomDeck) {
      return `Manage: ${this.editingCustomDeck.name}`;
    }
    return "Flashcard manager";
  }

  getIcon(): string {
    return "layers";
  }

  setManagerData(
    thresholds: FlashcardManagerThresholds,
    editingCustomDeck: EditTarget | null,
    onDeckListChanged?: () => void | Promise<void>,
  ): void {
    this.thresholds = thresholds;
    this.editingCustomDeck = editingCustomDeck;
    this.onDeckListChanged = onDeckListChanged;
    this.leaf.updateHeader();
    this.mountComponent();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-flashcard-manager-tab-container");
    this.mountComponent();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onClose(): Promise<void> {
    this.unmountComponent();
    this.contentEl.empty();
  }

  private mountComponent(): void {
    this.unmountComponent();

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-flashcard-manager-tab-container");

    this.component = mount(FlashcardManagerPanel, {
      target: contentEl,
      props: {
        db: this.db,
        customDeckService: this.customDeckService,
        leechThreshold: this.thresholds.leechThreshold,
        denseCardCharThreshold: this.thresholds.denseCardCharThreshold,
        initialEditTarget: this.editingCustomDeck,
        onCommitEdit: async (
          target: EditTarget,
          payload: EditCommitPayload,
        ) => {
          try {
            if (payload.kind === "filter") {
              await this.customDeckService.updateFilter(target.id, payload.definition);
              new Notice(`Filter deck "${target.name}" updated`);
            } else {
              if (payload.toAdd.length > 0) {
                await this.customDeckService.addFlashcards(target.id, payload.toAdd);
              }
              if (payload.toRemove.length > 0) {
                await this.customDeckService.removeFlashcards(target.id, payload.toRemove);
              }
              new Notice(
                `Updated "${target.name}" — ${payload.toAdd.length} added, ${payload.toRemove.length} removed`,
              );
            }
            await this.onDeckListChanged?.();
            this.leaf.detach();
          } catch (error) {
            new Notice(`Failed to save: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        onCreateCustomDeck: async (name: string, flashcardIds: string[]) => {
          try {
            const deck = await this.customDeckService.createCustomDeck(name);
            if (flashcardIds.length > 0) {
              await this.customDeckService.addFlashcards(deck.id, flashcardIds);
            }
            new Notice(`Created custom deck "${name}" with ${flashcardIds.length} cards`);
            await this.onDeckListChanged?.();
          } catch (error) {
            new Notice(`Failed to create deck: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        onCreateFilterDeck: async (name: string, definition: FilterDefinition) => {
          try {
            await this.customDeckService.createFilterDeck(name, definition);
            new Notice(`Created filter deck "${name}"`);
            await this.onDeckListChanged?.();
          } catch (error) {
            new Notice(`Failed to create filter deck: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        onAddToCustomDeck: async (customDeckId: string, flashcardIds: string[]) => {
          try {
            await this.customDeckService.addFlashcards(customDeckId, flashcardIds);
            new Notice(`Added ${flashcardIds.length} cards to custom deck`);
            await this.onDeckListChanged?.();
          } catch (error) {
            new Notice(`Failed to add cards: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      },
    }) as FlashcardManagerComponent;
  }

  private unmountComponent(): void {
    if (this.component) {
      try {
        void unmount(this.component);
      } catch (e) {
        console.warn("Error unmounting flashcard manager component:", e);
      }
      this.component = null;
    }
  }
}

/**
 * Branches on `ui.flashcardManagerDisplayMode` to either pop the modal or
 * route into a workspace tab. Centralized so the five callers don't have to
 * each repeat the same dispatch.
 */
export function openFlashcardManager(
  app: App,
  db: IDatabaseService,
  customDeckService: CustomDeckService,
  settings: DecksSettings,
  editingCustomDeck?: EditTarget,
  onDeckListChanged?: () => void | Promise<void>,
): void {
  const thresholds: FlashcardManagerThresholds = {
    leechThreshold: settings.review.leechThreshold,
    denseCardCharThreshold: settings.review.denseCardCharThreshold,
  };

  if (settings.ui.flashcardManagerDisplayMode === "tab") {
    const { workspace } = app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_FLASHCARD_MANAGER);
    const leaf = existing.length > 0 ? existing[0] : workspace.getLeaf("tab");

    void leaf
      .setViewState({ type: VIEW_TYPE_FLASHCARD_MANAGER, active: true })
      .then(() => {
        const view = leaf.view;
        if (view instanceof FlashcardManagerView) {
          view.setManagerData(thresholds, editingCustomDeck ?? null, onDeckListChanged);
        }
        void workspace.revealLeaf(leaf);
      })
      .catch(console.error);
    return;
  }

  new FlashcardManagerModal(
    app,
    db,
    customDeckService,
    thresholds,
    editingCustomDeck,
    onDeckListChanged,
  ).open();
}
