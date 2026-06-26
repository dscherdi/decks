import { occlusionImageLinkpath, type OcclusionDoc } from "@decks/core";

export interface OcclusionRenderOptions {
  doc: OcclusionDoc;
  /** Mask currently being asked. Null in reading view (all masks opaque). */
  activeMaskId: string | null;
  /** Back of card: the active mask is revealed (region shown). */
  revealed: boolean;
  /** "hidden": non-active masks stay opaque. "open": non-active are see-through. */
  showContext: "open" | "hidden";
  /** Resolve a vault link path to a renderable resource URL. */
  resolveImage: (linkpath: string) => string | null;
  /** Render the active mask's answer markdown below the image (back only). */
  renderMarkdown?: (content: string, el: HTMLElement) => void;
  /**
   * Reading-view mode: show the fully answered diagram — masks with answers
   * render their text as a label; deletion-only masks reveal the image.
   */
  showAnswers?: boolean;
}

/**
 * Render an occlusion image with its mask overlay into `container`. Shared by the
 * reading-view codeblock processor and the review modal so the geometry, scaling,
 * and styling stay identical across all three surfaces.
 */
export function renderOcclusion(container: HTMLElement, opts: OcclusionRenderOptions): void {
  container.empty();
  container.addClass("decks-occlusion-container");

  const stage = container.createDiv({ cls: "decks-occlusion-stage" });
  const linkpath = occlusionImageLinkpath(opts.doc.image);
  const src = opts.resolveImage(linkpath);

  if (src) {
    stage.createEl("img", { cls: "decks-occlusion-image", attr: { src } });
  } else {
    stage.createDiv({
      cls: "decks-occlusion-missing",
      text: `Image not found: ${linkpath}`,
    });
  }

  for (const mask of opts.doc.masks) {
    const isActive = opts.activeMaskId !== null && mask.id === opts.activeMaskId;
    const el = stage.createDiv({ cls: "decks-occlusion-mask" });
    el.setCssProps({
      left: `${mask.x}%`,
      top: `${mask.y}%`,
      width: `${mask.w}%`,
      height: `${mask.h}%`,
    });

    if (opts.showAnswers) {
      // Reading view: labeled diagram. Show the answer text, or reveal the
      // image for deletion-only masks.
      if (mask.answer.trim().length > 0 && opts.renderMarkdown) {
        el.addClass("decks-occlusion-mask-labeled");
        const labelEl = el.createDiv({ cls: "decks-occlusion-mask-answer markdown-rendered" });
        opts.renderMarkdown(mask.answer, labelEl);
      } else {
        el.addClass("decks-occlusion-mask-shown");
      }
    } else if (isActive) {
      el.addClass("decks-occlusion-mask-active");
      if (opts.revealed) el.addClass("decks-occlusion-mask-revealed");
    } else if (opts.showContext === "open" && opts.activeMaskId !== null) {
      // Non-active masks are see-through when context is shown.
      el.addClass("decks-occlusion-mask-context");
    }
  }

  // Answer below the image once the active mask is revealed.
  if (opts.revealed && opts.activeMaskId !== null && opts.renderMarkdown) {
    const active = opts.doc.masks.find((m) => m.id === opts.activeMaskId);
    if (active && active.answer.trim().length > 0) {
      const answerEl = container.createDiv({ cls: "decks-occlusion-answer markdown-rendered" });
      opts.renderMarkdown(active.answer, answerEl);
    }
  }
}
