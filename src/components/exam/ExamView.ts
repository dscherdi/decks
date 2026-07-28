import { Component, ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import { I18n, type ExamAttempt } from "@decks/core";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import { wireInternalLinks } from "../../utils/internal-links";
import FlashcardExamModal from "./FlashcardExamModal.svelte";
import { confirmDialog, persistExamAttempt } from "./ExamModalWrapper";

export const VIEW_TYPE_FLASHCARD_EXAM = "flashcard-exam-view";

type ExamComponent = ReturnType<typeof mount>;

export class ExamView extends ItemView {
  private component: ExamComponent | null = null;
  private markdownComponents: Component[] = [];
  private attempt: ExamAttempt | null = null;
  private deckName = "";
  private onRetake: (() => void) | null = null;
  private refreshStats: (() => Promise<void>) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private db: IDatabaseService
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_FLASHCARD_EXAM;
  }

  getDisplayText(): string {
    return this.deckName || I18n.t.exam.setupTitle;
  }

  getIcon(): string {
    return "graduation-cap";
  }

  setExamData(
    attempt: ExamAttempt,
    deckName: string,
    onRetake: () => void,
    refreshStats: () => Promise<void>
  ): void {
    this.attempt = attempt;
    this.deckName = deckName;
    this.onRetake = onRetake;
    this.refreshStats = refreshStats;
    this.mountComponent();
  }

  private renderMarkdown = async (
    content: string,
    el: HTMLElement,
    sourcePath = ""
  ): Promise<void> => {
    try {
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      await MarkdownRenderer.render(this.app, content, el, sourcePath, component);
      wireInternalLinks(this.app, el, sourcePath, component);
    } catch (error) {
      console.error("Error rendering markdown:", error);
      el.textContent = content;
    }
  };

  private mountComponent(): void {
    this.unmountComponent();
    const container = this.containerEl.children[1];
    if (!(container instanceof HTMLElement) || !this.attempt) return;
    container.empty();
    container.addClass("decks-exam-tab-container");

    const attempt = this.attempt;
    const t = I18n.t.exam;
    this.component = mount(FlashcardExamModal, {
      target: container,
      props: {
        attempt,
        deckName: this.deckName,
        renderMarkdown: this.renderMarkdown,
        onFinished: (result: ReturnType<ExamAttempt["finish"]>) =>
          persistExamAttempt(this.app, this.db, attempt, result),
        confirmSubmit: (unansweredCount: number) =>
          unansweredCount > 0
            ? confirmDialog(
                this.app,
                t.submitConfirmTitle,
                I18n.format(t.submitConfirmUnanswered, {
                  count: String(unansweredCount),
                })
              )
            : Promise.resolve(true),
        confirmQuit: () =>
          confirmDialog(this.app, t.quitConfirmTitle, t.quitConfirmBody),
        onQuit: () => this.leaf.detach(),
        onRetake: () => {
          const retake = this.onRetake;
          this.leaf.detach();
          retake?.();
        },
        onComplete: () => {
          this.refreshStats?.().catch(console.error);
          this.leaf.detach();
        },
        isActive: () =>
          this.app.workspace.getActiveViewOfType(ExamView) === this &&
          !activeDocument.querySelector(".modal-container"),
      },
    });
  }

  private unmountComponent(): void {
    if (this.component) {
      try {
        void unmount(this.component);
      } catch (e) {
        console.warn("Error unmounting exam component:", e);
      }
      this.component = null;
    }
    this.markdownComponents.forEach((comp) => comp.unload());
    this.markdownComponents = [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian's ItemView onClose is async by contract; this override has no await
  async onClose(): Promise<void> {
    this.unmountComponent();
  }
}
