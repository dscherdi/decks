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
import {
  Deck,
  Flashcard,
  DeckStats,
  DeckConfig,
  Statistics,
} from "./database/types";
import { FlashcardsSettings, DEFAULT_SETTINGS } from "./settings";
import { FlashcardsSettingTab } from "./components/SettingsTab";
import DeckListPanel from "./components/DeckListPanel.svelte";
import { DeckConfigModal } from "./components/DeckConfigModal";
import { StatisticsModal } from "./components/StatisticsModal";
import DeckConfigUI from "./components/DeckConfigUI.svelte";
import { FlashcardReviewModalWrapper } from "./components/FlashcardReviewModalWrapper";

const VIEW_TYPE_FLASHCARDS = "flashcards-view";
const DATABASE_PATH =
  ".obsidian/plugins/obsidian-flashcards-plugin/flashcards.db";

export default class FlashcardsPlugin extends Plugin {
  private db: DatabaseService;
  private deckManager: DeckManager;
  private fsrs: FSRS;
  public view: FlashcardsView | null = null;
  public settings: FlashcardsSettings;

  // Debug logging utility
  debugLog(message: string, ...args: any[]): void {
    if (this.settings?.debug?.enableLogging) {
      console.log(`[Flashcards Debug] ${message}`, ...args);
    }
  }

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
        this,
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

      // Schedule initial sync after workspace is ready
      this.app.workspace.onLayoutReady(() => {
        // Additional delay to ensure metadata cache is fully populated
        setTimeout(() => {
          this.performSync();
        }, 2000);
      });

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
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

    // Ensure debug section exists for existing users
    if (!this.settings.debug) {
      this.settings.debug = DEFAULT_SETTINGS.debug;
      await this.saveSettings();
    }
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

