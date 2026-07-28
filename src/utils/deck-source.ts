import { App, Notice, TFile } from "obsidian";
import { I18n } from "@decks/core";

/**
 * Open a deck's underlying source file (markdown or canvas) in a tab. Reuses an
 * existing leaf already showing the file; otherwise opens a new tab. Shows a
 * notice when the path no longer resolves to a file.
 */
export async function openDeckSourceFile(
  app: App,
  filepath: string,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filepath);
  if (!(file instanceof TFile)) {
    new Notice(I18n.format(I18n.t.notices.fileNotFound, { path: filepath }));
    return;
  }

  const existing = app.workspace
    .getLeavesOfType("markdown")
    .concat(app.workspace.getLeavesOfType("canvas"))
    .find((leaf) => {
      const state = leaf.getViewState().state;
      return state?.file === file.path;
    });

  const leaf = existing ?? app.workspace.getLeaf("tab");
  if (!existing) await leaf.openFile(file);
  app.workspace.setActiveLeaf(leaf, { focus: true });
}
