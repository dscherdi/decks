import type { DataAdapter } from "obsidian";
import type { QueryConfig } from "./BaseDatabaseService";
import { MainDatabaseService } from "./MainDatabaseService";
import { WorkerDatabaseService } from "./WorkerDatabaseService";
import type {
  Deck,
  Flashcard,
  ReviewLog,
  ReviewSession,
} from "./types";
import type { SqlJsValue, SqlRecord, SqlRow } from "./sql-types";
import type { SyncData, SyncResult } from "../services/FlashcardSynchronizer";

// Proper interface for all database operations
export interface IDatabaseService {
  // Initialization
  initialize(): Promise<void>;
  close(): Promise<void>;
  save(): Promise<void>;

  // Deck operations
  createDeck(
    deck: Omit<Deck, "created" | "modified"> & { id?: string }
  ): Promise<string>;
  getDeckById(id: string): Promise<Deck | null>;
  getDeckByFilepath(filepath: string): Promise<Deck | null>;
  getDeckByTag(tag: string): Promise<Deck | null>;
  getAllDecks(): Promise<Deck[]>;
  updateDeck(id: string, updates: Partial<Deck>): Promise<void>;
  updateDeckTimestamp(deckId: string): Promise<void>;
  updateDeckLastReviewed(deckId: string, timestamp: string): Promise<void>;
  updateDeckHeaderLevel(deckId: string, headerLevel: number): Promise<void>;
  renameDeck(
    oldDeckId: string,
    newDeckId: string,
    newName: string,
    newFilepath: string
  ): Promise<void>;
  deleteDeck(id: string): Promise<void>;
  deleteDeckByFilepath(filepath: string): Promise<void>;

  // Flashcard operations
  createFlashcard(
    flashcard: Omit<Flashcard, "id" | "created" | "modified">
  ): Promise<void>;
  getFlashcardById(flashcardId: string): Promise<Flashcard | null>;
  getFlashcardsByDeck(deckId: string): Promise<Flashcard[]>;
  getAllFlashcards(): Promise<Flashcard[]>;
  getDueFlashcards(deckId: string): Promise<Flashcard[]>;
  getReviewableFlashcards(deckId: string): Promise<Flashcard[]>;
  getNewCardsForReview(deckId: string): Promise<Flashcard[]>;
  getReviewCardsForReview(deckId: string): Promise<Flashcard[]>;
  updateFlashcard(
    flashcardId: string,
    updates: Partial<Flashcard>
  ): Promise<void>;
  updateFlashcardDeckIds(oldDeckId: string, newDeckId: string): Promise<void>;
  migrateFlashcardIdentity(
    oldId: string,
    newCard: Omit<Flashcard, "created" | "modified">
  ): Promise<void>;
  deleteFlashcard(id: string): Promise<void>;
  deleteFlashcardsByFile(sourceFile: string): Promise<void>;

  // Unified sync operation (implementation decides worker vs main thread)
  syncFlashcardsForDeck(
    data: SyncData,
    progressCallback?: (progress: number, message?: string) => void
  ): Promise<SyncResult>;

  // Worker operations (deprecated - use syncFlashcardsForDeck instead)
  syncFlashcardsForDeckWorker?(
    data: SyncData,
    progressTracker?: unknown
  ): Promise<SyncResult>;

  // Batch operations
  batchCreateFlashcards(
    flashcards: Array<Omit<Flashcard, "created" | "modified">>
  ): Promise<void>;
  batchUpdateFlashcards(
    updates: Array<{ id: string; updates: Partial<Flashcard> }>
  ): Promise<void>;
  batchDeleteFlashcards(flashcardIds: string[]): Promise<void>;

  // Review log operations
  createReviewLog(log: Omit<ReviewLog, "id">): Promise<void>;
  insertReviewLog(reviewLog: ReviewLog): Promise<void>;
  getLatestReviewLogForFlashcard(
    flashcardId: string
  ): Promise<ReviewLog | null>;
  getAllReviewLogs(): Promise<ReviewLog[]>;
  reviewLogExists(reviewLogId: string): Promise<boolean>;

  // Optimized review log queries for statistics
  getReviewLogsByDeck(deckId: string): Promise<ReviewLog[]>;
  getReviewLogsByDecks(deckIds: string[]): Promise<ReviewLog[]>;

  // Review session operations
  createReviewSession(session: Omit<ReviewSession, "id">): Promise<string>;
  getReviewSessionById(sessionId: string): Promise<ReviewSession | null>;
  getActiveReviewSession(deckId: string): Promise<ReviewSession | null>;
  getAllReviewSessions(): Promise<ReviewSession[]>;
  updateReviewSessionDoneUnique(
    sessionId: string,
    doneUnique: number
  ): Promise<void>;
  endReviewSession(sessionId: string): Promise<void>;
  insertReviewSession(session: ReviewSession): Promise<void>;
  reviewSessionExists(sessionId: string): Promise<boolean>;
  isCardReviewedInSession(
    sessionId: string,
    flashcardId: string
  ): Promise<boolean>;

