import { Modal, Component, Notice, MarkdownRenderer } from "obsidian";
import type { Deck, Flashcard } from "../database/types";
import type { RatingLabel } from "../algorithm/fsrs";
import type { Scheduler } from "../services/Scheduler";
import type { FlashcardsSettings } from "../settings";
import type { DatabaseServiceInterface } from "../database/DatabaseFactory";
import type {
  FlashcardReviewComponent,
  CompleteEventDetail,
} from "../types/svelte-components";
import FlashcardReviewModal from "./FlashcardReviewModal.svelte";

export class FlashcardReviewModalWrapper extends Modal {
  private deck: Deck;
  private initialCard: Flashcard | null;
  private scheduler: Scheduler;
  private settings: FlashcardsSettings;
  private db: DatabaseServiceInterface;
  private refreshStats: () => Promise<void>;
  private refreshStatsById: (deckId: string) => Promise<void>;
  private component: FlashcardReviewComponent | null = null;
  private markdownComponents: Component[] = [];
  private resizeHandler?: () => void;

  private renderMarkdown(content: string, el: HTMLElement): Component | null {
    try {
      const component = new Component();
      MarkdownRenderer.renderMarkdown(content, el, "", component);
      return component;
    } catch (error) {
      console.error("Error rendering markdown:", error);
      el.textContent = content;
      return null;
    }
  }

  constructor(
    app: any,
    deck: Deck,
    flashcards: Flashcard[],
    scheduler: Scheduler,
    settings: FlashcardsSettings,
    db: DatabaseServiceInterface,
    refreshStats: () => Promise<void>,
    refreshStatsById: (deckId: string) => Promise<void>,
  ) {
    super(app);
    this.deck = deck;
    this.initialCard = flashcards.length > 0 ? flashcards[0] : null;
    this.scheduler = scheduler;
    this.settings = settings;
    this.db = db;
    this.refreshStats = refreshStats;
    this.refreshStatsById = refreshStatsById;
  }

  private async reviewFlashcard(
    deck: Deck,
    flashcard: Flashcard,
    difficulty: "again" | "hard" | "good" | "easy",
    timeElapsed?: number,
    shownAt?: Date,
  ): Promise<void> {
    // Use unified scheduler for rating
    await this.scheduler.rate(
      flashcard.id,
      difficulty,
      new Date(),
      timeElapsed,
      shownAt,
    );

    // Update deck last reviewed
    await this.db.updateDeckLastReviewed(
      flashcard.deckId,
      new Date().toISOString(),
    );

    // Refresh stats for this specific deck
    await this.refreshStatsById(flashcard.deckId);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Add mobile-specific classes
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");

      if (window.innerWidth <= 768) {
        modalEl.addClass("decks-modal-mobile");
      } else {
        modalEl.removeClass("decks-modal-mobile");
      }
    }

    contentEl.addClass("decks-review-modal-container");

    this.component = new FlashcardReviewModal({
      target: contentEl,
      props: {
        initialCard: this.initialCard,
        deck: this.deck,
        onReview: async (
          card: Flashcard,
          rating: RatingLabel,
          timeElapsed?: number,
          shownAt?: Date,
        ) => {
          await this.reviewFlashcard(
            this.deck,
            card,
            rating,
            timeElapsed,
            shownAt,
          );
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
    }) as FlashcardReviewComponent;

    this.component.$on("complete", async (event: any) => {
      console.log("Review Complete");
      const { reason, reviewed } = event.detail as CompleteEventDetail;
      let message = `Review session complete for ${this.deck.name}!`;

      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(message);
      }
      // Refresh the view to update stats
      await this.refreshStatsById(this.deck.id);
    });

    // Handle window resize for mobile adaptation
    const handleResize = () => {
      const modalEl = this.containerEl.querySelector(".modal");
      if (modalEl instanceof HTMLElement) {
        if (window.innerWidth <= 768) {
          modalEl.addClass("decks-modal-mobile");
        } else {
          modalEl.removeClass("decks-modal-mobile");
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Store resize handler for cleanup
    this.resizeHandler = handleResize;
  }

  async onClose() {
    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
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
