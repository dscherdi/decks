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
  forceSync?: boolean;
  showProgress?: boolean;
  onProgress?: (progress: SyncProgress) => void;
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
   * Perform a sync with progress tracker
   */
  async performSync(forceSync = false): Promise<void> {
    const result = await this.sync({
      forceSync,
      showProgress: true,
      onProgress: (progress) => {
        this.logger.debug(
          `Progress: ${progress.percentage}% - ${progress.message}`
        );
        if (!this.progressTracker.isVisible()) {
          const message = forceSync
            ? "🔄 Force refreshing flashcards..."
            : "🔄 Syncing flashcards...";
          this.logger.debug(`Showing initial progress notice: ${message}`);
          this.progressTracker.show(message);
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
    const { forceSync = false, showProgress = false, onProgress } = options;

    if (this.isSyncing) {
      this.logger.debug("Sync already in progress, skipping...");
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;
    const syncStartTime = performance.now();

    try {
      this.logger.debug(
        `Performing ${
          forceSync ? "forced " : ""
        }sync of decks and flashcards...`
      );

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
      // await yieldToUI();
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
          `${
            forceSync ? "Force s" : "S"
          }yncing flashcards for deck: ${deck.name} (${deck.filepath})`
        );

        await this.deckManager.syncFlashcardsForDeck(
          deck.id,
          forceSync,
          this.progressTracker
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
   * Sync flashcards for a specific deck
   */
  async syncDeck(
    deckId: string,
    forceSync = false,
    onProgress?: (progress: { message: string; percentage: number }) => void
  ): Promise<void> {
    this.logger.debug(`Syncing specific deck ID: ${deckId}`);

    // Get deck to extract display name
    const deck = await this.db.getDeckById(deckId);
    if (!deck) {
      this.logger.debug(`No deck found for ID: ${deckId}`);
      return;
    }

    const deckDisplayName = deck.name;

    if (onProgress) {
      onProgress({
        message: `🔄 Force refreshing deck: ${deckDisplayName}...`,
        percentage: 20,
      });
    }

    const startTime = performance.now();

    await this.deckManager.syncFlashcardsForDeck(
      deckId,
      forceSync,
      this.progressTracker
    );

    const duration = performance.now() - startTime;

    if (onProgress) {
      onProgress({
        message: `✅ Force refresh complete: ${deckDisplayName} (${Math.round(
          duration
        )}ms)`,
        percentage: 100,
      });
    }
  }

  async forceSyncDeck(deckId: string): Promise<void> {
    this.logger.debug("onForceRefreshDeck callback invoked for deck:", deckId);

    // Get deck to extract display name
    const deck = await this.db.getDeckById(deckId);
    const deckDisplayName = deck ? deck.name : deckId;

    try {
      await this.syncDeck(deckId, true, (progress) => {
        if (progress.percentage === 0) {
          this.progressTracker.show(
            `Starting deck ${deckDisplayName} synchronization...`
          );
        }

        this.progressTracker.update(progress.message, progress.percentage);

        if (progress.percentage === 100) {
          setTimeout(() => this.progressTracker.hide(), 2000);
        }
      });

      // Refresh stats after force refresh
    } catch (error) {
      this.progressTracker.update(
        "❌ Deck refresh failed - check console for details",
        0
      );
      setTimeout(() => this.progressTracker.hide(), 3000);
      throw error;
    }
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
