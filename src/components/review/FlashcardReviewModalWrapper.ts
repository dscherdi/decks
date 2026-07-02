import { Modal, Component, Notice, MarkdownRenderer, App } from "obsidian";
import type { Flashcard, DeckOrGroup } from "../../database/types";
import { type RatingLabel, type ResolvedRender } from "@decks/core";
import {
  loadTemplateCache,
  makeTemplateResolver,
} from "../../utils/template-resolver";
import type { Scheduler } from "@decks/core";
import type { DecksSettings } from "../../settings";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type { DeckSynchronizer } from "../../services/DeckSynchronizer";
import type {
  FlashcardReviewComponent,
  CompleteEventDetail,
} from "../../types/svelte-components";
import FlashcardReviewModal from "./FlashcardReviewModal.svelte";
import { mount, unmount } from "svelte";
import { navigateToFlashcardSource } from "../../utils/flashcard-navigator";
import { I18n } from "@decks/core";
import { ConfirmModal } from "../ConfirmModal";

export class FlashcardReviewModalWrapper extends Modal {
  private deckOrGroup: DeckOrGroup;
  private initialCard: Flashcard | null;
  private allCards: Flashcard[];
  private scheduler: Scheduler;
  private settings: DecksSettings;
  private db: IDatabaseService;
  private deckSynchronizer: DeckSynchronizer;
  private refreshStats: () => Promise<void>;
  private refreshStatsById: (deckId: string) => Promise<void>;
  private browseMode: boolean;
  private cramMode: boolean;
  private component: FlashcardReviewComponent | null = null;
  private markdownComponents: Component[] = [];
  private resizeHandler?: () => void;
  public navigatedToSource = false;
  // Per-card template resolver, built from a cache loaded once before mount.
  private resolveTemplate: (card: Flashcard) => ResolvedRender | null = () => null;

  private renderMarkdown(content: string, el: HTMLElement, sourcePath = ""): void {
    try {
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      // sourcePath lets Obsidian resolve ![[…]] embeds (audio/images) against the deck file.
      void MarkdownRenderer.render(this.app, content, el, sourcePath, component);
    } catch (error) {
      console.error("Error rendering markdown:", error);
      el.textContent = content;
    }
  }

  constructor(
    app: App,
    deckOrGroup: DeckOrGroup,
    flashcards: Flashcard[],
    scheduler: Scheduler,
    settings: DecksSettings,
    db: IDatabaseService,
    deckSynchronizer: DeckSynchronizer,
    refreshStats: () => Promise<void>,
    refreshStatsById: (deckId: string) => Promise<void>,
    browseMode = false,
    cramMode = false
  ) {
    super(app);
    this.deckOrGroup = deckOrGroup;
    this.initialCard = flashcards.length > 0 ? flashcards[0] : null;
    this.allCards = flashcards;
    this.scheduler = scheduler;
    this.settings = settings;
    this.db = db;
    this.deckSynchronizer = deckSynchronizer;
    this.refreshStats = refreshStats;
    this.refreshStatsById = refreshStatsById;
    this.browseMode = browseMode;
    this.cramMode = cramMode;
  }

  private async reviewFlashcard(
    deckOrGroup: DeckOrGroup,
    flashcard: Flashcard,
    difficulty: "again" | "hard" | "good" | "easy",
    timeElapsed?: number,
    shownAt?: Date
  ): Promise<void> {
    await this.scheduler.rate(flashcard, difficulty, timeElapsed, shownAt);
    await this.db.updateDeckLastReviewed(
      flashcard.deckId,
      new Date().toISOString()
    );
    // No per-rating stats refresh — onClose handles it.
  }

  private async navigateToFlashcardSource(flashcard: Flashcard): Promise<void> {
    const leaf = await navigateToFlashcardSource(this.app, flashcard);
    if (leaf) {
      this.navigatedToSource = true;
      this.close();
    }
  }

