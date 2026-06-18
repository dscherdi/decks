import { type App, normalizePath } from "obsidian";
import type { FileStore } from "@decks/core";

/** FileStore backed by the Obsidian vault adapter (paths normalized). */
export class ObsidianFileStore implements FileStore {
  constructor(private readonly app: App) {}

  exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(normalizePath(path));
  }
  read(path: string): Promise<string> {
    return this.app.vault.adapter.read(normalizePath(path));
  }
  write(path: string, data: string): Promise<void> {
    return this.app.vault.adapter.write(normalizePath(path), data);
  }
  mkdir(path: string): Promise<void> {
    return this.app.vault.adapter.mkdir(normalizePath(path));
  }
}
