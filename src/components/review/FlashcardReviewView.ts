import {
  ItemView,
  WorkspaceLeaf,
  Component,
  Notice,
  MarkdownRenderer,
  TFile,
} from "obsidian";
import type { Flashcard, DeckOrGroup } from "../../database/types";
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

export const VIEW_TYPE_FLASHCARD_REVIEW = "flashcard-review-view";

export class FlashcardReviewView extends ItemView {
  private scheduler: Scheduler;
  private settings: DecksSettings;
  private db: IDatabaseService;

  private deckOrGroup: DeckOrGroup | null = null;
  private allCards: Flashcard[] = [];
  private browseMode = false;
  private initialCard: Flashcard | null = null;

  private component: FlashcardReviewComponent | null = null;
  private markdownComponents: Component[] = [];
  private mountGeneration = 0;

  private refreshStats: (() => Promise<void>) | null = null;
  private refreshStatsById: ((deckId: string) => Promise<void>) | null = null;

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
  }

  getViewType(): string {
    return VIEW_TYPE_FLASHCARD_REVIEW;
  }

  getDisplayText(): string {
    if (!this.deckOrGroup) {
      return "Review";
    }
    const prefix = this.browseMode ? "Browse" : "Review";
    return `${prefix}: ${this.deckOrGroup.name}`;
  }

  getIcon(): string {
    return "brain";
  }

  setReviewData(
    deckOrGroup: DeckOrGroup,
    cards: Flashcard[],
    browseMode: boolean,
    refreshStats: () => Promise<void>,
    refreshStatsById: (deckId: string) => Promise<void>
  ): void {
    this.deckOrGroup = deckOrGroup;
    this.allCards = cards;
    this.browseMode = browseMode;
    this.initialCard = cards.length > 0 ? cards[0] : null;
    this.refreshStats = refreshStats;
    this.refreshStatsById = refreshStatsById;

    // Update the tab title
    this.leaf.updateHeader();

    this.mountComponent();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-review-tab-container");

    if (!this.deckOrGroup) {
      this.showExpiredMessage();
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onClose(): Promise<void> {
    this.unmountComponent();
    this.contentEl.empty();
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

  private renderMarkdown(content: string, el: HTMLElement): void {
    try {
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      void MarkdownRenderer.render(this.app, content, el, "", component);
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
    await this.scheduler.rate(flashcard.id, difficulty, timeElapsed, shownAt);
    await this.db.updateDeckLastReviewed(
      flashcard.deckId,
      new Date().toISOString()
    );
    if (this.refreshStatsById) {
      await this.refreshStatsById(flashcard.deckId);
    }
  }

  private async navigateToFlashcardSource(
    flashcard: Flashcard
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(flashcard.sourceFile);
    if (!(file instanceof TFile)) {
      new Notice(`File not found: ${flashcard.sourceFile}`);
      return;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    let lineNumber = 0;

    if (flashcard.type === "header-paragraph" || flashcard.type === "cloze") {
      for (let i = 0; i < lines.length; i++) {
        const headerMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch && headerMatch[2].trim() === flashcard.front.trim()) {
          lineNumber = i;
          break;
        }
      }
    } else if (flashcard.type === "image-occlusion") {
      const parts = flashcard.breadcrumb.split(" > ");
      const headerText = parts[parts.length - 1]?.trim();
      if (headerText) {
        for (let i = 0; i < lines.length; i++) {
          const headerMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
          if (headerMatch && headerMatch[2].trim() === headerText) {
            lineNumber = i;
            break;
          }
        }
      }
    } else if (flashcard.type === "table") {
      for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        if (/^\|.*\|$/.test(trimmedLine)) {
          const cells = trimmedLine
            .slice(1, -1)
            .split("|")
            .map((cell) => cell.trim());
          if (cells.length >= 1 && cells[0] === flashcard.front) {
            lineNumber = i;
            break;
          }
        }
      }
    }

    let leaf = this.app.workspace.getLeavesOfType("markdown").find((l) => {
      const viewState = l.getViewState();
      return viewState.state?.file === flashcard.sourceFile;
    });

    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
    }

    await leaf.openFile(file, { eState: { line: lineNumber } });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    setTimeout(() => {
      const view = leaf.view;
      if (view && "setEphemeralState" in view) {
        (
          view as { setEphemeralState: (state: { line: number }) => void }
        ).setEphemeralState({ line: lineNumber });
      }
    }, 100);
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
          !document.querySelector(".modal-container"),
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
        renderMarkdown: (content: string, el: HTMLElement) => {
          this.renderMarkdown(content, el);
        },
        settings: this.settings,
        scheduler: this.scheduler,
        onCardReviewed: async (reviewedCard: Flashcard) => {
          if (reviewedCard && this.refreshStatsById) {
            await this.refreshStatsById(reviewedCard.deckId);
          }
        },
        onComplete: async (_event: CompleteEventDetail) => {
          if (generation !== this.mountGeneration) return;

          if (this.browseMode) {
            this.leaf.detach();
            return;
          }

          if (this.settings?.ui?.enableNotices !== false && this.deckOrGroup) {
            new Notice(
              `Review session complete for ${this.deckOrGroup.name}!`
            );
          }
          if (this.refreshStats) {
            await this.refreshStats();
          }
          this.leaf.detach();
        },
        onNavigateToSource: async (card: Flashcard) => {
          await this.navigateToFlashcardSource(card);
        },
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
