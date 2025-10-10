import type { IDatabaseService } from "../database/DatabaseFactory";
import type {
  Statistics,
  ReviewLog,
  Flashcard,
  DailyStats,
  Deck,
  DeckConfig,
  DeckStats,
} from "../database/types";
import type { DecksSettings } from "../settings";
import { FSRS } from "../algorithm/fsrs";

export interface TimeframeStats {
  reviews: number;
  timeSpent: number;
  newCards: number;
  learningCards: number;
  reviewCards: number;
  correctRate: number;
}

export interface FutureDueData {
  date: string;
  dueCount: number;
}

export interface BacklogForecastData {
  date: string;
  scheduledDue: number;
  projectedBacklog: number;
}

export class StatisticsService {
  private db: IDatabaseService;
  private settings: DecksSettings;
  private fsrs: FSRS;

  constructor(db: IDatabaseService, settings: DecksSettings) {
    this.db = db;
    this.settings = settings;
    this.fsrs = new FSRS({ requestRetention: 0.9, profile: "STANDARD" });
  }

  /**
   * Get overall statistics with deck and timeframe filters
   */
  async getOverallStatistics(
    deckFilter: string = "all",
    timeframe: string = "12months",
  ): Promise<Statistics> {
    return await this.db.getOverallStatistics(deckFilter, timeframe);
  }

  /**
   * Get deck IDs for a given filter
   */
  getDeckIdsFromFilter(
    deckFilter: string,
    availableDecks: any[] = [],
  ): string[] {
    if (deckFilter === "all") {
      return availableDecks.map((deck) => deck.id);
    } else if (deckFilter.startsWith("deck:")) {
      return [deckFilter.replace("deck:", "")];
    } else if (deckFilter.startsWith("tag:")) {
      const tag = deckFilter.replace("tag:", "");
      return availableDecks
        .filter((deck) => deck.tag === tag)
        .map((deck) => deck.id);
    }
    return [];
  }

  /**
   * Get available decks and tags for filtering
   */
  async getAvailableDecksAndTags(): Promise<{
    decks: any[];
    tags: string[];
  }> {
    console.log("[StatisticsService] Getting available decks and tags...");
    const decks = await this.db.getAllDecks();
    const tags = [...new Set(decks.map((deck) => deck.tag))];
    console.log(
      `[StatisticsService] Found ${decks.length} decks and ${tags.length} unique tags`,
    );
    return { decks, tags };
  }

  /**
   * Get review count by date for heatmap - uses database aggregation
   */
  async getReviewCountsByDate(
    days: number,
    deckIds: string[] = [],
  ): Promise<Map<string, number>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let sql: string;
    let params: any[];

