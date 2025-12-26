/**
 * Full Workflow Integration Tests
 *
 * Tests the complete plugin functionality using real test data files with thousands of flashcards.
 * Validates that core logic can run independently of Obsidian UI (suitable for console testing).
 *
 * Test Scenarios:
 * 1. Syncing decks and flashcards from markdown files
 * 2. Reporting correct deck lists with new/review card counts
 * 3. Simulating review sessions with multiple ratings
 * 4. Statistics service reporting (reviews, time, difficulty, future load)
 */

// Unmock sql.js for real integration tests
jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler } from "../../services/Scheduler";
import { StatisticsService } from "../../services/StatisticsService";
import {
    setupTestDatabase,
    teardownTestDatabase,
    InMemoryAdapter,
} from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import type { Flashcard, Deck } from "../../database/types";
import type { DecksSettings } from "../../settings";
import { promises as fs } from "fs";
import path from "path";

// Mock settings for testing
const createMockSettings = (): DecksSettings => ({
    review: {
        showProgress: true,
        enableKeyboardShortcuts: true,
        sessionDuration: 25,
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

// Helper function to create a deck with proper type
const createTestDeckData = (name: string, filepath: string, tag: string) => ({
    name,
    filepath,
    tag,
    lastReviewed: null,
    config: {
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        reviewOrder: "due-date" as const,
        headerLevel: 2,
        fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD" as const,
        },
    },
});

describe("Full Workflow Integration Tests", () => {
    let db: MainDatabaseService;
    let scheduler: Scheduler;
    let statisticsService: StatisticsService;
    let adapter: InMemoryAdapter;
    let settings: DecksSettings;

    beforeEach(async () => {
        db = await setupTestDatabase();
        adapter = new InMemoryAdapter();
        settings = createMockSettings();

        statisticsService = new StatisticsService(db, settings);
        const mockBackupService = {
            createBackup: jest.fn()
        } as any;
        scheduler = new Scheduler(
            db,
            settings,
            mockBackupService
        );
    });

    afterEach(async () => {
        await teardownTestDatabase();
    });

    describe("Deck Syncing from Test Data", () => {
        it("should sync flashcards from Math-Basics.md test file", async () => {
            const testDataPath = path.join(
                __dirname,
                "test-data",
                "Math-Basics.md"
            );
            const fileContent = await fs.readFile(testDataPath, "utf-8");

            // Create deck for the file
            const deckId = generateDeckId(testDataPath);
            const deck: Deck = {
                id: deckId,
                name: "Math Basics",
                filepath: testDataPath,
                tag: "flashcards/math",
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
            };

            await db.createDeck(deck);

            // Sync flashcards from file content
            const syncResult = await db.syncFlashcardsForDeck({
                deckId: deck.id,
                deckName: deck.name,
                deckFilepath: deck.filepath,
                deckConfig: deck.config,
                fileContent,
                force: false,
            });

            // Verify sync results
            expect(syncResult.success).toBe(true);
            expect(syncResult.parsedCount).toBeGreaterThan(0);
            expect(syncResult.operationsCount).toBeGreaterThan(0);

            // Verify flashcards were created
            const flashcards = await db.getFlashcardsByDeck(deck.id);
            expect(flashcards.length).toBe(syncResult.parsedCount);

            // Verify all flashcards are in "new" state
            flashcards.forEach((card) => {
                expect(card.state).toBe("new");
                expect(card.deckId).toBe(deck.id);
            });
        });

        it("should sync flashcards from Programming-Concepts.md test file", async () => {
            const testDataPath = path.join(
                __dirname,
                "test-data",
                "Programming-Concepts.md"
            );
            const fileContent = await fs.readFile(testDataPath, "utf-8");

            const deckId = generateDeckId(testDataPath);
            const deck: Deck = {
                id: deckId,
                name: "Programming Concepts",
                filepath: testDataPath,
                tag: "flashcards/programming",
                lastReviewed: null,
                created: new Date().toISOString(),
                modified: new Date().toISOString(),
                config: {
                    hasNewCardsLimitEnabled: false,
                    newCardsPerDay: 30,
                    hasReviewCardsLimitEnabled: false,
                    reviewCardsPerDay: 150,
                    reviewOrder: "due-date",
                    headerLevel: 2,
                    fsrs: {
                        requestRetention: 0.9,
                        profile: "STANDARD",
                    },
                },
            };

            await db.createDeck(deck);

            const syncResult = await db.syncFlashcardsForDeck({
                deckId: deck.id,
                deckName: deck.name,
                deckFilepath: deck.filepath,
                deckConfig: deck.config,
                fileContent,
                force: false,
            });

            expect(syncResult.success).toBe(true);
            expect(syncResult.parsedCount).toBeGreaterThan(0);

            const flashcards = await db.getFlashcardsByDeck(deck.id);
            expect(flashcards.length).toBe(syncResult.parsedCount);
        });

        it("should handle multiple deck syncs correctly", async () => {
            const testFiles = [
                "Math-Basics.md",
                "Programming-Concepts.md",
                "Spanish-Vocabulary.md",
            ];

            const syncedDecks: Deck[] = [];

            for (const filename of testFiles) {
                const testDataPath = path.join(
                    __dirname,
                    "test-data",
                    filename
                );
                const fileContent = await fs.readFile(testDataPath, "utf-8");

                const deckId = generateDeckId(testDataPath);
                const deck: Deck = {
                    id: deckId,
                    name: filename.replace(".md", "").replace(/-/g, " "),
                    filepath: testDataPath,
                    tag: `flashcards/${filename.toLowerCase()}`,
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
                };

                await db.createDeck(deck);
                syncedDecks.push(deck);

                const syncResult = await db.syncFlashcardsForDeck({
                    deckId: deck.id,
                    deckName: deck.name,
                    deckFilepath: deck.filepath,
                    deckConfig: deck.config,
                    fileContent,
                    force: false,
                });

                expect(syncResult.success).toBe(true);
            }

            // Verify all decks exist
            const allDecks = await db.getAllDecks();
            expect(allDecks.length).toBe(testFiles.length);

            // Verify flashcards for each deck
            for (const deck of syncedDecks) {
                const flashcards = await db.getFlashcardsByDeck(deck.id);
                expect(flashcards.length).toBeGreaterThan(0);
            }
        });
    });

    describe("Deck Listing and Card Count Reporting", () => {
        let testDeck: Deck;

        beforeEach(async () => {
            // Sync Math-Basics deck
            const testDataPath = path.join(
                __dirname,
                "test-data",
                "Math-Basics.md"
            );
            const fileContent = await fs.readFile(testDataPath, "utf-8");

            const deckId = generateDeckId(testDataPath);
            testDeck = {
                id: deckId,
                name: "Math Basics",
                filepath: testDataPath,
                tag: "flashcards/math",
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
            };

            await db.createDeck(testDeck);
            await db.syncFlashcardsForDeck({
                deckId: testDeck.id,
                deckName: testDeck.name,
                deckFilepath: testDeck.filepath,
                deckConfig: testDeck.config,
                fileContent,
                force: false,
            });
        });

        it("should report correct counts for new cards", async () => {
            const newCards = await db.getNewCardsForReview(testDeck.id);
            const allCards = await db.getFlashcardsByDeck(testDeck.id);

            expect(newCards.length).toBe(allCards.length); // All should be new initially
            newCards.forEach((card) => {
                expect(card.state).toBe("new");
            });
        });

        it("should report correct counts for review cards after some reviews", async () => {
            const allCards = await db.getFlashcardsByDeck(testDeck.id);

            // Review first 3 cards
            for (let i = 0; i < 3; i++) {
                const card = allCards[i];
                // Update card to review state
                await db.updateFlashcard(card.id, {
                    state: "review",
                    repetitions: 1,
                    stability: 2.5,
                    difficulty: 5.0,
                    interval: 1440,
                    lastReviewed: new Date().toISOString(),
                    dueDate: new Date(Date.now() - 1000).toISOString(), // Due now
                });
            }

            const dueCards = await db.getDueFlashcards(testDeck.id);
            const newCards = await db.getNewCardsForReview(testDeck.id);

            // getDueFlashcards returns all due cards (including new cards with due dates)
            // So we expect 6 total (3 review + 3 new)
            expect(dueCards.length).toBe(6);
            expect(newCards.length).toBe(3); // 3 cards still in new state
        });

        it("should report overall statistics correctly", async () => {
            const stats = await db.getOverallStatistics();

            expect(stats.cardStats.new).toBeGreaterThan(0);
            expect(
                stats.cardStats.new +
                    stats.cardStats.review +
                    stats.cardStats.mature
            ).toBeGreaterThan(0);
        });

        it("should report per-deck statistics correctly", async () => {
            const deckStats = await statisticsService.getDeckStats(testDeck.id);

            expect(deckStats.totalCount).toBeGreaterThan(0);
            expect(deckStats.newCount).toBeGreaterThan(0);
            expect(deckStats.dueCount).toBe(0); // No reviews yet
        });
    });

    describe("Review Session Simulation", () => {
        let testDeck: Deck;
        let testCards: Flashcard[];

        beforeEach(async () => {
            // Sync Programming-Concepts deck
            const testDataPath = path.join(
                __dirname,
                "test-data",
                "Programming-Concepts.md"
            );
            const fileContent = await fs.readFile(testDataPath, "utf-8");

            const deckId = generateDeckId(testDataPath);
            testDeck = {
                id: deckId,
                name: "Programming Concepts",
                filepath: testDataPath,
                tag: "flashcards/programming",
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
            };

            await db.createDeck(testDeck);
            await db.syncFlashcardsForDeck({
                deckId: testDeck.id,
                deckName: testDeck.name,
                deckFilepath: testDeck.filepath,
                deckConfig: testDeck.config,
                fileContent,
                force: false,
            });

            testCards = await db.getFlashcardsByDeck(testDeck.id);
        });

        it("should start review session and track progress", async () => {
            const session = await scheduler.startReviewSession(testDeck.id);

            expect(session.sessionId).toBeTruthy();
            expect(session.deckFilePath).toBe(testDeck.filepath);

            // Get session progress
            const progress = await scheduler.getSessionProgress(
                session.sessionId
            );
            expect(progress).toBeTruthy();
            expect(progress!.doneUnique).toBe(0);
            expect(progress!.goalTotal).toBeGreaterThan(0);
        });

        it("should simulate review with multiple ratings", async () => {
            var session = await scheduler.startFreshSession(testDeck.id);

            const reviewCount = Math.min(5, testCards.length);
            const ratings: ("again" | "hard" | "good" | "easy")[] = [
                "good",
                "good",
                "easy",
                "hard",
                "again",
            ];

            for (let i = 0; i < reviewCount; i++) {
                const card = await scheduler.getNext(new Date(), testDeck.id, {
                    allowNew: true,
                });
                expect(card).toBeTruthy();

                if (card) {
                    const rating = ratings[i % ratings.length];
                    const timeElapsedMs =
                        Math.floor(Math.random() * 10000) + 2000; // 2-12 seconds

                    await scheduler.rate(card.id, rating, timeElapsedMs);

                    // Verify card state was updated
                    const updatedCard = await db.getFlashcardById(card.id);
                    expect(updatedCard).toBeTruthy();
                    expect(updatedCard!.state).toBe("review");
                    expect(updatedCard!.repetitions).toBeGreaterThan(0);
                    expect(updatedCard!.lastReviewed).toBeTruthy();
                }
            }

            // Verify progress updated
            const progress = await scheduler.getSessionProgress(
                session.sessionId
            );
            expect(progress!.doneUnique).toBe(reviewCount);
        });

        it("should update card counts after reviews", async () => {
            await scheduler.startReviewSession(testDeck.id);

            const initialNewCount = (await db.getNewCardsForReview(testDeck.id))
                .length;
            const initialDueCount = (await db.getDueFlashcards(testDeck.id))
                .length;

            // Review 3 new cards
            for (let i = 0; i < 3; i++) {
                const card = await scheduler.getNext(new Date(), testDeck.id, {
                    allowNew: true,
                });
                if (card) {
                    await scheduler.rate(card.id, "good", 5000);
                }
            }

            // Check counts after reviews
            const newNewCount = (await db.getNewCardsForReview(testDeck.id))
                .length;
            const newDueCount = (await db.getDueFlashcards(testDeck.id)).length;

            // New count should decrease
            expect(newNewCount).toBeLessThan(initialNewCount);
        });

        it("should close review session and finalize statistics", async () => {
            const session = await scheduler.startReviewSession(testDeck.id);

            // Do some reviews
            for (let i = 0; i < 3; i++) {
                const card = await scheduler.getNext(new Date(), testDeck.id, {
                    allowNew: true,
                });
                if (card) {
                    await scheduler.rate(card.id, "good", 5000);
                }
            }

            // Close session
            await scheduler.endReviewSession(session.sessionId);

            // Verify session still exists but is marked as ended
            const progress = await scheduler.getSessionProgress(
                session.sessionId
            );
            expect(progress).toBeDefined();
            expect(progress!.doneUnique).toBeGreaterThanOrEqual(0);

            // Verify review logs were created
            const allLogs = await db.getAllReviewLogs();
            expect(allLogs.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe("Statistics Service Reporting", () => {
        let testDeck: Deck;

        beforeEach(async () => {
            // Sync Spanish-Vocabulary deck
            const testDataPath = path.join(
                __dirname,
                "test-data",
                "Spanish-Vocabulary.md"
            );
            const fileContent = await fs.readFile(testDataPath, "utf-8");

            const deckId = generateDeckId(testDataPath);
            testDeck = {
                id: deckId,
                name: "Spanish Vocabulary",
                filepath: testDataPath,
                tag: "flashcards/spanish",
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
            };

            await db.createDeck(testDeck);
            await db.syncFlashcardsForDeck({
                deckId: testDeck.id,
                deckName: testDeck.name,
                deckFilepath: testDeck.filepath,
                deckConfig: testDeck.config,
                fileContent,
                force: false,
            });

            // Perform some reviews
            const session = await scheduler.startReviewSession(testDeck.id);
            for (let i = 0; i < 10; i++) {
                const card = await scheduler.getNext(new Date(), testDeck.id, {
                    allowNew: true,
                });
                if (card) {
                    const ratings: ("good" | "easy" | "hard")[] = [
                        "good",
                        "easy",
                        "hard",
                    ];
                    await scheduler.rate(
                        card.id,
                        ratings[i % 3],
                        3000 + i * 500
                    );
                }
            }
            await scheduler.endReviewSession(session.sessionId);
        });

        it("should report correct number of reviews", async () => {
            const allLogs = await db.getAllReviewLogs();
            expect(allLogs.length).toBeGreaterThanOrEqual(10);

            // Get statistics via overall statistics
            const stats = await statisticsService.getOverallStatistics();
            expect(stats.reviewStats.totalReviews).toBeGreaterThanOrEqual(10);
        });

        it("should report total time spent reviewing", async () => {
            const stats = await statisticsService.getOverallStatistics();
            expect(stats.reviewStats.totalTimeMs).toBeGreaterThan(0);

            // Average time per card should be reasonable (2-15 seconds)
            const avgTime =
                stats.reviewStats.totalTimeMs / stats.reviewStats.totalReviews;
            expect(avgTime).toBeGreaterThan(2000);
            expect(avgTime).toBeLessThan(15000);
        });

        it("should categorize reviews by difficulty (rating distribution)", async () => {
            const allLogs = await db.getAllReviewLogs();

            const ratingCounts = {
                again: 0,
                hard: 0,
                good: 0,
                easy: 0,
            };

            allLogs.forEach((log) => {
                if (log.ratingLabel in ratingCounts) {
                    ratingCounts[
                        log.ratingLabel as keyof typeof ratingCounts
                    ]++;
                }
            });

            // Verify we have distribution across ratings
            expect(ratingCounts.good).toBeGreaterThan(0);
            expect(
                ratingCounts.easy + ratingCounts.hard + ratingCounts.good
            ).toBeGreaterThanOrEqual(10);
        });

        it("should report future load (forecast)", async () => {
            const stats = await statisticsService.getOverallStatistics();

            expect(stats.forecast).toBeTruthy();
            expect(Array.isArray(stats.forecast)).toBe(true);

            // Should have forecast data for future days
            expect(stats.forecast.length).toBeGreaterThan(0);

            // Verify forecast structure
            stats.forecast.forEach((item) => {
                expect(item).toHaveProperty("date");
                expect(item).toHaveProperty("count");
                expect(item.count).toBeGreaterThanOrEqual(0);
            });
        });

        it("should report cards by difficulty distribution", async () => {
            const allCards = await db.getFlashcardsByDeck(testDeck.id);

            const difficultyBuckets = {
                easy: 0, // difficulty 1-3
                medium: 0, // difficulty 4-7
                hard: 0, // difficulty 8-10
            };

            allCards.forEach((card) => {
                if (card.difficulty <= 3) {
                    difficultyBuckets.easy++;
                } else if (card.difficulty <= 7) {
                    difficultyBuckets.medium++;
                } else {
                    difficultyBuckets.hard++;
                }
            });

            // All cards should be categorized
            expect(
                difficultyBuckets.easy +
                    difficultyBuckets.medium +
                    difficultyBuckets.hard
            ).toBe(allCards.length);
        });

        it("should report overall statistics across all decks", async () => {
            const overallStats = await db.getOverallStatistics();

            expect(overallStats.cardStats.total).toBeGreaterThan(0);
            expect(
                overallStats.reviewStats.totalReviews
            ).toBeGreaterThanOrEqual(10);
            expect(overallStats.reviewStats.totalTimeMs).toBeGreaterThan(0);
        });
    });

    describe("Console-Ready Core Logic Validation", () => {
        it("should run complete workflow without Obsidian UI dependencies", async () => {
            // This test validates that core logic can run in a console environment

            // 1. Initialize database
            expect(db).toBeTruthy();

            // 2. Load test data
            const testDataPath = path.join(
                __dirname,
                "test-data",
                "Math-Basics.md"
            );
            const fileContent = await fs.readFile(testDataPath, "utf-8");

            // 3. Create and sync deck
            const deckId = generateDeckId(testDataPath);
            const deck: Deck = {
                id: deckId,
                name: "Console Test Deck",
                filepath: testDataPath,
                tag: "flashcards/test",
                lastReviewed: null,
                created: new Date().toISOString(),
                modified: new Date().toISOString(),
                config: {
                    hasNewCardsLimitEnabled: false,
                    newCardsPerDay: 10,
                    hasReviewCardsLimitEnabled: false,
                    reviewCardsPerDay: 50,
                    reviewOrder: "due-date",
                    headerLevel: 2,
                    fsrs: {
                        requestRetention: 0.9,
                        profile: "STANDARD",
                    },
                },
            };

            await db.createDeck(deck);
            const syncResult = await db.syncFlashcardsForDeck({
                deckId: deck.id,
                deckName: deck.name,
                deckFilepath: deck.filepath,
                deckConfig: deck.config,
                fileContent,
                force: false,
            });

            expect(syncResult.success).toBe(true);

            // 4. Report initial state
            const initialStats = await statisticsService.getDeckStats(deck.id);
            console.log("Initial State:", {
                totalCards: initialStats.totalCount,
                newCards: initialStats.newCount,
                dueCards: initialStats.dueCount,
            });

            // 5. Run review session
            const session = await scheduler.startReviewSession(deck.id);

            let reviewedCount = 0;
            for (let i = 0; i < 5; i++) {
                const card = await scheduler.getNext(new Date(), deck.id, {
                    allowNew: true,
                });
                if (card) {
                    await scheduler.rate(card.id, "good", 4000);
                    reviewedCount++;
                }
            }

            await scheduler.endReviewSession(session.sessionId);

            // 6. Report final state
            const finalStats = await statisticsService.getDeckStats(deck.id);
            const overallStats = await statisticsService.getOverallStatistics();
            console.log("Final State:", {
                totalCards: finalStats.totalCount,
                newCards: finalStats.newCount,
                dueCards: finalStats.dueCount,
                totalReviews: overallStats.reviewStats.totalReviews,
                totalTimeMs: overallStats.reviewStats.totalTimeMs,
            });

            // Verify state changes
            expect(finalStats.newCount).toBeLessThan(initialStats.newCount);
            expect(overallStats.reviewStats.totalReviews).toBe(reviewedCount);
            expect(overallStats.reviewStats.totalTimeMs).toBeGreaterThan(0);
        });
    });
});
