import { Modal, Component, Notice } from "obsidian";
import type { Deck, Flashcard } from "../database/types";
import type { RatingLabel } from "../algorithm/fsrs";
import type { Scheduler } from "../services/Scheduler";
import type { FlashcardsSettings } from "../settings";
import FlashcardReviewModal from "./FlashcardReviewModal.svelte";

export class FlashcardReviewModalWrapper extends Modal {
  private deck: Deck;
  private initialCard: Flashcard | null;
  private scheduler: Scheduler;
  private settings: FlashcardsSettings;
  private reviewFlashcard: (
    deck: Deck,
    card: Flashcard,
    rating: RatingLabel,
    timeElapsed?: number,
  ) => Promise<void>;
  private renderMarkdown: (
    content: string,
    el: HTMLElement,
  ) => Component | null;
  private refreshStats: () => Promise<void>;
  private refreshStatsById: (deckId: string) => Promise<void>;
  private component: FlashcardReviewModal | null = null;
  private markdownComponents: Component[] = [];

  constructor(
    app: any,
    deck: Deck,
    flashcards: Flashcard[],
    scheduler: Scheduler,
    settings: FlashcardsSettings,
    reviewFlashcard: (
      deck: Deck,
      card: Flashcard,
      rating: RatingLabel,
      timeElapsed?: number,
    ) => Promise<void>,
    renderMarkdown: (content: string, el: HTMLElement) => Component | null,
    refreshStats: () => Promise<void>,
    refreshStatsById: (deckId: string) => Promise<void>,
  ) {
    super(app);
    this.deck = deck;
    this.initialCard = flashcards.length > 0 ? flashcards[0] : null;
    this.scheduler = scheduler;
    this.settings = settings;
    this.reviewFlashcard = reviewFlashcard;
    this.renderMarkdown = renderMarkdown;
    this.refreshStats = refreshStats;
    this.refreshStatsById = refreshStatsById;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("deck-review-modal");

    // Add mobile-specific classes
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("deck-review-modal");
    }

    this.component = new FlashcardReviewModal({
      target: contentEl,
      props: {
        initialCard: this.initialCard,
        deck: this.deck,
        onReview: async (
          card: Flashcard,
          rating: RatingLabel,
          timeElapsed?: number,
        ) => {
          await this.reviewFlashcard(this.deck, card, rating, timeElapsed);
        },
        renderMarkdown: (content: string, el: HTMLElement) => {
          const component = this.renderMarkdown(content, el);
          if (component) {
            this.markdownComponents.push(component);
          }
        },
        settings: this.settings,
        scheduler: this.scheduler,
        onCardReviewed: async (reviewedCard: Flashcard) => {
          // Refresh stats for the specific deck being reviewed (more efficient)
          if (reviewedCard) {
            await this.refreshStatsById(reviewedCard.deckId);
          }
        },
      },
    });

    this.component.$on("complete", async (event) => {
      console.log("Review Complete");
      const { reason, reviewed } = event.detail;
      let message = `Review session complete for ${this.deck.name}!`;

      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(message);
      }
      // Refresh the view to update stats
      await this.refreshStatsById(this.deck.id);

      // Save db
      await this.scheduler.save();
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

  async onClose() {
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
    this.refreshStatsById(this.deck.id);
  }
}
