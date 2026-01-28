import { Plugin, TFile, WorkspaceLeaf, Notice, TAbstractFile } from "obsidian";

import {
  DatabaseFactory,
  type IDatabaseService,
} from "./database/DatabaseFactory";
import { DeckManager } from "./services/DeckManager";
import { DeckSynchronizer } from "./services/DeckSynchronizer";
import { Scheduler } from "./services/Scheduler";
import { BackupService } from "./services/BackupService";
import { StatisticsService } from "./services/StatisticsService";
import { yieldToUI } from "./utils/ui";
import { Logger, formatTime } from "./utils/logging";
import { ProgressTracker } from "./utils/progress";
import { generateDeckId } from "./utils/hash";

import { type DecksSettings, DEFAULT_SETTINGS } from "./settings";
import { DecksSettingTab } from "./components/settings/SettingsTab";

import { DecksView } from "./components/DecksView";

export const VIEW_TYPE_DECKS = "decks-view";

/**
 * Deep merge utility that ignores null and undefined values
 * This prevents null values in loaded data from overriding valid defaults
 */
function deepMergeIgnoreNull<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>
): T {
  if (source === null || source === undefined) {
    return target;
  }

  if (typeof target !== "object" || typeof source !== "object") {
    return source as T;
  }

  const result = { ...target } as Record<string, unknown>;

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];

      if (sourceValue === null || sourceValue === undefined) {
        // Keep the target value, don't override with null/undefined
        continue;
      }

      if (
        typeof sourceValue === "object" &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        // Recursively merge objects
        result[key] = deepMergeIgnoreNull(
          result[key] as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        );
      } else {
        result[key] = sourceValue;
      }
    }
  }

  return result as T;
}

export default class DecksPlugin extends Plugin {
  private db: IDatabaseService;
  public deckManager: DeckManager;
  private deckSynchronizer: DeckSynchronizer;
  private scheduler: Scheduler;
  private backupService: BackupService;
  private statisticsService: StatisticsService;
  public view: DecksView | null = null;
  public settings: DecksSettings;
  private logger: Logger;
  private progressTracker: ProgressTracker;
  private lastKnownDatabaseMtime = 0;

