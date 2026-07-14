import {
  ItemView,
  WorkspaceLeaf,
  Component,
  Notice,
  MarkdownRenderer,
} from "obsidian";
import type { Flashcard, DeckOrGroup } from "../../database/types";
import type { RatingLabel, ResolvedRender } from "@decks/core";
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
import { wireInternalLinks } from "../../utils/internal-links";
import { I18n } from "@decks/core";
import { ConfirmModal } from "../ConfirmModal";
import { AnchorStamper } from "../../services/AnchorStamper";

export const VIEW_TYPE_FLASHCARD_REVIEW = "flashcard-review-view";

export class FlashcardReviewView extends ItemView {
  private scheduler: Scheduler;
  private anchorStamper: AnchorStamper;
  private settings: DecksSettings;
  private db: IDatabaseService;

  private deckOrGroup: DeckOrGroup | null = null;
  private allCards: Flashcard[] = [];
  private browseMode = false;
  private initialCard: Flashcard | null = null;

  private component: FlashcardReviewComponent | null = null;
  private markdownComponents: Component[] = [];
  private mountGeneration = 0;
  // Per-card template resolver, rebuilt from the cache before each mount.
  private resolveTemplate: (card: Flashcard) => ResolvedRender | null = () => null;

  private refreshStats: (() => Promise<void>) | null = null;
  private refreshStatsById: ((deckId: string) => Promise<void>) | null = null;
  private deckSynchronizer: DeckSynchronizer | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    scheduler: Scheduler,
    settings: DecksSettings,
    db: IDatabaseService
  ) {
    super(leaf);
    this.scheduler = scheduler;
    this.settings = settings;
    this.db = db;
    this.anchorStamper = new AnchorStamper(this.app, db);
  }

  getViewType(): string {
    return VIEW_TYPE_FLASHCARD_REVIEW;
  }

  getDisplayText(): string {
    if (!this.deckOrGroup) {
      return I18n.t.views.review;
    }
    const prefix = this.browseMode ? I18n.t.views.browse : I18n.t.views.review;
    return I18n.format(I18n.t.views.reviewOf, {
      prefix,
      name: this.deckOrGroup.name,
    });
  }

  getIcon(): string {
    return "brain";
  }

  setReviewData(
    deckOrGroup: DeckOrGroup,
    cards: Flashcard[],
    browseMode: boolean,
    refreshStats: () => Promise<void>,
    refreshStatsById: (deckId: string) => Promise<void>,
    deckSynchronizer: DeckSynchronizer
  ): void {
    this.deckOrGroup = deckOrGroup;
    this.allCards = cards;
    this.browseMode = browseMode;
    this.initialCard = cards.length > 0 ? cards[0] : null;
    this.refreshStats = refreshStats;
    this.refreshStatsById = refreshStatsById;
    this.deckSynchronizer = deckSynchronizer;
    // Pause background syncs while this review tab is open.
    deckSynchronizer.isReviewing = true;

    // Update the tab title
    // updateHeader() exists at runtime but isn't in the obsidian typings.
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();

    // Load the template cache before mounting so the first card resolves its
    // template (same preload-before-mount behavior as the modal wrapper).
    void this.preloadThenMount();
  }

  private async preloadThenMount(): Promise<void> {
    this.resolveTemplate = makeTemplateResolver(await loadTemplateCache(this.db));
    this.mountComponent();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian's ItemView onOpen/onClose are async by contract; this override has no await
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-review-tab-container");

    if (!this.deckOrGroup) {
      this.showExpiredMessage();
    }
  }

  async onClose(): Promise<void> {
    // Review tab closed — let background syncs resume.
    if (this.deckSynchronizer) this.deckSynchronizer.isReviewing = false;
    this.unmountComponent();
    this.contentEl.empty();
    if (this.refreshStats) await this.refreshStats();
  }

  private showExpiredMessage(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-review-tab-container");

    const container = contentEl.createDiv({
      cls: "decks-review-tab-expired",
    });
    container.createEl("p", {
      text: "Review session expired. Please start a new review from the deck list.",
    });
    const closeButton = container.createEl("button", {
      text: "Close tab",
      cls: "mod-cta",
    });
    closeButton.addEventListener("click", () => {
      this.leaf.detach();
    });
  }

  private renderMarkdown(content: string, el: HTMLElement, sourcePath = ""): void {
    try {
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      // sourcePath lets Obsidian resolve ![[…]] embeds (audio/images) against the deck file.
      void MarkdownRenderer.render(this.app, content, el, sourcePath, component);
      // Make internal links open/preview like Obsidian during review.
      wireInternalLinks(this.app, el, sourcePath, component);
    } catch (error) {
      console.error("Error rendering markdown:", error);
      el.textContent = content;
    }
  }

  private async reviewFlashcard(
    flashcard: Flashcard,
    difficulty: RatingLabel,
    timeElapsed?: number,
    shownAt?: Date
  ): Promise<void> {
    await this.scheduler.rate(flashcard, difficulty, timeElapsed, shownAt);
    await this.db.updateDeckLastReviewed(
      flashcard.deckId,
      new Date().toISOString()
    );
    if (!this.browseMode) {
      await this.anchorStamper.ensureAnchored(flashcard);
    }
    // No per-rating stats refresh — onClose handles it.
  }

  private async navigateToFlashcardSource(
    flashcard: Flashcard
  ): Promise<void> {
    await navigateToFlashcardSource(this.app, flashcard);
  }

  /**
   * Tab-mode counterpart to FlashcardReviewModalWrapper.handleCardStateAction.
   * Same contract: suspend/bury are quietly applied with a Notice; reset is
   * destructive and gated behind ConfirmModal. Returns true if applied so
   * the Svelte side advances the queue, false on cancel.
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
      const originalOnClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        originalOnClose();
        if (!confirmed) resolve(false);
      };
      modal.open();
    });
  }

  private mountComponent(): void {
    if (!this.deckOrGroup) return;

    const generation = ++this.mountGeneration;

    // End previous session before unmounting to avoid async onDestroy race
    const oldSessionId = this.scheduler.getCurrentSession();
    if (oldSessionId) {
      this.scheduler.setCurrentSession(null);
      this.scheduler.endReviewSession(oldSessionId).catch(console.error);
    }

    this.unmountComponent();

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-review-tab-container");

    this.component = mount(FlashcardReviewModal, {
      target: contentEl,
      props: {
        isActive: () =>
          this.app.workspace.getActiveViewOfType(FlashcardReviewView) === this &&
          !activeDocument.querySelector(".modal-container"),
        initialCard: this.initialCard,
        deckOrGroup: this.deckOrGroup,
        browseMode: this.browseMode,
        allCards: this.allCards,
        onReview: async (
          card: Flashcard,
          rating: RatingLabel,
          timeElapsed?: number,
          shownAt?: Date
        ) => {
          await this.reviewFlashcard(card, rating, timeElapsed, shownAt);
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
        // Deliberately no per-rating stats refresh (see reviewFlashcard).
        onCardReviewed: undefined,
        // eslint-disable-next-line @typescript-eslint/require-await -- callback typed Promise<void> by the component contract; stats refresh now lives in onClose
        onComplete: async (_event: CompleteEventDetail) => {
          if (generation !== this.mountGeneration) return;

          if (this.browseMode) {
            this.leaf.detach();
            return;
          }

          if (this.settings?.ui?.enableNotices !== false && this.deckOrGroup) {
            new Notice(
              I18n.format(I18n.t.notices.reviewSessionCompleteFor, {
                deckName: this.deckOrGroup.name,
              })
            );
          }
          this.leaf.detach(); // onClose refreshes stats once
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
  }

  private unmountComponent(): void {
    if (this.component) {
      try {
        void unmount(this.component);
      } catch (e) {
        console.warn("Error unmounting flashcard review component:", e);
      }
      this.component = null;
    }

    this.markdownComponents.forEach((comp) => comp.unload());
    this.markdownComponents = [];
  }
}
