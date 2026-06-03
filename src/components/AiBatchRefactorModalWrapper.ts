import { Modal, Component, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";
import type {
  RefactorFieldSet,
  RefactorImage,
  RefactorProposal,
  RefactorResult,
} from "@decks/core";
import type { Flashcard } from "../database/types";
import AiBatchRefactorModal from "./AiBatchRefactorModal.svelte";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";

export interface AiBatchRefactorOptions {
  cards: Flashcard[];
  run: (
    card: Flashcard,
    options?: {
      instructions?: string;
      sourceContext?: string;
      images?: RefactorImage[];
      split?: boolean;
    },
    signal?: AbortSignal,
  ) => Promise<RefactorResult>;
  apply: (
    card: Flashcard,
    accepted: RefactorProposal[],
  ) => Promise<{ ok: boolean; error?: string }>;
  applySplit: (
    card: Flashcard,
    cards: RefactorFieldSet[],
  ) => Promise<{ ok: boolean; error?: string }>;
}

export class AiBatchRefactorModalWrapper extends Modal {
  private options: AiBatchRefactorOptions;
  private onClosed?: () => void;
  private component: Svelte5MountedComponent | null = null;
  private markdownComponents: Component[] = [];
  private resizeHandler?: () => void;

  constructor(
    app: App,
    options: AiBatchRefactorOptions,
    onClosed?: () => void,
  ) {
    super(app);
    this.options = options;
    this.onClosed = onClosed;
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

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      modalEl.addClass("decks-ai-batch-modal");
    }
    contentEl.addClass("decks-ai-batch-modal-content");

    const applyMobileClass = () => {
      if (!(modalEl instanceof HTMLElement)) return;
      if (window.innerWidth <= 768) modalEl.addClass("decks-modal-mobile");
      else modalEl.removeClass("decks-modal-mobile");
    };
    applyMobileClass();
    window.addEventListener("resize", applyMobileClass);
    this.resizeHandler = applyMobileClass;

    this.component = mount(AiBatchRefactorModal, {
      target: contentEl,
      props: {
        app: this.app,
        cards: this.options.cards,
        run: this.options.run,
        apply: this.options.apply,
        applySplit: this.options.applySplit,
        renderMarkdown: (source: string, el: HTMLElement) => {
          this.renderMarkdown(source, el);
        },
        onClose: () => this.close(),
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
    const cb = this.onClosed;
    this.onClosed = undefined;
    try {
      cb?.();
    } catch (e) {
      console.warn("AiBatchRefactorModalWrapper onClosed callback failed:", e);
    }
  }
}
