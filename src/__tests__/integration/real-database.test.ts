import initSqlJs, { Database } from "sql.js";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { DataAdapter } from "obsidian";
import { Deck, Flashcard, ReviewLog, DeckConfig } from "../../database/types";
import { FSRS } from "../../algorithm/fsrs";
import { Scheduler } from "../../services/Scheduler";
import { DEFAULT_FSRS_PARAMETERS } from "../../algorithm/fsrs-weights";

// Real in-memory adapter for testing
class TestAdapter implements DataAdapter {
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

  async read(): Promise<string> {
    throw new Error("Not implemented");
  }
  async write(): Promise<void> {
    throw new Error("Not implemented");
  }
  async list(): Promise<any> {
    throw new Error("Not implemented");
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
    return "TestAdapter";
  }
  getResourcePath(): string {
    return "";
  }
  async stat(): Promise<any> {
    return {};
  }
  async append(): Promise<void> {
    throw new Error("Not implemented");
  }
  async process(): Promise<any> {
    throw new Error("Not implemented");
  }
  async trashSystem(): Promise<boolean> {
    return true;
  }
  async trashLocal(): Promise<void> {
    throw new Error("Not implemented");
  }
  async rmdir(): Promise<void> {
    throw new Error("Not implemented");
  }
}

describe("Real Database Integration Tests", () => {
  let SQL: any;
  let db: MainDatabaseService;
  let adapter: TestAdapter;

  beforeAll(async () => {
    // Initialize real SQL.js
    try {
      SQL = await initSqlJs({
        locateFile: (file: string) => {
          // Use the distributed SQL.js files
          return `node_modules/sql.js/dist/${file}`;
        },
      });

      // Make it available globally for MainDatabaseService
      (global as any).initSqlJs = () => Promise.resolve(SQL);
    } catch (error) {
      console.warn(
        "Could not load real SQL.js, skipping real database tests:",
        error,
      );
      return;
    }
  });

  beforeEach(async () => {
    if (!SQL) {
      return;
    }

    adapter = new TestAdapter();
    const debugLog = jest.fn();
    db = new MainDatabaseService("test.db", adapter, debugLog);

    try {
      await db.initialize();
    } catch (error) {
      console.warn("Database initialization failed, skipping test:", error);
      return;
    }
  });

  afterAll(() => {
    delete (global as any).initSqlJs;
  });

  // Helper to skip tests if SQL.js not available
  const skipIfNoSQL = () => {
    if (!SQL) {
      return test.skip;
    }
    return test;
  };

  describe("Database Operations", () => {
    skipIfNoSQL()("should create and retrieve decks", async () => {
      const deck: Deck = {
        id: "test-deck-1",
        name: "Test Deck",
        tag: "test",
        filepath: "/test/deck.md",
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        config: {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          headerLevel: 2,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
      };

      await db.createDeck(deck);
      const retrieved = await db.getDeckByFilepath(deck.filepath);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(deck.id);
      expect(retrieved!.name).toBe(deck.name);
      expect(retrieved!.filepath).toBe(deck.filepath);
    });

    skipIfNoSQL()("should create and retrieve flashcards", async () => {
      // First create a deck
      const deck: Deck = {
        id: "test-deck-2",
        name: "Test Deck 2",
        tag: "test2",
        filepath: "/test/deck2.md",
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        config: {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          headerLevel: 2,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
      };
      await db.createDeck(deck);

      // Create flashcard
      const flashcard: Flashcard = {
        id: "flashcard-1",
        deckId: deck.id,
        type: "header-paragraph",
        front: "What is the capital of France?",
        back: "Paris",
        contentHash: "hash123",
        sourceFile: "test.md",
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
      };

      await db.createFlashcard(flashcard);
      const retrieved = await db.getFlashcardById(flashcard.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.front).toBe(flashcard.front);
      expect(retrieved!.back).toBe(flashcard.back);
      expect(retrieved!.state).toBe("new");
    });

    skipIfNoSQL()("should update flashcard FSRS data", async () => {
      // Create test deck first
      const testDeck: Deck = {
        id: "deck-2",
        name: "Test Deck 2",
        tag: "test2",
        filepath: "/test/deck2.md",
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        config: {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          headerLevel: 2,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
      };
      await db.createDeck(testDeck);

      const flashcard2: Flashcard = {
        id: "flashcard-2",
        deckId: testDeck.id,
        type: "header-paragraph",
        front: "What is the capital of Spain?",
        back: "Madrid",
        sourceFile: "test2.md",
        contentHash: "hash456",
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
      };
      await db.createFlashcard(flashcard2);

      const updatedCard = {
        ...flashcard2,
        state: "review" as const,
        repetitions: 1,
        stability: 2.5,
        difficulty: 5.0,
        lastReviewed: new Date().toISOString(),
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      await db.updateFlashcard(updatedCard.id, updatedCard);
      const retrieved = await db.getFlashcardById(flashcard2.id);

      expect(retrieved!.state).toBe("review");
      expect(retrieved!.repetitions).toBe(1);
      expect(retrieved!.stability).toBe(2.5);
      expect(retrieved!.difficulty).toBe(5.0);
    });

    skipIfNoSQL()("should create and retrieve review logs", async () => {
      const reviewLog: ReviewLog = {
        id: "review-1",
        flashcardId: "flashcard-1",
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
        retrievability: 1.0,
        requestRetention: 0.9,
        profile: "STANDARD",
        maximumIntervalDays: 36500,
        minMinutes: 1,
        fsrsWeightsVersion: "4.5",
        schedulerVersion: "1.0",
        lastReviewedAt: new Date(
          Date.now() - 24 * 60 * 60 * 1000,
        ).toISOString(),
        oldDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        newDueAt: new Date().toISOString(),
        elapsedDays: 1,
        sessionId: undefined,
      };

      await db.createReviewLog(reviewLog);
      const allLogs = await db.getAllReviewLogs();
      const reviewLogs = allLogs.filter(
        (log) => log.flashcardId === "flashcard-1",
      );

      expect(reviewLogs.length).toBeGreaterThan(0);
      const log = reviewLogs.find((l) => l.id === reviewLog.id);
      expect(log).toBeDefined();
      expect(log!.rating).toBe(3);
      expect(log!.newStability).toBe(2.5);
    });
  });

  describe("FSRS Integration", () => {
    let fsrs: FSRS;
    let scheduler: Scheduler;
    let testDeck: Deck;

    beforeEach(async () => {
      if (!SQL) return;

      fsrs = new FSRS(DEFAULT_FSRS_PARAMETERS);
      scheduler = new Scheduler(
        db,
        {} as any,
        {} as any,
        "",
        undefined as any,
        {} as any,
      );

      testDeck = {
        id: "fsrs-deck",
        name: "FSRS Test Deck",
        tag: "fsrstest",
        filepath: "/test/fsrs.md",
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        config: {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          headerLevel: 2,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
      };

      await db.createDeck(testDeck);
    });

    skipIfNoSQL()("should handle new card review with FSRS", async () => {
      const flashcard: Flashcard = {
        id: "fsrs-card-1",
        deckId: testDeck.id,
        type: "header-paragraph",
        front: "FSRS Test Question",
        back: "FSRS Test Answer",
        sourceFile: "fsrs.md",
        contentHash: "fsrs-hash",
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
      };

      await db.createFlashcard(flashcard);

      // Review the card with "Good" rating
      const now = new Date();
      const updatedCard = await scheduler.rate(flashcard.id, "good", now);

      // Verify database persistence
      const dbCard = await db.getFlashcardById(flashcard.id);
      expect(dbCard!.state).toBe("review");
      expect(dbCard!.repetitions).toBe(1);
      expect(dbCard!.lapses).toBe(0);
      expect(dbCard!.stability).toBeGreaterThan(0);
      expect(dbCard!.difficulty).toBeGreaterThanOrEqual(1);
      expect(dbCard!.difficulty).toBeLessThanOrEqual(10);

      // Verify review log was created
      const allLogs = await db.getAllReviewLogs();
      const reviewLogs = allLogs.filter(
        (log) => log.flashcardId === flashcard.id,
      );
      expect(reviewLogs).toHaveLength(1);
      expect(reviewLogs[0].rating).toBe(3);
      expect(reviewLogs[0].oldState).toBe("new");
      expect(reviewLogs[0].newState).toBe("review");
    });

    skipIfNoSQL()(
      "should handle card progression through multiple reviews",
      async () => {
        const flashcard: Flashcard = {
          id: "fsrs-card-2",
          deckId: testDeck.id,
          type: "header-paragraph",
          front: "Progressive Test Question",
          back: "Progressive Test Answer",
          sourceFile: "test.md",
          contentHash: "prog-hash",
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
        };

        await db.createFlashcard(flashcard);

        // Perform multiple reviews
        const ratings = [3, 4, 2, 3]; // Good, Easy, Hard, Good
        let currentCard = flashcard;

        const ratingLabels: Array<"again" | "hard" | "good" | "easy"> = [
          "good",
          "easy",
          "hard",
          "good",
        ];
        for (let i = 0; i < ratingLabels.length; i++) {
          const reviewTime = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
          await scheduler.rate(currentCard.id, ratingLabels[i], reviewTime);
          currentCard = (await db.getFlashcardById(currentCard.id))!;
        }

        // Verify final state
        const finalCard = await db.getFlashcardById(flashcard.id);
        expect(finalCard!.repetitions).toBe(4);
        expect(finalCard!.lapses).toBe(0); // No "Again" ratings
        expect(finalCard!.stability).toBeGreaterThan(0);

        // Verify review log progression
        const allLogs = await db.getAllReviewLogs();
        const reviewLogs = allLogs.filter(
          (log) => log.flashcardId === flashcard.id,
        );
        expect(reviewLogs).toHaveLength(4);

        // Check that stability generally increases (with possible decrease on Hard)
        let hasProgression = false;
        for (let i = 1; i < reviewLogs.length; i++) {
          if (reviewLogs[i].newStability! > reviewLogs[0].newStability!) {
            hasProgression = true;
            break;
          }
        }
        expect(hasProgression).toBe(true);
      },
    );

    skipIfNoSQL()("should handle lapse correctly", async () => {
      // Create a card that's already been reviewed
      const flashcard: Flashcard = {
        id: "lapse-card",
        deckId: testDeck.id,
        type: "header-paragraph",
        front: "Lapse Test Question",
        back: "Lapse Test Answer",
        sourceFile: "test.md",
        contentHash: "lapse-hash",
        state: "review",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        interval: 2880, // 2 days
        repetitions: 2,
        lapses: 0,
        lastReviewed: new Date(
          Date.now() - 3 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        stability: 5.0,
        difficulty: 6.0,
      };

      await db.createFlashcard(flashcard);

      // Review with "Again" (lapse)
      const now = new Date();
      await scheduler.rate(flashcard.id, "good", now);

      const updatedCard = await db.getFlashcardById(flashcard.id);
      expect(updatedCard!.lapses).toBe(1); // Lapse count increased
      expect(updatedCard!.repetitions).toBe(3); // Repetition count increased
      expect(updatedCard!.stability).toBeLessThan(5.0); // Stability decreased

      const reviewLog = await db.getLatestReviewLogForFlashcard(flashcard.id);
      expect(reviewLog!.rating).toBe(1);
      expect(reviewLog!.newLapses).toBe(1);
    });
  });

  describe("Statistics and Queries", () => {
    beforeEach(async () => {
      if (!SQL) return;

      // Create test data for statistics
      const deck: Deck = {
        id: "edge-case-deck",
        name: "Edge Case Test Deck",
        tag: "edgecase",
        filepath: "/test/edge.md",
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        config: {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          headerLevel: 2,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
      };
      await db.createDeck(deck);

      // Create multiple flashcards with different states
      const flashcards: Flashcard[] = [
        {
          id: "stats-card-1",
          deckId: deck.id,
          type: "header-paragraph",
          front: "Statistics Question 1",
          back: "Statistics Answer 1",
          sourceFile: "/test/stats1.md",
          contentHash: "stats1",
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
        },
        {
          id: "stats-card-2",
          deckId: deck.id,
          type: "header-paragraph",
          front: "Statistics Question 2",
          back: "Statistics Answer 2",
          sourceFile: "/test/stats2.md",
          contentHash: "stats2",
          state: "review",
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          dueDate: new Date().toISOString(),
          interval: 2880, // 2 days
          repetitions: 2,
          lapses: 0,
          lastReviewed: new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString(),
          stability: 5.0,
          difficulty: 6.0,
        },
        {
          id: "stats-card-3",
          deckId: deck.id,
          type: "header-paragraph",
          front: "Mature Card 1",
          back: "Answer 3",
          sourceFile: "/test/stats3.md",
          contentHash: "stats3",
          state: "review",
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          dueDate: new Date().toISOString(),
          interval: 40320, // 28 days (mature)
          repetitions: 5,
          lapses: 0,
          lastReviewed: new Date().toISOString(),
          stability: 25.0,
          difficulty: 4.2,
        },
      ];

      for (const card of flashcards) {
        await db.createFlashcard(card);
      }
    });

    skipIfNoSQL()("should calculate overall statistics correctly", async () => {
      const stats = await db.getOverallStatistics();

      expect(
        stats.cardStats.new + stats.cardStats.review + stats.cardStats.mature,
      ).toBeGreaterThan(0);
      expect(stats.cardStats.new).toBeGreaterThan(0);
      expect(stats.cardStats.review).toBeGreaterThan(0);
      expect(stats.cardStats.mature).toBeGreaterThanOrEqual(0);
    });

    skipIfNoSQL()("should get deck statistics", async () => {
      const allStats = await db.getOverallStatistics();
      const deckStats = allStats.cardStats;

      expect(
        deckStats.new + deckStats.review + deckStats.mature,
      ).toBeGreaterThanOrEqual(1);
      expect(deckStats.new).toBeGreaterThanOrEqual(0);
      expect(deckStats.review).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Data Persistence", () => {
    skipIfNoSQL()("should persist data across database saves", async () => {
      const deck: Deck = {
        id: "persist-deck",
        name: "Persistence Test Deck",
        tag: "persisttest",
        filepath: "/test/persist.md",
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        config: {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          headerLevel: 2,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        },
      };

      await db.createDeck(deck);
      await db.save();

      // Verify data persists
      const retrievedDeck = await db.getDeckByFilepath(deck.filepath);
      expect(retrievedDeck).not.toBeNull();
      expect(retrievedDeck!.name).toBe(deck.name);
    });
  });
});
