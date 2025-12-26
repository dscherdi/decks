import { DataAdapter } from "obsidian";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Deck, Flashcard, ReviewLog, DeckConfig } from "../../database/types";
import { setupRealSqlJs, teardownRealSqlJs } from "./setup-real-sql";

// Mock DataAdapter for in-memory testing
export class InMemoryAdapter implements DataAdapter {
  private files: Map<string, Uint8Array> = new Map();
  private directories: Set<string> = new Set();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const data = this.files.get(path);
    if (!data) {
      throw new Error(`File not found: ${path}`);
    }
    return data.buffer;
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, new Uint8Array(data));
  }

  async mkdir(path: string): Promise<void> {
    this.directories.add(path);
  }

  // Required DataAdapter methods
  async read(path: string): Promise<string> {
    const data = this.files.get(path);
    if (!data) {
      throw new Error(`File not found: ${path}`);
    }
    return new TextDecoder().decode(data);
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, new TextEncoder().encode(data));
  }

  async list(path: string): Promise<any> {
    return [];
  }

  async stat(path: string): Promise<any> {
    return { type: "file", size: 0, mtime: 0, ctime: 0 };
  }

  async append(path: string, data: string): Promise<void> {
    const existing = this.files.get(path) || new Uint8Array(0);
    const newData = new TextEncoder().encode(data);
    const combined = new Uint8Array(existing.length + newData.length);
    combined.set(existing);
    combined.set(newData, existing.length);
    this.files.set(path, combined);
  }

  async process(path: string, fn: (data: string) => string): Promise<string> {
    const data = await this.read(path);
    const result = fn(data);
    await this.write(path, result);
    return result;
  }

  async trashSystem(path: string): Promise<boolean> {
    this.files.delete(path);
    this.directories.delete(path);
    return true;
  }

  async trashLocal(path: string): Promise<void> {
    this.files.delete(path);
    this.directories.delete(path);
  }

  async rmdir(path: string): Promise<void> {
    this.directories.delete(path);
  }

  async remove(): Promise<void> {
    throw new Error("Not implemented");
  }
  async rename(): Promise<void> {
    throw new Error("Not implemented");
  }
  async copy(): Promise<void> {
    throw new Error("Not implemented");
  }
  getName(): string {
    return "InMemoryAdapter";
  }
  getResourcePath(): string {
    return "";
  }
}

// Test database utilities
export class DatabaseTestUtils {
  private static instance: MainDatabaseService | null = null;
  private static adapter: InMemoryAdapter | null = null;

  static async createTestDatabase(): Promise<MainDatabaseService> {
    // Initialize real SQL.js for integration tests
    await setupRealSqlJs();

    const adapter = new InMemoryAdapter();
    const debugLog = jest.fn();
    const dbPath = "test.db";

    const db = new MainDatabaseService(dbPath, adapter, debugLog);
    await db.initialize();

    this.instance = db;
    this.adapter = adapter;
    return db;
  }

  static async cleanupDatabase(): Promise<void> {
    if (this.instance) {
      // No explicit close method in MainDatabaseService, but we can clear the instance
      this.instance = null;
    }
    if (this.adapter) {
      this.adapter = null;
    }
    // Clean up real SQL.js
    teardownRealSqlJs();
  }

  // Helper to create test deck
  static createTestDeck(overrides: Partial<Deck> = {}): Deck {
    const deck: Deck = {
      id: this.generateId(),
      name: "Test Deck",
      filepath: "/test/deck.md",
      tag: "test",
      lastReviewed: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      config: {
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        reviewOrder: "due-date",
        headerLevel: 2,
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
      },
      ...overrides,
    };
    return deck;
  }

  // Helper to create test flashcard
  static createTestFlashcard(
    deckId: string,
    overrides: Partial<Flashcard> = {},
  ): Flashcard {
    const frontText = `Test Question ${Date.now()}_${Math.random()}`;
    const backText = `Test Answer ${Date.now()}_${Math.random()}`;

    return {
      id: `${deckId}:${frontText}`,
      deckId,
      type: "header-paragraph",
      front: frontText,
      back: backText,
      sourceFile: "/test/flashcard.md",
      contentHash: this.generateContentHash(backText),
      state: "new",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      interval: 0,
      repetitions: 0,
      lapses: 0,
      lastReviewed: null,
      stability: 0,
      difficulty: 5.0,
      ...overrides,
    };
  }

