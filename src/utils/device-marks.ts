/** Obsidian's storage that stays on this device and belongs to this vault. */
export interface VaultLocalStorage {
  loadLocalStorage(key: string): string | null;
  saveLocalStorage(key: string, data: string | null): void;
}

/** Differs whenever a file was rewritten or grew. */
export function fileMark(stat: { mtime: number; size: number }): string {
  return `${stat.mtime}:${stat.size}`;
}
