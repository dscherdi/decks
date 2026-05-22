import { App } from "obsidian";
import { getTestDeckContent } from "../assets/TestDeckTemplate";
import { getTestDeckCanvasContent } from "../assets/TestDeckCanvasTemplate";
import { I18n } from "@/i18n/I18n";

const DEFAULT_CANVAS_DECKS_FOLDER = "Canvas decks";

export class TestDeckService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async createTestDeck(deckTag: string, folderPath?: string): Promise<void> {
    const localizedFilename = I18n.t.testDeck.filename;
    const filename = folderPath
      ? `${folderPath.replace(/\/$/, "")}/${localizedFilename}`
      : localizedFilename;

    if (await this.app.vault.adapter.exists(filename)) {
      return;
    }

    const content = getTestDeckContent(deckTag);
    await this.app.vault.create(filename, content);
  }

  /**
   * Create the canvas getting-started deck.
   *
   * Drops the .canvas file in `currentCanvasFolder` if non-empty, otherwise
   * in the default "Canvas decks/" folder. Creates the folder if missing.
   * Returns the resolved folder path so the caller can decide whether to
   * persist it as the canvas-decks setting; returns null if the file already
   * existed (no folder-setting change in that case).
   */
  async createTestCanvasDeck(
    deckTag: string,
    currentCanvasFolder: string,
  ): Promise<string | null> {
    const folder =
      currentCanvasFolder.trim() !== ""
        ? currentCanvasFolder.trim().replace(/\/$/, "")
        : DEFAULT_CANVAS_DECKS_FOLDER;
    const filename = `${folder}/${I18n.t.testDeckCanvas.filename}`;

    if (await this.app.vault.adapter.exists(filename)) {
      return null;
    }

    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.adapter.mkdir(folder);
    }

    const content = getTestDeckCanvasContent(deckTag);
    await this.app.vault.create(filename, content);
    return folder;
  }
}
