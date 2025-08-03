import {
  Plugin,
  TFile,
  WorkspaceLeaf,
  Notice,
  MarkdownRenderer,
  Component,
  Modal,
  ItemView,
  ViewState,
  Menu,
  TAbstractFile,
} from "obsidian";

import { DatabaseService } from "./database/DatabaseService";
import { DeckManager } from "./services/DeckManager";
import { FSRS, type Difficulty } from "./algorithm/fsrs";
import { Deck, Flashcard, DeckStats } from "./database/types";
import { FlashcardsSettings, DEFAULT_SETTINGS } from "./settings";
import { FlashcardsSettingTab } from "./components/SettingsTab";
import DeckListPanel from "./components/DeckListPanel.svelte";
import FlashcardReviewModal from "./components/FlashcardReviewModal.svelte";

const VIEW_TYPE_FLASHCARDS = "flashcards-view";
const DATABASE_PATH =
  ".obsidian/plugins/obsidian-flashcards-plugin/flashcards.db";

export default class FlashcardsPlugin extends Plugin {
  private db: DatabaseService;
  private deckManager: DeckManager;
  private fsrs: FSRS;
  public view: FlashcardsView | null = null;
  public settings: FlashcardsSettings;
  private statsRefreshTimeout: NodeJS.Timeout | null = null;

  async onload() {
    console.log("Loading Flashcards plugin");

    // Load settings
    await this.loadSettings();

    try {
      // Ensure plugin directory exists
      const adapter = this.app.vault.adapter;
      const pluginDir = ".obsidian/plugins/obsidian-flashcards-plugin";
      if (!(await adapter.exists(pluginDir))) {
        await adapter.mkdir(pluginDir);
      }

      // Initialize database
      const dbPath = this.settings.database.customPath || DATABASE_PATH;
      this.db = new DatabaseService(dbPath);
      await this.db.initialize();

      // Initialize managers
      this.deckManager = new DeckManager(
        this.app.vault,
        this.app.metadataCache,
        this.db,
      );
      this.fsrs = new FSRS({
        requestRetention: this.settings.fsrs.requestRetention,
        maximumInterval: this.settings.fsrs.maximumInterval,
        easyBonus: this.settings.fsrs.easyBonus,
        hardInterval: this.settings.fsrs.hardInterval,
        w: this.settings.fsrs.weights,
      });

      // Register the side panel view
      this.registerView(
        VIEW_TYPE_FLASHCARDS,
        (leaf) => new FlashcardsView(leaf, this),
      );

      // Add ribbon icon
      this.addRibbonIcon("brain", "Flashcards", () => {
        this.activateView();
      });

      // Add command to show flashcards panel
      this.addCommand({
        id: "show-flashcards-panel",
        name: "Show Flashcards Panel",
        callback: () => {
          this.activateView();
        },
      });

      // Listen for file changes to update decks
      this.registerEvent(
        this.app.vault.on("modify", async (file) => {
          if (file instanceof TFile && file.extension === "md") {
            await this.handleFileChange(file);
          }
        }),
      );

      this.registerEvent(
        this.app.vault.on("delete", async (file) => {
          if (file instanceof TFile && file.extension === "md") {
            await this.handleFileDelete(file);
          }
        }),
      );

      // Load styles
      this.loadStyles();

      // Add settings tab
      this.addSettingTab(new FlashcardsSettingTab(this.app, this));

      console.log("Flashcards plugin loaded successfully");
    } catch (error) {
      console.error("Error loading Flashcards plugin:", error);
      new Notice(
        "Failed to load Flashcards plugin. Check console for details.",
      );
    }
  }

