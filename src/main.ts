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
import { Scheduler } from "./services/Scheduler";
import { FSRS, type Difficulty, type SchedulingInfo } from "./algorithm/fsrs";
import {
  Deck,
  Flashcard,
  DeckStats,
  DeckConfig,
  Statistics,
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
  private scheduler: Scheduler;
  public view: DecksView | null = null;
  public settings: FlashcardsSettings;
  private isSyncing: boolean = false;
  private progressNotice: Notice | null = null;

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
  private updateProgress(message: string, progress: number = 0): void {
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

  private showProgressNotice(message: string): void {
    if (this.settings?.ui?.enableNotices !== false) {
      this.progressNotice = new Notice(message, 0);
    }
  }

  private hideProgressNotice(): void {
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

      // Initialize deck manager
      this.deckManager = new DeckManager(
        this.app.vault,
        this.app.metadataCache,
        this.db,
        this,
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
            this.deckManager.syncFlashcardsForDeck.bind(this.deckManager),
            this.db.getDailyReviewCounts.bind(this.db),
            this.getReviewableFlashcards.bind(this),
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
        }, 5000);
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

      // Optional background sync if no decks exist (non-blocking)
      const decks = await this.db.getAllDecks();
      if (decks.length === 0) {
        this.debugLog("No decks found, scheduling background sync...");
        setTimeout(() => {
          this.performInitialSync();
        }, 1000);
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

  async performInitialSync() {
    let notice: Notice | null = null;
    try {
      const startTime = performance.now();
      this.debugLog("Performing initial background sync...");

      // Show progress notice for large syncs
      if (this.settings?.ui?.enableNotices !== false) {
        notice = new Notice("🔄 Syncing flashcards in background...", 0);
      }

      // Use requestIdleCallback or setTimeout to ensure non-blocking execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      await this.performSync(false);

      const totalTime = performance.now() - startTime;
      this.performanceLog(
        `Initial sync completed successfully in ${this.formatTime(totalTime)}`,
      );

      // Update notice to show completion
      if (notice) {
        notice.setMessage(
          `✅ Flashcard sync completed (${this.formatTime(totalTime)})`,
        );
        setTimeout(() => notice?.hide(), 3000);
      }
    } catch (error) {
      console.error("Error during initial sync:", error);

      // Show error notice
      if (notice) {
        notice.setMessage("⚠️ Flashcard sync failed - check console");
        setTimeout(() => notice?.hide(), 5000);
      }
      // Don't throw - let the app continue working even if initial sync fails
    }
  }

  async performSync(forceSync: boolean = false) {
    if (this.isSyncing) {
      this.debugLog("Sync already in progress, skipping...");
      return;
    }

    this.isSyncing = true;
    const syncStartTime = performance.now();

    // Show progress notice for force refresh
    if (forceSync) {
      this.showProgressNotice(
        "🔄 Force refreshing flashcards...\n" + this.createProgressBar(0),
      );
    }

    try {
      this.debugLog(
        `Performing ${forceSync ? "forced " : ""}sync of decks and flashcards...`,
      );

      // Metadata cache should be ready by now

      // First sync all decks
      if (forceSync) this.updateProgress("🔍 Discovering decks...", 10);
      const decksStartTime = performance.now();
      await this.deckManager.syncDecks();
      const decksTime = performance.now() - decksStartTime;
      this.performanceLog(
        `Deck discovery completed in ${this.formatTime(decksTime)}`,
      );

      // Then sync flashcards for each deck
      const decks = await this.db.getAllDecks();
      this.debugLog(
        `Found ${decks.length} decks after sync:`,
        decks.map((d) => d.name),
      );

      if (forceSync)
        this.updateProgress(`📚 Processing ${decks.length} decks...`, 20);

      let totalFlashcards = 0;
      const flashcardSyncStartTime = performance.now();

      // Process decks in chunks to avoid blocking the UI
      for (let i = 0; i < decks.length; i++) {
        const deck = decks[i];
        const deckStartTime = performance.now();

        // Update progress for force refresh
        if (forceSync) {
          const deckProgress = 20 + (i / decks.length) * 70;
          this.updateProgress(
            `📄 Processing deck: ${deck.name} (${i + 1}/${decks.length})`,
            deckProgress,
          );
        }

        this.debugLog(
          `${forceSync ? "Force s" : "S"}yncing flashcards for deck: ${deck.name} (${deck.filepath})`,
        );
        await this.deckManager.syncFlashcardsForDeck(deck.filepath, forceSync);

        // Check how many flashcards were created
        const flashcards = await this.db.getFlashcardsByDeck(deck.id);
        const deckTime = performance.now() - deckStartTime;
        totalFlashcards += flashcards.length;

        this.performanceLog(
          `Deck ${deck.name} processed in ${this.formatTime(deckTime)} - ${flashcards.length} flashcards`,
        );

        // Yield control every 5 decks to keep UI responsive
        if (i % 5 === 4) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      if (forceSync) this.updateProgress("✅ Finalizing sync...", 95);

      const flashcardSyncTime = performance.now() - flashcardSyncStartTime;
      const totalSyncTime = performance.now() - syncStartTime;

      this.performanceLog(
        `Flashcard processing completed in ${this.formatTime(flashcardSyncTime)}`,
      );
      this.performanceLog(
        `Total sync completed in ${this.formatTime(totalSyncTime)} - ${totalFlashcards} flashcards across ${decks.length} decks`,
      );

      // Performance summary
      if (decks.length > 0) {
        const avgDeckTime = flashcardSyncTime / decks.length;
        const avgFlashcardTime =
          totalFlashcards > 0 ? flashcardSyncTime / totalFlashcards : 0;
        this.performanceLog(
          `Performance: ${this.formatTime(avgDeckTime)}/deck, ${this.formatTime(avgFlashcardTime)}/flashcard`,
        );
      }

      if (forceSync) {
        this.updateProgress(
          `✅ Sync complete! Processed ${totalFlashcards} flashcards across ${decks.length} decks in ${this.formatTime(totalSyncTime)}`,
          100,
        );
        setTimeout(() => this.hideProgressNotice(), 3000);
      }
    } catch (error) {
      console.error("Error during sync:", error);
      if (forceSync) {
        this.updateProgress("❌ Sync failed - check console for details", 0);
        setTimeout(() => this.hideProgressNotice(), 5000);
      }
      throw error;
    } finally {
      this.isSyncing = false;
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
      await this.deckManager.updateFlashcardDeckIds(oldDeckId, newDeckId);

      // Refresh view if available
      if (this.view) {
        await this.view.refreshStats();
      }
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
    const headerLevel = this.settings?.parsing?.headerLevel;
    const stats = await this.db.getAllDeckStatsFiltered(headerLevel);
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
    const headerLevel = this.settings?.parsing?.headerLevel;
    return await this.db.getFlashcardsByDeckFiltered(deckId, headerLevel);
  }

  async getReviewableFlashcards(deckId: string): Promise<Flashcard[]> {
    const headerLevel = this.settings?.parsing?.headerLevel;
    return await this.db.getReviewableFlashcardsFiltered(deckId, headerLevel);
  }

  async getNextCard(deckId: string): Promise<Flashcard | null> {
    const headerLevel = this.settings?.parsing?.headerLevel;
    return await this.scheduler.getNext(new Date(), deckId, { headerLevel });
  }

  async getDailyReviewCounts(
    deckId: string,
  ): Promise<{ newCount: number; reviewCount: number }> {
    return await this.db.getDailyReviewCounts(deckId);
  }

  async getDeckStatsById(deckId: string): Promise<DeckStats> {
    const headerLevel = this.settings?.parsing?.headerLevel;
    const stats = await this.db.getDeckStatsFiltered(deckId, headerLevel);
    return {
      deckId,
      ...stats,
    };
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

    const updatedConfig = {
      ...currentConfig,
      ...config,
      fsrs: {
        ...currentConfig.fsrs,
        ...config.fsrs,
      },
    };

    await this.db.updateDeck(deckId, { config: updatedConfig });

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
  private syncFlashcardsForDeck: (deckName: string) => Promise<void>;
  private getDailyReviewCounts: (
    deckId: string,
  ) => Promise<{ newCount: number; reviewCount: number }>;
  private getReviewableFlashcards: (deckId: string) => Promise<Flashcard[]>;
  private reviewFlashcard: (
    card: Flashcard,
    difficulty: Difficulty,
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
    scheduler: Scheduler,
    settings: FlashcardsSettings,
    debugLog: (message: string, ...args: any[]) => void,
    performSync: (force?: boolean) => Promise<void>,
    getDecks: () => Promise<Deck[]>,
    getDeckStats: () => Promise<Map<string, DeckStats>>,
    getDeckStatsById: (deckId: string) => Promise<DeckStats | null>,
    getReviewCounts: (
      days: number,
    ) => Promise<Map<string, { date: string; reviews: number }[]>>,
    updateDeckConfig: (
      deckId: string,
      config: Partial<DeckConfig>,
    ) => Promise<void>,
    openStatisticsModal: (deckFilter?: string) => void,
    syncFlashcardsForDeck: (deckId: string) => Promise<void>,
    getDailyReviewCounts: (
      deckId: string,
    ) => Promise<{ newCount: number; reviewCount: number }>,
    getReviewableFlashcards: (deckId: string) => Promise<Flashcard[]>,
    reviewFlashcard: (
      card: Flashcard,
      difficulty: Difficulty,
      timeElapsed?: number,
    ) => Promise<void>,
    renderMarkdown: (content: string, el: HTMLElement) => Component | null,
    setViewReference: (view: DecksView | null) => void,
  ) {
    super(leaf);
    this.plugin = plugin;
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
    this.getReviewableFlashcards = getReviewableFlashcards;
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
          await this.refresh(true);
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

    // Initial refresh
    await this.refresh(true);

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
      await this.syncFlashcardsForDeck(deck.name);

      // Get daily review counts to show remaining allowance
      const dailyCounts = await this.getDailyReviewCounts(deck.id);

      // Calculate remaining daily allowance
      const config = deck.config;
      const remainingNew = config.enableNewCardsLimit
        ? Math.max(0, config.newCardsLimit - dailyCounts.newCount)
        : "unlimited";
      const remainingReview = config.enableReviewCardsLimit
        ? Math.max(0, config.reviewCardsLimit - dailyCounts.reviewCount)
        : "unlimited";

      // Get all flashcards that are due for review (respecting daily limits)
      const flashcards = await this.getReviewableFlashcards(deck.id);

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

        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(message);
        }
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

        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(limitInfo, 5000);
        }
      }

      // Open review modal
      new FlashcardReviewModalWrapper(
        this.app,
        deck,
        flashcards,
        this.scheduler,
        this.settings,
        this.reviewFlashcard.bind(this),
        this.renderMarkdown,
        this.refresh.bind(this),
        this.refreshStatsById.bind(this),
        this.getReviewableFlashcards.bind(this),
      ).open();
    } catch (error) {
      console.error("Error starting review:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error starting review. Check console for details.");
      }
    }
  }
}