  // Helper to create test review log
  static createTestReviewLog(
    flashcardId: string,
    overrides: Partial<ReviewLog> = {},
  ): ReviewLog {
    return {
      id: DatabaseTestUtils.generateId(),
      flashcardId,
      lastReviewedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      reviewedAt: new Date().toISOString(),
      rating: 3,
      ratingLabel: "good",
      timeElapsedMs: 5000,
      oldState: "new",
      newState: "review",
      oldIntervalMinutes: 0,
      newIntervalMinutes: 1440,
      oldRepetitions: 0,
      newRepetitions: 1,
      oldLapses: 0,
      newLapses: 0,
      oldStability: 0,
      newStability: 2.5,
      oldDifficulty: 5.0,
      newDifficulty: 5.0,
      oldDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      newDueAt: new Date().toISOString(),
      elapsedDays: 1,
      retrievability: 1.0,
      requestRetention: 0.9,
      profile: "STANDARD",
      maximumIntervalDays: 36500,
      minMinutes: 1,
      fsrsWeightsVersion: "4.5",
      schedulerVersion: "1.0",
      ...overrides,
    };
  }

  // Helper to generate ID
  private static generateId(): string {
    return Date.now() + "-" + Math.random().toString(36).substr(2, 9);
  }

  // Helper to generate content hash (simplified)
  private static generateContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  // Helper to create deck with flashcards
  static async createDeckWithFlashcards(
    db: MainDatabaseService,
    flashcardCount: number = 5,
  ): Promise<{ deck: Deck; flashcards: Flashcard[] }> {
    const deck = this.createTestDeck();
    await db.createDeck(deck);

    const flashcards: Flashcard[] = [];
    for (let i = 0; i < flashcardCount; i++) {
      const flashcard = this.createTestFlashcard(deck.id, {
        front: `Question ${i + 1}`,
        back: `Answer ${i + 1}`,
      });
      await db.createFlashcard(flashcard);
      flashcards.push(flashcard);
    }

    return { deck, flashcards };
  }

  // Helper to verify database state
  static async verifyDatabaseState(
    db: MainDatabaseService,
    expectedDecks: number,
    expectedFlashcards: number,
  ): Promise<void> {
    const decks = await db.getAllDecks();
    const flashcards = await db.getAllFlashcards();
    const stats = await db.getOverallStatistics();

    expect(decks).toHaveLength(expectedDecks);
    expect(flashcards).toHaveLength(expectedFlashcards);
    expect(
      stats.cardStats.new + stats.cardStats.review + stats.cardStats.mature,
    ).toBe(expectedFlashcards);
  }

  // Helper for testing FSRS data
  static expectValidFSRSData(flashcard: Flashcard): void {
    if (flashcard.state === "review") {
      expect(flashcard.stability).toBeGreaterThan(0);
      expect(flashcard.difficulty).toBeGreaterThanOrEqual(1);
      expect(flashcard.difficulty).toBeLessThanOrEqual(10);
      expect(flashcard.repetitions).toBeGreaterThan(0);
    }
  }

  // Helper for date comparisons in tests
  static expectDateWithinRange(
    actualDate: string,
    expectedDate: Date,
    toleranceMs: number = 1000,
  ): void {
    const actual = new Date(actualDate).getTime();
    const expected = expectedDate.getTime();
    const diff = Math.abs(actual - expected);
    expect(diff).toBeLessThan(toleranceMs);
  }
}

// Jest setup helpers
export const setupTestDatabase = async (): Promise<MainDatabaseService> => {
  return await DatabaseTestUtils.createTestDatabase();
};

export const teardownTestDatabase = async (): Promise<void> => {
  await DatabaseTestUtils.cleanupDatabase();
};