  // Statistics operations moved to StatisticsService
  getDailyReviewCounts(
    deckId: string,
    nextDayStartsAt?: number
  ): Promise<{ newCount: number; reviewCount: number }>;

  // Count operations
  countNewCards(deckId: string): Promise<number>;
  countDueCards(deckId: string): Promise<number>;
  countTotalCards(deckId: string): Promise<number>;

  // Forecast operations (optimized SQL)
  getScheduledDueByDay(
    deckId: string,
    startDate: string,
    endDate: string
  ): Promise<{ day: string; count: number }[]>;
  getScheduledDueByDayMulti(
    deckIds: string[],
    startDate: string,
    endDate: string
  ): Promise<{ day: string; count: number }[]>;
  getCurrentBacklog(deckId: string, currentDate: string): Promise<number>;
  getCurrentBacklogMulti(
    deckIds: string[],
    currentDate: string
  ): Promise<number>;
  getDeckReviewCountRange(
    deckId: string,
    startDate: string,
    endDate: string
  ): Promise<number>;
  countNewCardsToday(
    deckId: string,
    nextDayStartsAt?: number
  ): Promise<number>;
  countReviewCardsToday(
    deckId: string,
    nextDayStartsAt?: number
  ): Promise<number>;

  // Utility operations
  purgeDatabase(): Promise<void>;

  querySql<T>(
    sql: string,
    params: SqlJsValue[],
    config: { asObject: true }
  ): Promise<T[]>;
  querySql(
    sql: string,
    params?: SqlJsValue[],
    config?: { asObject?: false }
  ): Promise<SqlRow[]>;
  querySql<T = SqlRecord>(
    sql: string,
    params?: SqlJsValue[],
    config?: QueryConfig
  ): Promise<T[] | SqlJsValue[][]>;
  // Backup operations
  createBackupDatabase(backupPath: string): Promise<void>;
  restoreFromBackupDatabase(backupPath: string): Promise<void>;
  exportDatabaseToBuffer(): Promise<Uint8Array>;
  createBackupDatabaseInstance(
    backupData: Uint8Array
  ): Promise<string | object>;
  queryBackupDatabase(
    backupDb: string | object,
    sql: string
  ): Promise<SqlJsValue[][]>;
  closeBackupDatabaseInstance(backupDb: string | object): Promise<void>;

  // Synchronization operations
  syncWithDisk(): Promise<void>;

  // Transaction methods removed - no longer using transactions
}

export interface DatabaseServiceOptions {
  useWorker?: boolean;
  workerEnabled?: boolean;
  configDir?: string;
}

export class DatabaseFactory {
  private static instance: IDatabaseService | null = null;
  private static currentPath: string | null = null;

  static async create(
    dbPath: string,
    adapter: DataAdapter,
    debugLog: (message: string, ...args: (string | number | object)[]) => void,
    options: DatabaseServiceOptions = {}
  ): Promise<IDatabaseService> {
    // Check if we already have an instance for this path
    if (this.instance && this.currentPath === dbPath) {
      debugLog("Returning existing database instance");
      return this.instance;
    }

    // Close existing instance if path changed
    if (this.instance && this.currentPath !== dbPath) {
      debugLog("Database path changed, closing existing instance");
      await this.instance.close();
      this.instance = null;
    }

    const {
      useWorker = false,
      workerEnabled = false,
      configDir = "",
    } = options;

    try {
      if (useWorker && workerEnabled) {
        debugLog("Creating WorkerDatabaseService instance");
        this.instance = new WorkerDatabaseService(
          dbPath,
          adapter,
          configDir,
          debugLog
        );
      } else {
        debugLog("Creating MainDatabaseService instance");
        this.instance = new MainDatabaseService(dbPath, adapter, debugLog);
      }

      await this.instance.initialize();
      this.currentPath = dbPath;

      debugLog(`Database instance created successfully for path: ${dbPath}`);
      return this.instance;
    } catch (error) {
      debugLog("Failed to create database instance:", error);
      throw error;
    }
  }

  static async close(): Promise<void> {
    if (this.instance) {
      await this.instance.close();
      this.instance = null;
      this.currentPath = null;
    }
  }

  static getInstance(): IDatabaseService | null {
    return this.instance;
  }

  static getCurrentPath(): string | null {
    return this.currentPath;
  }
}
