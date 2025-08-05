import { Modal, Component, Notice } from "obsidian";
import type { Deck, Flashcard } from "../database/types";
import type { Difficulty } from "../algorithm/fsrs";
import type FlashcardsPlugin from "../main";
import FlashcardReviewModal from "./FlashcardReviewModal.svelte";

export class FlashcardReviewModalWrapper extends Modal {
  private plugin: FlashcardsPlugin;
  private deck: Deck;
  private flashcards: Flashcard[];
  private component: FlashcardReviewModal | null = null;
  private markdownComponents: Component[] = [];

  constructor(
    app: any,
    plugin: FlashcardsPlugin,
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
    contentEl.addClass("flashcard-review-modal");

    // Create container for Svelte component
    const container = contentEl.createDiv();

    this.component = new FlashcardReviewModal({
      target: container,
      props: {
        flashcards: this.flashcards,
        deck: this.deck,
        currentIndex: 0,
        onClose: () => this.close(),
        onReview: async (card: Flashcard, difficulty: Difficulty) => {
          await this.plugin.reviewFlashcard(card, difficulty);
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

      new Notice(message);

      // Refresh the view to update stats
      if (this.plugin.view) {
        this.plugin.view.refresh();
      }
    });
  }

  onClose() {
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
