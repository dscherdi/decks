import { DeckManager } from "./DeckManager";
import { yieldToUI } from "../utils/ui";
import { Logger, formatTime } from "../utils/logging";
import type { DecksSettings } from "../settings";
import type { DataAdapter } from "obsidian";
import { ProgressTracker } from "../utils/progress";
import type { IDatabaseService } from "../database/DatabaseFactory";

export interface SyncProgress {
  message: string;
  percentage: number;
}

export interface SyncOptions {
  showProgress?: boolean;
  onProgress?: (progress: SyncProgress) => void;
  // Bypass the per-deck mtime gate and force a full re-parse of every deck.
  // Default false: only re-parse decks whose source file's mtime has
  // advanced since last sync. Set true for the manual "force full resync"
  // command or whenever you suspect the local cache is wrong.
  force?: boolean;
}

export interface SyncResult {
  totalDecks: number;
  totalFlashcards: number;
  syncTime: number;
  saveTime: number;
  success: boolean;
  error?: Error;
}

export class DeckSynchronizer {
  private db: IDatabaseService;
  private deckManager: DeckManager;
  private isSyncing = false;
  private logger: Logger;
  private progressTracker: ProgressTracker;
  // Wall-clock ms when the most recent sync completed successfully. Used by
  // modal-open paths to skip a redundant sync that just ran (e.g. returning
  // from a review session). Survives across modal instances because the
  // synchronizer itself is a singleton owned by the plugin.
  private _lastSyncCompletedAt = 0;

  constructor(
    db: IDatabaseService,
    deckManager: DeckManager,
    settings: DecksSettings,
    adapter: DataAdapter,
    configDir: string
  ) {
    this.db = db;
    this.deckManager = deckManager;
    this.logger = new Logger(settings, adapter, configDir);
    this.progressTracker = new ProgressTracker(settings);
  }

  /**
   * Check if a sync operation is currently in progress
   */
  get isInProgress(): boolean {
    return this.isSyncing;
  }

  /**
   * Wall-clock ms of the last successful sync completion. Used by
   * stale-while-revalidate modal opens to skip a redundant background
   * sync that just ran. Returns 0 if no sync has completed yet.
   */
  get lastSyncCompletedAt(): number {
    return this._lastSyncCompletedAt;
  }

  /**
   * Perform a sync with progress tracker
   */
  async performSync(): Promise<void> {
    const result = await this.sync({
      showProgress: true,
      onProgress: (progress) => {
        this.logger.debug(
          `Progress: ${progress.percentage}% - ${progress.message}`
        );
        if (!this.progressTracker.isVisible()) {
          this.logger.debug("Showing initial progress notice");
          this.progressTracker.show("Syncing flashcards...");
        }
        this.progressTracker.update(progress.message, progress.percentage);
        if (progress.percentage === 100) {
          this.logger.debug("Sync complete, hiding progress notice");
          setTimeout(() => this.progressTracker.hide(), 3000);
        }
      },
    });

    if (!result.success && result.error) {
      this.progressTracker.update(
        "❌ Sync failed - check console for details",
        0
      );
      setTimeout(() => this.progressTracker.hide(), 5000);
      throw result.error;
    }
  }

  /**
   * Perform initial sync with graceful error handling
   */
  async performInitialSync(): Promise<void> {
    try {
      this.logger.debug("Starting initial sync...");

      // Add delay to ensure workspace is fully ready
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // await this.performSync({ forceSync: false, showProgress: true });

      this.logger.debug("Initial sync completed successfully");
    } catch (error) {
      this.logger.error("Initial sync failed:", error);
      // Don't throw - let the app continue working even if initial sync fails
    }
  }

  /**
   * Main sync operation - coordinates deck discovery and flashcard synchronization
   */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    const { showProgress = false, onProgress, force = false } = options;

