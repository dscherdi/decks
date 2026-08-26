import { App, TFile } from "obsidian";
import type { NoteAccess } from "@decks/core";

/**
 * Obsidian's half of the anchor stamper's file seam.
 *
 * `Vault.process` is passed the edit callback rather than being unwrapped into
 * a read and a write here, because it is atomic against Obsidian's own
 * concurrent writes and unwrapping it would give that up.
 */
export class ObsidianNoteAccess implements NoteAccess {
  constructor(private app: App) {}

  private file(path: string): TFile | null {
    const found = this.app.vault.getAbstractFileByPath(path);
    return found instanceof TFile ? found : null;
  }

  async read(path: string): Promise<string | null> {
    const file = this.file(path);
    return file ? await this.app.vault.cachedRead(file) : null;
  }

  async process(path: string, edit: (current: string) => string): Promise<void> {
    const file = this.file(path);
    if (!file) return;
    await this.app.vault.process(file, edit);
  }

  async mtime(path: string): Promise<number> {
    return this.file(path)?.stat.mtime ?? 0;
  }

  async readProperty(path: string, key: string): Promise<string | null> {
    const file = this.file(path);
    if (!file) return null;
    let value: string | null = null;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const existing = fm[key];
      value = typeof existing === "string" ? existing : null;
    });
    return value;
  }

  async writeProperty(path: string, key: string, value: string): Promise<void> {
    const file = this.file(path);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[key] = value;
    });
  }
}
