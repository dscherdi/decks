import {
  DatabaseFactory,
  type IDatabaseService,
} from "../../database/DatabaseFactory";
import { DeckManager } from "../../services/DeckManager";
import { DeckSynchronizer } from "../../services/DeckSynchronizer";
import { Scheduler } from "../../services/Scheduler";
import { StatisticsService } from "../../services/StatisticsService";
import { BackupService } from "../../services/BackupService";
import { type DecksSettings, DEFAULT_SETTINGS } from "../../settings";
import type { Deck, Flashcard, ReviewLog, DeckStats } from "../../database/types";
import {
  ConsoleVault,
  ConsoleMetadataCache,
  type MockVault,
  type MockMetadataCache,
} from "../adapters/ConsoleAdapters";

export interface ConsoleOptions {
  dataPath: string;
  vaultPath: string;
  settings?: Partial<DecksSettings>;
  debug?: boolean;
}

export interface ReviewSession {
  sessionId: string;
  deckId: string;
  nextCard: Flashcard | null;
}

/**
 * Console Core - Orchestrates existing services without UI dependencies
 * Uses existing business logic with console adapters
 */
export class ConsoleCore {
  private vault: MockVault;
  private metadataCache: MockMetadataCache;
  private db: IDatabaseService;
  private deckManager: DeckManager;
  private deckSynchronizer: DeckSynchronizer;
  private scheduler: Scheduler;
  private statisticsService: StatisticsService;
  private backupService: BackupService;
  private settings: DecksSettings;
  private logger: { debug: (msg: string, ...args: unknown[]) => void };
  private initialized = false;
  private currentSessionId: string | null = null;

  constructor(options: ConsoleOptions) {
    this.settings = this.mergeSettings(DEFAULT_SETTINGS, options.settings);

    // Initialize console adapters
    this.vault = new ConsoleVault(options.vaultPath, options.dataPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.metadataCache = new ConsoleMetadataCache(this.vault as any);

    // Create console logger
    this.logger = {
      debug: options.debug ? console.log : () => {},
    };
  }

  private mergeSettings(
    defaults: DecksSettings,
    overrides?: Partial<DecksSettings>,
  ): DecksSettings {
    if (!overrides) return defaults;

    return {
      ...defaults,
      ...overrides,
      parsing: { ...defaults.parsing, ...overrides.parsing },
      review: { ...defaults.review, ...overrides.review },
      ui: { ...defaults.ui, ...overrides.ui },
      backup: { ...defaults.backup, ...overrides.backup },
      experimental: { ...defaults.experimental, ...overrides.experimental },
    };
  }

  async initialize(options: ConsoleOptions): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure data directory exists
      await this.vault.adapter.mkdir(options.dataPath);

      // Initialize database (reuse existing DatabaseFactory)
      const databasePath = `${options.dataPath}/flashcards.db`;
      this.db = await DatabaseFactory.create(
        databasePath,
        this.vault.adapter as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        this.logger.debug,
        { useWorker: false, workerEnabled: false, configDir: options.dataPath },
      );

      // Initialize existing services with console adapters
      this.deckManager = new DeckManager(
        this.vault as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        this.metadataCache as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        this.db,
        undefined, // No plugin reference for console
        this.settings.parsing.folderSearchPath,
      );

      this.deckSynchronizer = new DeckSynchronizer(
        this.db,
        this.deckManager,
        this.settings,
        this.vault.adapter as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        options.dataPath,
      );

      this.backupService = new BackupService(
        this.vault.adapter as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        options.dataPath,
        this.logger.debug,
      );

      this.statisticsService = new StatisticsService(this.db, this.settings);

      this.scheduler = new Scheduler(
        this.db,
        this.settings,
        this.backupService,
        this.logger,
      );

      this.initialized = true;
      console.log("✅ Console Core initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Console Core:", error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await DatabaseFactory.close();
    }
    this.initialized = false;
  }

  // === DECK OPERATIONS (using existing DeckManager/DeckSynchronizer) ===

  async syncAllDecks(): Promise<{
    totalDecks: number;
    totalFlashcards: number;
  }> {
    this.ensureInitialized();

    await this.deckSynchronizer.performSync({
      forceSync: false,
      showProgress: false,
    });

    const decks = await this.deckManager.getAllDecks();
    const totalDecks = decks.length;
    let totalFlashcards = 0;
    for (const deck of decks) {
      const cards = await this.database.getFlashcardsByDeck(deck.id);
      totalFlashcards += cards.length;
    }

    return {
      totalDecks,
      totalFlashcards,
    };
  }