  /**
   * Apply a per-card state action (suspend / bury / reset). The Svelte
   * component calls this; we own the confirmation modal (reset only), the
   * DB write, and the user-facing Notice. Returns true if applied so the
   * caller advances the review queue; false if the user cancelled.
   *
   * Reset is irreversible (it deletes the card's review_logs) so we gate
   * it behind a ConfirmModal. Suspend/bury are quietly applied — they're
   * trivially reversible via Unsuspend/Unbury on the manager UI.
   */
  private async handleCardStateAction(
    card: Flashcard,
    action: "suspend" | "bury" | "reset"
  ): Promise<boolean> {
    const r = I18n.t.review;
    const showNotice = this.settings?.ui?.enableNotices !== false;

    if (action === "suspend") {
      await this.db.suspendCard(card.id);
      if (showNotice) new Notice(r.cardSuspended);
      return true;
    }

    if (action === "bury") {
      const until = this.scheduler.getBuryUntilForNextDay(new Date());
      await this.db.buryCard(card.id, until);
      if (showNotice) new Notice(r.cardBuried);
      return true;
    }

    // action === "reset" — destructive, gate behind ConfirmModal. Returns
    // true on confirm-then-reset, false on cancel (modal closed without
    // onConfirm firing).
    return new Promise<boolean>((resolve) => {
      let confirmed = false;
      const modal = new ConfirmModal(this.app, {
        title: r.resetCardConfirmTitle,
        message: r.resetCardConfirmMessage,
        isDanger: true,
        onConfirm: () => {
          confirmed = true;
          this.db
            .resetCard(card.id)
            .then(() => {
              if (showNotice) new Notice(r.cardReset);
              resolve(true);
            })
            .catch((error: unknown) => {
              console.error("resetCard failed:", error);
              resolve(false);
            });
        },
      });
      // Wrap onClose so a dismissal without confirmation settles the
      // promise as false (otherwise the Svelte caller would hang).
      const originalOnClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        originalOnClose();
        if (!confirmed) resolve(false);
      };
      modal.open();
    });
  }

  onOpen() {
    this.deckSynchronizer.isReviewing = true; // pause background syncs during review

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

    void this.preloadThenMount(contentEl);
  }

  private async preloadThenMount(contentEl: HTMLElement): Promise<void> {
    this.resolveTemplate = makeTemplateResolver(await loadTemplateCache(this.db));

    this.component = mount(FlashcardReviewModal, {
      target: contentEl,
      props: {
        initialCard: this.initialCard,
        deckOrGroup: this.deckOrGroup,
        browseMode: this.browseMode,
        cramMode: this.cramMode,
        allCards: this.allCards,
        onReview: async (
          card: Flashcard,
          rating: RatingLabel,
          timeElapsed?: number,
          shownAt?: Date
        ) => {
          await this.reviewFlashcard(
            this.deckOrGroup,
            card,
            rating,
            timeElapsed,
            shownAt
          );
        },
        renderMarkdown: (content: string, el: HTMLElement, sourcePath?: string) => {
          this.renderMarkdown(content, el, sourcePath ?? "");
        },
        resolveTemplate: (card: Flashcard) => this.resolveTemplate(card),
        resolveEmbed: (linkpath: string, sourcePath: string) => {
          const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
          return dest ? this.app.vault.getResourcePath(dest) : null;
        },
        settings: this.settings,
        scheduler: this.scheduler,
        onCardReviewed: undefined,
        onComplete: async (_event: CompleteEventDetail) => {
          if (this.browseMode || this.cramMode) {
            // Cram changes no real scheduling — just close (no session notice).
            this.close();
            return;
          }

          if (this.settings?.ui?.enableNotices !== false) {
            new Notice(
              I18n.format(I18n.t.notices.reviewSessionCompleteFor, {
                deckName: this.deckOrGroup.name,
              })
            );
          }
          // Refresh the view to update stats
          await this.refreshStats();
          this.close();
        },
        onNavigateToSource: async (card: Flashcard) => {
          await this.navigateToFlashcardSource(card);
        },
        onCardStateAction: (
          card: Flashcard,
          action: "suspend" | "bury" | "reset"
        ) => this.handleCardStateAction(card, action),
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
    this.resizeHandler = handleResize;
  }

  onClose() {
    this.deckSynchronizer.isReviewing = false;

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
    const deckId = this.deckOrGroup.type === 'file' ? this.deckOrGroup.id : this.deckOrGroup.type === 'custom' ? this.deckOrGroup.id : this.deckOrGroup.tag;
    this.refreshStatsById(deckId).catch(console.error);
  }
}
