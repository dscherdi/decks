import { Plugin, TFile, WorkspaceLeaf, Notice, TAbstractFile } from "obsidian";

import { DatabaseService } from "./database/DatabaseService";
import { DeckManager } from "./services/DeckManager";
import { DeckSynchronizer } from "./services/DeckSynchronizer";
import { Scheduler } from "./services/Scheduler";
import { yieldToUI } from "./utils/ui";
import { Logger, formatTime } from "./utils/logging";
import { ProgressTracker } from "./utils/progress";
import { DeckStats } from "./database/types";
import { FlashcardsSettings, DEFAULT_SETTINGS } from "./settings";
import { DecksSettingTab } from "./components/SettingsTab";

import { DecksView } from "./components/DecksView";

export const VIEW_TYPE_DECKS = "decks-view";

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
  private logger: Logger;
  private progressTracker: ProgressTracker;
  private hasShownInitialProgress = false;

  async onload() {
    // Load settings first
    await this.loadSettings();

    // Initialize utilities
    this.logger = new Logger(
      this.settings,
      this.app.vault.adapter,
      this.app.vault.configDir,
    );
    this.progressTracker = new ProgressTracker(this.settings);

    this.logger.debug("Loading Decks plugin");

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
        this.logger.debug.bind(this),
      );
      await this.db.initialize();

      // Initialize deck manager with optimized main-thread approach
      this.deckManager = new DeckManager(
        this.app.vault,
        this.app.metadataCache,
        this.db,
        this,
        this.settings.parsing.folderSearchPath,
      );

      // Initialize deck synchronizer
      this.deckSynchronizer = new DeckSynchronizer(
        this.db,
        this.deckManager,
        this.settings,
        this.app.vault.adapter,
        this.app.vault.configDir,
      );

      // Initialize scheduler
      this.scheduler = new Scheduler(
        this.db,
        this.settings,
        this.app.vault.adapter,
        this.app.vault.configDir,
      );

      // Register the side panel view
      this.registerView(
        VIEW_TYPE_DECKS,
        (leaf) =>
          new DecksView(
            leaf,
            this.db,
            this.deckSynchronizer,
            this.scheduler,
            this.settings,
            this.progressTracker,
            this.logger,
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
          () => this.view?.performSync(false) || Promise.resolve(),
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

      this.logger.debug("Decks plugin loaded successfully");
    } catch (error) {
      console.error("Error loading Decks plugin:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Failed to load Decks plugin. Check console for details.");
      }
    }
  }

  async onunload() {
    this.logger.debug("Unloading Decks plugin");

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

    // Update DeckManager folder search path if it exists
    if (this.deckManager) {
      this.deckManager.updateFolderSearchPath(
        this.settings.parsing.folderSearchPath,
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
      workspace.revealLeaf(leaf);
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
        ...frontmatterTags.map((tag) =>
          tag.startsWith("#") ? tag : `#${tag}`,
        ),
      );
    }

    const hasFlashcardsTag = allTags.some((tag) =>
      tag.startsWith("#flashcards"),
    );

    this.logger.debug(
      `File ${file.path} has flashcards tag:`,
      hasFlashcardsTag,
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
      this.logger.debug("Performing initial background sync...");

      // Use requestIdleCallback or setTimeout to ensure non-blocking execution
      await yieldToUI();

      // Delegate to view for domain logic
      if (this.view) {
        await this.view.performSync(false);
        await this.view.refresh(false);
      }

      await yieldToUI();

      const totalTime = performance.now() - startTime;
      this.logger.performance(
        `Initial sync completed successfully in ${formatTime(totalTime)}`,
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
        const newDeckId = this.deckManager.generateDeckId(file.path);

        this.logger.debug(`File renamed from ${oldPath} to ${file.path}`);
        this.logger.debug(`Updating deck ID from ${oldDeckId} to ${newDeckId}`);

        // Update deck with new ID, name, and filepath
        await this.db.renameDeck(
          oldDeckId,
          newDeckId,
          file.basename,
          file.path,
        );

        // Update all flashcard deck IDs
        await this.deckSynchronizer.updateFlashcardDeckIds(
          oldDeckId,
          newDeckId,
        );

        await yieldToUI();

        await this.db.save();
        // Refresh view if available
        if (this.view) {
          await this.view.refreshStats();
        }
      }
    }
  }
}
