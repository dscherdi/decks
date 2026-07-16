import { App, Component, MarkdownRenderer, Modal, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import { I18n, type ExamAttempt, type ExamSession, type Flashcard } from "@decks/core";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import { AnchorStamper } from "../../services/AnchorStamper";
import { ConfirmModal } from "../ConfirmModal";
import { wireInternalLinks } from "../../utils/internal-links";
import FlashcardExamModal from "./FlashcardExamModal.svelte";

type ExamComponent = ReturnType<typeof mount>;

/**
 * Persist a finished attempt and lazily stamp answered, unanchored cards
 * (batched per markdown file). Shared by the modal and tab hosts.
 */
export async function persistExamAttempt(
  app: App,
  db: IDatabaseService,
  attempt: ExamAttempt,
  result: ReturnType<ExamAttempt["finish"]>
): Promise<ExamSession[]> {
  await db.completeExamSession(result.session, result.answers);

  const stamper = new AnchorStamper(app, db);
  const byFile = new Map<string, Flashcard[]>();
  const loose: Flashcard[] = [];
  for (const answer of result.answers) {
    if (answer.givenAnswer === "") continue;
    const card = attempt.questions[answer.ordinal]?.card;
    if (!card || card.anchor) continue;
    if (card.sourceFile.toLowerCase().endsWith(".md")) {
      const cards = byFile.get(card.sourceFile) ?? [];
      cards.push(card);
      byFile.set(card.sourceFile, cards);
    } else {
      loose.push(card);
    }
  }
  for (const [path, cards] of byFile) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await stamper.stampFileBatch(file, cards).catch(() => undefined);
    }
  }
  for (const card of loose) {
    await stamper.ensureAnchored(card).catch(() => undefined);
  }

  return db.getExamSessionsForDeckKey(result.session.deckKey);
}

export function confirmDialog(
  app: App,
  title: string,
  message: string
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let confirmed = false;
    const modal = new ConfirmModal(app, {
      title,
      message,
      isDanger: true,
      onConfirm: () => {
        confirmed = true;
        resolve(true);
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

export class ExamModalWrapper extends Modal {
  private component: ExamComponent | null = null;
  private markdownComponents: Component[] = [];

  constructor(
    app: App,
    private attempt: ExamAttempt,
    private deckName: string,
    private db: IDatabaseService,
    private onRetake: () => void,
    private refreshStats: () => Promise<void>
  ) {
    super(app);
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

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      modalEl.addClass("decks-exam-modal");
    }
    contentEl.addClass("decks-exam-container");

    const t = I18n.t.exam;
    this.component = mount(FlashcardExamModal, {
      target: contentEl,
      props: {
        attempt: this.attempt,
        deckName: this.deckName,
        renderMarkdown: this.renderMarkdown,
        onFinished: (result: ReturnType<ExamAttempt["finish"]>) =>
          persistExamAttempt(this.app, this.db, this.attempt, result),
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
        onQuit: () => this.close(),
        onRetake: () => {
          this.close();
          this.onRetake();
        },
        onComplete: () => this.close(),
      },
    });
  }

  onClose() {
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
    this.refreshStats().catch(console.error);
  }
}
