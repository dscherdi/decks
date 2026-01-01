/**
 * Large Deck Integration Tests
 *
 * Tests plugin performance and correctness with large decks containing thousands of flashcards.
 * Uses real test data files from test-data/ directory.
 *
 * Test Scenarios:
 * 1. Parsing and syncing decks with 2000-10000 flashcards
 * 2. Performance validation (parsing, querying, session management)
 * 3. Batch operations with large datasets
 * 4. Memory efficiency with large decks
 */

// Unmock sql.js for real integration tests
jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler } from "../../services/Scheduler";
import { StatisticsService } from "../../services/StatisticsService";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import type { Deck } from "../../database/types";
import type { DecksSettings } from "../../settings";
import { promises as fs } from "fs";
import path from "path";

// Mock settings for testing
const createMockSettings = (): DecksSettings => ({
  review: {
    showProgress: true,
    enableKeyboardShortcuts: true,
    sessionDuration: 25,
    nextDayStartsAt: 4,
  },
  parsing: {
    folderSearchPath: "",
  },
  ui: {
    enableBackgroundRefresh: false,
    backgroundRefreshInterval: 300,
    enableNotices: false,
  },
  backup: {
    enableAutoBackup: false,
    maxBackups: 3,
  },
  debug: {
    enableLogging: false,
    performanceLogs: false,
  },
  experimental: {
    enableDatabaseWorker: false,
  },
});

