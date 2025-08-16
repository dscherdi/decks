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
import { DeckSynchronizer } from "./services/DeckSynchronizer";
import { Scheduler } from "./services/Scheduler";
import { yieldToUI } from "./utils/ui";
import { FSRS, type RatingLabel, type SchedulingInfo } from "./algorithm/fsrs";
import {
  Deck,
  Flashcard,
  DeckStats,
  DeckConfig,
  Statistics,
  hasNewCardsLimit,
  hasReviewCardsLimit,
} from "./database/types";
import { FlashcardsSettings, DEFAULT_SETTINGS } from "./settings";
import { DecksSettingTab } from "./components/SettingsTab";
import DeckListPanel from "./components/DeckListPanel.svelte";
import { DeckConfigModal } from "./components/DeckConfigModal";
import { StatisticsModal } from "./components/StatisticsModal";
import DeckConfigUI from "./components/DeckConfigUI.svelte";
import { FlashcardReviewModalWrapper } from "./components/FlashcardReviewModalWrapper";
import {
  getMinMinutesForProfile,
  getMaxIntervalDaysForProfile,
} from "./algorithm/fsrs-weights";

const VIEW_TYPE_DECKS = "decks-view";

/**
 * Deep merge utility that ignores null and undefined values
 * This prevents null values in loaded data from overriding valid defaults
 */
function deepMergeIgnoreNull(target: any, source: any): any {
  if (source === null || source === undefined) {
    return target;
  }

  if (typeof source !== "object" || Array.isArray(source)) {
    return source;
  }

  const result = { ...target };

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];

      if (sourceValue === null || sourceValue === undefined) {
        // Keep the target value, don't override with null/undefined
        continue;
      }

      if (
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue) &&
        target[key]
      ) {
        // Recursively merge objects
        result[key] = deepMergeIgnoreNull(target[key], sourceValue);
      } else {
        // Use source value for primitives and arrays
        result[key] = sourceValue;
      }
    }
  }

  return result;
}

export default class DecksPlugin extends Plugin {
  private db: DatabaseService;
  public deckManager: DeckManager;
  private deckSynchronizer: DeckSynchronizer;
  private scheduler: Scheduler;
  public view: DecksView | null = null;
  public settings: FlashcardsSettings;
  private progressNotice: Notice | null = null;
  private hasShownInitialProgress = false;