  async onunload() {
    console.log("Unloading Flashcards plugin");

    // Close database connection
    if (this.db) {
      await this.db.close();
    }

    // Remove view
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_FLASHCARDS);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);

    // Update FSRS instance with new settings
    this.fsrs = new FSRS({
      requestRetention: this.settings.fsrs.requestRetention,
      maximumInterval: this.settings.fsrs.maximumInterval,
      easyBonus: this.settings.fsrs.easyBonus,
      hardInterval: this.settings.fsrs.hardInterval,
      w: this.settings.fsrs.weights,
    });
  }

  private loadStyles() {
    const styleEl = document.createElement("style");
    styleEl.id = "flashcards-plugin-styles";
    styleEl.textContent = `
      /* Custom styles for flashcards plugin */
      .flashcards-view {
        padding: 0;
        overflow: hidden;
      }

      /* Modal styles */
      .flashcard-review-modal {
        height: 90vh;
        max-height: 700px;
      }

      .flashcard-review-modal .modal-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 0;
        overflow: hidden;
        width: 100%;
        box-sizing: border-box;
      }

      .flashcard-review-modal .modal {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .flashcard-review-modal .modal-container {
        overflow: hidden;
        width: 100%;
        height: 100%;
      }
    `;
    document.head.appendChild(styleEl);
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_FLASHCARDS);

    if (leaves.length > 0) {
      // View already open
      leaf = leaves[0];
    } else {
      // Open in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_FLASHCARDS,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async handleFileChange(file: TFile) {
    // Check if file has flashcards tag
    const metadata = this.app.metadataCache.getFileCache(file);
    console.log(`File changed: ${file.path}, metadata:`, metadata);

    if (!metadata || !metadata.tags) return;

    const hasFlashcardsTag = metadata.tags.some((tag) =>
      tag.tag.startsWith("#flashcards"),
    );

    console.log(`File ${file.path} has flashcards tag:`, hasFlashcardsTag);

    if (hasFlashcardsTag && this.view) {
      // Refresh the view
      await this.view.refresh();
    }
  }

  async handleFileDelete(file: TFile) {
    // Remove flashcards from deleted file
    await this.db.deleteFlashcardsByFile(file.path);

    if (this.view) {
      await this.view.refresh();
    }
  }

  async syncDecks() {
    await this.deckManager.syncDecks();
  }

  async syncFlashcardsForDeck(deckTag: string) {
    await this.deckManager.syncFlashcardsForDeck(deckTag);
  }

  async getDecks(): Promise<Deck[]> {
    return await this.db.getAllDecks();
  }

  async getDeckStats(): Promise<Map<string, DeckStats>> {
    const stats = await this.db.getAllDeckStats();
    const statsMap = new Map<string, DeckStats>();

    for (const stat of stats) {
      statsMap.set(stat.deckId, stat);
    }

    return statsMap;
  }

  async getDueFlashcards(deckId: string): Promise<Flashcard[]> {
    return await this.db.getDueFlashcards(deckId);
  }

  async getFlashcardsByDeck(deckId: string): Promise<Flashcard[]> {
    return await this.db.getFlashcardsByDeck(deckId);
  }

  async getReviewableFlashcards(deckId: string): Promise<Flashcard[]> {
    return await this.db.getReviewableFlashcards(deckId);
  }

  async reviewFlashcard(
    flashcard: Flashcard,
    difficulty: Difficulty,
  ): Promise<void> {
    // Update flashcard with new scheduling
    const updatedCard = this.fsrs.updateCard(flashcard, difficulty);

    // Save to database
    await this.db.updateFlashcard(updatedCard);

    // Log the review
    await this.db.createReviewLog({
      flashcardId: flashcard.id,
      reviewedAt: new Date().toISOString(),
      difficulty,
      oldInterval: flashcard.interval,
      newInterval: updatedCard.interval,
      oldEaseFactor: flashcard.easeFactor,
      newEaseFactor: updatedCard.easeFactor,
    });

    // Update deck last reviewed
    await this.db.updateDeckLastReviewed(flashcard.deckId);
  }

  renderMarkdown(content: string, el: HTMLElement) {
    const component = new Component();
    component.load();
    MarkdownRenderer.renderMarkdown(content, el, "", component);
    // Return component for caller to manage
    return component;
  }
}

