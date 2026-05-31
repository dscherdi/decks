import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { RefactorProposal, RefactorResult } from "@decks/core";
import type { Flashcard } from "../database/types";
import AiBatchRefactorModal from "./AiBatchRefactorModal.svelte";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";

export interface AiBatchRefactorOptions {
  cards: Flashcard[];
  run: (card: Flashcard) => Promise<RefactorResult>;
  apply: (
    card: Flashcard,
    accepted: RefactorProposal[],
  ) => Promise<{ ok: boolean; error?: string }>;
}

export class AiBatchRefactorModalWrapper extends Modal {
  private options: AiBatchRefactorOptions;
  private onClosed?: () => void;
  private component: Svelte5MountedComponent | null = null;

  constructor(
    app: App,
    options: AiBatchRefactorOptions,
    onClosed?: () => void,
  ) {
    super(app);
    this.options = options;
    this.onClosed = onClosed;
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

    this.component = mount(AiBatchRefactorModal, {
      target: contentEl,
      props: {
        cards: this.options.cards,
        run: this.options.run,
        apply: this.options.apply,
        onClose: () => this.close(),
      },
    }) as Svelte5MountedComponent;
  }

  onClose() {
    if (this.component) {
      void unmount(this.component);
      this.component = null;
    }
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
