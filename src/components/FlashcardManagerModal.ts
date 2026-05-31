import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { CustomDeckService } from "../services/CustomDeckService";
import type { FilterDefinition, Flashcard } from "../database/types";
import type { DecksSettings } from "../settings";
import FlashcardManagerPanel from "./FlashcardManagerPanel.svelte";
import type {
  EditTarget,
  EditCommitPayload,
} from "./FlashcardManagerEditTypes";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";
import { I18n } from "@decks/core";

export type FlashcardManagerComponent = Svelte5MountedComponent;

// Kept as an alias for callers that imported the old name.
export type EditCustomDeckTarget = EditTarget;

export interface FlashcardManagerThresholds {
  leechThreshold: number;
  denseCardCharThreshold: number;
}

export class FlashcardManagerModal extends Modal {
  private db: IDatabaseService;
  private customDeckService: CustomDeckService;
  private component: FlashcardManagerComponent | null = null;
  private resizeHandler?: () => void;
  private editingCustomDeck: EditTarget | null;
  private thresholds: FlashcardManagerThresholds;
  private onDeckListChanged?: () => void | Promise<void>;
  private onCleanupOrphans?: () => Promise<void>;
  private initialColumnWidths: Record<string, number>;
  private onColumnWidthsChange?: (widths: Record<string, number>) => void;
  private onEditCard?: (card: Flashcard) => Promise<void>;
  private onBatchRefactor?: (cards: Flashcard[]) => Promise<void>;
  private settings?: DecksSettings;

  constructor(
    app: App,
    db: IDatabaseService,
    customDeckService: CustomDeckService,
    thresholds: FlashcardManagerThresholds,
    editingCustomDeck?: EditTarget,
    onDeckListChanged?: () => void | Promise<void>,
    onCleanupOrphans?: () => Promise<void>,
    initialColumnWidths: Record<string, number> = {},
    onColumnWidthsChange?: (widths: Record<string, number>) => void,
    onEditCard?: (card: Flashcard) => Promise<void>,
    settings?: DecksSettings,
    onBatchRefactor?: (cards: Flashcard[]) => Promise<void>,
  ) {
    super(app);
    this.db = db;
    this.customDeckService = customDeckService;
    this.thresholds = thresholds;
    this.editingCustomDeck = editingCustomDeck ?? null;
    this.onDeckListChanged = onDeckListChanged;
    this.onCleanupOrphans = onCleanupOrphans;
    this.initialColumnWidths = initialColumnWidths;
    this.onColumnWidthsChange = onColumnWidthsChange;
    this.onEditCard = onEditCard;
    this.settings = settings;
    this.onBatchRefactor = onBatchRefactor;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      modalEl.addClass("decks-flashcard-manager-modal");
      if (window.innerWidth <= 768) {
        modalEl.addClass("decks-modal-mobile");
      } else {
        modalEl.removeClass("decks-modal-mobile");
      }
    }

    this.component = mount(FlashcardManagerPanel, {
      target: contentEl,
      props: {
        app: this.app,
        db: this.db,
        customDeckService: this.customDeckService,
        leechThreshold: this.thresholds.leechThreshold,
        denseCardCharThreshold: this.thresholds.denseCardCharThreshold,
        nextDayStartsAt: this.settings?.review?.nextDayStartsAt ?? 4,
        showNotices: this.settings?.ui?.enableNotices !== false,
        initialEditTarget: this.editingCustomDeck,
        onCleanupOrphans: this.onCleanupOrphans ?? null,
        initialColumnWidths: this.initialColumnWidths,
        onColumnWidthsChange: this.onColumnWidthsChange ?? null,
        onEditCard: this.onEditCard ?? null,
        aiEnabled: this.settings?.ai.enabled ?? false,
        onBatchRefactor: this.onBatchRefactor ?? null,
        onCommitEdit: async (
          target: EditTarget,
          payload: EditCommitPayload
        ) => {
          try {
            if (payload.kind === "filter") {
              await this.customDeckService.updateFilter(target.id, payload.definition);
              new Notice(I18n.format(I18n.t.notices.filterDeckUpdated, { name: target.name }));
            } else {
              if (payload.toAdd.length > 0) {
                await this.customDeckService.addFlashcards(target.id, payload.toAdd);
              }
              if (payload.toRemove.length > 0) {
                await this.customDeckService.removeFlashcards(target.id, payload.toRemove);
              }
              new Notice(
                I18n.format(I18n.t.notices.customDeckUpdatedCounts, {
                  name: target.name,
                  added: payload.toAdd.length,
                  removed: payload.toRemove.length,
                })
              );
            }
            await this.onDeckListChanged?.();
            this.close();
          } catch (error) {
            new Notice(
              I18n.format(I18n.t.notices.failedToSave, {
                message: error instanceof Error ? error.message : String(error),
              })
            );
          }
        },
        onCreateCustomDeck: async (name: string, flashcardIds: string[]) => {
          try {
            const deck = await this.customDeckService.createCustomDeck(name);
            if (flashcardIds.length > 0) {
              await this.customDeckService.addFlashcards(deck.id, flashcardIds);
            }
            new Notice(
              I18n.format(I18n.t.notices.customDeckCreated, {
                name,
                count: flashcardIds.length,
              })
            );
            await this.onDeckListChanged?.();
          } catch (error) {
            new Notice(
              I18n.format(I18n.t.notices.failedToCreateDeck, {
                message: error instanceof Error ? error.message : String(error),
              })
            );
          }
        },
        onCreateFilterDeck: async (name: string, definition: FilterDefinition) => {
          try {
            await this.customDeckService.createFilterDeck(name, definition);
            new Notice(I18n.format(I18n.t.notices.filterDeckCreated, { name }));
            await this.onDeckListChanged?.();
          } catch (error) {
            new Notice(
              I18n.format(I18n.t.notices.failedToCreateFilterDeck, {
                message: error instanceof Error ? error.message : String(error),
              })
            );
          }
        },
        onAddToCustomDeck: async (customDeckId: string, flashcardIds: string[]) => {
          try {
            await this.customDeckService.addFlashcards(customDeckId, flashcardIds);
            new Notice(
              I18n.format(I18n.t.notices.cardsAddedToCustomDeck, {
                count: flashcardIds.length,
              })
            );
            await this.onDeckListChanged?.();
          } catch (error) {
            new Notice(
              I18n.format(I18n.t.notices.failedToAddCards, {
                message: error instanceof Error ? error.message : String(error),
              })
            );
          }
        },
      },
    }) as FlashcardManagerComponent;

    const handleResize = () => {
      if (modalEl instanceof HTMLElement) {
        if (window.innerWidth <= 768) {
          modalEl.addClass("decks-modal-mobile");
        } else {
          modalEl.removeClass("decks-modal-mobile");
        }
      }
    };
    window.addEventListener("resize", handleResize);
    this.resizeHandler = handleResize;
  }

  onClose() {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }

    if (this.component) {
      void unmount(this.component);
      this.component = null;
    }

    this.contentEl.empty();
  }
}
