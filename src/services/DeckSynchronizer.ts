import { DeckManager } from "./DeckManager";
import { yieldToUI } from "@decks/core";
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
  // True while a migration is writing many files. Vault create/modify event
  // handlers skip their auto-sync so the per-file events don't collide with each
  // other or the migration's own single forced sync.
  isMigrating = false;
  // True while a review modal/tab is open; background syncs skip themselves.
  isReviewing = false;
  // Single-flight coalescing: the in-flight run and the one trailing run queued
  // behind it (concurrent callers reuse `queued`).
  private current: Promise<SyncResult> | null = null;
  private queued: Promise<SyncResult> | null = null;
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
          window.setTimeout(() => this.progressTracker.hide(), 3000);
        }
      },
    });

    if (!result.success && result.error) {
      this.progressTracker.update(
        "❌ Sync failed - check console for details",
        0
      );
      window.setTimeout(() => this.progressTracker.hide(), 5000);
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
      await new Promise((resolve) => window.setTimeout(resolve, 5000));

      // await this.performSync({ forceSync: false, showProgress: true });

      this.logger.debug("Initial sync completed successfully");
    } catch (error) {
      this.logger.error("Initial sync failed:", error);
      // Don't throw - let the app continue working even if initial sync fails
    }
  }

  /**
   * Main sync operation. Concurrent calls are coalesced: while a run is in
   * flight, callers get a single trailing run that executes once the current
   * one finishes — so vault create/modify events never throw "already in
   * progress", and a fresh run still picks up the latest changes.
   */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    if (this.current) {
      if (!this.queued) {
        this.queued = this.current
          .catch(() => undefined)
          .then(() => {
            this.queued = null;
            return this.runSync(options);
          });
      }
      return this.queued;
    }
    this.current = this.runSync(options).finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async runSync(options: SyncOptions = {}): Promise<SyncResult> {
    const { showProgress = false, onProgress, force = false } = options;

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

      // Step 3: Sync flashcards for each deck.
      // Skip unchanged decks up front (one bulk DB read + cheap mtime checks)
      // so they incur no per-deck worker round-trips. `force` bypasses the gate.
      let totalFlashcards = 0;
      const flashcardSyncStartTime = performance.now();
      const stale = force ? null : await this.deckManager.getStaleDeckIds();
      let syncedDeckCount = 0;

      for (let i = 0; i < decks.length; i++) {
        const deck = decks[i];

        if (stale && !stale.has(deck.id)) continue;
        const deckStartTime = performance.now();
        syncedDeckCount++;

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
          {
            force,
            // Map the worker's within-deck progress (0-100) into this deck's
            // slice of the bar so a long deck visibly advances.
            onProgress:
              showProgress && onProgress
                ? (p) =>
                    onProgress({
                      message: `📄 Processing deck: ${deck.name} (${i + 1}/${
                        decks.length
                      })`,
                      percentage: 20 + ((i + p / 100) / decks.length) * 70,
                    })
                : undefined,
          }
        );
        await yieldToUI();

        const deckTime = performance.now() - deckStartTime;
        this.logger.performance(
          `Deck ${deck.name} processed in ${formatTime(deckTime)}`
        );
      }

      // Orphaned-card pruning is deliberately NOT run here. A destructive
      // `DELETE … WHERE deck_id NOT IN (SELECT id FROM decks)` during any sync can
      // wipe a real deck's cards if its deck row is transiently missing (cold
      // registry / iCloud race). It's exposed as an explicit "Clean up orphaned
      // cards" command instead (see main.ts).

      // Step 4: Save database — only when something actually changed. A no-op
      // sync (every deck unchanged) leaves the DB clean, so we skip the
      // expensive full serialize + disk write.
      let saveTime = 0;
      if (this.db.isDirty()) {
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

        saveTime = performance.now() - saveStartTime;
      } else {
        this.logger.debug("No changes detected — skipping database save.");
      }
      // Report total cards once (aggregate) rather than per-deck round-trips.
      totalFlashcards = syncedDeckCount > 0 ? await this.db.countAllCards() : 0;

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
