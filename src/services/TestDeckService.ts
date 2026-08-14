import { App } from "obsidian";
import { getTestDeckCanvasContent } from "../assets/TestDeckCanvasTemplate";
import {
  I18n,
  getExamDeckContent,
  getExamDeckPath,
  getTemplateShowcaseContent,
  getTemplateShowcaseFolder,
  getTemplateShowcasePath,
  getTestDeckContent,
  getTestDeckPath,
} from "@decks/core";

const DEFAULT_CANVAS_DECKS_FOLDER = "Canvas decks";

export class TestDeckService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async createTestDeck(deckTag: string, folderPath?: string): Promise<void> {
    const filename = getTestDeckPath(folderPath);

    if (await this.app.vault.adapter.exists(filename)) {
      return;
    }

    const content = getTestDeckContent(deckTag);
    await this.app.vault.create(filename, content);
  }

  /** Demo exam deck, tagged `<deckTag>/exams` so it lands on the Exams preset. */
  async createExamDemoDeck(deckTag: string, folderPath?: string): Promise<void> {
    const filename = getExamDeckPath(folderPath);

    if (await this.app.vault.adapter.exists(filename)) {
      return;
    }

    const content = getExamDeckContent(deckTag);
    await this.app.vault.create(filename, content);
  }

  /**
   * Create the sample template file used by the getting-started "Templates"
   * section. Dropped into `currentTemplateFolder` if set, else the default
   * "Decks Templates/" folder (created if missing). Returns the resolved folder
   * so the caller can persist it as the template-folder setting, or null if the
   * file already existed.
   */
  async createTemplateShowcase(
    currentTemplateFolder: string,
  ): Promise<string | null> {
    const folder = getTemplateShowcaseFolder(currentTemplateFolder);
    const filename = getTemplateShowcasePath(folder);

    if (await this.app.vault.adapter.exists(filename)) {
      return null;
    }

    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.adapter.mkdir(folder);
    }

    await this.app.vault.create(filename, getTemplateShowcaseContent());
    return folder;
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
