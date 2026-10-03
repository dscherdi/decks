import { App, Notice, TFile } from "obsidian";
import { I18n } from "@decks/core";

/**
 * Open a vault PDF at a page, reusing a tab that already shows it. Opened from the
 * file rather than link text, where a '#' in the file name would cut the path.
 */
export async function openVaultPdf(
  app: App,
  path: string,
  page?: number | null,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || file.extension.toLowerCase() !== "pdf") {
    new Notice(I18n.format(I18n.t.notices.fileNotFound, { path }));
    return false;
  }
  const existing = app.workspace
    .getLeavesOfType("pdf")
    .find((leaf) => leaf.getViewState().state?.file === file.path);
  const leaf = existing ?? app.workspace.getLeaf("tab");
  await leaf.openFile(file, page ? { eState: { subpath: `#page=${page}` } } : undefined);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  return true;
}