  async onload() {
    // Load settings first
    await this.loadSettings();

    // Initialize utilities
    this.logger = new Logger(
      this.settings,
      this.app.vault.adapter,
      this.app.vault.configDir,
      this.manifest.dir || 'decks'
    );
    this.progressTracker = new ProgressTracker(this.settings);

    this.logger.debug("Loading Decks plugin");

    try {
      // Ensure plugin directory exists
      const adapter = this.app.vault.adapter;
      const manifestDir = this.manifest.dir || 'decks';
      const pluginDir = `${this.app.vault.configDir}/plugins/${manifestDir}`;
      if (!(await adapter.exists(pluginDir))) {
        await adapter.mkdir(pluginDir);
      }

      // FSRS instances are now created per-deck as needed

      // Initialize database with worker support
      const databasePath = `${this.app.vault.configDir}/plugins/${manifestDir}/flashcards.db`;

      // Use experimental setting to control worker usage
      const useWorker = this.settings.experimental.enableDatabaseWorker;

      this.db = await DatabaseFactory.create(
        databasePath,
        adapter,
        this.logger.debug.bind(this),
        {
          useWorker,
          workerEnabled: true,
          configDir: this.app.vault.configDir,
        }
      );

      // Initialize deck manager with optimized main-thread approach
      this.deckManager = new DeckManager(
        this.app.vault,
        this.app.metadataCache,
        this.db,
        {
          settings: this.settings,
          configDir: this.app.vault.configDir,
        },
        this.settings.parsing.folderSearchPath
      );

      // Initialize deck synchronizer
      this.deckSynchronizer = new DeckSynchronizer(
        this.db,
        this.deckManager,
        this.settings,
        this.app.vault.adapter,
        this.app.vault.configDir
      );

      // Initialize backup service
      this.backupService = new BackupService(
        this.app.vault.adapter,
        this.app.vault.configDir,
        this.manifest.dir || 'decks',
        this.logger.debug.bind(this.logger)
      );

      // Initialize statistics service
      this.statisticsService = new StatisticsService(this.db, this.settings);

      // Initialize scheduler
      this.scheduler = new Scheduler(
        this.db,
        this.settings,
        this.backupService,
        this.logger
      );

      // Register the side panel view
      this.registerView(
        VIEW_TYPE_DECKS,
        (leaf) =>
          new DecksView(
            leaf,
            this.db,
            this.deckSynchronizer,
            this.deckManager,
            this.scheduler,
            this.statisticsService,
            this.settings,
            this.progressTracker,
            this.logger,
            (view: DecksView | null) => {
              this.view = view;
            }
          )
      );

      // Schedule initial sync after workspace is ready
      this.app.workspace.onLayoutReady(() => {
        // Additional delay to ensure metadata cache is fully populated and app is responsive
        setTimeout(() => {
          void this.performInitialSync();
        }, 2000);
      });

      // Add ribbon icon
      this.addRibbonIcon("brain", "Flashcards", () => {
        void this.activateView();
      });

      // Add command to show flashcards panel
      this.addCommand({
        id: "show-flashcards-panel",
        name: "Show flashcards panel",
        callback: () => {
          void this.activateView();
        },
      });

      // Listen for file changes to update decks
      this.registerEvent(
        this.app.vault.on("modify", async (file) => {
          if (file instanceof TFile && file.extension === "md") {
            await this.handleFileChange(file);
          }
        })
      );

      this.registerEvent(
        this.app.vault.on("delete", async (file) => {
          if (file instanceof TFile && file.extension === "md") {
            await this.handleFileDelete(file);
          }
        })
      );

      this.registerEvent(
        this.app.vault.on("rename", async (file, oldPath) => {
          if (file instanceof TFile && file.extension === "md") {
            await this.handleFileRename(file, oldPath);
          }
        })
      );

      // Add settings tab
      this.addSettingTab(
        new DecksSettingTab(
          this.app,
          this,
          this.settings,
          this.db,
          this.saveSettings.bind(this),
          this.logger,
          () => this.view?.refresh(false) || Promise.resolve(),
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
          this.backupService
        )
      );

      // Setup database file watcher
      this.setupDatabaseWatcher();

      this.logger.debug("Decks plugin loaded successfully");
    } catch (error) {
      console.error("Error loading Decks plugin:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Failed to load decks plugin. Check the console for details.");
      }
    }
  }

  onunload() {
    this.logger.debug("Unloading Decks plugin");

    // Close database connection using factory singleton
    void DatabaseFactory.close();
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = deepMergeIgnoreNull(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      (loadedData || {}) as Record<string, unknown>
    ) as unknown as DecksSettings;

    // Deep merge ensures all properties have valid defaults
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // FSRS instances are now deck-specific, no global instance to update

    // Update DeckManager folder search path if it exists
    if (this.deckManager) {
      this.deckManager.updateFolderSearchPath(
        this.settings.parsing.folderSearchPath
      );
    }
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
      await workspace.revealLeaf(leaf);
    }
  }

  async handleFileChange(file: TFile) {
    // Check if file has flashcards tag
    const metadata = this.app.metadataCache.getFileCache(file);
    this.logger.debug(`File changed: ${file.path}, metadata:`, metadata);

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
        ...frontmatterTags.map((tag) => (String(tag).startsWith("#") ? String(tag) : `#${String(tag)}`))
      );
    }

    const hasFlashcardsTag = allTags.some((tag) =>
      tag.startsWith("#flashcards")
    );

    this.logger.debug(
      `File ${file.path} has flashcards tag:`,
      hasFlashcardsTag
    );

    if (hasFlashcardsTag) {
      // Check if deck exists for this file
      const existingDeck = await this.db.getDeckByFilepath(file.path);
      if (existingDeck) {
        // Update deck tag if it changed
        const newTag =
          allTags.find((tag) => tag.startsWith("#flashcards")) || "#flashcards";
        if (existingDeck.tag !== newTag) {
          this.logger.debug(
            `Updating deck tag from ${existingDeck.tag} to ${newTag}`
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
      this.logger.debug("Performing initial background sync...");

      // Use requestIdleCallback or setTimeout to ensure non-blocking execution
      await yieldToUI();

      // Delegate to view for domain logic
      if (this.view) {
        await this.view.refresh(true);
      }

      await yieldToUI();

      const totalTime = performance.now() - startTime;
      this.logger.performance(
        `Initial sync completed successfully in ${formatTime(totalTime)}`
      );
    } catch (error) {
      console.error("Error during initial sync:", error);
      // Don't throw - let the app continue working even if initial sync fails
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

  async handleFileRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (file instanceof TFile && file.extension === "md") {
      // Handle deck ID regeneration for renamed files
      const oldDeck = await this.db.getDeckByFilepath(oldPath);
      if (oldDeck) {
        const oldDeckId = oldDeck.id;
        const newDeckId = generateDeckId(file.path);

        this.logger.debug(`File renamed from ${oldPath} to ${file.path}`);
        this.logger.debug(`Updating deck ID from ${oldDeckId} to ${newDeckId}`);

        // Update deck with new ID, name, and filepath
        await this.db.renameDeck(
          oldDeckId,
          newDeckId,
          file.basename,
          file.path
        );

        // Update all flashcard deck IDs
        await this.deckManager.updateFlashcardDeckIds(oldDeckId, newDeckId);

        await yieldToUI();

        await this.db.save();
        // Refresh view if available
        if (this.view) {
          await this.view.refreshStats();
        }
      }
    }
  }

  private setupDatabaseWatcher(): void {
    const manifestDir = this.manifest.dir || 'decks';
    const databasePath = `${this.app.vault.configDir}/plugins/${manifestDir}/flashcards.db`;

    // Initialize lastKnownDatabaseMtime
    void this.updateLastKnownDatabaseMtime(databasePath);

    // Polling every 2 seconds using Obsidian's registerInterval
    this.registerInterval(
      window.setInterval(() => {
        void this.checkForDatabaseChanges(databasePath);
      }, 2000)
    );

    // Watch for window focus events using registerDomEvent
    this.registerDomEvent(window, "focus", () => {
      void this.checkForDatabaseChanges(databasePath);
    });

    this.logger.debug("Database watcher setup complete");
  }

  private async updateLastKnownDatabaseMtime(
    databasePath: string
  ): Promise<void> {
    try {
      if (await this.app.vault.adapter.exists(databasePath)) {
        const stat = await this.app.vault.adapter.stat(databasePath);
        if (stat) {
          this.lastKnownDatabaseMtime = stat.mtime;
        }
      }
    } catch (error) {
      this.logger.debug("Failed to update lastKnownDatabaseMtime:", error);
    }
  }

  private async checkForDatabaseChanges(databasePath: string): Promise<void> {
    try {
      if (!(await this.app.vault.adapter.exists(databasePath))) {
        return;
      }

      const stat = await this.app.vault.adapter.stat(databasePath);
      if (stat && stat.mtime > this.lastKnownDatabaseMtime) {
        this.logger.debug(
          `Database file changed (${stat.mtime} > ${this.lastKnownDatabaseMtime}), triggering sync`
        );

        // Trigger sync with disk
        await this.db.syncWithDisk();

        // Update our known mtime
        this.lastKnownDatabaseMtime = stat.mtime;

        // Refresh the view if available
        if (this.view) {
          await this.view.refreshStats();
        }
      }
    } catch (error) {
      this.logger.debug("Error checking for database changes:", error);
    }
  }
}
