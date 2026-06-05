import { App, MarkdownView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { Flashcard } from "../database/types";
import { findFlashcardLine } from "./source-navigator";
import { I18n } from "@decks/core";

/**
 * Shape of Obsidian's canvas view internals we rely on for focus-on-node.
 * These properties are not part of Obsidian's public API — guarded by
 * runtime checks plus try/catch so a future Obsidian build that changes
 * the shape only degrades to "open the canvas file" (no node focus).
 */
interface CanvasViewLike {
  canvas?: {
    nodes?: Map<string, CanvasNodeLike>;
    selectOnly?: (node: CanvasNodeLike) => void;
    zoomToBbox?: (bbox: unknown) => void;
    zoomToSelection?: () => void;
  };
}

interface CanvasNodeLike {
  bbox?: unknown;
}

function isMarkdownFile(file: TFile): boolean {
  return file.extension === "md";
}

function isCanvasFile(file: TFile): boolean {
  return file.extension === "canvas";
}

/**
 * Open the source file for a flashcard and try to position the editor at the
 * card's location.
 *
 * - Markdown: opens the file in a tab (reusing an existing leaf if one is
 *   already showing it) and scrolls to the line that holds the front text.
 * - Canvas: opens the file and asks the canvas view to select + zoom to the
 *   text node identified by `flashcard.sourceNodeId`. Falls back to a plain
 *   open if any part of the canvas API isn't available.
 */
export async function navigateToFlashcardSource(
  app: App,
  flashcard: Flashcard,
): Promise<WorkspaceLeaf | null> {
  const file = app.vault.getAbstractFileByPath(flashcard.sourceFile);
  if (!(file instanceof TFile)) {
    new Notice(
      I18n.format(I18n.t.notices.fileNotFound, { path: flashcard.sourceFile }),
    );
    return null;
  }

  if (isCanvasFile(file)) {
    return await openCanvasAndFocusNode(app, file, flashcard.sourceNodeId ?? null);
  }

  if (isMarkdownFile(file)) {
    return await openMarkdownAndScrollToLine(app, file, flashcard);
  }

  // Unknown extension — best effort open.
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(file);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  return leaf;
}

async function openMarkdownAndScrollToLine(
  app: App,
  file: TFile,
  flashcard: Flashcard,
): Promise<WorkspaceLeaf> {
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const lineNumber = findFlashcardLine(lines, flashcard) ?? 0;

  let leaf = app.workspace.getLeavesOfType("markdown").find((l) => {
    const viewState = l.getViewState();
    return viewState.state?.file === file.path;
  });
  if (!leaf) {
    leaf = app.workspace.getLeaf("tab");
  }

  await leaf.openFile(file, { eState: { line: lineNumber } });
  app.workspace.setActiveLeaf(leaf, { focus: true });

  window.setTimeout(() => {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    if (view.getMode() === "preview") {
      view.previewMode.applyScroll(lineNumber);
    } else {
      view.setEphemeralState({ line: lineNumber });
    }
  }, 100);

  return leaf;
}

async function openCanvasAndFocusNode(
  app: App,
  file: TFile,
  sourceNodeId: string | null,
): Promise<WorkspaceLeaf> {
  let leaf = app.workspace.getLeavesOfType("canvas").find((l) => {
    const viewState = l.getViewState();
    return viewState.state?.file === file.path;
  });
  if (!leaf) {
    leaf = app.workspace.getLeaf("tab");
  }
  await leaf.openFile(file);
  app.workspace.setActiveLeaf(leaf, { focus: true });

  if (!sourceNodeId) return leaf;

  // Defer until the canvas view has mounted and parsed its nodes Map.
  window.setTimeout(() => {
    try {
      const view = leaf.view as unknown as CanvasViewLike;
      const canvas = view?.canvas;
      if (!canvas?.nodes) return;
      const node = canvas.nodes.get(sourceNodeId);
      if (!node) return;
      canvas.selectOnly?.(node);
      if (canvas.zoomToBbox && node.bbox !== undefined) {
        canvas.zoomToBbox(node.bbox);
      } else {
        canvas.zoomToSelection?.();
      }
    } catch {
      // Canvas internals changed shape or threw — fall back silently to plain open.
    }
  }, 150);

  return leaf;
}
