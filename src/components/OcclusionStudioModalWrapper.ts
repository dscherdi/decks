import { Modal, Component, MarkdownRenderer, Notice, TFile } from "obsidian";
import type { App } from "obsidian";
import {
  OcclusionV2Parser,
  occlusionImageLinkpath,
  OCCLUSION_V2_VERSION,
  type OcclusionDoc,
  type OcclusionMask,
} from "@decks/core";
import { mount, unmount } from "svelte";
import type { Svelte5MountedComponent } from "../types/svelte-components";
import OcclusionStudioModal from "./OcclusionStudioModal.svelte";
import { replaceOcclusionBlock } from "../utils/occlusion-codeblock";

export interface OcclusionStudioOptions {
  /** The note that contains the codeblock being edited. */
  sourcePath: string;
  /** The occlusion model currently in the block. */
  doc: OcclusionDoc;
  /** Opening fence line of the block (from getSectionInfo), if known. */
  lineStart?: number;
  /** Closing fence line of the block (from getSectionInfo), if known. */
  lineEnd?: number;
  /** Disambiguate multiple blocks by image when no line hint is available. */
  matchImage?: string;
  /** Called after a successful write so the host can refresh. */
  onSaved?: () => void;
}

export class OcclusionStudioModalWrapper extends Modal {
  private options: OcclusionStudioOptions;
  private component: Svelte5MountedComponent | null = null;
  private markdownComponents: Component[] = [];
  private resizeHandler?: () => void;

  constructor(app: App, options: OcclusionStudioOptions) {
    super(app);
    this.options = options;
  }

  private renderMarkdown(content: string, el: HTMLElement): void {
    try {
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      void MarkdownRenderer.render(this.app, content, el, this.options.sourcePath, component);
    } catch (error) {
      console.error("Error rendering markdown:", error);
      el.textContent = content;
    }
  }

  private resolveImage(linkpath: string): string | null {
    const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, this.options.sourcePath);
    return dest ? this.app.vault.getResourcePath(dest) : null;
  }

  private persist(masks: OcclusionMask[]): void {
    const file = this.app.vault.getAbstractFileByPath(this.options.sourcePath);
    if (!(file instanceof TFile)) {
      new Notice("Could not find the note to save the occlusion.");
      return;
    }
    const newDoc: OcclusionDoc = {
      __v: OCCLUSION_V2_VERSION,
      image: this.options.doc.image,
      masks,
    };
    const yamlBody = OcclusionV2Parser.toYaml(newDoc).trimEnd();
    const fenced = "```decks-occlusion\n" + yamlBody + "\n```";

    let located = true;
    this.app.vault
      .process(file, (content) => {
        const replaced = replaceOcclusionBlock(content, fenced, {
          hintStart: this.options.lineStart,
          hintEnd: this.options.lineEnd,
          matchImage: this.options.matchImage,
        });
        if (replaced === null) {
          located = false;
          return content;
        }
        return replaced;
      })
      .then(() => {
        if (!located) {
          new Notice("Could not locate the occlusion block — it may have moved.");
          return;
        }
        this.options.onSaved?.();
        this.close();
      })
      .catch((e) => {
        console.error("Failed to write occlusion block:", e);
        new Notice("Failed to save the occlusion.");
      });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      modalEl.addClass("decks-occlusion-studio-modal");
    }

    const applyMobileClass = () => {
      if (!(modalEl instanceof HTMLElement)) return;
      if (window.innerWidth <= 768) modalEl.addClass("decks-modal-mobile");
      else modalEl.removeClass("decks-modal-mobile");
    };
    applyMobileClass();
    window.addEventListener("resize", applyMobileClass);
    this.resizeHandler = applyMobileClass;

    const linkpath = occlusionImageLinkpath(this.options.doc.image);
    this.component = mount(OcclusionStudioModal, {
      target: contentEl,
      props: {
        imageSrc: this.resolveImage(linkpath),
        imageLabel: this.options.doc.image,
        initialMasks: this.options.doc.masks,
        renderMarkdown: (source: string, el: HTMLElement) => this.renderMarkdown(source, el),
        onSave: (masks: OcclusionMask[]) => this.persist(masks),
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
  }
}
