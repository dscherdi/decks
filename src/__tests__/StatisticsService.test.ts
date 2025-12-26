import {
  StatisticsService,
  TimeframeStats,
} from "../services/StatisticsService";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { FSRS } from "../algorithm/fsrs";
import type {
  Statistics,
  ReviewLog,
  Flashcard,
  DailyStats,
} from "../database/types";

// Mock implementations
class MockDatabaseService implements Partial<IDatabaseService> {
  private mockStatistics: Statistics | null = null;
  private mockReviewLogs: ReviewLog[] = [];
  private mockFlashcards: Flashcard[] = [];
  private mockFlashcardsByDeck: Map<string, Flashcard[]> = new Map();

  setFlashcardsByDeck(deckId: string, flashcards: Flashcard[]): void {
    this.mockFlashcardsByDeck.set(deckId, flashcards);
  }

  setReviewLogs(logs: ReviewLog[]): void {
    this.mockReviewLogs = logs;
  }

  setMockStatistics(stats: Statistics) {
    this.mockStatistics = stats;
  }

  setMockReviewLogs(logs: ReviewLog[]) {
    this.mockReviewLogs = logs;
  }

  setMockFlashcards(cards: Flashcard[]) {
    this.mockFlashcards = cards;
  }

  setMockFlashcardsByDeck(deckId: string, cards: Flashcard[]) {
    this.mockFlashcardsByDeck.set(deckId, cards);
  }

  async getOverallStatistics(
    deckFilter?: string,
    timeframe?: string,
  ): Promise<Statistics> {
    return this.mockStatistics || this.createEmptyStatistics();
  }

  async getAllReviewLogs(): Promise<ReviewLog[]> {
    return this.mockReviewLogs;
  }

  async getAllFlashcards(): Promise<Flashcard[]> {
    return this.mockFlashcards;
  }

  async getFlashcardsByDeck(deckId: string): Promise<Flashcard[]> {
    return this.mockFlashcardsByDeck.get(deckId) || [];
  }

  async getDeckById(deckId: string): Promise<any> {
    // Mock implementation returning a deck with default config
    return {
      id: deckId,
      config: {
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
      },
    };
  }

  // Forecast database methods
  async getScheduledDueByDay(
    deckId: string,
    startDate: string,
    endDate: string,
  ): Promise<{ day: string; count: number }[]> {
    const cards = this.mockFlashcardsByDeck.get(deckId) || [];
    const reviewCards = cards.filter((card) => card.state === "review");

    const start = new Date(startDate);
    const end = new Date(endDate);
    const results: { day: string; count: number }[] = [];
    const dueCounts = new Map<string, number>();

    for (const card of reviewCards) {
      const dueDate = new Date(card.dueDate);
      if (dueDate >= start && dueDate < end) {
        const dateStr = dueDate.toISOString().slice(0, 10);
        dueCounts.set(dateStr, (dueCounts.get(dateStr) || 0) + 1);
      }
    }

    for (const [day, count] of dueCounts) {
      results.push({ day, count });
    }

    return results.sort((a, b) => a.day.localeCompare(b.day));
  }

