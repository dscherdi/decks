import { Notice } from "obsidian";
import { DatabaseService } from "../database/DatabaseService";
import { DeckManager } from "./DeckManager";
import { yieldToUI } from "../utils/ui";

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
  private db: DatabaseService;
  private deckManager: DeckManager;
  private isSyncing: boolean = false;
  private debugLog: (message: string, ...args: any[]) => void;
  private performanceLog: (message: string) => void;

  constructor(
    db: DatabaseService,
    deckManager: DeckManager,
    debugLog: (message: string, ...args: any[]) => void,
    performanceLog: (message: string) => void,
  ) {
    this.db = db;
    this.deckManager = deckManager;
    this.debugLog = debugLog;
    this.performanceLog = performanceLog;
  }

  /**
   * Check if a sync operation is currently in progress
   */
  get isInProgress(): boolean {
    return this.isSyncing;
  }

  /**
   * Format time duration in human-readable format
   */
  private formatTime(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(2)}ms`;
    } else {
      return `${(ms / 1000).toFixed(2)}s`;
    }
  }

  /**
   * Perform initial sync with graceful error handling
   */
  async performInitialSync(): Promise<void> {
    try {
      this.debugLog("Starting initial sync...");

      // Add delay to ensure workspace is fully ready
      await new Promise((resolve) => setTimeout(resolve, 5000));

      await this.performSync({ forceSync: false, showProgress: true });

      this.debugLog("Initial sync completed successfully");
    } catch (error) {
      console.error("Initial sync failed:", error);
      // Don't throw - let the app continue working even if initial sync fails
    }
  }

  /**
   * Main sync operation - coordinates deck discovery and flashcard synchronization
   */
  async performSync(options: SyncOptions = {}): Promise<SyncResult> {
    const { forceSync = false, showProgress = false, onProgress } = options;

    if (this.isSyncing) {
      this.debugLog("Sync already in progress, skipping...");
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;
    const syncStartTime = performance.now();

    try {
      this.debugLog(
        `Performing ${forceSync ? "forced " : ""}sync of decks and flashcards...`,
      );

      // Step 1: Sync all decks
      if (showProgress && onProgress) {
        onProgress({ message: "🔍 Discovering decks...", percentage: 10 });
      }

      const decksStartTime = performance.now();
      // await yieldToUI();
      await this.deckManager.syncDecks();
      const decksTime = performance.now() - decksStartTime;

      this.performanceLog(
        `Deck discovery completed in ${this.formatTime(decksTime)}`,
      );

      // Step 2: Get all decks and prepare for flashcard sync
      // await yieldToUI();
      const decks = await this.db.getAllDecks();
      this.debugLog(
        `Found ${decks.length} decks after sync:`,
        decks.map((d) => d.name),
      );

      if (showProgress && onProgress) {
        onProgress({
          message: `📚 Processing ${decks.length} decks...`,
          percentage: 20,
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
            message: `📄 Processing deck: ${deck.name} (${i + 1}/${decks.length})`,
            percentage: deckProgress,
          });
        }

        this.debugLog(
          `${forceSync ? "Force s" : "S"}yncing flashcards for deck: ${deck.name} (${deck.filepath})`,
        );

        await this.deckManager.syncFlashcardsForDeck(deck.filepath, forceSync);
        await yieldToUI();

        // Track performance metrics
        const flashcards = await this.db.getFlashcardsByDeck(deck.id);
        const deckTime = performance.now() - deckStartTime;
        totalFlashcards += flashcards.length;

        this.performanceLog(
          `Deck ${deck.name} processed in ${this.formatTime(deckTime)} - ${flashcards.length} flashcards`,
        );
      }

      // Step 4: Save database
      if (showProgress && onProgress) {
        onProgress({ message: "💾 Saving database...", percentage: 95 });
      }

      this.debugLog("Saving database after processing all decks...");
      const saveStartTime = performance.now();

      await yieldToUI();
      await this.db.save();

      const saveTime = performance.now() - saveStartTime;

      this.debugLog("Database saved successfully");
      this.performanceLog(
        `Database saved in ${this.formatTime(saveTime)} after processing ${decks.length} decks`,
      );

      // Step 5: Calculate final metrics
      const flashcardSyncTime = performance.now() - flashcardSyncStartTime;
      const totalSyncTime = performance.now() - syncStartTime;

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

      // Final progress update
      if (showProgress && onProgress) {
        onProgress({
          message: `✅ Sync complete! Processed ${totalFlashcards} flashcards across ${decks.length} decks in ${this.formatTime(totalSyncTime)} (DB saved in ${this.formatTime(saveTime)})`,
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
      this.debugLog("Error during sync:", error);

      if (showProgress && onProgress) {
        onProgress({
          message: "❌ Sync failed - check console for details",
          percentage: 0,
        });
      }

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
  async syncDeck(deckName: string, forceSync: boolean = false): Promise<void> {
    this.debugLog(`Syncing specific deck: ${deckName}`);
    await this.deckManager.syncFlashcardsForDeck(deckName, forceSync);
  }

  /**
   * Create a deck for a specific file
   */
  async createDeckForFile(filePath: string, tag: string): Promise<void> {
    this.debugLog(`Creating deck for file: ${filePath} with tag: ${tag}`);
    await this.deckManager.createDeckForFile(filePath, tag);
  }

  /**
   * Update flashcard deck IDs when a deck is renamed
   */
  async updateFlashcardDeckIds(
    oldDeckId: string,
    newDeckId: string,
  ): Promise<void> {
    this.debugLog(
      `Updating flashcard deck IDs from ${oldDeckId} to ${newDeckId}`,
    );
    await this.deckManager.updateFlashcardDeckIds(oldDeckId, newDeckId);
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
