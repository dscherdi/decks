import { ItemView, WorkspaceLeaf, Component, MarkdownRenderer } from "obsidian";
import { mount, unmount } from "svelte";
import { I18n } from "@decks/core";
import type { Svelte5MountedComponent } from "../types/svelte-components";
import AiGeneratorModal from "./AiGeneratorModal.svelte";
import type { AiGeneratorOptions } from "./AiGeneratorModalWrapper";

export const VIEW_TYPE_AI_GENERATOR = "ai-generator-view";

export class AiGeneratorView extends ItemView {
  private options: AiGeneratorOptions | null = null;
  private component: Svelte5MountedComponent | null = null;
  private markdownComponents: Component[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_AI_GENERATOR;
  }

  getDisplayText(): string {
    return I18n.t.modals.aiGenerator.title;
  }

  getIcon(): string {
    return "wand-2";
  }

  setOptions(options: AiGeneratorOptions): void {
    this.options = options;
    this.mountComponent();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian's ItemView onOpen/onClose are async by contract; this override has no await
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-ai-generator-tab-container");
    if (this.options) this.mountComponent();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian's ItemView onOpen/onClose are async by contract; this override has no await
  async onClose(): Promise<void> {
    this.unmountComponent();
    this.contentEl.empty();
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

  private mountComponent(): void {
    if (!this.options) return;
    this.unmountComponent();

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-ai-generator-tab-container");

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
        onClose: () => this.leaf.detach(),
      },
    }) as Svelte5MountedComponent;
  }

  private unmountComponent(): void {
    if (this.component) {
      try {
        void unmount(this.component);
      } catch (e) {
        console.warn("Error unmounting AI generator component:", e);
      }
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
  }
}
