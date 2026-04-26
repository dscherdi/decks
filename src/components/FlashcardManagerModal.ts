import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { CustomDeckService } from "../services/CustomDeckService";
import FlashcardManagerPanel from "./FlashcardManagerPanel.svelte";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";

export type FlashcardManagerComponent = Svelte5MountedComponent;

interface EditCustomDeckOptions {
  id: string;
  name: string;
}

export class FlashcardManagerModal extends Modal {
  private db: IDatabaseService;
  private customDeckService: CustomDeckService;
  private component: FlashcardManagerComponent | null = null;
  private resizeHandler?: () => void;
  private editingCustomDeck: EditCustomDeckOptions | null;

  constructor(
    app: App,
    db: IDatabaseService,
    customDeckService: CustomDeckService,
    editingCustomDeck?: EditCustomDeckOptions,
  ) {
    super(app);
    this.db = db;
    this.customDeckService = customDeckService;
    this.editingCustomDeck = editingCustomDeck ?? null;
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
        db: this.db,
        customDeckService: this.customDeckService,
        editingCustomDeckId: this.editingCustomDeck?.id ?? null,
        editingCustomDeckName: this.editingCustomDeck?.name ?? null,
        onCreateCustomDeck: async (name: string, flashcardIds: string[]) => {
          try {
            const deck = await this.customDeckService.createCustomDeck(name);
            await this.customDeckService.addFlashcards(deck.id, flashcardIds);
            new Notice(`Created custom deck "${name}" with ${flashcardIds.length} cards`);
          } catch (error) {
            new Notice(`Failed to create deck: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        onAddToCustomDeck: async (customDeckId: string, flashcardIds: string[]) => {
          try {
            await this.customDeckService.addFlashcards(customDeckId, flashcardIds);
            new Notice(`Added ${flashcardIds.length} cards to custom deck`);
          } catch (error) {
            new Notice(`Failed to add cards: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        onRemoveFromCustomDeck: this.editingCustomDeck
          ? async (customDeckId: string, flashcardIds: string[]) => {
              try {
                await this.customDeckService.removeFlashcards(customDeckId, flashcardIds);
                new Notice(`Removed ${flashcardIds.length} cards from custom deck`);
              } catch (error) {
                new Notice(`Failed to remove cards: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          : null,
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
