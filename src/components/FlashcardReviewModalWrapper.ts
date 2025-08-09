import { Modal, Component, Notice } from "obsidian";
import type { Deck, Flashcard } from "../database/types";
import type { Difficulty } from "../algorithm/fsrs";
import type DecksPlugin from "../main";
import FlashcardReviewModal from "./FlashcardReviewModal.svelte";

export class FlashcardReviewModalWrapper extends Modal {
  private plugin: DecksPlugin;
  private deck: Deck;
  private flashcards: Flashcard[];
  private component: FlashcardReviewModal | null = null;
  private markdownComponents: Component[] = [];

  constructor(
    app: any,
    plugin: DecksPlugin,
    deck: Deck,
    flashcards: Flashcard[],
  ) {
    super(app);
    this.plugin = plugin;
    this.deck = deck;
    this.flashcards = flashcards;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("deck-review-modal");

    // Add mobile-specific classes
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement && window.innerWidth <= 768) {
      modalEl.addClass("deck-review-modal-mobile");
    }

    // Create container for Svelte component
    const container = contentEl.createDiv();

    this.component = new FlashcardReviewModal({
      target: container,
      props: {
        flashcards: this.flashcards,
        deck: this.deck,
        currentIndex: 0,
        onClose: () => this.close(),
        onReview: async (
          card: Flashcard,
          difficulty: Difficulty,
          timeElapsed?: number,
        ) => {
          await this.plugin.reviewFlashcard(card, difficulty, timeElapsed);
        },
        renderMarkdown: (content: string, el: HTMLElement) => {
          const component = this.plugin.renderMarkdown(content, el);
          if (component) {
            this.markdownComponents.push(component);
          }
        },
        settings: this.plugin.settings,
        onCardReviewed: async (reviewedCard: Flashcard) => {
          // Refresh stats for the specific deck being reviewed (more efficient)
          if (this.plugin.view && reviewedCard) {
            await this.plugin.view.refreshStatsById(reviewedCard.deckId);
          }
        },
      },
    });

    this.component.$on("complete", (event) => {
      const { reason, reviewed } = event.detail;
      let message = `Review session complete for ${this.deck.name}!`;

      if (reason === "no-more-cards") {
        message = `All available cards reviewed! Completed ${reviewed} cards from ${this.deck.name}.`;
      }

      if (this.plugin.settings?.ui?.enableNotices !== false) {
        new Notice(message);
      }

      // Refresh the view to update stats
      if (this.plugin.view) {
        this.plugin.view.refresh();
      }
    });

    // Handle window resize for mobile adaptation
    const handleResize = () => {
      const modalEl = this.containerEl.querySelector(".modal");
      if (modalEl instanceof HTMLElement) {
        if (window.innerWidth <= 768) {
          modalEl.addClass("deck-review-modal-mobile");
        } else {
          modalEl.removeClass("deck-review-modal-mobile");
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Store resize handler for cleanup
    (this as any)._resizeHandler = handleResize;
  }

  onClose() {
    // Clean up resize handler
    if ((this as any)._resizeHandler) {
      window.removeEventListener("resize", (this as any)._resizeHandler);
      delete (this as any)._resizeHandler;
    }

    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }

    // Clean up markdown components
    this.markdownComponents.forEach((comp) => comp.unload());
    this.markdownComponents = [];

    // Refresh view when closing
    if (this.plugin.view) {
      this.plugin.view.refresh();
    }
  }
}