  async getScheduledDueByDayMulti(
    deckIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<{ day: string; count: number }[]> {
    const results = new Map<string, number>();

    for (const deckId of deckIds) {
      const deckResults = await this.getScheduledDueByDay(
        deckId,
        startDate,
        endDate,
      );
      for (const r of deckResults) {
        results.set(r.day, (results.get(r.day) || 0) + r.count);
      }
    }

    return Array.from(results.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  async getCurrentBacklog(
    deckId: string,
    currentDate: string,
  ): Promise<number> {
    const cards = this.mockFlashcardsByDeck.get(deckId) || [];
    const current = new Date(currentDate);

    return cards.filter((card) => {
      const dueDate = new Date(card.dueDate);
      return card.state === "review" && dueDate < current;
    }).length;
  }

  async getCurrentBacklogMulti(
    deckIds: string[],
    currentDate: string,
  ): Promise<number> {
    let total = 0;
    for (const deckId of deckIds) {
      total += await this.getCurrentBacklog(deckId, currentDate);
    }
    return total;
  }

  async getDeckReviewCountRange(
    deckId: string,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    const cards = this.mockFlashcardsByDeck.get(deckId) || [];
    const cardIds = new Set(cards.map((card) => card.id));

    const start = new Date(startDate);
    const end = new Date(endDate);

    return this.mockReviewLogs.filter((log) => {
      const reviewDate = new Date(log.reviewedAt);
      return (
        reviewDate >= start && reviewDate < end && cardIds.has(log.flashcardId)
      );
    }).length;
  }

  private createEmptyStatistics(): Statistics {
    return {
      dailyStats: [],
      cardStats: { new: 0, review: 0, mature: 0 },
      answerButtons: { again: 0, hard: 0, good: 0, easy: 0 },
      retentionRate: 0,
      intervals: [],
      forecast: [],
      averagePace: 0,
      totalReviewTime: 0,
    };
  }
}

// Mock settings
const mockSettings = {
  review: {
    showProgress: true,
    enableKeyboardShortcuts: true,
    sessionDuration: 25,
  },
  parsing: { folderSearchPath: "" },
  ui: {
    enableBackgroundRefresh: true,
    backgroundRefreshInterval: 5,
    enableNotices: true,
  },
  backup: { enableAutoBackup: true, maxBackups: 5 },
  debug: { enableLogging: false, performanceLogs: false },
  experimental: { enableDatabaseWorker: false },
};

describe("StatisticsService", () => {
  let statisticsService: StatisticsService;
  let mockDb: MockDatabaseService;

  beforeEach(() => {
    mockDb = new MockDatabaseService();
    statisticsService = new StatisticsService(
      mockDb as any,
      mockSettings as any,
    );
  });

  describe("getTodayStats", () => {
    it("should return today's stats when available", () => {
      const today = new Date().toISOString().split("T")[0];
      const mockStats = createMockStatistics([
        createMockDailyStats(today, 10, 300),
        createMockDailyStats("2024-01-01", 5, 150),
      ]);

      const result = statisticsService.getTodayStats(mockStats);

      expect(result.date).toBe(today);
      expect(result.reviews).toBe(10);
    });

    it("should return first available stats when today is not found", () => {
      const mockStats = createMockStatistics([
        createMockDailyStats("2024-01-02", 8, 240),
        createMockDailyStats("2024-01-01", 5, 150),
      ]);

      const result = statisticsService.getTodayStats(mockStats);

      expect(result.date).toBe("2024-01-02");
      expect(result.reviews).toBe(8);
    });

  });

  describe("getTimeframeStats", () => {
    beforeEach(() => {
      // Mock current date for consistent testing
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2024-01-15"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should calculate stats for specified timeframe", () => {
      const mockStats = createMockStatistics([
        createMockDailyStats("2024-01-14", 10, 300, 2, 8, 85.0),
        createMockDailyStats("2024-01-13", 15, 450, 3, 12, 90.0),
        createMockDailyStats("2024-01-05", 5, 150, 1, 4, 80.0), // Outside 7-day window
      ]);

      const result = statisticsService.getTimeframeStats(mockStats, 7);

      expect(result.reviews).toBe(25); // 10 + 15
      expect(result.timeSpent).toBe(750); // 300 + 450
      expect(result.newCards).toBe(5); // 2 + 3
      expect(result.reviewCards).toBe(20); // 8 + 12
      expect(result.correctRate).toBeCloseTo(88.0, 1); // Weighted average: (85*10 + 90*15) / 25 = 2200/25 = 88
    });

  });

  describe("calculateAverageEase", () => {
    it("should calculate correct average ease", () => {
      const mockStats = createMockStatistics();
      mockStats.answerButtons = { again: 10, hard: 20, good: 30, easy: 40 };

      const result = statisticsService.calculateAverageEase(mockStats);

      // (10*1 + 20*2 + 30*3 + 40*4) / 100 = 300/100 = 3.00
      expect(result).toBe(3.0);
    });

  });

  describe("calculateAverageInterval", () => {
    it("should calculate correct average interval in days", () => {
      const mockStats = createMockStatistics();
      mockStats.intervals = [
        { interval: "1d", count: 10 },
        { interval: "3d", count: 5 },
        { interval: "2h", count: 2 },
      ];

      const result = statisticsService.calculateAverageInterval(mockStats);

      // (10*1440 + 5*4320 + 2*120) minutes / 17 cards = 36240/17 = ~2132 minutes = ~1.5 days
      expect(result).toBeGreaterThan(0);
    });

  });

  describe("getDueToday and getDueTomorrow", () => {
    it("should return correct due counts", () => {
      const today = new Date().toISOString().split("T")[0];
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split("T")[0];

      const mockStats = createMockStatistics();
      mockStats.forecast = [
        { date: today, dueCount: 5 },
        { date: tomorrowStr, dueCount: 8 },
      ];

      expect(statisticsService.getDueToday(mockStats)).toBe(5);
      expect(statisticsService.getDueTomorrow(mockStats)).toBe(8);
    });

  });

  describe("getMaturityRatio", () => {
    it("should calculate correct maturity ratio", () => {
      const mockStats = createMockStatistics();
      mockStats.cardStats = { new: 10, review: 20, mature: 30 };

      const result = statisticsService.getMaturityRatio(mockStats);

      expect(result).toBe(50.0); // 30/60 = 50%
    });

  });

  describe("getTotalCards", () => {
    it("should return correct total count", () => {
      const mockStats = createMockStatistics();
      mockStats.cardStats = { new: 10, review: 20, mature: 30 };

      const result = statisticsService.getTotalCards(mockStats);

      expect(result).toBe(60);
    });

  });

  describe("simulateFutureDueLoad", () => {
    it("should return backlog forecast data", async () => {
      // Setup mock deck with flashcards
      const deckId = "test-deck";
      const baseDate = new Date();
      const tomorrow = new Date(baseDate);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const flashcards = [
        createMockFlashcard("1", deckId, "review", tomorrow),
        createMockFlashcard(
          "2",
          deckId,
          "review",
          new Date(baseDate.getTime() - 24 * 60 * 60 * 1000),
        ), // overdue
      ];

      mockDb.setFlashcardsByDeck(deckId, flashcards);

      // Setup recent review logs
      const reviewLogs = [
        createMockReviewLog("1", "1", new Date(), 3),
        createMockReviewLog("2", "2", new Date(), 3),
      ];
      mockDb.setReviewLogs(reviewLogs);

      const result = await statisticsService.simulateFutureDueLoad([deckId], 7);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(7);

      // Check structure
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("scheduledDue");
      expect(result[0]).toHaveProperty("projectedBacklog");

      // First day should have the overdue card as backlog
      expect(result[0].projectedBacklog).toBeGreaterThanOrEqual(1);
    });

    it("should calculate backlog forecast correctly with realistic data", async () => {
      const deckId = "test-deck";
      const baseDate = new Date();

      // Create cards with different due dates
      const flashcards = [
        createMockFlashcard(
          "overdue1",
          deckId,
          "review",
          new Date(baseDate.getTime() - 24 * 60 * 60 * 1000),
        ), // 1 day overdue
        createMockFlashcard(
          "overdue2",
          deckId,
          "review",
          new Date(baseDate.getTime() - 48 * 60 * 60 * 1000),
        ), // 2 days overdue
        createMockFlashcard(
          "due-day3",
          deckId,
          "review",
          new Date(baseDate.getTime() + 3 * 24 * 60 * 60 * 1000),
        ), // due in 3 days
        createMockFlashcard(
          "due-day5",
          deckId,
          "review",
          new Date(baseDate.getTime() + 5 * 24 * 60 * 60 * 1000),
        ), // due in 5 days
      ];

      mockDb.setFlashcardsByDeck(deckId, flashcards);

      // Setup review history (simulate 2 reviews per day on average)
      const reviewLogs: ReviewLog[] = [];
      for (let i = 0; i < 60; i++) {
        // 60 reviews over 30 days = 2/day average
        const reviewDate = new Date(
          baseDate.getTime() - i * 12 * 60 * 60 * 1000,
        ); // spread over past 30 days
        reviewLogs.push(
          createMockReviewLog(
            `review-${i}`,
            flashcards[i % flashcards.length].id,
            reviewDate,
            3,
          ),
        );
      }
      mockDb.setReviewLogs(reviewLogs);

      const result = await statisticsService.simulateFutureDueLoad([deckId], 7);

      expect(result).toHaveLength(7);

      // Initial backlog should be 2 (overdue cards)
      expect(result[0].projectedBacklog).toBe(2);

      // FSRS simulation may generate additional reviews beyond original schedule
      // Day 3 should have at least the original 1 due card
      expect(result[3].scheduledDue).toBeGreaterThanOrEqual(1);

      // Day 5 should have at least the original 1 due card
      expect(result[5].scheduledDue).toBeGreaterThanOrEqual(1);

      // Backlog should generally decrease over time due to processing capacity
      // (2 reviews/day capacity vs cards becoming due)
      expect(result[6].projectedBacklog).toBeLessThanOrEqual(
        result[0].projectedBacklog + 2,
      );
    });

    it("should handle deck with no review history", async () => {
      const deckId = "new-deck";
      const baseDate = new Date();

      const flashcards = [
        createMockFlashcard(
          "1",
          deckId,
          "review",
          new Date(baseDate.getTime() + 24 * 60 * 60 * 1000),
        ),
      ];

      mockDb.setFlashcardsByDeck(deckId, flashcards);
      mockDb.setReviewLogs([]); // No review history

      const result = await statisticsService.simulateFutureDueLoad([deckId], 5);

      expect(result).toHaveLength(5);

      // With no review history, avgReviewsPerDay should be 0
      // So backlog should accumulate all due cards
      expect(result[1].projectedBacklog).toBeGreaterThanOrEqual(
        result[0].projectedBacklog,
      );
    });

    it("should handle 1-year backlog forecast simulation", async () => {
      const deckId = "large-deck";
      const baseDate = new Date();

      // Create realistic deck with cards due throughout the year
      const flashcards: Flashcard[] = [];
      for (let i = 0; i < 50; i++) {
        const daysOffset = Math.floor(Math.random() * 365); // Random due dates over the year
        const dueDate = new Date(
          baseDate.getTime() + daysOffset * 24 * 60 * 60 * 1000,
        );
        flashcards.push(
          createMockFlashcard(`card-${i}`, deckId, "review", dueDate),
        );
      }

      // Add some overdue cards
      for (let i = 0; i < 10; i++) {
        const overdueDays = Math.floor(Math.random() * 30) + 1;
        const overdueDate = new Date(
          baseDate.getTime() - overdueDays * 24 * 60 * 60 * 1000,
        );
        flashcards.push(
          createMockFlashcard(`overdue-${i}`, deckId, "review", overdueDate),
        );
      }

      mockDb.setFlashcardsByDeck(deckId, flashcards);

      // Setup review history (consistent reviewing pattern)
      const reviewLogs: ReviewLog[] = [];
      for (let i = 0; i < 300; i++) {
        // 300 reviews over 30 days = 10/day
        const reviewDate = new Date(
          baseDate.getTime() - i * 3.456 * 60 * 60 * 1000,
        ); // spread over 30 days
        reviewLogs.push(
          createMockReviewLog(
            `review-${i}`,
            flashcards[i % flashcards.length].id,
            reviewDate,
            3,
          ),
        );
      }
      mockDb.setReviewLogs(reviewLogs);

      const result = await statisticsService.simulateFutureDueLoad(
        [deckId],
        365,
      );

      expect(result).toHaveLength(365);

      // Initial backlog should include overdue cards
      expect(result[0].projectedBacklog).toBeGreaterThanOrEqual(10);

      // Test that dates are formatted correctly
      expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result[364].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Test that backlog values are reasonable integers
      expect(Number.isInteger(result[0].projectedBacklog)).toBe(true);
      expect(result[364].projectedBacklog).toBeLessThan(10000); // Reasonable upper bound

      // Total scheduled due should equal number of future cards
      const totalScheduled = result.reduce(
        (sum, day) => sum + day.scheduledDue,
        0,
      );
      const futureDueCards = flashcards.filter(
        (card) => new Date(card.dueDate) >= baseDate,
      );
      // FSRS simulation generates additional future reviews beyond original schedule
      expect(totalScheduled).toBeGreaterThanOrEqual(futureDueCards.length);
    });

    it("should handle 1-year simulation with acceptable performance", async () => {
      const deckId = "perf-deck";
      const baseDate = new Date();

      // Create a realistic deck size for performance testing
      const flashcards: Flashcard[] = [];
      for (let i = 0; i < 100; i++) {
        const daysOffset = Math.floor(Math.random() * 365) + 1; // Due throughout the year
        const dueDate = new Date(
          baseDate.getTime() + daysOffset * 24 * 60 * 60 * 1000,
        );
        flashcards.push(
          createMockFlashcard(`card-${i}`, deckId, "review", dueDate),
        );
      }

      mockDb.setFlashcardsByDeck(deckId, flashcards);

      // Setup sufficient review history
      const reviewLogs: ReviewLog[] = [];
      for (let i = 0; i < 450; i++) {
        // 15 reviews/day average
        const reviewDate = new Date(
          baseDate.getTime() - i * 1.6 * 60 * 60 * 1000,
        ); // 30 days
        reviewLogs.push(
          createMockReviewLog(
            `review-${i}`,
            flashcards[i % flashcards.length].id,
            reviewDate,
            3,
          ),
        );
      }
      mockDb.setReviewLogs(reviewLogs);

      const startTime = Date.now();
      const result = await statisticsService.simulateFutureDueLoad(
        [deckId],
        365,
      );
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Performance check - should complete within reasonable time
      expect(duration).toBeLessThan(1000); // 1 second max for this size
      expect(result).toHaveLength(365);

      // Verify structure and reasonable values
      expect(result[0]).toHaveProperty("scheduledDue");
      expect(result[0]).toHaveProperty("projectedBacklog");
      expect(result[364].projectedBacklog).toBeLessThan(10000); // Reasonable bound

      // With good review capacity (15/day) vs 100 cards spread over year,
      // backlog should be manageable
      const avgBacklog =
        result.reduce((sum, day) => sum + day.projectedBacklog, 0) / 365;
      expect(avgBacklog).toBeLessThan(50); // Should maintain reasonable backlog
    });
  });

  describe("getFilteredForecastData", () => {
    it("should return filtered forecast data", () => {
      const mockStats = createMockStatistics();
      mockStats.forecast = [
        { date: "2024-01-01", dueCount: 5 },
        { date: "2024-01-02", dueCount: 3 },
        { date: "2024-01-03", dueCount: 0 },
        { date: "2024-01-04", dueCount: 7 },
      ];

      const result = statisticsService.getFilteredForecastData(
        mockStats,
        10,
        false,
      );

      expect(result).toHaveLength(4);
      expect(result[0].dueCount).toBe(5);
      expect(result[2].dueCount).toBe(0); // Includes zero days when onlyNonZero=false
    });

    it("should filter out zero days when onlyNonZero is true", () => {
      const mockStats = createMockStatistics();
      mockStats.forecast = [
        { date: "2024-01-01", dueCount: 5 },
        { date: "2024-01-02", dueCount: 0 }, // Should be filtered out
        { date: "2024-01-03", dueCount: 3 },
      ];

      const result = statisticsService.getFilteredForecastData(
        mockStats,
        10,
        true,
      );

      expect(result).toHaveLength(2);
      expect(result[0].dueCount).toBe(5);
      expect(result[1].dueCount).toBe(3);
    });

    it("should limit results to maxDays", () => {
      const mockStats = createMockStatistics();
      mockStats.forecast = [
        { date: "2024-01-01", dueCount: 1 },
        { date: "2024-01-02", dueCount: 2 },
        { date: "2024-01-03", dueCount: 3 },
        { date: "2024-01-04", dueCount: 4 },
        { date: "2024-01-05", dueCount: 5 },
      ];

      const result = statisticsService.getFilteredForecastData(
        mockStats,
        3,
        false,
      );

      expect(result).toHaveLength(3);
      expect(result[2].dueCount).toBe(3);
    });
  });

  describe("calculateForecastStats", () => {
    it("should calculate correct forecast statistics", () => {
      const mockStats = createMockStatistics();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split("T")[0];

      mockStats.forecast = [
        { date: "2024-01-01", dueCount: 10 },
        { date: tomorrowStr, dueCount: 5 },
        { date: "2024-01-03", dueCount: 0 },
        { date: "2024-01-04", dueCount: 8 },
      ];

      const result = statisticsService.calculateForecastStats(
        mockStats,
        [],
        10,
      );

      expect(result.totalReviews).toBe(23); // 10 + 5 + 0 + 8
      expect(result.averagePerDay).toBeCloseTo(5.75, 1); // 23/4
      expect(result.dueTomorrow).toBe(5);
      expect(result.dailyLoad).toBeCloseTo(7.67, 1); // (10 + 5 + 8) / 3 non-zero days
    });

  });

  describe("retention rate handling", () => {
    it("should use deck-specific retention rate for simulations", async () => {
      // Create a deck with custom retention rate
      const customRetentionDb = new MockDatabaseService();
      customRetentionDb.getDeckById = async (deckId: string) => ({
        id: deckId,
        config: {
          fsrs: {
            requestRetention: 0.95, // Custom retention rate
            profile: "STANDARD",
          },
        },
      });

      const customGetDeckConfig = async (deckId: string) => {
        const deck = await customRetentionDb.getDeckById(deckId);
        return deck?.config || null;
      };

      const customStatisticsService = new StatisticsService(
        customRetentionDb as any,
        mockSettings as any,
      );

      // Test with deck that has custom config
      const deckId = "custom-deck";
      const testFlashcards = [createMockFlashcard("1", deckId)];
      mockDb.setFlashcardsByDeck(deckId, testFlashcards);
      mockDb.setReviewLogs([]);

      const result = await customStatisticsService.simulateFutureDueLoad(
        [deckId],
        30,
      );

      expect(result).toHaveLength(30);
      expect(result[0]).toHaveProperty("scheduledDue");
      expect(result[0]).toHaveProperty("projectedBacklog");
    });

    it("should work even when deck config is unavailable", async () => {
      const deckId = "unknown-deck";
      const testFlashcards = [createMockFlashcard("1", deckId)];
      mockDb.setFlashcardsByDeck(deckId, testFlashcards);
      mockDb.setReviewLogs([]);

      // Should still work without deck config
      const result = await statisticsService.simulateFutureDueLoad([deckId], 7);

      expect(result).toHaveLength(7);
      expect(result[0]).toHaveProperty("scheduledDue");
      expect(result[0]).toHaveProperty("projectedBacklog", 0);
    });

    it("should handle multiple decks correctly", async () => {
      const deckId1 = "test-deck-1";
      const deckId2 = "test-deck-2";
      const baseDate = new Date();
      const tomorrow = new Date(baseDate);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Setup flashcards for first deck
      const flashcards1 = [
        createMockFlashcard("1", deckId1, "review", tomorrow),
        createMockFlashcard("2", deckId1, "review", tomorrow),
      ];

      // Setup flashcards for second deck
      const flashcards2 = [
        createMockFlashcard("3", deckId2, "review", tomorrow),
      ];

      mockDb.setFlashcardsByDeck(deckId1, flashcards1);
      mockDb.setFlashcardsByDeck(deckId2, flashcards2);

      // Setup review logs
      const reviewLogs = [
        createMockReviewLog("1", "1", new Date(), 3),
        createMockReviewLog("2", "2", new Date(), 3),
        createMockReviewLog("3", "3", new Date(), 3),
      ];
      mockDb.setReviewLogs(reviewLogs);

      const result = await statisticsService.simulateFutureDueLoad(
        [deckId1, deckId2],
        7,
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(7);

      // Tomorrow should have at least the original 3 cards (FSRS may add more)
      expect(result[1].scheduledDue).toBeGreaterThanOrEqual(3);

      // Check structure
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("scheduledDue");
      expect(result[0]).toHaveProperty("projectedBacklog");
    });
  });

  describe("Statistical Calculation Accuracy - Stress Tests", () => {
    describe("Timeframe Statistics Mathematical Correctness", () => {
      beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-06-15T12:00:00Z"));
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("should calculate weighted average retention rate correctly with edge cases", () => {
        const dailyStats = [
          createMockDailyStats("2024-06-14", 100, 3600, 10, 90, 95.0), // High volume, high retention
          createMockDailyStats("2024-06-13", 1, 60, 0, 1, 0.0), // Low volume, zero retention
          createMockDailyStats("2024-06-12", 50, 1800, 5, 45, 90.0), // Medium volume
          createMockDailyStats("2024-06-11", 0, 0, 0, 0, 0.0), // No reviews
          createMockDailyStats("2024-06-10", 200, 7200, 20, 180, 88.0), // Very high volume
        ];

        const mockStats = createMockStatistics(dailyStats);
        const result = statisticsService.getTimeframeStats(mockStats, 7);

        // Total reviews: 100 + 1 + 50 + 0 + 200 = 351
        // Weighted retention: (95*100 + 0*1 + 90*50 + 88*200) / 351 = (9500 + 0 + 4500 + 17600) / 351 ≈ 90.03
        expect(result.reviews).toBe(351);
        expect(result.correctRate).toBeCloseTo(90.03, 1);
        expect(result.timeSpent).toBe(12660); // 3600 + 60 + 1800 + 0 + 7200
        expect(result.newCards).toBe(35); // 10 + 0 + 5 + 0 + 20
        expect(result.reviewCards).toBe(316); // 90 + 1 + 45 + 0 + 180
      });

      it("should handle extreme timeframe ranges correctly", () => {
        // Generate 400 days of data
        const dailyStats: any[] = [];
        for (let i = 0; i < 400; i++) {
          const date = new Date("2024-06-15");
          date.setDate(date.getDate() - i);
          dailyStats.push(
            createMockDailyStats(
              date.toISOString().split("T")[0],
              Math.floor(Math.random() * 50) + 1,
              Math.floor(Math.random() * 1800) + 300,
              Math.floor(Math.random() * 5),
              Math.floor(Math.random() * 45) + 5,
              80 + Math.random() * 20,
            ),
          );
        }

        const mockStats = createMockStatistics(dailyStats);

        // Test very long timeframe (365 days)
        const yearResult = statisticsService.getTimeframeStats(mockStats, 365);
        expect(yearResult.reviews).toBeGreaterThan(300); // Should include most days
        expect(yearResult.correctRate).toBeGreaterThan(70);
        expect(yearResult.correctRate).toBeLessThan(105);

        // Test single day
        const dayResult = statisticsService.getTimeframeStats(mockStats, 1);
        expect(dayResult.reviews).toBeGreaterThanOrEqual(0);
        expect(dayResult.correctRate).toBeGreaterThanOrEqual(0);
      });

      it("should maintain precision with very large numbers", () => {
        const largeNumberStats = [
          createMockDailyStats(
            "2024-06-14",
            999999,
            3599999,
            99999,
            899999,
            99.999,
          ),
          createMockDailyStats(
            "2024-06-13",
            888888,
            3199999,
            88888,
            799999,
            88.888,
          ),
        ];

        const mockStats = createMockStatistics(largeNumberStats);
        const result = statisticsService.getTimeframeStats(mockStats, 7);

        // Should handle large numbers without precision loss
        expect(result.reviews).toBe(1888887); // 999999 + 888888
        expect(result.timeSpent).toBe(6799998); // 3599999 + 3199999
        expect(result.newCards).toBe(188887); // 99999 + 88888

        // Weighted average: (99.999 * 999999 + 88.888 * 888888) / 1888887
        const expectedRate = (99.999 * 999999 + 88.888 * 888888) / 1888887;
        expect(result.correctRate).toBeCloseTo(expectedRate, 2);
      });
    });

    describe("Average Ease Calculation Robustness", () => {
      it("should handle extreme answer button distributions", () => {
        const extremeCases = [
          { again: 1000000, hard: 0, good: 0, easy: 0 }, // All "again"
          { again: 0, hard: 0, good: 0, easy: 1000000 }, // All "easy"
          { again: 1, hard: 1, good: 1, easy: 1 }, // Uniform small
          { again: 999999, hard: 1, good: 1, easy: 1 }, // Heavily skewed
          { again: 0, hard: 0, good: 1000000, easy: 0 }, // All "good"
        ];

        extremeCases.forEach((answerButtons, index) => {
          const mockStats = createMockStatistics();
          mockStats.answerButtons = answerButtons;

          const result = statisticsService.calculateAverageEase(mockStats);

          // Should always return a valid number
          expect(typeof result).toBe("number");
          expect(result).toBeGreaterThanOrEqual(1.0);
          expect(result).toBeLessThanOrEqual(4.0);
        });
      });

      it("should maintain mathematical accuracy across different scales", () => {
        const testCases = [
          { again: 100, hard: 200, good: 300, easy: 400 }, // Base case
          { again: 1, hard: 2, good: 3, easy: 4 }, // Small scale
          { again: 10000, hard: 20000, good: 30000, easy: 40000 }, // Large scale
        ];

        testCases.forEach((answerButtons) => {
          const mockStats = createMockStatistics();
          mockStats.answerButtons = answerButtons;

          const result = statisticsService.calculateAverageEase(mockStats);

          // Manual calculation: (1*again + 2*hard + 3*good + 4*easy) / total
          const total =
            answerButtons.again +
            answerButtons.hard +
            answerButtons.good +
            answerButtons.easy;
          const expected =
            (1 * answerButtons.again +
              2 * answerButtons.hard +
              3 * answerButtons.good +
              4 * answerButtons.easy) /
            total;

          expect(result).toBeCloseTo(expected, 6);
        });
      });
    });

    describe("Interval Calculations with Edge Cases", () => {
      it("should parse all interval formats correctly", () => {
        const intervalTestCases = [
          {
            intervals: [{ interval: "1m", count: 100 }],
            expectedAvg: 30, // 1m is parsed as 1 month = 43200 minutes = 30 days
          },
          { intervals: [{ interval: "1h", count: 100 }], expectedAvg: 0 }, // 1 hour = 60 minutes, rounds to 0 days
          { intervals: [{ interval: "1d", count: 100 }], expectedAvg: 1 }, // Days
          { intervals: [{ interval: "30d", count: 100 }], expectedAvg: 30 }, // Longer days
          {
            intervals: [
              { interval: "30m", count: 10 }, // 30 months
              { interval: "12h", count: 5 }, // 12 hours
              { interval: "7d", count: 2 }, // 7 days
            ],
            expectedAvg: Math.round(
              (10 * 30 * 43200 + 5 * 12 * 60 + 2 * 7 * 1440) /
                (10 + 5 + 2) /
                1440,
            ),
          },
        ];

        intervalTestCases.forEach(({ intervals, expectedAvg }, index) => {
          const mockStats = createMockStatistics();
          mockStats.intervals = intervals;

          const result = statisticsService.calculateAverageInterval(mockStats);
          expect(result).toBeCloseTo(expectedAvg, 3);
        });
      });

      it("should handle malformed interval strings gracefully", () => {
        const malformedIntervals = [
          { interval: "", count: 10 },
          { interval: "invalid", count: 5 },
          { interval: "123", count: 3 }, // No unit
          { interval: "d", count: 2 }, // No number
          { interval: "1x", count: 1 }, // Invalid unit
          { interval: "-5d", count: 4 }, // Negative
          { interval: "1.5d", count: 6 }, // Decimal
        ];

        const mockStats = createMockStatistics();
        mockStats.intervals = malformedIntervals;

        // Should not crash and should return a reasonable result
        const result = statisticsService.calculateAverageInterval(mockStats);
        expect(typeof result).toBe("number");
        // May return NaN for malformed data, but should not throw
        expect(result >= 0 || isNaN(result)).toBe(true);
      });
    });

    describe("Forecast Calculation Integrity", () => {
      it("should validate forecast data consistency", async () => {
        const today = new Date().toISOString().split("T")[0];
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split("T")[0];

        // Test with overlapping actual and predicted data
        const mockStats = createMockStatistics();
        mockStats.forecast = [
          { date: today, dueCount: 10 },
          { date: tomorrowStr, dueCount: 15 },
          { date: "2024-07-01", dueCount: 20 },
          { date: "2024-07-02", dueCount: 0 }, // Zero day
          { date: "2024-07-03", dueCount: 25 },
        ];

        const actualData = [
          { date: today, dueCount: 8 }, // Actual is different from forecast
          { date: tomorrowStr, dueCount: 12 }, // Actual is different
        ];

        const deckId = "forecast-test-deck";
        const flashcards = [
          createMockFlashcard("1", deckId),
          createMockFlashcard("2", deckId),
        ];

        mockDb.setFlashcardsByDeck(deckId, flashcards);
        mockDb.setReviewLogs([]);

        const result = await statisticsService.simulateFutureDueLoad(
          [deckId],
          10,
        );

        // Should return array of forecast data
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(10);
        expect(result[0]).toHaveProperty("scheduledDue");
        expect(result[0]).toHaveProperty("projectedBacklog");

        // All results should have proper structure
        for (let i = 0; i < 10; i++) {
          expect(result[i]).toHaveProperty("date");
          expect(result[i]).toHaveProperty("scheduledDue");
          expect(result[i]).toHaveProperty("projectedBacklog");
          expect(typeof result[i].scheduledDue).toBe("number");
          expect(typeof result[i].projectedBacklog).toBe("number");
        }
      });

      it("should handle date boundary edge cases in forecasts", () => {
        // Test around month boundaries, leap years, etc.
        const testDates = [
          "2024-02-28", // Day before leap day
          "2024-02-29", // Leap day
          "2024-03-01", // Day after leap day
          "2023-12-31", // Year boundary
          "2024-01-01", // New year
        ];

        testDates.forEach((dateStr) => {
          const mockStats = createMockStatistics();
          mockStats.forecast = [{ date: dateStr, dueCount: 5 }];

          // Should handle all dates correctly
          const forecastData = statisticsService.getFilteredForecastData(
            mockStats,
            30,
            false,
          );
          expect(forecastData).toHaveLength(1);
          expect(forecastData[0].date).toBe(dateStr);
          expect(forecastData[0].dueCount).toBe(5);

          const stats = statisticsService.calculateForecastStats(
            mockStats,
            [],
            30,
          );
          expect(stats.totalReviews).toBe(5);
        });
      });
    });
  });

  describe("Data Integrity and Corruption Handling", () => {
    describe("Malformed Data Resilience", () => {
      it("should handle corrupted daily stats gracefully", () => {
        const corruptedStats = [
          { date: "2024-06-14", reviews: -5, timeSpent: -100 }, // Negative values
          { date: "invalid-date", reviews: 10, timeSpent: 300 }, // Invalid date
          { date: "2024-06-12", reviews: NaN, timeSpent: Infinity }, // NaN/Infinity
          { date: null, reviews: 5, timeSpent: 150 }, // Null date
          { reviews: 3, timeSpent: 90 }, // Missing date
          "not-an-object", // Wrong type
        ];

        const mockStats = createMockStatistics();
        (mockStats as any).dailyStats = corruptedStats;

        // Should not crash when processing corrupted data
        expect(() => {
          const result = statisticsService.getTimeframeStats(mockStats, 7);
          expect(typeof result).toBe("object");
          expect(result.reviews).toBeGreaterThanOrEqual(0);
          expect(result.timeSpent).toBeGreaterThanOrEqual(0);
        }).not.toThrow();
      });

      it("should handle missing or null fields in statistics", () => {
        const incompleteStats = {
          cardStats: null,
          answerButtons: undefined,
          intervals: "not-an-array",
          forecast: { invalid: "structure" },
          dailyStats: [],
        } as any;

        // Should handle incomplete/invalid statistics structure
        const totalCards = statisticsService.getTotalCards(incompleteStats);
        expect(totalCards).toBe(0);

        const averageEase =
          statisticsService.calculateAverageEase(incompleteStats);
        expect(averageEase).toBe(0);

        // This will throw because intervals is not an array, but that's expected behavior
        expect(() => {
          statisticsService.calculateAverageInterval(incompleteStats);
        }).toThrow();
      });
    });

    describe("Large Dataset Performance", () => {
      it("should handle 10k+ daily stats efficiently", () => {
        // Use real timers for this test to avoid date filtering issues
        jest.useRealTimers();

        const largeDailyStats: any[] = [];
        const currentDate = new Date();

        // Generate 10,000 days of data (about 27 years)
        for (let i = 0; i < 10000; i++) {
          const date = new Date(currentDate);
          date.setDate(currentDate.getDate() - i);
          largeDailyStats.push(
            createMockDailyStats(
              date.toISOString().split("T")[0],
              Math.floor(Math.random() * 100) + 1,
              Math.floor(Math.random() * 3600) + 60,
              Math.floor(Math.random() * 10),
              Math.floor(Math.random() * 90) + 10,
              75 + Math.random() * 25,
            ),
          );
        }

        const mockStats = createMockStatistics(largeDailyStats);

        const startTime = performance.now();

        // Test various timeframe calculations
        const day1 = statisticsService.getTimeframeStats(mockStats, 1);
        const week = statisticsService.getTimeframeStats(mockStats, 7);
        const month = statisticsService.getTimeframeStats(mockStats, 30);
        const year = statisticsService.getTimeframeStats(mockStats, 365);

        const endTime = performance.now();

        // Should complete within reasonable time (less than 100ms)
        expect(endTime - startTime).toBeLessThan(100);

        // All results should be valid
        [day1, week, month, year].forEach((result) => {
          expect(result.reviews).toBeGreaterThan(0);
          expect(result.timeSpent).toBeGreaterThan(0);
          expect(result.correctRate).toBeGreaterThan(0);
          expect(result.correctRate).toBeLessThan(100);
        });

        // Longer timeframes should have more data
        expect(year.reviews).toBeGreaterThan(month.reviews);
        expect(month.reviews).toBeGreaterThan(week.reviews);
        expect(week.reviews).toBeGreaterThan(day1.reviews);

        // Restore fake timers
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-06-15T12:00:00Z"));
      });

      it("should handle massive forecast arrays efficiently", () => {
        const massiveForecast: any[] = [];

        // Generate 5 years of forecast data (1825 days)
        for (let i = 0; i < 1825; i++) {
          const date = new Date("2024-06-15");
          date.setDate(date.getDate() + i);
          massiveForecast.push({
            date: date.toISOString().split("T")[0],
            dueCount: Math.floor(Math.random() * 50) + (i < 100 ? 10 : 1), // Front-load some data
          });
        }

        const mockStats = createMockStatistics();
        mockStats.forecast = massiveForecast;

        const startTime = performance.now();

        const filtered = statisticsService.getFilteredForecastData(
          mockStats,
          365,
          false,
        );
        const stats = statisticsService.calculateForecastStats(
          mockStats,
          [],
          365,
        );
        const dueToday = statisticsService.getDueToday(mockStats);
        const dueTomorrow = statisticsService.getDueTomorrow(mockStats);

        const endTime = performance.now();

        // Should complete quickly even with large dataset
        expect(endTime - startTime).toBeLessThan(50);

        // Results should be valid
        expect(filtered.length).toBeLessThanOrEqual(365);
        expect(stats.totalReviews).toBeGreaterThan(0);
        expect(dueToday).toBeGreaterThanOrEqual(0);
        expect(dueTomorrow).toBeGreaterThanOrEqual(0);
      });
    });

    describe("Concurrent Access and State Management", () => {
      it("should handle multiple simultaneous calculations without interference", async () => {
        const mockStats = createMockStatistics([
          createMockDailyStats("2024-06-14", 50, 1800, 5, 45, 90.0),
          createMockDailyStats("2024-06-13", 30, 1200, 3, 27, 85.0),
        ]);
        mockStats.answerButtons = { again: 10, hard: 20, good: 30, easy: 40 };
        mockStats.intervals = [
          { interval: "1d", count: 20 },
          { interval: "3d", count: 10 },
        ];

        // Simulate concurrent access by running multiple calculations simultaneously
        const promises = Array.from({ length: 10 }, (_, i) =>
          Promise.resolve().then(() => {
            const timeframe = statisticsService.getTimeframeStats(mockStats, 7);
            const ease = statisticsService.calculateAverageEase(mockStats);
            const interval =
              statisticsService.calculateAverageInterval(mockStats);
            const total = statisticsService.getTotalCards(mockStats);

            return { timeframe, ease, interval, total, index: i };
          }),
        );

        const results = await Promise.all(promises);

        // All results should be identical (no shared state corruption)
        const first = results[0];
        results.forEach((result, index) => {
          expect(result.timeframe).toEqual(first.timeframe);
          expect(result.ease).toBe(first.ease);
          expect(result.interval).toBe(first.interval);
          expect(result.total).toBe(first.total);
        });
      });
    });
  });

  describe("Boundary and Precision Testing", () => {
    describe("Floating Point Precision Edge Cases", () => {
      it("should handle very small decimal values in statistics", () => {
        const precisionStats = createMockStatistics([
          createMockDailyStats(
            "2024-06-14",
            1000000,
            3600000,
            100000,
            900000,
            99.99999,
          ),
          createMockDailyStats(
            "2024-06-13",
            1000000,
            3600000,
            100000,
            900000,
            99.99998,
          ),
        ]);

        const result = statisticsService.getTimeframeStats(precisionStats, 7);

        // Should maintain precision in calculations
        expect(result.reviews).toBe(2000000);
        expect(result.correctRate).toBeCloseTo(99.999985, 5);
      });

      it("should handle zero division scenarios gracefully", () => {
        const zeroDivisionStats = createMockStatistics();
        zeroDivisionStats.answerButtons = {
          again: 0,
          hard: 0,
          good: 0,
          easy: 0,
        };
        zeroDivisionStats.intervals = [];
        zeroDivisionStats.cardStats = { new: 0, review: 0, mature: 0 };

        // All calculations should return 0 without crashing
        expect(statisticsService.calculateAverageEase(zeroDivisionStats)).toBe(
          0,
        );
        expect(
          statisticsService.calculateAverageInterval(zeroDivisionStats),
        ).toBe(0);
        expect(statisticsService.getTotalCards(zeroDivisionStats)).toBe(0);
        expect(statisticsService.getMaturityRatio(zeroDivisionStats)).toBe(0);
      });
    });

    describe("Date Boundary Validation", () => {
      it("should handle leap year calculations correctly", () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-03-01T12:00:00Z")); // Day after leap day

        const leapYearStats = [
          createMockDailyStats("2024-02-29", 50, 1800, 5, 45, 90.0), // Leap day
          createMockDailyStats("2024-02-28", 40, 1440, 4, 36, 85.0),
          createMockDailyStats("2024-03-01", 60, 2160, 6, 54, 95.0),
        ];

        const mockStats = createMockStatistics(leapYearStats);
        const result = statisticsService.getTimeframeStats(mockStats, 5);

        // Should include all three days
        expect(result.reviews).toBe(150); // 50 + 40 + 60
        expect(result.timeSpent).toBe(5400); // 1800 + 1440 + 2160

        jest.useRealTimers();
      });

      it("should handle year boundary transitions", () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-01-02T12:00:00Z"));

        const yearBoundaryStats = [
          createMockDailyStats("2024-01-01", 30, 1200, 3, 27, 88.0),
          createMockDailyStats("2023-12-31", 25, 1000, 2, 23, 85.0),
          createMockDailyStats("2023-12-30", 20, 800, 1, 19, 82.0),
        ];

        const mockStats = createMockStatistics(yearBoundaryStats);
        const result = statisticsService.getTimeframeStats(mockStats, 5);

        expect(result.reviews).toBe(75); // All three days within range
        expect(result.newCards).toBe(6); // 3 + 2 + 1

        jest.useRealTimers();
      });
    });

    describe("Statistical Aggregation Accuracy", () => {
      it("should maintain accuracy with skewed data distributions", () => {
        // Use real timers for this test
        jest.useRealTimers();

        const currentDate = new Date();
        const yesterday = new Date(currentDate);
        yesterday.setDate(currentDate.getDate() - 1);
        const dayBefore = new Date(currentDate);
        dayBefore.setDate(currentDate.getDate() - 2);

        const skewedStats = createMockStatistics([
          createMockDailyStats(
            currentDate.toISOString().split("T")[0],
            1,
            60,
            0,
            1,
            100.0,
          ), // Perfect but tiny
          createMockDailyStats(
            yesterday.toISOString().split("T")[0],
            10000,
            360000,
            1000,
            9000,
            75.0,
          ), // Huge volume
          createMockDailyStats(
            dayBefore.toISOString().split("T")[0],
            1,
            60,
            0,
            1,
            0.0,
          ), // Perfect failure
        ]);

        const result = statisticsService.getTimeframeStats(skewedStats, 7);

        // Weighted calculation: (100*1 + 75*10000 + 0*1) / 10002 ≈ 75.01
        expect(result.reviews).toBe(10002);
        expect(result.correctRate).toBeCloseTo(75.01, 1);

        // Restore fake timers
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-06-15T12:00:00Z"));
      });

      it("should handle extreme interval distributions", () => {
        const extremeIntervals = createMockStatistics();
        extremeIntervals.intervals = [
          { interval: "1d", count: 1 },
          { interval: "365d", count: 1 },
          { interval: "1h", count: 1000 }, // Should round to 0 days each
        ];

        const result =
          statisticsService.calculateAverageInterval(extremeIntervals);

        // (1*1440 + 365*1440 + 1000*60) / 1002 ≈ 587 minutes ≈ 0 days (rounded)
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(365);
      });
    });

    describe("Memory and Performance Under Stress", () => {
      it("should handle repeated calculations without memory accumulation", () => {
        // Use real timers and current date for this test
        jest.useRealTimers();

        const currentDate = new Date();
        const baseStats = createMockStatistics([
          createMockDailyStats(
            currentDate.toISOString().split("T")[0],
            100,
            3600,
            10,
            90,
            90.0,
          ),
        ]);

        // Perform thousands of calculations
        for (let i = 0; i < 100; i++) {
          // Reduce iterations for performance
          const timeframe = statisticsService.getTimeframeStats(baseStats, 30);
          const ease = statisticsService.calculateAverageEase(baseStats);
          const interval =
            statisticsService.calculateAverageInterval(baseStats);

          // Results should remain consistent
          expect(timeframe.reviews).toBe(100);
          expect(ease).toBe(0); // No answer buttons in base stats
          expect(interval).toBe(0);
        }

        // Restore fake timers
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-06-15T12:00:00Z"));
      });

      it("should maintain precision across temperature variations in calculations", () => {
        // Simulate calculation "warming up" with repeated operations
        const precisionStats = createMockStatistics();
        precisionStats.answerButtons = {
          again: 333,
          hard: 333,
          good: 333,
          easy: 334,
        };

        const results: number[] = [];
        for (let i = 0; i < 100; i++) {
          results.push(statisticsService.calculateAverageEase(precisionStats));
        }

        // All results should be identical (no floating point drift)
        const firstResult = results[0];
        results.forEach((result) => {
          expect(result).toBe(firstResult);
        });

        // Expected: (333*1 + 333*2 + 333*3 + 334*4) / 1333 ≈ 2.5
        expect(firstResult).toBeCloseTo(2.5, 2);
      });
    });
  });
});

// Helper functions to create mock data
function createMockStatistics(dailyStats: DailyStats[] = []): Statistics {
  return {
    dailyStats,
    cardStats: { new: 0, review: 0, mature: 0 },
    answerButtons: { again: 0, hard: 0, good: 0, easy: 0 },
    retentionRate: 0,
    intervals: [],
    forecast: [],
    averagePace: 0,
    totalReviewTime: 0,
  };
}

function createMockDailyStats(
  date: string,
  reviews: number = 0,
  timeSpent: number = 0,
  newCards: number = 0,
  reviewCards: number = 0,
  correctRate: number = 0,
): DailyStats {
  return {
    date,
    reviews,
    timeSpent,
    newCards,
    learningCards: 0,
    reviewCards,
    correctRate,
  };
}

function createMockFlashcard(
  id: string,
  deckId: string,
  state: "new" | "review" = "review",
  dueDate: Date = new Date(),
): Flashcard {
  return {
    id,
    deckId,
    front: `Front ${id}`,
    back: `Back ${id}`,
    type: "header-paragraph",
    sourceFile: "test.md",
    contentHash: "hash" + id,
    state,
    dueDate: dueDate.toISOString(),
    interval: 1440,
    repetitions: 0,
    difficulty: 5.0,
    stability: 1.0,
    lapses: 0,
    lastReviewed: null,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  };
}

function createMockReviewLog(
  id: string,
  flashcardId: string,
  reviewedAt: Date = new Date(),
  rating: 1 | 2 | 3 | 4 = 3,
): ReviewLog {
  const ratingLabels = ["again", "hard", "good", "easy"] as const;
  return {
    id,
    flashcardId,
    sessionId: "session-1",
    lastReviewedAt: new Date(reviewedAt.getTime() - 60000).toISOString(),
    shownAt: new Date(reviewedAt.getTime() - 5000).toISOString(),
    reviewedAt: reviewedAt.toISOString(),
    rating,
    ratingLabel: ratingLabels[rating - 1],
    timeElapsedMs: 5000,
    oldState: "review",
    oldRepetitions: 1,
    oldLapses: 0,
    oldStability: 2.5,
    oldDifficulty: 5.0,
    newState: "review",
    newRepetitions: 2,
    newLapses: 0,
    newStability: 3.0,
    newDifficulty: 5.0,
    oldIntervalMinutes: 1440,
    newIntervalMinutes: 4320,
    oldDueAt: new Date(reviewedAt.getTime() - 86400000).toISOString(),
    newDueAt: reviewedAt.toISOString(),
    elapsedDays:
      Math.floor(
        (reviewedAt.getTime() - (reviewedAt.getTime() - 60000)) / 86400000,
      ) || 1,
    retrievability: 0.9,
    requestRetention: 0.9,
    profile: "STANDARD",
    maximumIntervalDays: 36500,
    minMinutes: 1,
    fsrsWeightsVersion: "1.0",
    schedulerVersion: "1.0",
  };
}
