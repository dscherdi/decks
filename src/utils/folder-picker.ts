import { type App, FuzzySuggestModal } from "obsidian";

/** Fuzzy picker over vault folder paths ("" = vault root). */
export class FolderPickerModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private readonly folders: string[],
    private readonly onChoose: (path: string) => void,
    placeholder: string,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): string[] {
    return this.folders;
  }

  getItemText(path: string): string {
    return path === "" ? "/" : path;
  }

  onChooseItem(path: string): void {
    this.onChoose(path);
  }
}
