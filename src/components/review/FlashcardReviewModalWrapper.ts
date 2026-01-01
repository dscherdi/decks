import { Modal, Component, Notice, MarkdownRenderer, App } from "obsidian";
import type { Deck, Flashcard } from "../../database/types";
import type { RatingLabel } from "../../algorithm/fsrs";
import type { Scheduler } from "../../services/Scheduler";
import type { DecksSettings } from "../../settings";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type {
  FlashcardReviewComponent,
  CompleteEventDetail,
} from "../../types/svelte-components";
import FlashcardReviewModal from "./FlashcardReviewModal.svelte";
import { mount, unmount } from "svelte";

export class FlashcardReviewModalWrapper extends Modal {
  private deck: Deck;
  private initialCard: Flashcard | null;
  private scheduler: Scheduler;
  private settings: DecksSettings;
  private db: IDatabaseService;
  private refreshStats: () => Promise<void>;
  private refreshStatsById: (deckId: string) => Promise<void>;
  private component: FlashcardReviewComponent | null = null;
  private markdownComponents: Component[] = [];
  private resizeHandler?: () => void;

  private renderMarkdown(content: string, el: HTMLElement): Component | null {
    try {
      const component = new Component();
      void MarkdownRenderer.render(this.app, content, el, "", component);
      return component;
    } catch (error) {
      console.error("Error rendering markdown:", error);
      el.textContent = content;
      return null;
    }
  }

  constructor(
    app: App,
    deck: Deck,
    flashcards: Flashcard[],
    scheduler: Scheduler,
    settings: DecksSettings,
    db: IDatabaseService,
    refreshStats: () => Promise<void>,
    refreshStatsById: (deckId: string) => Promise<void>
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
    shownAt?: Date
  ): Promise<void> {
    // Use unified scheduler for rating
    await this.scheduler.rate(flashcard.id, difficulty, timeElapsed, shownAt);

    // Update deck last reviewed
    await this.db.updateDeckLastReviewed(
      flashcard.deckId,
      new Date().toISOString()
    );

    // Refresh stats for this specific deck
    await this.refreshStatsById(flashcard.deckId);
  }

  onOpen() {
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

    this.component = mount(FlashcardReviewModal, {
      target: contentEl,
      props: {
        initialCard: this.initialCard,
        deck: this.deck,
        onReview: async (
          card: Flashcard,
          rating: RatingLabel,
          timeElapsed?: number,
          shownAt?: Date
        ) => {
          await this.reviewFlashcard(
            this.deck,
            card,
            rating,
            timeElapsed,
            shownAt
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
        onComplete: async (_event: CompleteEventDetail) => {
          const message = `Review session complete for ${this.deck.name}!`;

          if (this.settings?.ui?.enableNotices !== false) {
            new Notice(message);
          }
          // Refresh the view to update stats
          await this.refreshStatsById(this.deck.id);
        },
      },
    }) as FlashcardReviewComponent;

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

  onClose() {
    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }

    if (this.component) {
      // Svelte 5: explicitly unmount to trigger onDestroy and cleanup listeners
      try {
        void unmount(this.component);
      } catch (e) {
        console.warn("Error unmounting flashcard review component:", e);
      }
      this.component = null;
    }

    // Clean up markdown components
    this.markdownComponents.forEach((comp) => comp.unload());
    this.markdownComponents = [];

    // Refresh view when closing
    this.refreshStatsById(this.deck.id).catch(console.error);
  }
}
