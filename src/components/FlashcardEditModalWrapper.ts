import { Modal, Component, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";
import type { RefactorFieldSet, RefactorResult } from "@decks/core";
import type { Flashcard } from "../database/types";
import type { FlashcardEdits, EditResult } from "../services/FlashcardWriter";
import FlashcardEditModal from "./FlashcardEditModal.svelte";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";

export interface FlashcardEditAiOptions {
  aiEnabled: boolean;
  onRefactor: (
    current: RefactorFieldSet,
    signal?: AbortSignal,
  ) => Promise<RefactorResult>;
}

export class FlashcardEditModalWrapper extends Modal {
  private card: Flashcard;
  private onSave: (edits: FlashcardEdits) => Promise<EditResult>;
  private onClosed?: () => void;
  private aiOptions?: FlashcardEditAiOptions;
  private component: Svelte5MountedComponent | null = null;
  private markdownComponents: Component[] = [];
  private resizeHandler?: () => void;

  constructor(
    app: App,
    card: Flashcard,
    onSave: (edits: FlashcardEdits) => Promise<EditResult>,
    onClosed?: () => void,
    aiOptions?: FlashcardEditAiOptions,
  ) {
    super(app);
    this.card = card;
    this.onSave = onSave;
    this.onClosed = onClosed;
    this.aiOptions = aiOptions;
  }

  private renderMarkdown(content: string, el: HTMLElement): void {
    try {
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      void MarkdownRenderer.render(
        this.app,
        content,
        el,
        this.card.sourceFile,
        component,
      );
    } catch (error) {
      console.error("Error rendering markdown:", error);
      el.textContent = content;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      modalEl.addClass("decks-flashcard-edit-modal");
    }
    contentEl.addClass("decks-flashcard-edit-modal-content");

    const applyMobileClass = () => {
      if (!(modalEl instanceof HTMLElement)) return;
      if (window.innerWidth <= 768) {
        modalEl.addClass("decks-modal-mobile");
      } else {
        modalEl.removeClass("decks-modal-mobile");
      }
    };
    applyMobileClass();
    window.addEventListener("resize", applyMobileClass);
    this.resizeHandler = applyMobileClass;

    this.component = mount(FlashcardEditModal, {
      target: contentEl,
      props: {
        card: this.card,
        onSave: this.onSave,
        onClose: () => this.close(),
        renderMarkdown: (source: string, el: HTMLElement) => {
          this.renderMarkdown(source, el);
        },
        aiEnabled: this.aiOptions?.aiEnabled ?? false,
        onRefactor: this.aiOptions?.onRefactor,
      },
    }) as Svelte5MountedComponent;
  }

  onClose() {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }
    if (this.component) {
      void unmount(this.component);
      this.component = null;
    }
    for (const c of this.markdownComponents) {
      try {
        c.unload();
      } catch (e) {
        console.warn("Error unloading markdown component:", e);
      }
    }
    this.markdownComponents = [];
    this.contentEl.empty();
    // Notify the caller via the lifecycle hook (runs no matter how the modal
    // is closed — X button, Escape, backdrop click, programmatic .close()).
    // Guard against double-call.
    const cb = this.onClosed;
    this.onClosed = undefined;
    try {
      cb?.();
    } catch (e) {
      console.warn("FlashcardEditModalWrapper onClosed callback failed:", e);
    }
  }
}
