import { Modal, Component, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";
import type { AiProviderId, GeneratedCard, GenerateHandlers, GenerateResult, RefactorImage } from "@decks/core";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";
import AiGeneratorModal from "./AiGeneratorModal.svelte";
import type { GeneratorSaveRequest, ProfileOpt } from "./generator-save";

export interface AiGeneratorOptions {
  generate: (
    options: {
      prompt: string;
      sourceContext?: string;
      images?: RefactorImage[];
      maxBatches?: number;
      existingCards?: GeneratedCard[];
      model?: string;
      debug?: boolean;
    },
    handlers: GenerateHandlers,
    signal: AbortSignal,
  ) => Promise<GenerateResult>;
  save: (
    cards: GeneratedCard[],
    request: GeneratorSaveRequest,
  ) => Promise<{
    ok: boolean;
    error?: string;
    count?: number;
    deckId?: string;
    filePath?: string;
  }>;
  loadProfiles: () => Promise<ProfileOpt[]>;
  defaultFolder: string;
  canvasFolder: string;
  deckTag: string;
  aiProvider: AiProviderId;
  defaultModel: string;
  debugEnabled: boolean;
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
      // The debug panel starts collapsed; the modal widens via
      // `decks-ai-gen-has-debug` only when the user opens it from the header.
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
        defaultFolder: this.options.defaultFolder,
        canvasFolder: this.options.canvasFolder,
        deckTag: this.options.deckTag,
        aiProvider: this.options.aiProvider,
        defaultModel: this.options.defaultModel,
        debugEnabled: this.options.debugEnabled,
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