class FlashcardsView extends ItemView {
  private plugin: FlashcardsPlugin;
  private component: DeckListPanel | null = null;
  private markdownComponents: Component[] = [];
  private statsRefreshTimeout: NodeJS.Timeout | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: FlashcardsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_FLASHCARDS;
  }

  getDisplayText(): string {
    return "Flashcards";
  }

  getIcon(): string {
    return "brain";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("flashcards-view");

    // Create and mount Svelte component
    this.component = new DeckListPanel({
      target: container,
      props: {
        decks: [],
        deckStats: new Map(),
        onDeckClick: (deck: Deck) => this.startReview(deck),
        onRefresh: async () => {
          console.log("onRefresh callback invoked");
          await this.refresh();
        },
      },
    });

    // Initial refresh
    await this.refresh();
  }

  async onClose() {
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }

    // Clean up timeouts
    if (this.statsRefreshTimeout) {
      clearTimeout(this.statsRefreshTimeout);
      this.statsRefreshTimeout = null;
    }

    // Clean up markdown components
    this.markdownComponents.forEach((comp) => comp.unload());
    this.markdownComponents = [];
  }

  async refresh() {
    console.log("FlashcardsView.refresh() called");
    try {
      // Sync decks with vault
      console.log("Syncing decks...");
      await this.plugin.syncDecks();

      // Get updated data
      console.log("Getting decks and stats...");
      const decks = await this.plugin.getDecks();

      // Get fresh stats after syncing
      const deckStats = await this.plugin.getDeckStats();

      // Update component
      if (this.component) {
        console.log("Updating component with new data");
        this.component.$set({
          decks,
          deckStats,
        });
      } else {
        console.error("Component not found!");
      }
      console.log("Refresh complete");
    } catch (error) {
      console.error("Error refreshing flashcards:", error);
      new Notice("Error refreshing flashcards. Check console for details.");
    }
  }

  async refreshStats() {
    // Clear any existing timeout
    if (this.statsRefreshTimeout) {
      clearTimeout(this.statsRefreshTimeout);
    }

    // Trigger visual feedback immediately
    if (this.component) {
      this.component.updateStats();
    }

    // Throttle the actual stats refresh
    this.statsRefreshTimeout = setTimeout(async () => {
      console.log("FlashcardsView.refreshStats() executing");
      try {
        // Get updated stats only (faster than full refresh)
        const deckStats = await this.plugin.getDeckStats();
        console.log("Updated deck stats:", deckStats);

        // Update component with new stats
        if (this.component) {
          this.component.$set({
            deckStats,
          });
        }
      } catch (error) {
        console.error("Error refreshing deck stats:", error);
      } finally {
        this.statsRefreshTimeout = null;
      }
    }, 300); // 300ms throttle
  }

  async startReview(deck: Deck) {
    try {
      // First sync flashcards for this specific deck
      console.log(`Syncing flashcards for deck before review: ${deck.name}`);
      await this.plugin.syncFlashcardsForDeck(deck.tag);

      // Get all flashcards that are due for review (new + due cards)
      const flashcards = await this.plugin.getReviewableFlashcards(deck.id);

      if (flashcards.length === 0) {
        new Notice(`No cards due for review in ${deck.name}`);
        return;
      }

      // Open review modal
      new FlashcardReviewModalWrapper(
        this.app,
        this.plugin,
        deck,
        flashcards,
      ).open();
    } catch (error) {
      console.error("Error starting review:", error);
      new Notice("Error starting review. Check console for details.");
    }
  }
}

class FlashcardReviewModalWrapper extends Modal {
  private plugin: FlashcardsPlugin;
  private deck: Deck;
  private flashcards: Flashcard[];
  private component: FlashcardReviewModal | null = null;
  private markdownComponents: Component[] = [];

  constructor(
    app: any,
    plugin: FlashcardsPlugin,
    deck: Deck,
    flashcards: Flashcard[],
  ) {
    super(app);
    this.plugin = plugin;
    this.deck = deck;
    this.flashcards = flashcards;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("flashcard-review-modal");

    // Create container for Svelte component
    const container = contentEl.createDiv();

    this.component = new FlashcardReviewModal({
      target: container,
      props: {
        flashcards: this.flashcards,
        currentIndex: 0,
        onClose: () => this.close(),
        onReview: async (card: Flashcard, difficulty: Difficulty) => {
          await this.plugin.reviewFlashcard(card, difficulty);
        },
        renderMarkdown: (content: string, el: HTMLElement) => {
          const component = this.plugin.renderMarkdown(content, el);
          if (component) {
            this.markdownComponents.push(component);
          }
        },
        settings: this.plugin.settings,
        onCardReviewed: async () => {
          // Refresh deck list stats after each card review
          if (this.plugin.view) {
            await this.plugin.view.refreshStats();
          }
        },
      },
    });

    this.component.$on("complete", (event) => {
      const { reason, reviewed } = event.detail;
      let message = `Review session complete for ${this.deck.name}!`;

      if (reason === "session-limit") {
        message = `Session goal reached! Reviewed ${reviewed} cards from ${this.deck.name}.`;
      } else if (reason === "no-more-cards") {
        message = `All cards reviewed! Completed ${reviewed} cards from ${this.deck.name}.`;
      }

      new Notice(message);

      // Refresh the view to update stats
      if (this.plugin.view) {
        this.plugin.view.refresh();
      }
    });
  }

  onClose() {
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }

    // Clean up markdown components
    this.markdownComponents.forEach((comp) => comp.unload());
    this.markdownComponents = [];

    // Refresh view when closing
    if (this.plugin.view) {
      this.plugin.view.refresh();
    }
  }
}
