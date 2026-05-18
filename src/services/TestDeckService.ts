import { App } from "obsidian";
import { getTestDeckContent } from "../assets/TestDeckTemplate";
import { I18n } from "@/i18n/I18n";

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
}
