import { App } from "obsidian";
import { getTestDeckContent } from "../assets/TestDeckTemplate";

const TEST_DECK_FILENAME = "Decks \u2014 Getting started.md";

export class TestDeckService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async createTestDeck(deckTag: string, folderPath?: string): Promise<void> {
    const filename = folderPath
      ? `${folderPath.replace(/\/$/, "")}/${TEST_DECK_FILENAME}`
      : TEST_DECK_FILENAME;

    if (await this.app.vault.adapter.exists(filename)) {
      return;
    }

    const content = getTestDeckContent(deckTag);
    await this.app.vault.create(filename, content);
  }
}