describe("Large Deck Integration Tests", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  let statisticsService: StatisticsService;
  let settings: DecksSettings;

  beforeEach(async () => {
    db = await setupTestDatabase();
    settings = createMockSettings();

    statisticsService = new StatisticsService(db, settings);
    const mockBackupService = {
      createBackup: jest.fn(),
    } as any;
    scheduler = new Scheduler(db, settings, mockBackupService);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  describe("Large German Deck Parsing", () => {
    it("should parse and sync 10000 German nouns deck", async () => {
      const testDataPath = path.join(
        __dirname,
        "test-data",
        "10000 German nouns.md"
      );
      // Fix the tag from 'notflashcards' to 'flashcards' for testing
      const rawContent = await fs.readFile(testDataPath, "utf-8");
      const fileContent = rawContent.replace(
        "notflashcards/german",
        "flashcards/german"
      );

      const deckId = generateDeckId(testDataPath);
      const deck: Deck = {
        id: deckId,
        name: "10000 German Nouns",
        filepath: testDataPath,
        tag: "flashcards/german",
        lastReviewed: null,
        profileId: "profile_default",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      await db.createDeck(deck);

      // Update profile for this specific test
      const profile = await db.getDefaultProfile();
      if (profile) {
        await db.updateProfile(profile.id, {
          headerLevel: 1,
        });
      }

      const deckWithProfile = await db.getDeckWithProfile(deck.id);
      const startTime = Date.now();
      const syncResult = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: deckWithProfile!.profile,
        fileContent,
        force: false,
      });
      const syncDuration = Date.now() - startTime;

      // Verify sync succeeded
      expect(syncResult.success).toBe(true);
      expect(syncResult.parsedCount).toBeGreaterThan(3700); // File contains ~3722 cards

      // Performance check: Should complete in reasonable time (< 5 seconds)
      expect(syncDuration).toBeLessThan(5000);

      console.log(
        `Synced ${syncResult.parsedCount} cards in ${syncDuration}ms`
      );

      // Verify all flashcards were created
      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards.length).toBe(syncResult.parsedCount);

      // All should be in "new" state initially
      const newCards = flashcards.filter((c) => c.state === "new");
      expect(newCards.length).toBe(flashcards.length);
    }, 30000); // 30 second timeout

    it("should parse and sync 4200 German adjectives deck", async () => {
      const testDataPath = path.join(
        __dirname,
        "test-data",
        "4200 German Adjectives.md"
      );
      const fileContent = await fs.readFile(testDataPath, "utf-8");

      const deckId = generateDeckId(testDataPath);
      const deck: Deck = {
        id: deckId,
        name: "4200 German Adjectives",
        filepath: testDataPath,
        tag: "flashcards/german",
        lastReviewed: null,
        profileId: "profile_default",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      await db.createDeck(deck);

      // Update profile for this specific test
      const profile = await db.getDefaultProfile();
      if (profile) {
        await db.updateProfile(profile.id, {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 30,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 150,
          reviewOrder: "random",
          headerLevel: 1, // German files use # header (level 1)
          fsrs: {
            requestRetention: 0.85,
            profile: "INTENSIVE",
          },
        });
      }

      const deckWithProfile = await db.getDeckWithProfile(deck.id);
      const syncResult = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: deckWithProfile!.profile,
        fileContent,
        force: false,
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.parsedCount).toBeGreaterThan(4190);

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards.length).toBe(syncResult.parsedCount);
    }, 30000);

    it("should parse and sync 2000 German verbs deck", async () => {
      const testDataPath = path.join(
        __dirname,
        "test-data",
        "2000 German verbs.md"
      );
      const fileContent = await fs.readFile(testDataPath, "utf-8");

      const deckId = generateDeckId(testDataPath);
      const deck: Deck = {
        id: deckId,
        name: "2000 German Verbs",
        filepath: testDataPath,
        tag: "flashcards/german",
        lastReviewed: null,
        profileId: "profile_default",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      await db.createDeck(deck);

      // Update profile for this specific test
      const profile = await db.getDefaultProfile();
      if (profile) {
        await db.updateProfile(profile.id, {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 25,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          reviewOrder: "due-date",
          headerLevel: 3, // This file uses ### header (level 3)
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        });
      }

      const deckWithProfile = await db.getDeckWithProfile(deck.id);
      const syncResult = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: deckWithProfile!.profile,
        fileContent,
        force: false,
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.parsedCount).toBeGreaterThan(2010);

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      // Note: Some cards may have duplicate IDs (same front text), so DB count may be less than parsed
      expect(flashcards.length).toBeGreaterThanOrEqual(2010);
    }, 30000);
  });

  describe("Multi-Deck Large Dataset Performance", () => {
    it("should handle multiple large decks simultaneously", async () => {
      const largeFiles = [
        "2000 German verbs.md",
        "1200 Deutsche Redewendungen.md",
        "500 Nomen-Verb Verbindungen.md",
      ];

      const deckIds: string[] = [];
      let totalCards = 0;

      // Update profile once for all decks
      const profile = await db.getDefaultProfile();
      if (profile) {
        await db.updateProfile(profile.id, {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          reviewOrder: "due-date",
          headerLevel: 1, // German files use # header (level 1)
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        });
      }

      for (const filename of largeFiles) {
        const testDataPath = path.join(__dirname, "test-data", filename);
        const fileContent = await fs.readFile(testDataPath, "utf-8");

        const deckId = generateDeckId(testDataPath);
        const deck: Deck = {
          id: deckId,
          name: filename.replace(".md", ""),
          filepath: testDataPath,
          tag: `flashcards/german/${filename}`,
          lastReviewed: null,
          profileId: "profile_default",
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };

        await db.createDeck(deck);

        const deckWithProfile = await db.getDeckWithProfile(deck.id);
        const syncResult = await db.syncFlashcardsForDeck({
          deckId: deck.id,
          deckName: deck.name,
          deckFilepath: deck.filepath,
          deckConfig: deckWithProfile!.profile,
          fileContent,
          force: false,
        });

        expect(syncResult.success).toBe(true);
        deckIds.push(deckId);
        totalCards += syncResult.parsedCount;
      }

      // Verify all decks exist
      const allDecks = await db.getAllDecks();
      expect(allDecks.length).toBe(largeFiles.length);

      // Verify total card count
      const overallStats = await statisticsService.getOverallStatistics([], "all");
      expect(overallStats.cardStats.total).toBe(totalCards);
      expect(overallStats.cardStats.new).toBe(totalCards);

      console.log(
        `Total cards across ${largeFiles.length} decks: ${totalCards}`
      );
    }, 30000);
  });

  describe("Large Deck Query Performance", () => {
    let largeDeck: Deck;

    beforeEach(async () => {
      // Set up a large deck for query tests
      const testDataPath = path.join(
        __dirname,
        "test-data",
        "10000 German nouns.md"
      );
      const fileContent = await fs.readFile(testDataPath, "utf-8");

      const deckId = generateDeckId(testDataPath);
      largeDeck = {
        id: deckId,
        name: "Query Performance Test",
        filepath: testDataPath,
        tag: "flashcards/test",
        lastReviewed: null,
        profileId: "profile_default",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      await db.createDeck(largeDeck);

      // Update profile for this test
      const profile = await db.getDefaultProfile();
      if (profile) {
        await db.updateProfile(profile.id, {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 50,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 200,
          reviewOrder: "due-date",
          headerLevel: 1, // German files use # header (level 1)
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        });
      }

      const deckWithProfile = await db.getDeckWithProfile(largeDeck.id);
      await db.syncFlashcardsForDeck({
        deckId: largeDeck.id,
        deckName: largeDeck.name,
        deckFilepath: largeDeck.filepath,
        deckConfig: deckWithProfile!.profile,
        fileContent,
        force: false,
      });
    }, 30000);

    it("should efficiently query new cards from large deck", async () => {
      const startTime = Date.now();
      const newCards = await db.getNewCardsForReview(largeDeck.id);
      const queryDuration = Date.now() - startTime;

      expect(newCards.length).toBe(100); // getNewCardsForReview has LIMIT 100
      expect(queryDuration).toBeLessThan(1000); // Should complete in < 1 second

      console.log(`Queried ${newCards.length} new cards in ${queryDuration}ms`);
    });

    it("should efficiently get next card from large deck", async () => {
      const iterations = 100;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const card = await scheduler.getNext(new Date(), largeDeck.id, {
          allowNew: true,
        });
        expect(card).toBeTruthy();
      }

      const totalDuration = Date.now() - startTime;
      const avgDuration = totalDuration / iterations;

      expect(avgDuration).toBeLessThan(50); // Should average < 50ms per query

      console.log(
        `Average getNext() duration: ${avgDuration.toFixed(2)}ms over ${iterations} iterations`
      );
    });

    it("should efficiently update cards in large deck", async () => {
      const cardsToReview = 50;
      const startTime = Date.now();

      for (let i = 0; i < cardsToReview; i++) {
        const card = await scheduler.getNext(new Date(), largeDeck.id, {
          allowNew: true,
        });

        if (card) {
          await scheduler.rate(card.id, "good", 3000);
        }
      }

      const totalDuration = Date.now() - startTime;
      const avgDuration = totalDuration / cardsToReview;

      expect(avgDuration).toBeLessThan(100); // Should average < 100ms per rate

      console.log(
        `Average rate() duration: ${avgDuration.toFixed(2)}ms over ${cardsToReview} reviews`
      );

      // Verify review logs were created
      const reviewLogs = await db.getAllReviewLogs();
      expect(reviewLogs.length).toBe(cardsToReview);
    }, 30000);
  });

  describe("Large Deck Session Management", () => {
    let largeDeck: Deck;

    beforeEach(async () => {
      const testDataPath = path.join(
        __dirname,
        "test-data",
        "4200 German Adjectives.md"
      );
      const fileContent = await fs.readFile(testDataPath, "utf-8");

      const deckId = generateDeckId(testDataPath);
      largeDeck = {
        id: deckId,
        name: "Session Test Deck",
        filepath: testDataPath,
        tag: "flashcards/test",
        lastReviewed: null,
        profileId: "profile_default",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      await db.createDeck(largeDeck);

      // Update the default profile with limits for this test
      const profile = await db.getDefaultProfile();
      if (profile) {
        await db.updateProfile(profile.id, {
          hasNewCardsLimitEnabled: true,
          newCardsPerDay: 50,
          hasReviewCardsLimitEnabled: true,
          reviewCardsPerDay: 200,
          headerLevel: 1, // German files use # header (level 1)
        });
      }

      const deckWithProfile = await db.getDeckWithProfile(largeDeck.id);
      await db.syncFlashcardsForDeck({
        deckId: largeDeck.id,
        deckName: largeDeck.name,
        deckFilepath: largeDeck.filepath,
        deckConfig: deckWithProfile!.profile,
        fileContent,
        force: false,
      });
    }, 30000);

    it("should correctly calculate session goals for large deck", async () => {
      const session = await scheduler.startReviewSession(largeDeck.id);

      expect(session.sessionId).toBeTruthy();

      const progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress).toBeTruthy();

      // Goal should respect daily limits (50 new cards max)
      expect(progress!.goalTotal).toBeGreaterThan(0);
      expect(progress!.goalTotal).toBeLessThanOrEqual(50);

      console.log(`Session goal for large deck: ${progress!.goalTotal} cards`);
    });

    it("should track progress correctly during large review session", async () => {
      const session = await scheduler.startReviewSession(largeDeck.id);
      scheduler.setCurrentSession(session.sessionId);

      const reviewCount = 25;

      for (let i = 0; i < reviewCount; i++) {
        const card = await scheduler.getNext(new Date(), largeDeck.id, {
          allowNew: true,
        });

        if (card) {
          await scheduler.rate(card.id, "good", 4000);
        }
      }

      const progress = await scheduler.getSessionProgress(session.sessionId);
      expect(progress!.doneUnique).toBe(reviewCount);

      await scheduler.endReviewSession(session.sessionId);
    }, 30000);
  });

  describe("Large Deck Statistics", () => {
    it("should generate accurate statistics for large deck", async () => {
      const testDataPath = path.join(
        __dirname,
        "test-data",
        "2000 German verbs.md"
      );
      const fileContent = await fs.readFile(testDataPath, "utf-8");

      const deckId = generateDeckId(testDataPath);
      const deck: Deck = {
        id: deckId,
        name: "Stats Test Deck",
        filepath: testDataPath,
        tag: "flashcards/test",
        lastReviewed: null,
        profileId: "profile_default",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      await db.createDeck(deck);

      // Update profile for this test
      const profile = await db.getDefaultProfile();
      if (profile) {
        await db.updateProfile(profile.id, {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 30,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          reviewOrder: "due-date",
          headerLevel: 3, // 2000 German verbs uses ### header (level 3)
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        });
      }

      const deckWithProfile = await db.getDeckWithProfile(deck.id);
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: deckWithProfile!.profile,
        fileContent,
        force: false,
      });

      // Perform some reviews
      const session = await scheduler.startReviewSession(deck.id);
      scheduler.setCurrentSession(session.sessionId);

      for (let i = 0; i < 50; i++) {
        const card = await scheduler.getNext(new Date(), deck.id, {
          allowNew: true,
        });
        if (card) {
          const ratings: ("good" | "easy" | "hard" | "again")[] = [
            "good",
            "easy",
            "hard",
            "again",
          ];
          await scheduler.rate(card.id, ratings[i % 4], 3000 + i * 100);
        }
      }

      await scheduler.endReviewSession(session.sessionId);

      // Get statistics
      const startTime = Date.now();
      const deckStats = await statisticsService.getDeckStats(deck.id);
      const overallStats = await statisticsService.getOverallStatistics();
      const statsDuration = Date.now() - startTime;

      expect(deckStats.totalCount).toBeGreaterThan(2010);
      expect(overallStats.reviewStats.totalReviews).toBe(50);
      expect(overallStats.reviewStats.totalTimeMs).toBeGreaterThan(0);

      // Statistics queries should be fast even with large deck
      expect(statsDuration).toBeLessThan(1000);

      console.log(`Generated statistics in ${statsDuration}ms`);
      console.log(
        `Deck: ${deckStats.totalCount} cards, ${overallStats.reviewStats.totalReviews} reviews`
      );
    }, 30000);
  });

  describe("Edge Cases with Large Decks", () => {
    it("should handle re-syncing large deck without duplicates", async () => {
      const testDataPath = path.join(
        __dirname,
        "test-data",
        "1200 Deutsche Redewendungen.md"
      );
      const fileContent = await fs.readFile(testDataPath, "utf-8");

      const deckId = generateDeckId(testDataPath);
      const deck: Deck = {
        id: deckId,
        name: "Resync Test Deck",
        filepath: testDataPath,
        tag: "flashcards/test",
        lastReviewed: null,
        profileId: "profile_default",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      await db.createDeck(deck);

      // Update profile for this test
      const profile = await db.getDefaultProfile();
      if (profile) {
        await db.updateProfile(profile.id, {
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          reviewOrder: "due-date",
          headerLevel: 1, // German files use # header (level 1)
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
        });
      }

      const deckWithProfile = await db.getDeckWithProfile(deck.id);

      // First sync
      const firstSync = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: deckWithProfile!.profile,
        fileContent,
        force: false,
      });

      expect(firstSync.success).toBe(true);
      const firstCount = firstSync.parsedCount;

      // Second sync (should detect no changes)
      const secondSync = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: deckWithProfile!.profile,
        fileContent,
        force: false,
      });

      expect(secondSync.success).toBe(true);
      expect(secondSync.parsedCount).toBe(firstCount);

      // Verify no duplicates
      const allCards = await db.getFlashcardsByDeck(deck.id);
      expect(allCards.length).toBe(firstCount);

      // Force re-sync (should still not create duplicates)
      const forceSync = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: deckWithProfile!.profile,
        fileContent,
        force: true,
      });

      expect(forceSync.success).toBe(true);

      const finalCards = await db.getFlashcardsByDeck(deck.id);
      expect(finalCards.length).toBe(firstCount); // No duplicates
    }, 30000);
  });
});