  async createDeckFromFile(
    filePath: string,
    name?: string,
    tag = "#flashcards",
  ): Promise<Deck> {
    this.ensureInitialized();

    const deckName =
      name || filePath.split("/").pop()?.replace(".md", "") || "Untitled";
    await this.deckSynchronizer.createDeckForFile(filePath, tag);

    // Get the created deck by filepath
    const deck = await this.db.getDeckByFilepath(filePath);
    if (!deck) {
      throw new Error(`Failed to create deck for file: ${filePath}`);
    }

    console.log(`✅ Created deck: ${deckName}`);
    return deck;
  }

  async getDecks(): Promise<Deck[]> {
    this.ensureInitialized();
    return this.db.getAllDecks();
  }

  async getDeck(deckId: string): Promise<Deck | null> {
    this.ensureInitialized();
    return this.db.getDeckById(deckId);
  }

  async deleteDeck(deckId: string): Promise<void> {
    this.ensureInitialized();
    await this.db.deleteDeck(deckId);
    console.log(`🗑️ Deleted deck: ${deckId}`);
  }

  async syncDeck(deckId: string): Promise<void> {
    this.ensureInitialized();
    await this.deckSynchronizer.syncDeck(deckId);
    console.log(`🔄 Synced deck: ${deckId}`);
  }

  // === FLASHCARD OPERATIONS (using existing services) ===

  async getFlashcards(deckId: string): Promise<Flashcard[]> {
    this.ensureInitialized();
    return this.db.getFlashcardsByDeck(deckId);
  }

  async getFlashcard(flashcardId: string): Promise<Flashcard | null> {
    this.ensureInitialized();
    return this.db.getFlashcardById(flashcardId);
  }

  // === REVIEW SYSTEM (using existing Scheduler) ===

  async startReviewSession(
    deckId: string,
    sessionDurationMinutes?: number,
  ): Promise<ReviewSession> {
    this.ensureInitialized();

    const deck = await this.db.getDeckById(deckId);
    if (!deck) {
      throw new Error(`Deck not found: ${deckId}`);
    }

    await this.scheduler.startReviewSession(
      deckId,
      new Date(),
      sessionDurationMinutes,
    );
    const nextCard = await this.scheduler.getNext(new Date(), deckId);

    const sessionId = this.scheduler.getCurrentSession();
    this.currentSessionId = sessionId;

    return {
      sessionId: sessionId || "",
      deckId,
      nextCard,
    };
  }

  async getNextCard(deckId: string): Promise<Flashcard | null> {
    this.ensureInitialized();
    return this.scheduler.getNext(new Date(), deckId);
  }

  async reviewCard(
    flashcardId: string,
    rating: 1 | 2 | 3 | 4,
    timeElapsedMs?: number,
  ): Promise<Flashcard> {
    this.ensureInitialized();

    // Convert numeric rating to RatingLabel
    const ratingLabels = ["again", "hard", "good", "easy"] as const;
    const ratingLabel = ratingLabels[rating - 1];

    const updatedCard = await this.scheduler.rate(
      flashcardId,
      ratingLabel,
      new Date(),
      timeElapsedMs,
    );

    const ratingNames = ["", "Again", "Hard", "Good", "Easy"];
    this.logger.debug(`📝 Rated card: ${ratingNames[rating]}`);

    return updatedCard;
  }

  async previewCard(flashcardId: string): Promise<{
    again: { interval: string; due: Date };
    hard: { interval: string; due: Date };
    good: { interval: string; due: Date };
    easy: { interval: string; due: Date };
  }> {
    this.ensureInitialized();
    const preview = await this.scheduler.preview(flashcardId, new Date());

    if (!preview) {
      throw new Error(`Card not found: ${flashcardId}`);
    }

    return {
      again: {
        interval: `${preview.again.interval} min`,
        due: new Date(preview.again.dueDate),
      },
      hard: {
        interval: `${preview.hard.interval} min`,
        due: new Date(preview.hard.dueDate),
      },
      good: {
        interval: `${preview.good.interval} min`,
        due: new Date(preview.good.dueDate),
      },
      easy: {
        interval: `${preview.easy.interval} min`,
        due: new Date(preview.easy.dueDate),
      },
    };
  }