  /**
   * Helper method for timing operations
   */
  private formatTime(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(2)}ms`;
    } else {
      return `${(ms / 1000).toFixed(2)}s`;
    }
  }

  // Debug logging utility
  debugLog(message: string, ...args: any[]): void {
    if (this.settings?.debug?.enableLogging) {
      console.log(`[Decks Debug] ${message}`, ...args);
      this.writeToLogFile(message, ...args);
    }
  }

  private async writeToLogFile(message: string, ...args: any[]): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const logPath = `${this.app.vault.configDir}/plugins/decks/debug.log`;

      const timestamp = new Date().toISOString();
      const argsStr =
        args.length > 0
          ? ` ${args
              .map((arg) =>
                typeof arg === "object" ? JSON.stringify(arg) : String(arg),
              )
              .join(" ")}`
          : "";
      const logEntry = `[${timestamp}] ${message}${argsStr}\n`;

      let existingContent = "";
      if (await adapter.exists(logPath)) {
        existingContent = await adapter.read(logPath);
      }

      await adapter.write(logPath, existingContent + logEntry);
    } catch (error) {
      console.error("[Decks Debug] Failed to write to log file:", error);
    }
  }

  // Performance logging utility
  performanceLog(message: string, ...args: any[]): void {
    if (this.settings?.debug?.performanceLogs) {
      console.log(`[Decks Performance] ${message}`, ...args);
    }
  }

  // Progress tracking utility
  public updateProgress(message: string, progress: number = 0): void {
    if (this.progressNotice) {
      const progressBar = this.createProgressBar(progress);
      this.progressNotice.setMessage(`${message}\n${progressBar}`);
    }
  }

  private createProgressBar(progress: number): string {
    const width = 25;
    const filled = Math.round((progress / 100) * width);
    const empty = width - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    const percentage = Math.round(progress);
    return `[${bar}] ${percentage}%`;
  }

  public showProgressNotice(message: string): void {
    this.debugLog(`showProgressNotice called with: ${message}`);
    this.debugLog(`enableNotices setting: ${this.settings?.ui?.enableNotices}`);
    if (this.settings?.ui?.enableNotices !== false) {
      this.debugLog("Creating progress notice");
      this.progressNotice = new Notice(message, 0);
    } else {
      this.debugLog("Notices disabled, not showing progress notice");
    }
  }

  public hideProgressNotice(): void {
    if (this.progressNotice) {
      this.progressNotice.hide();
      this.progressNotice = null;
    }
  }

  async onload() {
    this.debugLog("Loading Decks plugin");

    // Load settings
    await this.loadSettings();

    try {
      // Ensure plugin directory exists
      const adapter = this.app.vault.adapter;
      const pluginDir = `${this.app.vault.configDir}/plugins/decks`;
      if (!(await adapter.exists(pluginDir))) {
        await adapter.mkdir(pluginDir);
      }

      // FSRS instances are now created per-deck as needed

      // Initialize database
      const databasePath = `${this.app.vault.configDir}/plugins/decks/flashcards.db`;
      this.db = new DatabaseService(
        databasePath,
        adapter,
        this.debugLog.bind(this),
      );
      await this.db.initialize();

      // Initialize deck manager with optimized main-thread approach
      this.deckManager = new DeckManager(
        this.app.vault,
        this.app.metadataCache,
        this.db,
        this,
      );

      // Initialize deck synchronizer
      this.deckSynchronizer = new DeckSynchronizer(
        this.db,
        this.deckManager,
        this.debugLog.bind(this),
        this.performanceLog.bind(this),
      );

      // Initialize scheduler
      this.scheduler = new Scheduler(this.db);

      // Register the side panel view
      this.registerView(
        VIEW_TYPE_DECKS,
        (leaf) =>
          new DecksView(
            this,
            leaf,
            this.deckSynchronizer,
            this.scheduler,
            this.settings,
            this.debugLog.bind(this),
            this.performSync.bind(this),
            this.getDecks.bind(this),
            this.getDeckStats.bind(this),
            this.getDeckStatsById.bind(this),
            this.getReviewCounts.bind(this),
            this.updateDeckConfig.bind(this),
            this.openStatisticsModal.bind(this),
            this.deckSynchronizer.syncDeck.bind(this.deckSynchronizer),
            this.db.getDailyReviewCounts.bind(this.db),
            this.reviewFlashcard.bind(this),
            this.renderMarkdown.bind(this),
            (view: DecksView | null) => {
              this.view = view;
            },
          ),
      );

      // Schedule initial sync after workspace is ready
      this.app.workspace.onLayoutReady(() => {
        // Additional delay to ensure metadata cache is fully populated and app is responsive
        setTimeout(() => {
          this.performInitialSync();
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

      this.registerEvent(
        this.app.vault.on("rename", async (file, oldPath) => {
          if (file instanceof TFile && file.extension === "md") {
            await this.handleFileRename(file, oldPath);
          }
        }),
      );

      // Add settings tab
      this.addSettingTab(
        new DecksSettingTab(
          this.app,
          this,
          this.settings,
          this.saveSettings.bind(this),
          this.performSync.bind(this),
          async () => {
            if (this.view) {
              await this.view.refreshStats();
            }
          },
          () => {
            if (this.view) {
              this.view.restartBackgroundRefresh();
            }
          },
          () => {
            if (this.view) {
              this.view.startBackgroundRefresh();
            }
          },
          () => {
            if (this.view) {
              this.view.stopBackgroundRefresh();
            }
          },
          this.db.purgeDatabase.bind(this.db),
        ),
      );

      this.debugLog("Decks plugin loaded successfully");
    } catch (error) {
      console.error("Error loading Decks plugin:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Failed to load Decks plugin. Check console for details.");
      }
    }
  }

  async onunload() {
    this.debugLog("Unloading Decks plugin");

    // Close database connection
    if (this.db) {
      await this.db.close();
    }
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = deepMergeIgnoreNull(DEFAULT_SETTINGS, loadedData);

    // Deep merge ensures all properties have valid defaults
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // FSRS instances are now deck-specific, no global instance to update
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_DECKS);

    if (leaves.length > 0) {
      // View already open
      leaf = leaves[0];
    } else {
      // Open in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_DECKS,
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
        await yieldToUI();
        await this.deckSynchronizer.syncDeck(existingDeck.id);

        // Refresh only this specific deck's stats (fastest option)
        if (this.view) {
          await this.view.refreshStatsById(existingDeck.id);
        }
      } else {
        // New file with flashcards tag - create deck for this file only
        const newTag =
          allTags.find((tag) => tag.startsWith("#flashcards")) || "#flashcards";
        await this.deckSynchronizer.createDeckForFile(file.path, newTag);
        await yieldToUI();

        // Get the newly created deck and sync it
        const newDeck = await this.db.getDeckByFilepath(file.path);
        if (newDeck) {
          await this.deckSynchronizer.syncDeck(newDeck.id);
        }

        // For new decks, refresh all stats to show the new deck
        if (this.view) {
          await this.view.refreshStats();
        }
      }
    }
  }

  async performInitialSync() {
    try {
      const startTime = performance.now();
      this.debugLog("Performing initial background sync...");

      // Use requestIdleCallback or setTimeout to ensure non-blocking execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Use the main performSync method which has progress notices
      await this.performSync(false);

      if (this.view) {
        // Update the view with refreshed data
        const updatedDecks = await this.getDecks();
        const deckStats = await this.getDeckStats();
        this.view.update(updatedDecks, deckStats);
      }

      const totalTime = performance.now() - startTime;
      this.performanceLog(
        `Initial sync completed successfully in ${this.formatTime(totalTime)}`,
      );
    } catch (error) {
      console.error("Error during initial sync:", error);
      // Don't throw - let the app continue working even if initial sync fails
    }
  }

  async performSync(forceSync: boolean = false): Promise<void> {
    const result = await this.deckSynchronizer.performSync({
      forceSync,
      showProgress: true,
      onProgress: (progress) => {
        this.debugLog(
          `Progress: ${progress.percentage}% - ${progress.message}`,
        );
        if (!this.hasShownInitialProgress) {
          const message = forceSync
            ? "🔄 Force refreshing flashcards...\n" +
              this.createProgressBar(progress.percentage)
            : "🔄 Syncing flashcards...\n" +
              this.createProgressBar(progress.percentage);
          this.debugLog(`Showing initial progress notice: ${message}`);
          this.showProgressNotice(message);
          this.hasShownInitialProgress = true;
        }
        this.updateProgress(progress.message, progress.percentage);
        if (progress.percentage === 100) {
          this.debugLog("Sync complete, hiding progress notice");
          this.hasShownInitialProgress = false;
          setTimeout(() => this.hideProgressNotice(), 3000);
        }
      },
    });

    if (!result.success && result.error) {
      this.updateProgress("❌ Sync failed - check console for details", 0);
      this.hasShownInitialProgress = false;
      setTimeout(() => this.hideProgressNotice(), 5000);
      throw result.error;
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

  async handleFileRename(file: TFile, oldPath: string) {
    // Handle deck ID regeneration for renamed files
    const oldDeck = await this.db.getDeckByFilepath(oldPath);
    if (oldDeck) {
      const oldDeckId = oldDeck.id;
      const newDeckId = this.deckManager.generateDeckId(file.path);

      this.debugLog(`File renamed from ${oldPath} to ${file.path}`);
      this.debugLog(`Updating deck ID from ${oldDeckId} to ${newDeckId}`);

      // Update deck with new ID, name, and filepath
      await this.db.renameDeck(oldDeckId, newDeckId, file.basename, file.path);

      // Update all flashcard deck IDs
      await this.deckSynchronizer.updateFlashcardDeckIds(oldDeckId, newDeckId);

      // Refresh view if available
      if (this.view) {
        await this.view.refreshStats();
      }
    }
  }

  async syncDecks() {
    await this.deckManager.syncDecks();
  }

  async syncFlashcardsForDeck(deckId: string) {
    await this.deckSynchronizer.syncDeck(deckId);
  }

  async getReviewCounts(days: number = 365): Promise<Map<string, number>> {
    return await this.db.getReviewCountsByDate(days);
  }

  async getDecks(): Promise<Deck[]> {
    return this.db.getAllDecks();
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

  async getNextCard(deckId: string): Promise<Flashcard | null> {
    return await this.scheduler.getNext(new Date(), deckId, {});
  }

  async getDailyReviewCounts(
    deckId: string,
  ): Promise<{ newCount: number; reviewCount: number }> {
    return await this.db.getDailyReviewCounts(deckId);
  }

  async getDeckStatsById(deckId: string): Promise<DeckStats> {
    const stats = await this.db.getDeckStats(deckId);
    return stats;
  }

  async updateDeckConfig(
    deckId: string,
    config: Partial<DeckConfig>,
  ): Promise<void> {
    // Validate profile and requestRetention if provided
    if (
      config.fsrs?.profile &&
      !["INTENSIVE", "STANDARD"].includes(config.fsrs.profile)
    ) {
      throw new Error(`Invalid profile: ${config.fsrs.profile}`);
    }

    if (config.fsrs?.requestRetention !== undefined) {
      const rr = config.fsrs.requestRetention;
      if (rr <= 0.5 || rr >= 0.995) {
        throw new Error(
          `requestRetention must be in range (0.5, 0.995), got ${rr}`,
        );
      }
    }

    // Get current config and merge with updates
    const currentConfig = await this.getDeckConfig(deckId);
    if (!currentConfig) {
      throw new Error(`Deck not found: ${deckId}`);
    }

    // Check if header level is changing
    const headerLevelChanged =
      config.headerLevel !== undefined &&
      config.headerLevel !== currentConfig.headerLevel;

    const updatedConfig = {
      ...currentConfig,
      ...config,
      fsrs: {
        ...currentConfig.fsrs,
        ...config.fsrs,
      },
    };

    await this.db.updateDeck(deckId, { config: updatedConfig });

    // If header level changed, force resync the deck to clean up old flashcards
    if (headerLevelChanged) {
      const deck = await this.db.getDeckById(deckId);
      if (deck) {
        this.debugLog(
          `Header level changed for deck ${deck.name}, forcing resync`,
        );
        await yieldToUI();
        await this.deckSynchronizer.syncDeck(deck.filepath, true);
      }
    }

    // Refresh stats for this deck since config changes can affect displayed stats
    if (this.view) {
      await this.view.refreshStatsById(deckId);
    }
  }

  /**
   * Get deck configuration
   */
  async getDeckConfig(deckId: string): Promise<DeckConfig | null> {
    const decks = await this.db.getAllDecks();
    const deck = decks.find((d) => d.id === deckId);
    return deck ? deck.config : null;
  }

  /**
   * Schedule preview for a card showing all four rating outcomes
   */
  async schedulePreview(
    cardId: string,
    now: Date = new Date(),
  ): Promise<SchedulingInfo | null> {
    return await this.scheduler.preview(cardId, now);
  }

  async reviewFlashcard(
    deck: Deck,
    flashcard: Flashcard,
    difficulty: "again" | "hard" | "good" | "easy",
    timeElapsed?: number,
  ): Promise<void> {
    // Use unified scheduler for rating
    await this.scheduler.rate(
      flashcard.id,
      difficulty,
      new Date(),
      timeElapsed,
    );

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

class DecksView extends ItemView {
  private plugin: DecksPlugin;
  private deckSynchronizer: DeckSynchronizer;
  private scheduler: Scheduler;
  private settings: FlashcardsSettings;
  private debugLog: (message: string, ...args: any[]) => void;
  private performSync: (force?: boolean) => Promise<void>;
  private getDecks: () => Promise<Deck[]>;
  private getDeckStats: () => Promise<Map<string, DeckStats>>;
  private getDeckStatsById: (deckId: string) => Promise<DeckStats | null>;
  private getReviewCounts: (days: number) => Promise<any>;
  private updateDeckConfig: (
    deckId: string,
    config: DeckConfig,
  ) => Promise<void>;
  private openStatisticsModal: () => void;
  private syncFlashcardsForDeck: (deckId: string) => Promise<void>;
  private getDailyReviewCounts: (
    deckId: string,
  ) => Promise<{ newCount: number; reviewCount: number }>;
  private reviewFlashcard: (
    card: Flashcard,
    difficulty: RatingLabel,
    timeElapsed?: number,
  ) => Promise<void>;
  private renderMarkdown: (
    content: string,
    el: HTMLElement,
  ) => Component | null;
  private setViewReference: (view: DecksView | null) => void;
  private component: DeckListPanel | null = null;
  private markdownComponents: Component[] = [];
  private statsRefreshTimeout: NodeJS.Timeout | null = null;
  private backgroundRefreshInterval: NodeJS.Timeout | null = null;

  constructor(
    plugin: DecksPlugin,
    leaf: WorkspaceLeaf,
    deckSynchronizer: DeckSynchronizer,
    scheduler: Scheduler,
    settings: FlashcardsSettings,
    debugLog: (message: string, ...args: any[]) => void,
    performSync: (force?: boolean) => Promise<void>,
    getDecks: () => Promise<Deck[]>,
    getDeckStats: () => Promise<Map<string, DeckStats>>,
    getDeckStatsById: (deckId: string) => Promise<DeckStats | null>,
    getReviewCounts: (days: number) => Promise<Map<string, number> | undefined>,
    updateDeckConfig: (deckId: string, config: DeckConfig) => Promise<void>,
    openStatisticsModal: (deckFilter?: string) => void,
    syncFlashcardsForDeck: (deckId: string) => Promise<void>,
    getDailyReviewCounts: (
      deckId: string,
    ) => Promise<{ newCount: number; reviewCount: number }>,
    reviewFlashcard: (
      card: Flashcard,
      rating: RatingLabel,
      timeElapsed?: number,
    ) => Promise<void>,
    renderMarkdown: (content: string, el: HTMLElement) => Component | null,
    setViewReference: (view: DecksView | null) => void,
  ) {
    super(leaf);
    this.plugin = plugin;
    this.deckSynchronizer = deckSynchronizer;
    this.scheduler = scheduler;
    this.settings = settings;
    this.debugLog = debugLog;
    this.performSync = performSync;
    this.getDecks = getDecks;
    this.getDeckStats = getDeckStats;
    this.getDeckStatsById = getDeckStatsById;
    this.getReviewCounts = getReviewCounts;
    this.updateDeckConfig = updateDeckConfig;
    this.openStatisticsModal = openStatisticsModal;
    this.syncFlashcardsForDeck = syncFlashcardsForDeck;
    this.getDailyReviewCounts = getDailyReviewCounts;
    this.reviewFlashcard = reviewFlashcard;
    this.renderMarkdown = renderMarkdown;
    this.setViewReference = setViewReference;
    // Set reference in plugin so we can access this view instance
    this.setViewReference(this);
  }

  getViewType(): string {
    return VIEW_TYPE_DECKS;
  }

  getDisplayText(): string {
    return "Decks";
  }

  getIcon(): string {
    return "brain";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("decks-view");

    // Create and mount Svelte component
    this.component = new DeckListPanel({
      target: container,
      props: {
        onDeckClick: (deck: Deck) => this.startReview(deck),
        onRefresh: async () => {
          this.debugLog("onRefresh callback invoked");
          await this.refresh(false);
        },
        onForceRefreshDeck: async (deckFilepath: string) => {
          this.debugLog(
            "onForceRefreshDeck callback invoked for deck:",
            deckFilepath,
          );

          // Show progress notice for single deck refresh
          const deckDisplayName =
            deckFilepath.split("/").pop()?.replace(".md", "") || deckFilepath;
          this.plugin.showProgressNotice(
            `🔄 Force refreshing deck: ${deckDisplayName}...`,
          );

          try {
            await this.deckSynchronizer.syncDeck(
              deckFilepath,
              true,
              (progress) => {
                this.plugin.updateProgress(
                  progress.message,
                  progress.percentage,
                );

                if (progress.percentage === 100) {
                  setTimeout(() => this.plugin.hideProgressNotice(), 2000);
                }
              },
            );

            // Refresh stats after force refresh
            await this.refreshStats();
          } catch (error) {
            this.plugin.updateProgress(
              "❌ Deck refresh failed - check console for details",
              0,
            );
            setTimeout(() => this.plugin.hideProgressNotice(), 3000);
            throw error;
          }
        },
        getReviewCounts: async (days: number) => {
          return await this.getReviewCounts(days);
        },
        onUpdateDeckConfig: async (deckId: string, config: DeckConfig) => {
          await this.updateDeckConfig(deckId, config);
        },
        onOpenStatistics: () => {
          this.openStatisticsModal();
        },
        plugin: this.plugin,
      },
    });

    // // Initial refresh
    // await this.refresh(false);

    // Start background refresh job if enabled
    if (this.settings.ui.enableBackgroundRefresh) {
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
    this.setViewReference(null);
  }

  async update(updatedDecks: Deck[], deckStats: Map<string, DeckStats>) {
    this.component?.updateDecks(updatedDecks);
    this.component?.updateStats(deckStats);
  }

  async refresh(force: boolean = false) {
    this.debugLog("DecksView.refresh() called");
    try {
      // Perform sync with force parameter
      await this.performSync(force);

      // Update the view with refreshed data
      const updatedDecks = await this.getDecks();
      const deckStats = await this.getDeckStats();
      this.update(updatedDecks, deckStats);

      this.debugLog("Refresh complete");
    } catch (error) {
      console.error("Error refreshing decks:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error refreshing decks. Check console for details.");
      }
    }
  }

  async refreshStats() {
    this.debugLog("DecksView.refreshStats() executing");
    try {
      // Get updated stats only (faster than full refresh)
      const deckStats = await this.getDeckStats();
      this.debugLog("Updated deck stats:", deckStats);

      // Update component with new stats - same pattern as refresh()
      if (this.component) {
        this.component.updateStats(deckStats);
      }
    } catch (error) {
      console.error("Error refreshing stats:", error);
    }
  }

  async refreshStatsById(deckId: string) {
    this.debugLog(`DecksView.refreshStatsById() executing for deck: ${deckId}`);
    try {
      // Get all stats (same as refresh() method for consistency)
      const deckStats = await this.getDeckStatsById(deckId);
      this.debugLog("Updated all deck stats");

      // Update component using same pattern as refresh()
      if (this.component && deckStats) {
        this.component.updateStatsById(deckId, deckStats);
      }
    } catch (error) {
      console.error("Error refreshing stats by ID:", error);
    }
  }

  startBackgroundRefresh() {
    // Don't start if background refresh is disabled
    if (!this.settings.ui.enableBackgroundRefresh) {
      return;
    }

    // Clear any existing interval
    this.stopBackgroundRefresh();

    this.debugLog(
      `Starting background refresh job (every ${this.settings.ui.backgroundRefreshInterval} seconds)`,
    );

    this.backgroundRefreshInterval = setInterval(async () => {
      this.debugLog("Background refresh tick");
      this.refresh();
    }, this.settings.ui.backgroundRefreshInterval * 1000);
  }

  stopBackgroundRefresh() {
    if (this.backgroundRefreshInterval) {
      this.debugLog("Stopping background refresh job");
      clearInterval(this.backgroundRefreshInterval);
      this.backgroundRefreshInterval = null;
    }
  }

  restartBackgroundRefresh() {
    this.stopBackgroundRefresh();
    if (this.settings.ui.enableBackgroundRefresh) {
      this.startBackgroundRefresh();
    }
  }

  async refreshHeatmap() {
    if (this.component) {
      this.component.refreshHeatmap();
    }
  }

  // Test method to check if background job is running
  checkBackgroundJobStatus() {
    this.debugLog("Background job status:", {
      isRunning: !!this.backgroundRefreshInterval,
      intervalId: this.backgroundRefreshInterval,
      componentExists: !!this.component,
      refreshInterval: this.settings.ui.backgroundRefreshInterval,
    });
  }

  async startReview(deck: Deck) {
    try {
      // First sync flashcards for this specific deck
      this.debugLog(`Syncing cards for deck before review: ${deck.name}`);
      await this.syncFlashcardsForDeck(deck.id);

      // Get daily review counts to show remaining allowance
      const dailyCounts = await this.getDailyReviewCounts(deck.id);

      // Calculate remaining daily allowance
      const config = deck.config;
      const remainingNew = hasNewCardsLimit(config)
        ? config.newCardsPerDay === 0
          ? "none"
          : Math.max(0, config.newCardsPerDay - dailyCounts.newCount)
        : "unlimited";
      const remainingReview = hasReviewCardsLimit(config)
        ? config.reviewCardsPerDay === 0
          ? "none"
          : Math.max(0, config.reviewCardsPerDay - dailyCounts.reviewCount)
        : "unlimited";

      // Check if there are any cards available using the scheduler
      const nextCard = await this.scheduler.getNext(new Date(), deck.id, {
        allowNew: true,
      });

      if (!nextCard) {
        let message = `No cards due for review in ${deck.name}`;

        // Check if limits are the reason no cards are available
        const newLimitReached =
          hasNewCardsLimit(config) &&
          (remainingNew === 0 || remainingNew === "none");
        const reviewLimitReached =
          hasReviewCardsLimit(config) &&
          (remainingReview === 0 || remainingReview === "none");

        if (newLimitReached && reviewLimitReached) {
          message += `\n\nDaily limits reached:`;
          message += `\nNew cards: ${config.newCardsPerDay}/${config.newCardsPerDay}`;
          message += `\nReview cards: ${config.reviewCardsPerDay}/${config.reviewCardsPerDay}`;
        } else if (newLimitReached) {
          message += `\n\nDaily new cards limit reached: ${config.newCardsPerDay}/${config.newCardsPerDay}`;
        } else if (reviewLimitReached) {
          message += `\n\nDaily review cards limit reached: ${config.reviewCardsPerDay}/${config.reviewCardsPerDay}`;
        }

        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(message);
        }
        return;
      }

      // Show daily limit info before starting review if limits are active
      if (hasNewCardsLimit(config) || hasReviewCardsLimit(config)) {
        let limitInfo = `Daily progress for ${deck.name}:\n`;
        if (hasNewCardsLimit(config)) {
          if (config.newCardsPerDay === 0) {
            limitInfo += `New cards: DISABLED (0 allowed per day)\n`;
          } else if (dailyCounts.newCount >= config.newCardsPerDay) {
            limitInfo += `New cards: ${dailyCounts.newCount}/${config.newCardsPerDay} (LIMIT EXCEEDED)\n`;
          } else {
            limitInfo += `New cards: ${dailyCounts.newCount}/${config.newCardsPerDay} (${remainingNew} remaining)\n`;
          }
        }
        if (hasReviewCardsLimit(config)) {
          if (config.reviewCardsPerDay === 0) {
            limitInfo += `Review cards: DISABLED (0 allowed per day)\n`;
          } else if (dailyCounts.reviewCount >= config.reviewCardsPerDay) {
            limitInfo += `Review cards: ${dailyCounts.reviewCount}/${config.reviewCardsPerDay} (LIMIT EXCEEDED)\n`;
          } else {
            limitInfo += `Review cards: ${dailyCounts.reviewCount}/${config.reviewCardsPerDay} (${remainingReview} remaining)\n`;
          }
        }

        // Add explanation when limits are exceeded but learning cards are available
        const newLimitExceeded =
          hasNewCardsLimit(config) &&
          (config.newCardsPerDay === 0 ||
            dailyCounts.newCount >= config.newCardsPerDay);
        const reviewLimitExceeded =
          hasReviewCardsLimit(config) &&
          (config.reviewCardsPerDay === 0 ||
            dailyCounts.reviewCount >= config.reviewCardsPerDay);

        if (newLimitExceeded || reviewLimitExceeded) {
          limitInfo += `\n\nNote: Only learning cards will be shown (limits exceeded)`;
        }

        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(limitInfo, 5000);
        }
      }

      // Open review modal
      new FlashcardReviewModalWrapper(
        this.app,
        deck,
        [nextCard],
        this.scheduler,
        this.settings,
        this.reviewFlashcard.bind(this),
        this.renderMarkdown,
        this.refresh.bind(this),
        this.refreshStatsById.bind(this),
      ).open();
    } catch (error) {
      console.error("Error starting review:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error starting review. Check console for details.");
      }
    }
  }
}