      // Fallback sync if no decks exist (initial sync may have failed due to timing)
      const decks = await this.db.getAllDecks();
      if (decks.length === 0) {
        this.debugLog("No decks found, triggering fallback sync...");
        await this.performSync();
      }
    }
  }

  async handleFileChange(file: TFile) {
    // Check if file has flashcards tag
    const metadata = this.app.metadataCache.getFileCache(file);
    this.debugLog(`File changed: ${file.path}, metadata:`, metadata);

    if (!metadata) return;

    // Check both inline tags and frontmatter tags
    const allTags: string[] = [];
    if (metadata.tags) {
      allTags.push(...metadata.tags.map((t) => t.tag));
    }
    if (metadata.frontmatter && metadata.frontmatter.tags) {
      const frontmatterTags = Array.isArray(metadata.frontmatter.tags)
        ? metadata.frontmatter.tags
        : [metadata.frontmatter.tags];
      allTags.push(
        ...frontmatterTags.map((tag) =>
          tag.startsWith("#") ? tag : `#${tag}`,
        ),
      );
    }

    const hasFlashcardsTag = allTags.some((tag) =>
      tag.startsWith("#flashcards"),
    );

    this.debugLog(`File ${file.path} has flashcards tag:`, hasFlashcardsTag);

    if (hasFlashcardsTag) {
      // Check if deck exists for this file
      const existingDeck = await this.db.getDeckByFilepath(file.path);
      if (existingDeck) {
        // Update deck tag if it changed
        const newTag =
          allTags.find((tag) => tag.startsWith("#flashcards")) || "#flashcards";
        if (existingDeck.tag !== newTag) {
          this.debugLog(
            `Updating deck tag from ${existingDeck.tag} to ${newTag}`,
          );
          await this.db.updateDeck(existingDeck.id, { tag: newTag });
        }

        // Sync flashcards for this specific deck only
        await this.deckManager.syncFlashcardsForDeck(file.path);

        // Refresh only this specific deck's stats (fastest option)
        if (this.view) {
          await this.view.refreshStatsById(existingDeck.id);
        }
      } else {
        // New file with flashcards tag - create deck for this file only
        const newTag =
          allTags.find((tag) => tag.startsWith("#flashcards")) || "#flashcards";
        await this.deckManager.createDeckForFile(file.path, newTag);
        await this.deckManager.syncFlashcardsForDeck(file.path);

        // For new decks, refresh all stats to show the new deck
        if (this.view) {
          await this.view.refreshStats();
        }
      }
    }
  }

  async performSync() {
    try {
      this.debugLog("Performing sync of decks and flashcards...");

      // Metadata cache should be ready by now

      // First sync all decks
      await this.deckManager.syncDecks();

      // Then sync flashcards for each deck
      const decks = await this.db.getAllDecks();
      this.debugLog(
        `Found ${decks.length} decks after sync:`,
        decks.map((d) => d.name),
      );

      for (const deck of decks) {
        this.debugLog(
          `Syncing flashcards for deck: ${deck.name} (${deck.filepath})`,
        );
        await this.deckManager.syncFlashcardsForDeck(deck.filepath);

        // Check how many flashcards were created
        const flashcards = await this.db.getFlashcardsByDeck(deck.id);
        this.debugLog(
          `Deck ${deck.name} now has ${flashcards.length} flashcards`,
        );
      }

      this.debugLog(`Sync completed for ${decks.length} decks`);

      // Update the view if it's open (but avoid infinite recursion)
      if (this.view) {
        const updatedDecks = await this.getDecks();
        const deckStats = await this.getDeckStats();
        this.view.update(updatedDecks, deckStats);
      }
    } catch (error) {
      console.error("Error during initial sync:", error);
    }
  }

  async handleFileDelete(file: TFile) {
    // Remove the deck and all associated flashcards/review logs
    await this.db.deleteDeckByFilepath(file.path);

    if (this.view) {
      // Just refresh stats to remove deleted deck from UI (much faster than full sync)
      await this.view.refreshStats();
    }
  }

  async syncDecks() {
    await this.deckManager.syncDecks();
  }

  async syncFlashcardsForDeck(deckName: string) {
    await this.deckManager.syncFlashcardsForDeckByName(deckName);
  }

  async getReviewCounts(days: number = 365): Promise<Map<string, number>> {
    return await this.db.getReviewCountsByDate(days);
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

  async getDailyReviewCounts(
    deckId: string,
  ): Promise<{ newCount: number; reviewCount: number }> {
    return await this.db.getDailyReviewCounts(deckId);
  }

  async getDeckStatsById(deckId: string): Promise<DeckStats> {
    return await this.db.getDeckStats(deckId);
  }

  async updateDeckConfig(deckId: string, config: DeckConfig): Promise<void> {
    await this.db.updateDeck(deckId, { config });

    // Refresh stats for this deck since config changes can affect displayed stats
    if (this.view) {
      await this.view.refreshStatsById(deckId);
    }
  }

  async reviewFlashcard(
    flashcard: Flashcard,
    difficulty: Difficulty,
    timeElapsed?: number,
  ): Promise<void> {
    // Update flashcard with new scheduling
    const updatedCard = this.fsrs.updateCard(flashcard, difficulty);

    // Save to database
    await this.db.updateFlashcard(updatedCard.id, {
      state: updatedCard.state,
      dueDate: updatedCard.dueDate,
      interval: updatedCard.interval,
      repetitions: updatedCard.repetitions,
      easeFactor: updatedCard.easeFactor,
      stability: updatedCard.stability,
      lapses: updatedCard.lapses,
      lastReviewed: updatedCard.lastReviewed,
    });

    // Log the review
    await this.db.createReviewLog({
      flashcardId: flashcard.id,
      reviewedAt: new Date().toISOString(),
      difficulty,
      oldInterval: flashcard.interval,
      newInterval: updatedCard.interval,
      oldEaseFactor: flashcard.easeFactor,
      newEaseFactor: updatedCard.easeFactor,
      timeElapsed: timeElapsed ?? 0,
    });

    // Update deck last reviewed
    await this.db.updateDeckLastReviewed(flashcard.deckId);

    // Refresh stats for this specific deck if view exists
    if (this.view) {
      await this.view.refreshStatsById(flashcard.deckId);
      // Also refresh heatmap since a new review was completed
      await this.view.refreshHeatmap();
    }
  }

  async getOverallStatistics(
    deckFilter: string = "all",
    timeframe: string = "12months",
  ): Promise<Statistics> {
    return await this.db.getOverallStatistics(deckFilter, timeframe);
  }

  openStatisticsModal() {
    const modal = new StatisticsModal(this);
    modal.open();
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
  private backgroundRefreshInterval: NodeJS.Timeout | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: FlashcardsPlugin) {
    super(leaf);
    this.plugin = plugin;
    // Set reference in plugin so we can access this view instance
    this.plugin.view = this;
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
        onDeckClick: (deck: Deck) => this.startReview(deck),
        onRefresh: async () => {
          this.plugin.debugLog("onRefresh callback invoked");
          await this.refresh();
        },
        getReviewCounts: async (days: number) => {
          return await this.plugin.getReviewCounts(days);
        },
        onUpdateDeckConfig: async (deckId: string, config: DeckConfig) => {
          await this.plugin.updateDeckConfig(deckId, config);
        },
        onOpenStatistics: () => {
          this.plugin.openStatisticsModal();
        },
        plugin: this.plugin,
      },
    });

    // Initial refresh
    await this.refresh();

    // Start background refresh job if enabled
    if (this.plugin.settings.ui.enableBackgroundRefresh) {
      this.startBackgroundRefresh();
    }
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

    // Clean up background refresh
    this.stopBackgroundRefresh();

    // Clean up markdown components
    this.markdownComponents.forEach((comp) => comp.unload());
    this.markdownComponents = [];

    // Clear reference in plugin
    if (this.plugin.view === this) {
      this.plugin.view = null;
    }
  }

  async update(updatedDecks: Deck[], deckStats: Map<string, DeckStats>) {
    this.component?.updateDecks(updatedDecks);
    this.component?.updateStats(deckStats);
  }

  async refresh() {
    this.plugin.debugLog("FlashcardsView.refresh() called");
    try {
      // Perform complete sync like debug command
      await this.plugin.performSync();

      this.plugin.debugLog("Refresh complete");
    } catch (error) {
      console.error("Error refreshing flashcards:", error);
      new Notice("Error refreshing flashcards. Check console for details.");
    }
  }

  async refreshStats() {
    this.plugin.debugLog("FlashcardsView.refreshStats() executing");
    try {
      // Get updated stats only (faster than full refresh)
      const deckStats = await this.plugin.getDeckStats();
      this.plugin.debugLog("Updated deck stats:", deckStats);

      // Update component with new stats - same pattern as refresh()
      if (this.component) {
        this.component.updateStats(deckStats);
      }
    } catch (error) {
      console.error("Error refreshing deck stats:", error);
    }
  }

  async refreshStatsById(deckId: string) {
    this.plugin.debugLog(
      `FlashcardsView.refreshStatsById() executing for deck: ${deckId}`,
    );
    try {
      // Get all stats (same as refresh() method for consistency)
      const deckStats = await this.plugin.getDeckStatsById(deckId);
      this.plugin.debugLog("Updated all deck stats");

      // Update component using same pattern as refresh()
      if (this.component && deckStats) {
        this.component.updateStatsById(deckId, deckStats);
      }
    } catch (error) {
      console.error(`Error refreshing stats for deck ${deckId}:`, error);
    }
  }

  startBackgroundRefresh() {
    // Don't start if background refresh is disabled
    if (!this.plugin.settings.ui.enableBackgroundRefresh) {
      return;
    }

    // Clear any existing interval
    this.stopBackgroundRefresh();

    this.plugin.debugLog(
      `Starting background refresh job (every ${this.plugin.settings.ui.backgroundRefreshInterval} seconds)`,
    );
    this.backgroundRefreshInterval = setInterval(async () => {
      this.plugin.debugLog("Background refresh tick");
      this.refresh();
    }, this.plugin.settings.ui.backgroundRefreshInterval * 1000);
  }

  stopBackgroundRefresh() {
    if (this.backgroundRefreshInterval) {
      this.plugin.debugLog("Stopping background refresh job");
      clearInterval(this.backgroundRefreshInterval);
      this.backgroundRefreshInterval = null;
    }
  }

  restartBackgroundRefresh() {
    this.stopBackgroundRefresh();
    if (this.plugin.settings.ui.enableBackgroundRefresh) {
      this.startBackgroundRefresh();
    }
  }

  async refreshHeatmap() {
    if (this.component) {
      await this.component.refreshHeatmap();
    }
  }

  // Test method to check if background job is running
  checkBackgroundJobStatus() {
    this.plugin.debugLog("Background job status:", {
      isRunning: !!this.backgroundRefreshInterval,
      intervalId: this.backgroundRefreshInterval,
      componentExists: !!this.component,
      refreshInterval: this.plugin.settings.ui.backgroundRefreshInterval,
    });
    return !!this.backgroundRefreshInterval;
  }

  async startReview(deck: Deck) {
    try {
      // First sync flashcards for this specific deck
      console.log(`Syncing flashcards for deck before review: ${deck.name}`);
      await this.plugin.syncFlashcardsForDeck(deck.name);

      // Get daily review counts to show remaining allowance
      const dailyCounts = await this.plugin.getDailyReviewCounts(deck.id);

      // Calculate remaining daily allowance
      const config = deck.config;
      const remainingNew = config.enableNewCardsLimit
        ? Math.max(0, config.newCardsLimit - dailyCounts.newCount)
        : "unlimited";
      const remainingReview = config.enableReviewCardsLimit
        ? Math.max(0, config.reviewCardsLimit - dailyCounts.reviewCount)
        : "unlimited";

      // Get all flashcards that are due for review (respecting daily limits)
      const flashcards = await this.plugin.getReviewableFlashcards(deck.id);

      if (flashcards.length === 0) {
        let message = `No cards due for review in ${deck.name}`;

        // Check if limits are the reason no cards are available
        const newLimitReached =
          config.enableNewCardsLimit && remainingNew === 0;
        const reviewLimitReached =
          config.enableReviewCardsLimit && remainingReview === 0;

        if (newLimitReached && reviewLimitReached) {
          message += `\n\nDaily limits reached:`;
          message += `\nNew cards: ${config.newCardsLimit}/${config.newCardsLimit}`;
          message += `\nReview cards: ${config.reviewCardsLimit}/${config.reviewCardsLimit}`;
        } else if (newLimitReached) {
          message += `\n\nDaily new cards limit reached: ${config.newCardsLimit}/${config.newCardsLimit}`;
        } else if (reviewLimitReached) {
          message += `\n\nDaily review cards limit reached: ${config.reviewCardsLimit}/${config.reviewCardsLimit}`;
        }

        new Notice(message);
        return;
      }

      // Show daily limit info before starting review if limits are active
      if (config.enableNewCardsLimit || config.enableReviewCardsLimit) {
        let limitInfo = `Daily progress for ${deck.name}:\n`;
        if (config.enableNewCardsLimit) {
          if (dailyCounts.newCount >= config.newCardsLimit) {
            limitInfo += `New cards: ${dailyCounts.newCount}/${config.newCardsLimit} (LIMIT EXCEEDED)\n`;
          } else {
            limitInfo += `New cards: ${dailyCounts.newCount}/${config.newCardsLimit} (${remainingNew} remaining)\n`;
          }
        }
        if (config.enableReviewCardsLimit) {
          if (dailyCounts.reviewCount >= config.reviewCardsLimit) {
            limitInfo += `Review cards: ${dailyCounts.reviewCount}/${config.reviewCardsLimit} (LIMIT EXCEEDED)`;
          } else {
            limitInfo += `Review cards: ${dailyCounts.reviewCount}/${config.reviewCardsLimit} (${remainingReview} remaining)`;
          }
        }

        // Add explanation when limits are exceeded but learning cards are available
        const newLimitExceeded =
          config.enableNewCardsLimit &&
          dailyCounts.newCount >= config.newCardsLimit;
        const reviewLimitExceeded =
          config.enableReviewCardsLimit &&
          dailyCounts.reviewCount >= config.reviewCardsLimit;

        if (newLimitExceeded || reviewLimitExceeded) {
          limitInfo += `\n\nNote: Only learning cards will be shown (limits exceeded)`;
        }

        new Notice(limitInfo, 5000);
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