  async endReviewSession(): Promise<void> {
    this.ensureInitialized();
    if (this.currentSessionId) {
      await this.scheduler.endReviewSession(this.currentSessionId);
      this.currentSessionId = null;
    }
    console.log("✅ Review session ended");
  }

  // === STATISTICS (using existing StatisticsService) ===

  async getDeckStats(deckId: string): Promise<DeckStats> {
    this.ensureInitialized();
    return this.statisticsService.getDeckStats(deckId);
  }

  async getOverallStats(): Promise<{
    totalDecks: number;
    totalCards: number;
    newCards: number;
    dueCards: number;
    matureCards: number;
  }> {
    this.ensureInitialized();

    const decks = await this.getDecks();
    const stats = await this.statisticsService.getOverallStatistics();

    return {
      totalDecks: decks.length,
      totalCards:
        stats.cardStats.new + stats.cardStats.review + stats.cardStats.mature,
      newCards: stats.cardStats.new,
      dueCards: stats.cardStats.review,
      matureCards: stats.cardStats.mature,
    };
  }

  async getReviewHistory(
    deckId?: string,
    _limit?: number,
  ): Promise<ReviewLog[]> {
    this.ensureInitialized();
    if (deckId) {
      return this.db.getReviewLogsByDeck(deckId);
    }
    return this.db.getAllReviewLogs();
  }

  // === BACKUP OPERATIONS (using existing BackupService) ===

  async createBackup(): Promise<string> {
    this.ensureInitialized();
    const filename = await this.backupService.createBackup(this.db);
    console.log(`💾 Backup created: ${filename}`);
    return filename;
  }

  async listBackups(): Promise<
    Array<{ filename: string; created: Date; size: number }>
  > {
    this.ensureInitialized();
    const backups = await this.backupService.getAvailableBackups();
    return backups.map((b) => ({
      filename: b.filename,
      created: b.timestamp,
      size: b.size,
    }));
  }

  async restoreBackup(filename: string): Promise<void> {
    this.ensureInitialized();
    await this.backupService.restoreFromBackup(filename, this.db);
    console.log(`📥 Backup restored: ${filename}`);
  }

  // === FILE SCANNING ===

  async scanMarkdownFiles(
    directory?: string,
  ): Promise<Array<{ path: string; hasFlashcards: boolean }>> {
    this.ensureInitialized();

    const files = this.vault.getMarkdownFiles();
    const results: Array<{ path: string; hasFlashcards: boolean }> = [];

    for (const file of files) {
      if (directory && !file.path.startsWith(directory)) {
        continue;
      }

      try {
        const content = await this.vault.cachedRead(file);
        const metadata = this.metadataCache.getFileCache(file);

        // Check for flashcards tag or flashcard content
        const hasFlashcards = this.hasFlashcardContent(content, metadata);
        results.push({ path: file.path, hasFlashcards });
      } catch {
        console.warn(`Could not read file: ${file.path}`);
        results.push({ path: file.path, hasFlashcards: false });
      }
    }

    return results;
  }

  private hasFlashcardContent(content: string, metadata: any): boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
    // Check for flashcards tag
    const hasTags =
      metadata?.tags?.some((t: any) => t.tag.startsWith("#flashcards")) || // eslint-disable-line @typescript-eslint/no-explicit-any
      (metadata?.frontmatter?.tags &&
        (Array.isArray(metadata.frontmatter.tags)
          ? metadata.frontmatter.tags.some((tag: string) =>
              tag.includes("flashcards"),
            )
          : metadata.frontmatter.tags.includes("flashcards")));

    if (hasTags) return true;

    // Check for table format flashcards
    if (content.includes("| **") && content.includes(" |")) return true;

    // Check for header-paragraph format
    if (/^#{1,6}\s+.+$/m.test(content)) return true;

    return false;
  }

  // === UTILITY METHODS ===

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("ConsoleCore not initialized. Call initialize() first.");
    }
  }

  getSettings(): DecksSettings {
    return this.settings;
  }

  updateSettings(newSettings: Partial<DecksSettings>): void {
    this.settings = this.mergeSettings(this.settings, newSettings);
  }

  // For debugging and introspection
  getServices() {
    return {
      db: this.db,
      deckManager: this.deckManager,
      deckSynchronizer: this.deckSynchronizer,
      scheduler: this.scheduler,
      statisticsService: this.statisticsService,
      backupService: this.backupService,
    };
  }
}