    if (deckIds.length === 0) {
      sql = `
        SELECT DATE(reviewed_at) as date, COUNT(*) as count
        FROM review_logs
        WHERE reviewed_at >= ?
        GROUP BY DATE(reviewed_at)
      `;
      params = [startDate.toISOString()];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT DATE(rl.reviewed_at) as date, COUNT(*) as count
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${placeholders}) AND rl.reviewed_at >= ?
        GROUP BY DATE(rl.reviewed_at)
      `;
      params = [...deckIds, startDate.toISOString()];
    }

    const results: Array<{ date: string; count: number }> = await this.db.query(
      sql,
      params,
    );
    const counts: Map<string, number> = new Map<string, number>();

    results.forEach((row: { date: string; count: number }) => {
      counts.set(row.date, row.count);
    });

    return counts;
  }

  /**
   * Get flashcards for charts filtered by deck IDs
   */
  async getFlashcardsForChart(deckIds: string[] = []): Promise<Flashcard[]> {
    if (deckIds.length === 0) {
      return await this.db.getAllFlashcards();
    } else if (deckIds.length === 1) {
      return await this.db.getFlashcardsByDeck(deckIds[0]);
    } else {
      // Load multiple decks in parallel
      const deckPromises = deckIds.map((deckId) =>
        this.db.getFlashcardsByDeck(deckId),
      );
      const deckResults = await Promise.all(deckPromises);
      return deckResults.flat();
    }
  }

  /**
   * Get review logs for charts filtered by deck IDs
   */
  async getReviewLogsForChart(deckIds: string[] = []): Promise<ReviewLog[]> {
    if (deckIds.length === 0) {
      return await this.db.getAllReviewLogs();
    } else if (deckIds.length === 1) {
      return await this.db.getReviewLogsByDeck(deckIds[0]);
    } else {
      return await this.db.getReviewLogsByDecks(deckIds);
    }
  }

  /**
   * Get today's statistics from daily stats
   */
  getTodayStats(statistics: Statistics | null): any {
    if (!statistics?.dailyStats || statistics.dailyStats.length === 0) {
      return null;
    }
    const today = new Date().toISOString().split("T")[0];
    return (
      statistics.dailyStats.find((day) => day.date === today) ||
      statistics.dailyStats[0] ||
      null
    );
  }

  /**
   * Get statistics for a specific timeframe (days back from today)
   */
  getTimeframeStats(
    statistics: Statistics | null,
    days: number,
  ): TimeframeStats {
    if (!statistics?.dailyStats) {
      return {
        reviews: 0,
        timeSpent: 0,
        newCards: 0,
        learningCards: 0,
        reviewCards: 0,
        correctRate: 0,
      };
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split("T")[0];

    const filteredStats = statistics.dailyStats.filter(
      (day) => day.date >= cutoffStr,
    );

    if (filteredStats.length === 0) {
      return {
        reviews: 0,
        timeSpent: 0,
        newCards: 0,
        learningCards: 0,
        reviewCards: 0,
        correctRate: 0,
      };
    }

    return filteredStats.reduce(
      (acc, day) => ({
        reviews: acc.reviews + day.reviews,
        timeSpent: acc.timeSpent + day.timeSpent,
        newCards: acc.newCards + day.newCards,
        learningCards: 0, // No learning cards in pure FSRS
        reviewCards: acc.reviewCards + day.reviewCards,
        correctRate:
          acc.reviews + day.reviews > 0
            ? (acc.correctRate * acc.reviews + day.correctRate * day.reviews) /
              (acc.reviews + day.reviews)
            : 0,
      }),
      {
        reviews: 0,
        timeSpent: 0,
        newCards: 0,
        learningCards: 0,
        reviewCards: 0,
        correctRate: 0,
      },
    );
  }

  /**
   * Calculate average ease from answer buttons
   */
  calculateAverageEase(statistics: Statistics | null): number {
    if (!statistics?.answerButtons) return 0;
    const { again, hard, good, easy } = statistics.answerButtons;
    const total = again + hard + good + easy;
    if (total === 0) return 0;
    // Map buttons to values: Again=1, Hard=2, Good=3, Easy=4
    const weightedSum = again * 1 + hard * 2 + good * 3 + easy * 4;
    return weightedSum / total;
  }

  /**
   * Calculate average interval from intervals data
   */
  calculateAverageInterval(statistics: Statistics | null): number {
    if (!statistics?.intervals || statistics.intervals.length === 0) {
      return 0;
    }

    let totalInterval = 0;
    let totalCards = 0;

    statistics.intervals.forEach((interval) => {
      const intervalStr = interval.interval;
      let minutes = 0;

      if (intervalStr.endsWith("h")) {
        minutes = parseInt(intervalStr) * 60;
      } else if (intervalStr.endsWith("d")) {
        minutes = parseInt(intervalStr) * 1440;
      } else if (intervalStr.endsWith("m")) {
        minutes = parseInt(intervalStr) * 43200; // months
      }

      totalInterval += minutes * interval.count;
      totalCards += interval.count;
    });

    if (totalCards === 0) return 0;
    const avgMinutes = totalInterval / totalCards;
    return Math.round(avgMinutes / 1440); // Convert back to days
  }

  /**
   * Get cards due today from forecast
   */
  getDueToday(statistics: Statistics | null): number {
    if (!statistics?.forecast || statistics.forecast.length === 0) return 0;
    const today = new Date().toISOString().split("T")[0];
    const todayForecast = statistics.forecast.find((day) => day.date === today);
    return todayForecast ? todayForecast.dueCount : 0;
  }

  /**
   * Get cards due tomorrow from forecast
   */
  getDueTomorrow(statistics: Statistics | null): number {
    if (!statistics?.forecast || statistics.forecast.length === 0) return 0;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];
    const tomorrowForecast = statistics.forecast.find(
      (day) => day.date === tomorrowStr,
    );
    return tomorrowForecast ? tomorrowForecast.dueCount : 0;
  }

  /**
   * Calculate maturity ratio (mature cards / total cards)
   */
  getMaturityRatio(statistics: Statistics | null): number {
    if (!statistics?.cardStats) return 0;
    const { new: newCards, review, mature } = statistics.cardStats;
    const total = newCards + (review || 0) + mature;
    if (total === 0) return 0;
    return (mature / total) * 100;
  }

  /**
   * Get total cards count
   */
  getTotalCards(statistics: Statistics | null): number {
    if (!statistics?.cardStats) return 0;
    const { new: newCards, review, mature } = statistics.cardStats;
    return newCards + (review || 0) + mature;
  }

  /**
   * Forecast future review load and backlog growth with FSRS simulation extension
   */
  async simulateFutureDueLoadForDeck(
    deckId: string,
    totalDays: number,
  ): Promise<BacklogForecastData[]> {
    const now = new Date();

    // UTC day boundaries
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const end = new Date(start.getTime() + totalDays * 86400000);
    const startMs = start.getTime();
    const endMs = end.getTime();

    // Precompute date keys
    const keys = this.buildDateKeys(startMs, totalDays);

    // Build DB schedule with index-friendly SQL
    const rows = await this.db.getScheduledDueByDay(
      deckId,
      start.toISOString(),
      end.toISOString(),
    );
    const sched = new Map<string, number>();
    for (const r of rows) sched.set(r.day, r.count | 0);

    // Get deck cards for FSRS extension
    const cards = await this.db.getFlashcardsByDeck(deckId);
    const reviewCards = cards.filter((card) => card.state === "review");

    // Get deck config for FSRS params
    const deck = await this.db.getDeckById(deckId);
    const deckConfig = deck?.config;

    // FSRS extension to simulate future demand
    const ext = await this.simulateFsrsDemand(
      reviewCards,
      startMs,
      endMs,
      deckConfig,
    );
    for (const [dayKey, c] of ext) {
      sched.set(dayKey, (sched.get(dayKey) || 0) + c);
    }

    // Compute capacity
    const dailyCap = await this.computeCapacity(
      deckId,
      start.toISOString(),
      30,
    );

    // Get initial backlog (overdue at start)
    let backlog = await this.db.getCurrentBacklog(deckId, start.toISOString());

    // Generate forecast
    const out: BacklogForecastData[] = [];
    for (let i = 0; i < totalDays; i++) {
      const due = sched.get(keys[i]) || 0;

      // Day-0 semantics: don't modify backlog on day 0
      if (i > 0) {
        backlog = Math.max(0, backlog + due - dailyCap);
      }

      out.push({
        date: keys[i],
        scheduledDue: due,
        projectedBacklog: backlog, // Keep as float, no rounding
      });
    }

    return out;
  }

  /**
   * Forecast future review load for multiple decks with optimized SQL aggregation
   */
  async simulateFutureDueLoad(
    deckIds: string[],
    totalDays: number,
  ): Promise<BacklogForecastData[]> {
    if (!deckIds || deckIds.length === 0) {
      return [];
    }

    // For single deck, delegate directly
    if (deckIds.length === 1) {
      return this.simulateFutureDueLoadForDeck(deckIds[0], totalDays);
    }

    const now = new Date();

    // UTC day boundaries
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const end = new Date(start.getTime() + totalDays * 86400000);
    const startMs = start.getTime();
    const endMs = end.getTime();

    // Precompute date keys
    const keys = this.buildDateKeys(startMs, totalDays);

    // Multi-deck SQL aggregation in one query
    const rows = await this.db.getScheduledDueByDayMulti(
      deckIds,
      start.toISOString(),
      end.toISOString(),
    );
    const sched = new Map<string, number>();
    for (const r of rows) sched.set(r.day, r.count | 0);

    // Get all cards from all decks for FSRS extension
    const allCards = [];
    const deckConfigs = new Map();
    for (const deckId of deckIds) {
      const cards = await this.db.getFlashcardsByDeck(deckId);
      const reviewCards = cards.filter((card) => card.state === "review");
      allCards.push(...reviewCards);

      const deck = await this.db.getDeckById(deckId);
      deckConfigs.set(deckId, deck?.config);
    }

    // FSRS extension using aggregated cards (use first deck's config for global params)
    const firstConfig = deckConfigs.values().next().value;
    const ext = await this.simulateFsrsDemand(
      allCards,
      startMs,
      endMs,
      firstConfig,
    );
    for (const [dayKey, c] of ext) {
      sched.set(dayKey, (sched.get(dayKey) || 0) + c);
    }

    // Compute total capacity across all decks
    let totalDailyCapacity = 0;
    for (const deckId of deckIds) {
      const capacity = await this.computeCapacity(
        deckId,
        start.toISOString(),
        30,
      );
      totalDailyCapacity += capacity;
    }

    // Get initial backlog across all decks in one query
    let backlog = await this.db.getCurrentBacklogMulti(
      deckIds,
      start.toISOString(),
    );

    // Generate forecast with global aggregation
    const out: BacklogForecastData[] = [];
    for (let i = 0; i < totalDays; i++) {
      const due = sched.get(keys[i]) || 0;

      // Day-0 semantics: don't modify backlog on day 0
      if (i > 0) {
        backlog = Math.max(0, backlog + due - totalDailyCapacity);
      }

      out.push({
        date: keys[i],
        scheduledDue: due,
        projectedBacklog: backlog, // Keep as float
      });
    }

    return out;
  }

  /**
   * Build precomputed date keys for performance
   */
  private buildDateKeys(startMs: number, totalDays: number): string[] {
    const keys: string[] = [];
    for (let i = 0; i < totalDays; i++) {
      const date = new Date(startMs + i * 86400000);
      keys.push(date.toISOString().slice(0, 10));
    }
    return keys;
  }

  /**
   * Compute daily capacity for a deck
   */
  private async computeCapacity(
    deckId: string,
    startStr: string,
    windowDays: number,
  ): Promise<number> {
    const deck = await this.db.getDeckById(deckId);
    const deckConfig = deck?.config;

    if (
      deckConfig?.hasReviewCardsLimitEnabled &&
      deckConfig.reviewCardsPerDay > 0
    ) {
      return deckConfig.reviewCardsPerDay;
    }

    // Fixed 30-day window ending at start
    const start = new Date(startStr);
    const windowStart = new Date(start.getTime() - windowDays * 86400000);
    const totalReviews = await this.db.getDeckReviewCountRange(
      deckId,
      windowStart.toISOString(),
      startStr,
    );

    return Math.max(0, totalReviews / windowDays);
  }

  /**
   * FSRS-driven simulation to extend daily due counts beyond stored due dates
   */
  private async simulateFsrsDemand(
    cards: any[],
    startMs: number,
    endMs: number,
    deckConfig: any,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    if (!cards || cards.length === 0) {
      return result;
    }

    // Get FSRS parameters from deck config or defaults
    const requestRetention = deckConfig?.fsrs?.requestRetention || 0.9;
    const profile = deckConfig?.fsrs?.profile || "STANDARD";
    const minMinutes = profile === "INTENSIVE" ? 1 : 1440;
    const maxDays = 36500;

    // Performance caps
    const maxEventsPerCard = 200;
    const maxEventsPerDayIntensive = 6;

    // Min-heap simulation using simple array (will be sorted by nextDue)
    interface SimNode {
      cardId: string;
      stability: number;
      difficulty: number;
      lastReview: number;
      nextDue: number;
      events: number;
    }

    const heap: SimNode[] = [];

    // Seed heap with cards
    for (const card of cards) {
      if (!card.dueDate || !card.stability || !card.difficulty) continue;

      const dueAt = new Date(card.dueDate).getTime();
      const lastReviewAt = card.lastReviewed
        ? new Date(card.lastReviewed).getTime()
        : dueAt - 86400000; // Default to 1 day before due

      heap.push({
        cardId: card.id,
        stability: card.stability,
        difficulty: Math.max(1, Math.min(10, card.difficulty)),
        lastReview: lastReviewAt,
        nextDue: Math.max(dueAt, startMs),
        events: 0,
      });
    }

    // Simulation loop
    const dailyEventCounts = new Map<string, number>();

    while (heap.length > 0) {
      // Sort heap by nextDue (simple approach)
      heap.sort((a, b) => a.nextDue - b.nextDue);

      const node = heap.shift()!;
      if (node.nextDue >= endMs || node.events >= maxEventsPerCard) {
        continue;
      }

      // Check intensive profile daily cap
      if (profile === "INTENSIVE") {
        const dayKey = new Date(node.nextDue).toISOString().slice(0, 10);
        const todayEvents = dailyEventCounts.get(dayKey) || 0;
        if (todayEvents >= maxEventsPerDayIntensive) {
          continue;
        }
        dailyEventCounts.set(dayKey, todayEvents + 1);
      }

      // Bucket the review
      const dayKey = new Date(node.nextDue).toISOString().slice(0, 10);
      result.set(dayKey, (result.get(dayKey) || 0) + 1);

      // Calculate next review (assume "Good" rating = 3)
      const elapsedDays = (node.nextDue - node.lastReview) / 86400000;
      const R = Math.pow(1 + elapsedDays / (9 * node.stability), -1);

      // Update difficulty (simplified FSRS formula for rating=3)
      const newDifficulty = Math.max(
        1,
        Math.min(10, node.difficulty - 0 * (3 - 3)), // w6 * (rating - 3), w6≈0 for good
      );

      // Update stability (simplified FSRS formula)
      const growthFactor =
        Math.exp(1) *
        (11 - newDifficulty) *
        Math.pow(node.stability, -0.1) *
        (Math.exp(0.2 * (1 - R)) - 1);
      const newStability = Math.max(0.1, node.stability * (1 + growthFactor));

      // Calculate next interval
      const k = Math.log(requestRetention) / Math.log(0.9);
      const intervalMinutes = Math.max(
        minMinutes,
        Math.min(maxDays * 1440, newStability * k * 1440),
      );

      // Push back to heap with updated values
      heap.push({
        cardId: node.cardId,
        stability: newStability,
        difficulty: newDifficulty,
        lastReview: node.nextDue,
        nextDue: node.nextDue + intervalMinutes * 60000,
        events: node.events + 1,
      });
    }

    return result;
  }

  /**
   * Create FSRS instance with deck-specific configuration
   */
  getFilteredForecastData(
    statistics: Statistics | null,
    maxDays: number,
    onlyNonZero: boolean = false,
  ): FutureDueData[] {
    if (!statistics?.forecast || statistics.forecast.length === 0) {
      return [];
    }

    const actualForecast = statistics.forecast.slice(
      0,
      Math.min(maxDays, statistics.forecast.length),
    );

    if (onlyNonZero) {
      return actualForecast.filter((day) => day.dueCount > 0).slice(0, maxDays);
    }

    return actualForecast;
  }

  /**
   * Calculate forecast statistics
   */
  calculateForecastStats(
    statistics: Statistics | null,
    flashcards: Flashcard[],
    timeframeDays: number,
  ) {
    if (!statistics?.forecast || statistics.forecast.length === 0) {
      return {
        totalReviews: 0,
        averagePerDay: 0,
        dueTomorrow: 0,
        dailyLoad: 0,
      };
    }

    const actualForecast = statistics.forecast.slice(0, timeframeDays);
    const totalReviews = actualForecast.reduce(
      (sum, day) => sum + day.dueCount,
      0,
    );
    const averagePerDay = totalReviews / Math.max(1, actualForecast.length);
    const dueTomorrow = this.getDueTomorrow(statistics);

    // Calculate average daily load over the period
    const nonZeroDays = actualForecast.filter((day) => day.dueCount > 0);
    const dailyLoad =
      nonZeroDays.length > 0
        ? nonZeroDays.reduce((sum, day) => sum + day.dueCount, 0) /
          nonZeroDays.length
        : 0;

    return {
      totalReviews: Math.round(totalReviews),
      averagePerDay: Math.round(averagePerDay * 10) / 10,
      dueTomorrow,
      dailyLoad: Math.round(dailyLoad * 10) / 10,
    };
  }

  /**
   * Get deck statistics with optional daily limit respect
   */
  async getDeckStats(
    deckId: string,
    respectDailyLimits: boolean = true,
  ): Promise<DeckStats> {
    const now = new Date().toISOString();

    // Get basic deck stats
    const totalCards = await this.db.countTotalCards(deckId);
    const newCards = await this.db.countNewCards(deckId, now);
    const dueCards = await this.db.countDueCards(deckId, now);
    console.log(dueCards);
    const matureCards = await this.db.getFlashcardsByDeck(deckId);
    const matureCount = matureCards.filter(
      (card) => card.state === "review" && card.interval > 30240,
    ).length;

    let finalNewCount = newCards;
    let finalDueCount = dueCards;

    // Apply daily limits if requested
    if (respectDailyLimits) {
      const deck = await this.db.getDeckById(deckId);
      if (deck) {
        const dailyCounts = await this.db.getDailyReviewCounts(deckId);

        // Apply new card limits
        if (
          deck.config.hasNewCardsLimitEnabled &&
          deck.config.newCardsPerDay >= 0
        ) {
          if (deck.config.newCardsPerDay === 0) {
            finalNewCount = 0;
          } else {
            const remainingNew = Math.max(
              0,
              deck.config.newCardsPerDay - dailyCounts.newCount,
            );
            finalNewCount = Math.min(newCards, remainingNew);
          }
        }

        // Apply review card limits
        if (
          deck.config.hasReviewCardsLimitEnabled &&
          deck.config.reviewCardsPerDay >= 0
        ) {
          if (deck.config.reviewCardsPerDay === 0) {
            finalDueCount = 0;
          } else {
            const remainingReview = Math.max(
              0,
              deck.config.reviewCardsPerDay - dailyCounts.reviewCount,
            );
            finalDueCount = Math.min(dueCards, remainingReview);
          }
        }
      }
    }

    return {
      deckId,
      newCount: finalNewCount,
      dueCount: finalDueCount,
      totalCount: totalCards,
      matureCount,
    };
  }

  /**
   * Get statistics for all decks
   */
  async getAllDeckStats(): Promise<DeckStats[]> {
    const decks = await this.db.getAllDecks();
    const stats = [];

    for (const deck of decks) {
      const deckStats = await this.getDeckStats(deck.id);
      stats.push(deckStats);
    }

    return stats;
  }

  /**
   * Get study statistics (total and past month hours)
   */
  async getStudyStats(): Promise<{
    totalHours: number;
    pastMonthHours: number;
  }> {
    const allLogs = await this.db.getAllReviewLogs();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    let totalMs = 0;
    let monthMs = 0;

    allLogs.forEach((log) => {
      const timeElapsed = log.timeElapsedMs || 0;
      totalMs += timeElapsed;

      const reviewDate = new Date(log.reviewedAt);
      if (reviewDate >= oneMonthAgo) {
        monthMs += timeElapsed;
      }
    });

    return {
      totalHours: totalMs / (1000 * 60 * 60),
      pastMonthHours: monthMs / (1000 * 60 * 60),
    };
  }
}