    if (this.isSyncing) {
      this.logger.debug("Sync already in progress, skipping...");
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;
    const syncStartTime = performance.now();

    try {
      this.logger.debug("Performing sync of decks and flashcards...");

      // Step 1: Sync all decks
      if (showProgress && onProgress) {
        onProgress({
          message: "🔍 Discovering decks...",
          percentage: 10,
        });
      }

      const decksStartTime = performance.now();

      await this.deckManager.syncDecks();
      const decksTime = performance.now() - decksStartTime;

      this.logger.performance(
        `Deck discovery completed in ${formatTime(decksTime)}`
      );

      // Step 2: Get all decks and prepare for flashcard sync
      const decks = await this.db.getAllDecks();
      this.logger.debug(
        `Found ${decks.length} decks after sync:`,
        decks.map((d) => d.name)
      );

      if (showProgress && onProgress) {
        onProgress({
          message: "📊 Loading decks...",
          percentage: 10,
        });
      }

      // Step 3: Sync flashcards for each deck
      let totalFlashcards = 0;
      const flashcardSyncStartTime = performance.now();

      for (let i = 0; i < decks.length; i++) {
        const deck = decks[i];
        const deckStartTime = performance.now();

        // Update progress
        if (showProgress && onProgress) {
          const deckProgress = 20 + (i / decks.length) * 70;
          onProgress({
            message: `📄 Processing deck: ${deck.name} (${i + 1}/${
              decks.length
            })`,
            percentage: deckProgress,
          });
        }

        this.logger.debug(
          `Syncing flashcards for deck: ${deck.name} (${deck.filepath})`
        );

        await this.deckManager.syncFlashcardsForDeck(
          deck.id,
          this.progressTracker,
          { force }
        );
        await yieldToUI();

        // Track performance metrics
        const totalCardCount = await this.db.countTotalCards(deck.id);
        totalFlashcards += totalCardCount;
        const deckTime = performance.now() - deckStartTime;

        this.logger.performance(
          `Deck ${deck.name} processed in ${formatTime(
            deckTime
          )} - ${totalCardCount} flashcards`
        );
      }

      // Step 4: Save database
      if (showProgress && onProgress) {
        onProgress({
          message: "💾 Saving database...",
          percentage: 95,
        });
      }

      this.logger.debug("Saving database after processing all decks...");
      const saveStartTime = performance.now();

      await yieldToUI();
      await this.db.save();
      await yieldToUI();

      const saveTime = performance.now() - saveStartTime;

      this.logger.performance(
        `Database saved in ${formatTime(saveTime)} after processing ${
          decks.length
        } decks`
      );

      // Step 5: Calculate final metrics
      const flashcardSyncTime = performance.now() - flashcardSyncStartTime;
      const totalSyncTime = performance.now() - syncStartTime;

      this.logger.performance(
        `Total sync completed in ${formatTime(
          totalSyncTime
        )} - ${totalFlashcards} flashcards across ${decks.length} decks`
      );

      // Performance summary
      if (decks.length > 0) {
        const avgDeckTime = flashcardSyncTime / decks.length;
        const avgFlashcardTime =
          totalFlashcards > 0 ? flashcardSyncTime / totalFlashcards : 0;
        this.logger.performance(
          `Performance: ${formatTime(avgDeckTime)}/deck, ${formatTime(
            avgFlashcardTime
          )}/flashcard`
        );
      }

      // Final progress update
      if (showProgress && onProgress) {
        onProgress({
          message: `✅ Sync complete! Processed ${totalFlashcards} flashcards across ${
            decks.length
          } decks in ${formatTime(totalSyncTime)}`,
          percentage: 100,
        });
      }

      this._lastSyncCompletedAt = Date.now();
      return {
        totalDecks: decks.length,
        totalFlashcards,
        syncTime: totalSyncTime,
        saveTime,
        success: true,
      };
    } catch (error) {
      this.logger.debug("Error during sync:", error);

      return {
        totalDecks: 0,
        totalFlashcards: 0,
        syncTime: performance.now() - syncStartTime,
        saveTime: 0,
        success: false,
        error: error as Error,
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync flashcards for a specific deck. `force` bypasses the mtime gate
   * (used by handleFileRename in main.ts where we know the file changed
   * even though mtime checks could be ambiguous mid-rename).
   */
  async syncDeck(deckId: string, options: { force?: boolean } = {}): Promise<void> {
    this.logger.debug(`Syncing specific deck ID: ${deckId}`);

    const deck = await this.db.getDeckById(deckId);
    if (!deck) {
      this.logger.debug(`No deck found for ID: ${deckId}`);
      return;
    }

    await this.deckManager.syncFlashcardsForDeck(
      deckId,
      this.progressTracker,
      options
    );
  }

  /**
   * Create a deck for a specific file
   */
  async createDeckForFile(filePath: string, tag: string): Promise<void> {
    this.logger.debug(`Creating deck for file: ${filePath} with tag: ${tag}`);
    await this.deckManager.createDeckForFile(filePath, tag);
  }

  /**
   * Get sync statistics
   */
  getSyncStats(): { isInProgress: boolean } {
    return {
      isInProgress: this.isSyncing,
    };
  }
}
