import { Modal, Component, Notice, MarkdownRenderer, App, TFile } from "obsidian";
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

export class FlashcardReviewModalWrapper extends Modal {
  private deckOrGroup: DeckOrGroup;
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
    deckOrGroup: DeckOrGroup,
    flashcards: Flashcard[],
    scheduler: Scheduler,
    settings: DecksSettings,
    db: IDatabaseService,
    refreshStats: () => Promise<void>,
    refreshStatsById: (deckId: string) => Promise<void>
  ) {
    super(app);
    this.deckOrGroup = deckOrGroup;
    this.initialCard = flashcards.length > 0 ? flashcards[0] : null;
    this.scheduler = scheduler;
    this.settings = settings;
    this.db = db;
    this.refreshStats = refreshStats;
    this.refreshStatsById = refreshStatsById;
  }

  private async reviewFlashcard(
    deckOrGroup: DeckOrGroup,
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

  private async navigateToFlashcardSource(flashcard: Flashcard): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(flashcard.sourceFile);
    if (!(file instanceof TFile)) {
      new Notice(`File not found: ${flashcard.sourceFile}`);
      return;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    let lineNumber = 0;

    if (flashcard.type === "header-paragraph") {
      for (let i = 0; i < lines.length; i++) {
        const headerMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch && headerMatch[2].trim() === flashcard.front.trim()) {
          lineNumber = i;
          break;
        }
      }
    } else if (flashcard.type === "table") {
      for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        // Check if it's a table row (starts and ends with |)
        if (/^\|.*\|$/.test(trimmedLine)) {
          // Parse the same way FlashcardParser does
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

    // Check if file is already open in an existing leaf
    let leaf = this.app.workspace.getLeavesOfType("markdown").find((l) => {
      const viewState = l.getViewState();
      return viewState.state?.file === flashcard.sourceFile;
    });

    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
    }

    await leaf.openFile(file);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    // Scroll to the line after a short delay to ensure the editor is ready
    const targetLine = lineNumber;
    const targetLeaf = leaf;

    this.close();

    setTimeout(() => {
      const view = targetLeaf.view;
      if (view && "editor" in view) {
        const editor = (view as { editor: { setCursor: (pos: { line: number; ch: number }) => void; scrollIntoView: (range: { from: { line: number; ch: number }; to: { line: number; ch: number } }, center: boolean) => void; focus: () => void } }).editor;
        if (editor) {
          editor.focus();
          editor.setCursor({ line: targetLine, ch: 0 });
          editor.scrollIntoView(
            { from: { line: targetLine, ch: 0 }, to: { line: targetLine, ch: 0 } },
            true
          );
        }
      }
    }, 200);
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
        deckOrGroup: this.deckOrGroup,
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
          const message = `Review session complete for ${this.deckOrGroup.name}!`;

          if (this.settings?.ui?.enableNotices !== false) {
            new Notice(message);
          }
          // Refresh the view to update stats
          await this.refreshStats();
        },
        onNavigateToSource: async (card: Flashcard) => {
          await this.navigateToFlashcardSource(card);
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
    const deckId = this.deckOrGroup.type === 'file' ? this.deckOrGroup.id : this.deckOrGroup.tag;
    this.refreshStatsById(deckId).catch(console.error);
  }
}
