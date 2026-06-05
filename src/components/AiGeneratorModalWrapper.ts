import { Modal, Component, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";
import type { GeneratedCard, GenerateHandlers, RefactorImage } from "@decks/core";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";
import AiGeneratorModal from "./AiGeneratorModal.svelte";
import type {
  DeckOpt,
  GeneratorSaveRequest,
  ProfileOpt,
} from "./generator-save";

export interface AiGeneratorOptions {
  generate: (
    options: { prompt: string; sourceContext?: string; images?: RefactorImage[] },
    handlers: GenerateHandlers,
    signal: AbortSignal,
  ) => Promise<unknown>;
  save: (
    cards: GeneratedCard[],
    request: GeneratorSaveRequest,
  ) => Promise<{ ok: boolean; error?: string; count?: number; deckId?: string }>;
  loadProfiles: () => Promise<ProfileOpt[]>;
  loadDecks: () => Promise<DeckOpt[]>;
  defaultFolder: string;
  canvasFolder: string;
  deckTag: string;
}

export class AiGeneratorModalWrapper extends Modal {
  private options: AiGeneratorOptions;
  private onClosed?: () => void;
  private component: Svelte5MountedComponent | null = null;
  private markdownComponents: Component[] = [];
  private resizeHandler?: () => void;

  constructor(app: App, options: AiGeneratorOptions, onClosed?: () => void) {
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

    this.component = mount(AiGeneratorModal, {
      target: contentEl,
      props: {
        app: this.app,
        generate: this.options.generate,
        save: this.options.save,
        loadProfiles: this.options.loadProfiles,
        loadDecks: this.options.loadDecks,
        defaultFolder: this.options.defaultFolder,
        canvasFolder: this.options.canvasFolder,
        deckTag: this.options.deckTag,
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
      console.warn("AiGeneratorModalWrapper onClosed callback failed:", e);
    }
  }
}
