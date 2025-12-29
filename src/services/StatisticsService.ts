import type { IDatabaseService } from "../database/DatabaseFactory";
import {
  type Statistics,
  type ReviewLog,
  type Flashcard,
  type FlashcardState,
  type DeckProfile,
  type DeckStats,
  DEFAULT_DECK_PROFILE,
  type SimulatedCardState,
  type MaturityProgressionResult,
} from "../database/types";
import type { DecksSettings } from "../settings";
import { FSRS, type RatingLabel } from "../algorithm/fsrs";
import { Logger } from "../utils/logging";
import { MinHeap } from "../utils/min-heap";
import {
  toLocalDateString,
  getLocalDateSQL,
  getLocalHourSQL,
} from "../utils/date-utils";
import { yieldToUI } from "../utils/ui";
import type {
  DailyStatsRow,
  AnswerButtonStatsRow,
  PaceStatsRow,
  ForecastRow,
  CountResult,
} from "../database/sql-types";

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
  private logger: Logger;

  constructor(db: IDatabaseService, settings: DecksSettings) {
    this.db = db;
    this.settings = settings;
    this.fsrs = new FSRS({ requestRetention: 0.9, profile: "STANDARD" });
    this.logger = new Logger(settings);
  }

  /**
   * Get overall statistics with deck and timeframe filters
   */
  async getOverallStatistics(
    deckIds: string[] = [],
    timeframe = "12months"
  ): Promise<Statistics> {
    try {
      // Calculate timeframe dates
      const now = new Date();
      const daysAgo =
        timeframe === "12months" ? 365 : timeframe === "3months" ? 90 : 30;
      const startDate = new Date(
        now.getTime() - daysAgo * 24 * 60 * 60 * 1000
      ).toISOString();
      const endDate = now.toISOString();

      this.logger.debug(
        `[StatisticsService] Querying stats for timeframe: ${timeframe} (${daysAgo} days), deckIds: ${deckIds.length > 0 ? deckIds.join(",") : "all"}`
      );

      // Get daily review stats with detailed breakdown
      const dailyStatsData = await this.getReviewsByDateDetailed(
        daysAgo,
        deckIds
      );

      // Get card stats (new, review, mature counts)
      const cardCounts = await this.getCardCountsByMaturity(deckIds);

      // Get answer button stats
      const answerButtonStats = await this.getAnswerButtonStatsForPeriod(
        startDate,
        endDate,
        deckIds
      );

      // Get interval distribution
      const intervalData = await this.getIntervalDistribution(deckIds);

      // Get pace stats
      const paceData = await this.getPaceStatsForPeriod(
        startDate,
        endDate,
        deckIds
      );

      // Get forecast data (next 30 days)
      const forecastData = await this.getForecastDueCards(30, deckIds);

      // Calculate retention rate from answer buttons
      const totalReviewsInPeriod =
        answerButtonStats.again +
        answerButtonStats.hard +
        answerButtonStats.good +
        answerButtonStats.easy;
      const correctReviews =
        answerButtonStats.hard +
        answerButtonStats.good +
        answerButtonStats.easy;
      const retentionRate =
        totalReviewsInPeriod > 0
          ? (correctReviews / totalReviewsInPeriod) * 100
          : 0;

      // Get total review count and time (all time, not just period)
      const allReviewLogs =
        deckIds.length > 0
          ? await this.getReviewLogsForChart(deckIds)
          : await this.db.getAllReviewLogs();
      const totalReviewsAllTime = allReviewLogs.length;
      const totalTimeMs = allReviewLogs.reduce(
        (sum: number, log: ReviewLog) => sum + (log.timeElapsedMs || 0),
        0
      );

      return {
        dailyStats: Array.from(dailyStatsData.entries()).map(
          ([date, stats]) => ({
            date,
            reviews: stats.count,
            timeSpent: stats.totalTimeSeconds,
            newCards: stats.newCards,
            learningCards: stats.learningCards,
            reviewCards: stats.reviewCards,
            correctRate: stats.correctRate,
          })
        ),
        cardStats: {
          new: cardCounts.new,
          review: cardCounts.young,
          mature: cardCounts.mature,
          total: cardCounts.new + cardCounts.young + cardCounts.mature,
        },
        reviewStats: {
          totalReviews: totalReviewsAllTime,
          totalTimeMs,
        },
        answerButtons: answerButtonStats,
        retentionRate,
        intervals: Array.from(intervalData.entries()).map(
          ([interval, count]) => ({
            interval,
            count,
          })
        ),
        forecast: forecastData,
        averagePace: paceData.averagePace,
        totalReviewTime: paceData.totalTime,
      };
    } catch (error) {
      this.logger.error("Failed to get overall statistics:", error);
      // Return empty stats on error
      return {
        dailyStats: [],
        cardStats: { new: 0, review: 0, mature: 0, total: 0 },
        reviewStats: { totalReviews: 0, totalTimeMs: 0 },
        answerButtons: { again: 0, hard: 0, good: 0, easy: 0 },
        retentionRate: 0,
        intervals: [],
        forecast: [],
        averagePace: 0,
        totalReviewTime: 0,
      };
    }
  }

  /**
   * Get detailed daily review statistics
   */
  private async getReviewsByDateDetailed(
    days: number,
    deckIds: string[] = []
  ): Promise<
    Map<
      string,
      {
        count: number;
        totalTimeSeconds: number;
        newCards: number;
        learningCards: number;
        reviewCards: number;
        correctRate: number;
      }
    >
  > {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          ${getLocalDateSQL("rl.reviewed_at")} as date,
          COUNT(*) as reviews,
          SUM(rl.time_elapsed_ms / 1000.0) as total_time_seconds,
          SUM(CASE WHEN rl.old_repetitions = 0 THEN 1 ELSE 0 END) as new_cards,
          SUM(CASE WHEN rl.old_repetitions > 0 AND rl.old_repetitions < 3 THEN 1 ELSE 0 END) as learning_cards,
          SUM(CASE WHEN rl.old_repetitions >= 3 THEN 1 ELSE 0 END) as review_cards,
          AVG(CASE WHEN rl.rating >= 3 THEN 1.0 ELSE 0.0 END) as correct_rate
        FROM review_logs rl
        WHERE rl.reviewed_at >= ?
        GROUP BY ${getLocalDateSQL("rl.reviewed_at")}
        ORDER BY date
      `;
      params = [startDate.toISOString()];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          ${getLocalDateSQL("rl.reviewed_at")} as date,
          COUNT(*) as reviews,
          SUM(rl.time_elapsed_ms / 1000.0) as total_time_seconds,
          SUM(CASE WHEN rl.old_repetitions = 0 THEN 1 ELSE 0 END) as new_cards,
          SUM(CASE WHEN rl.old_repetitions > 0 AND rl.old_repetitions < 3 THEN 1 ELSE 0 END) as learning_cards,
          SUM(CASE WHEN rl.old_repetitions >= 3 THEN 1 ELSE 0 END) as review_cards,
          AVG(CASE WHEN rl.rating >= 3 THEN 1.0 ELSE 0.0 END) as correct_rate
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${placeholders}) AND rl.reviewed_at >= ?
        GROUP BY ${getLocalDateSQL("rl.reviewed_at")}
        ORDER BY date
      `;
      params = [...deckIds, startDate.toISOString()];
    }

    const results = await this.db.querySql<DailyStatsRow>(sql, params, {
      asObject: true,
    });
    const stats = new Map();

    results.forEach((row) => {
      stats.set(row.date, {
        count: row.reviews || 0,
        totalTimeSeconds: row.total_time_seconds || 0,
        newCards: row.new_cards || 0,
        learningCards: row.learning_cards || 0,
        reviewCards: row.review_cards || 0,
        correctRate: (row.correct_rate || 0) * 100,
      });
    });

    return stats;
  }

  /**
   * Get answer button statistics for a time period
   */
  private async getAnswerButtonStatsForPeriod(
    startDate: string,
    endDate: string,
    deckIds: string[] = []
  ): Promise<{ again: number; hard: number; good: number; easy: number }> {
    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT rl.rating_label, COUNT(*) as count
        FROM review_logs rl
        WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ?
        GROUP BY rl.rating_label
      `;
      params = [startDate, endDate];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT rl.rating_label, COUNT(*) as count
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ? AND f.deck_id IN (${placeholders})
        GROUP BY rl.rating_label
      `;
      params = [startDate, endDate, ...deckIds];
    }

    const results = await this.db.querySql<AnswerButtonStatsRow>(sql, params, {
      asObject: true,
    });
    const answerButtons = { again: 0, hard: 0, good: 0, easy: 0 };

    results.forEach((row) => {
      if (row.rating_label === "again") answerButtons.again = row.count || 0;
      else if (row.rating_label === "hard") answerButtons.hard = row.count || 0;
      else if (row.rating_label === "good") answerButtons.good = row.count || 0;
      else if (row.rating_label === "easy") answerButtons.easy = row.count || 0;
    });

    return answerButtons;
  }

  /**
   * Get pace statistics (average time per review, total time)
   */
  private async getPaceStatsForPeriod(
    startDate: string,
    endDate: string,
    deckIds: string[] = []
  ): Promise<{ averagePace: number; totalTime: number }> {
    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          AVG(rl.time_elapsed_ms / 1000.0) as avg_pace,
          SUM(rl.time_elapsed_ms / 1000.0) as total_time
        FROM review_logs rl
        WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ?
          AND rl.time_elapsed_ms IS NOT NULL
          AND rl.time_elapsed_ms > 0
      `;
      params = [startDate, endDate];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          AVG(rl.time_elapsed_ms / 1000.0) as avg_pace,
          SUM(rl.time_elapsed_ms / 1000.0) as total_time
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE rl.reviewed_at >= ? AND rl.reviewed_at <= ?
          AND rl.time_elapsed_ms IS NOT NULL
          AND rl.time_elapsed_ms > 0
          AND f.deck_id IN (${placeholders})
      `;
      params = [startDate, endDate, ...deckIds];
    }

    const results = await this.db.querySql<PaceStatsRow>(sql, params, {
      asObject: true,
    });
    const firstRow = results[0];
    return {
      averagePace: firstRow?.avg_pace || 0,
      totalTime: firstRow?.total_time || 0,
    };
  }

  /**
   * Get forecast of due cards for upcoming days
   */
  private async getForecastDueCards(
    days: number,
    deckIds: string[] = []
  ): Promise<Array<{ date: string; dueCount: number; count: number }>> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const forecastEnd = new Date(
      todayStart.getTime() + days * 24 * 60 * 60 * 1000
    );

    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT ${getLocalDateSQL("due_date")} as date, COUNT(*) as due_count
        FROM flashcards
        WHERE due_date >= ? AND due_date <= ?
        GROUP BY ${getLocalDateSQL("due_date")}
        ORDER BY ${getLocalDateSQL("due_date")}
      `;
      params = [todayStart.toISOString(), forecastEnd.toISOString()];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT ${getLocalDateSQL("due_date")} as date, COUNT(*) as due_count
        FROM flashcards
        WHERE due_date >= ? AND due_date <= ? AND deck_id IN (${placeholders})
        GROUP BY ${getLocalDateSQL("due_date")}
        ORDER BY ${getLocalDateSQL("due_date")}
      `;
      params = [
        todayStart.toISOString(),
        forecastEnd.toISOString(),
        ...deckIds,
      ];
    }

    // Get overdue cards
    let overdueSql: string;
    let overdueParams: (string | number | null)[];

    if (deckIds.length === 0) {
      overdueSql = `SELECT COUNT(*) as count FROM flashcards WHERE due_date < ? AND state != 'new'`;
      overdueParams = [todayStart.toISOString()];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      overdueSql = `SELECT COUNT(*) as count FROM flashcards WHERE due_date < ? AND state != 'new' AND deck_id IN (${placeholders})`;
      overdueParams = [todayStart.toISOString(), ...deckIds];
    }

    const [results, overdueResults] = await Promise.all([
      this.db.querySql<ForecastRow>(sql, params, { asObject: true }),
      this.db.querySql<CountResult>(overdueSql, overdueParams, {
        asObject: true,
      }),
    ]);

    const overdueCount = overdueResults[0]?.count || 0;
    const forecast = results.map((row) => ({
      date: row.date,
      dueCount: row.due_count || 0,
      count: row.due_count || 0,
    }));

    // Add overdue cards to today's count
    if (overdueCount > 0) {
      const todayStr = toLocalDateString(todayStart);
      const todayForecast = forecast.find((f) => f.date === todayStr);
      if (todayForecast) {
        todayForecast.dueCount += overdueCount;
        todayForecast.count += overdueCount;
      } else {
        forecast.unshift({
          date: todayStr,
          dueCount: overdueCount,
          count: overdueCount,
        });
      }
    }

    return forecast;
  }

  /**
   * Get deck IDs for a given filter
   */
  getDeckIdsFromFilter(
    deckFilter: string,
    availableDecks: { id: string; name: string; tag: string }[] = []
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
    decks: { id: string; name: string; tag: string }[];
    tags: string[];
  }> {
    // console.log("[StatisticsService] Getting available decks and tags...");
    const decks = await this.db.getAllDecks();
    const tags = [...new Set(decks.map((deck) => deck.tag))];
    // console.log(
    //     `[StatisticsService] Found ${decks.length} decks and ${tags.length} unique tags`
    // );
    return { decks, tags };
  }

  /**
   * Get review count by date for heatmap - uses database aggregation
   */
  async getReviewCountsByDate(
    days: number,
    deckIds: string[] = []
  ): Promise<Map<string, number>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT ${getLocalDateSQL("reviewed_at")} as date, COUNT(*) as count
        FROM review_logs
        WHERE reviewed_at >= ?
        GROUP BY ${getLocalDateSQL("reviewed_at")}
      `;
      params = [startDate.toISOString()];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT ${getLocalDateSQL("rl.reviewed_at")} as date, COUNT(*) as count
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${placeholders}) AND rl.reviewed_at >= ?
        GROUP BY ${getLocalDateSQL("rl.reviewed_at")}
      `;
      params = [...deckIds, startDate.toISOString()];
    }

    const results = await this.db.querySql(sql, params);
    const counts: Map<string, number> = new Map<string, number>();

    results.forEach((row: (string | number | null)[]) => {
      const date = row[0] as string;
      const count = row[1] as number;
      counts.set(date, count);
    });

    return counts;
  }

  /**
   * Get card counts by maturity type - database aggregation
   */
  async getCardCountsByMaturity(deckIds: string[] = []): Promise<{
    new: number;
    young: number;
    mature: number;
  }> {
    const MATURITY_THRESHOLD = 30240; // 21 days in minutes

    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          state,
          CASE
            WHEN state = 'new' THEN 'new'
            WHEN interval <= ? THEN 'young'
            ELSE 'mature'
          END as maturity_type,
          COUNT(*) as count
        FROM flashcards
        GROUP BY maturity_type
      `;
      params = [MATURITY_THRESHOLD];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          state,
          CASE
            WHEN state = 'new' THEN 'new'
            WHEN interval <= ? THEN 'young'
            ELSE 'mature'
          END as maturity_type,
          COUNT(*) as count
        FROM flashcards
        WHERE deck_id IN (${placeholders})
        GROUP BY maturity_type
      `;
      params = [MATURITY_THRESHOLD, ...deckIds];
    }

    const results = await this.db.querySql(sql, params);
    const counts = { new: 0, young: 0, mature: 0 };

    results.forEach((row: (string | number | null)[]) => {
      const maturityType = row[1] as string;
      const count = row[2] as number;
      if (maturityType === "new") counts.new = count;
      else if (maturityType === "young") counts.young = count;
      else if (maturityType === "mature") counts.mature = count;
    });

    return counts;
  }

  /**
   * Get reviews grouped by date and rating - database aggregation
   */
  async getReviewsByDateAndRating(
    days: number,
    deckIds: string[] = []
  ): Promise<
    Map<string, { again: number; hard: number; good: number; easy: number }>
  > {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          ${getLocalDateSQL("reviewed_at")} as date,
          rating,
          COUNT(*) as count
        FROM review_logs
        WHERE reviewed_at >= ?
        GROUP BY ${getLocalDateSQL("reviewed_at")}, rating
      `;
      params = [startDate.toISOString()];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          ${getLocalDateSQL("rl.reviewed_at")} as date,
          rl.rating,
          COUNT(*) as count
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${placeholders}) AND rl.reviewed_at >= ?
        GROUP BY ${getLocalDateSQL("rl.reviewed_at")}, rl.rating
      `;
      params = [...deckIds, startDate.toISOString()];
    }

    const results = await this.db.querySql(sql, params);
    const dateGroups = new Map<
      string,
      { again: number; hard: number; good: number; easy: number }
    >();

    results.forEach((row: (string | number | null)[]) => {
      const date = row[0] as string;
      const rating = row[1] as number;
      const count = row[2] as number;

      if (!dateGroups.has(date)) {
        dateGroups.set(date, { again: 0, hard: 0, good: 0, easy: 0 });
      }

      const group = dateGroups.get(date)!;
      switch (rating) {
        case 1:
          group.again = count;
          break;
        case 2:
          group.hard = count;
          break;
        case 3:
          group.good = count;
          break;
        case 4:
          group.easy = count;
          break;
      }
    });

    return dateGroups;
  }

  /**
   * Get reviews grouped by hour of day - database aggregation
   */
  async getReviewsByHour(deckIds: string[] = []): Promise<Map<number, number>> {
    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          ${getLocalHourSQL("reviewed_at")} as hour,
          COUNT(*) as count
        FROM review_logs
        GROUP BY hour
      `;
      params = [];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          ${getLocalHourSQL("rl.reviewed_at")} as hour,
          COUNT(*) as count
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${placeholders})
        GROUP BY hour
      `;
      params = [...deckIds];
    }

    const results = await this.db.querySql(sql, params);
    const hourCounts = new Map<number, number>();

    results.forEach((row: (string | number | null)[]) => {
      const hour = row[0] as number;
      const count = row[1] as number;
      hourCounts.set(hour, count);
    });

    return hourCounts;
  }

  /**
   * Get success rates by hour - database aggregation
   * Returns percentage of reviews with rating >= 3 (Good/Easy) for each hour
   */
  async getSuccessRatesByHour(
    deckIds: string[] = []
  ): Promise<Map<number, number>> {
    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          ${getLocalHourSQL("reviewed_at")} as hour,
          COUNT(*) as total,
          SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) as passed
        FROM review_logs
        GROUP BY hour
      `;
      params = [];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          ${getLocalHourSQL("rl.reviewed_at")} as hour,
          COUNT(*) as total,
          SUM(CASE WHEN rl.rating >= 3 THEN 1 ELSE 0 END) as passed
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${placeholders})
        GROUP BY hour
      `;
      params = [...deckIds];
    }

    const results = await this.db.querySql(sql, params);
    const successRates = new Map<number, number>();

    results.forEach((row: (string | number | null)[]) => {
      const hour = row[0] as number;
      const total = row[1] as number;
      const passed = row[2] as number;
      const rate = total > 0 ? (passed / total) * 100 : 0;
      successRates.set(hour, rate);
    });

    return successRates;
  }

  /**
   * Get card stability distribution - database aggregation
   */
  async getStabilityDistribution(
    deckIds: string[] = []
  ): Promise<Map<string, number>> {
    // Stability buckets matching chart expectations: "0-1d", "1-3d", "3-7d", "1-2w", "2-4w", "1-3m", "3-6m", "6m-1y", "1y+"
    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          CASE
            WHEN stability < 1 THEN '0-1d'
            WHEN stability < 3 THEN '1-3d'
            WHEN stability < 7 THEN '3-7d'
            WHEN stability < 14 THEN '1-2w'
            WHEN stability < 30 THEN '2-4w'
            WHEN stability < 90 THEN '1-3m'
            WHEN stability < 180 THEN '3-6m'
            WHEN stability < 365 THEN '6m-1y'
            ELSE '1y+'
          END as bucket,
          COUNT(*) as count
        FROM flashcards
        WHERE state = 'review'
        GROUP BY bucket
        ORDER BY bucket
      `;
      params = [];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          CASE
            WHEN stability < 1 THEN '0-1d'
            WHEN stability < 3 THEN '1-3d'
            WHEN stability < 7 THEN '3-7d'
            WHEN stability < 14 THEN '1-2w'
            WHEN stability < 30 THEN '2-4w'
            WHEN stability < 90 THEN '1-3m'
            WHEN stability < 180 THEN '3-6m'
            WHEN stability < 365 THEN '6m-1y'
            ELSE '1y+'
          END as bucket,
          COUNT(*) as count
        FROM flashcards
        WHERE state = 'review' AND deck_id IN (${placeholders})
        GROUP BY bucket
        ORDER BY bucket
      `;
      params = [...deckIds];
    }

    const results = await this.db.querySql(sql, params);
    const distribution = new Map<string, number>();

    results.forEach((row: (string | number | null)[]) => {
      const bucket = row[0] as string;
      const count = row[1] as number;
      distribution.set(bucket, count);
    });

    return distribution;
  }

  /**
   * Get card difficulty distribution - database aggregation
   */
  async getDifficultyDistribution(
    deckIds: string[] = []
  ): Promise<Map<string, number>> {
    // Difficulty buckets matching chart expectations: percentage ranges "0-10%", "10-20%", etc.
    // FSRS difficulty is 1-10 scale, convert to percentages
    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          CASE
            WHEN difficulty < 1 THEN '0-10%'
            WHEN difficulty < 2 THEN '10-20%'
            WHEN difficulty < 3 THEN '20-30%'
            WHEN difficulty < 4 THEN '30-40%'
            WHEN difficulty < 5 THEN '40-50%'
            WHEN difficulty < 6 THEN '50-60%'
            WHEN difficulty < 7 THEN '60-70%'
            WHEN difficulty < 8 THEN '70-80%'
            WHEN difficulty < 9 THEN '80-90%'
            ELSE '90-100%'
          END as bucket,
          COUNT(*) as count
        FROM flashcards
        WHERE state = 'review'
        GROUP BY bucket
        ORDER BY bucket
      `;
      params = [];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          CASE
            WHEN difficulty < 1 THEN '0-10%'
            WHEN difficulty < 2 THEN '10-20%'
            WHEN difficulty < 3 THEN '20-30%'
            WHEN difficulty < 4 THEN '30-40%'
            WHEN difficulty < 5 THEN '40-50%'
            WHEN difficulty < 6 THEN '50-60%'
            WHEN difficulty < 7 THEN '60-70%'
            WHEN difficulty < 8 THEN '70-80%'
            WHEN difficulty < 9 THEN '80-90%'
            ELSE '90-100%'
          END as bucket,
          COUNT(*) as count
        FROM flashcards
        WHERE state = 'review' AND deck_id IN (${placeholders})
        GROUP BY bucket
        ORDER BY bucket
      `;
      params = [...deckIds];
    }

    const results = await this.db.querySql(sql, params);
    const distribution = new Map<string, number>();

    results.forEach((row: (string | number | null)[]) => {
      const bucket = row[0] as string;
      const count = row[1] as number;
      distribution.set(bucket, count);
    });

    return distribution;
  }

  /**
   * Get card interval distribution - database aggregation
   */
  async getIntervalDistribution(
    deckIds: string[] = []
  ): Promise<Map<string, number>> {
    // Interval buckets matching chart expectations: "1d", "2-3d", "4-7d", "1-2w", "2-3w", "1-2m", "2-4m", "4-6m", "6m-1y", "1y+"
    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          CASE
            WHEN interval <= 1440 THEN '1d'
            WHEN interval <= 4320 THEN '2-3d'
            WHEN interval <= 10080 THEN '4-7d'
            WHEN interval <= 20160 THEN '1-2w'
            WHEN interval <= 30240 THEN '2-3w'
            WHEN interval <= 86400 THEN '1-2m'
            WHEN interval <= 172800 THEN '2-4m'
            WHEN interval <= 259200 THEN '4-6m'
            WHEN interval <= 525600 THEN '6m-1y'
            ELSE '1y+'
          END as bucket,
          COUNT(*) as count
        FROM flashcards
        WHERE state != 'new'
        GROUP BY bucket
        ORDER BY bucket
      `;
      params = [];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          CASE
            WHEN interval <= 1440 THEN '1d'
            WHEN interval <= 4320 THEN '2-3d'
            WHEN interval <= 10080 THEN '4-7d'
            WHEN interval <= 20160 THEN '1-2w'
            WHEN interval <= 30240 THEN '2-3w'
            WHEN interval <= 86400 THEN '1-2m'
            WHEN interval <= 172800 THEN '2-4m'
            WHEN interval <= 259200 THEN '4-6m'
            WHEN interval <= 525600 THEN '6m-1y'
            ELSE '1y+'
          END as bucket,
          COUNT(*) as count
        FROM flashcards
        WHERE deck_id IN (${placeholders})
          AND state != 'new'
        GROUP BY bucket
        ORDER BY bucket
      `;
      params = [...deckIds];
    }

    const results = await this.db.querySql(sql, params);
    const distribution = new Map<string, number>();

    results.forEach((row: (string | number | null)[]) => {
      const bucket = row[0] as string;
      const count = row[1] as number;
      distribution.set(bucket, count);
    });

    return distribution;
  }

  /**
   * Get cards added by date - database aggregation
   */
  async getCardsAddedByDate(
    days: number,
    deckIds: string[] = []
  ): Promise<Map<string, number>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          ${getLocalDateSQL("created")} as date,
          COUNT(*) as count
        FROM flashcards
        WHERE created >= ?
        GROUP BY ${getLocalDateSQL("created")}
      `;
      params = [startDate.toISOString()];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          ${getLocalDateSQL("created")} as date,
          COUNT(*) as count
        FROM flashcards
        WHERE deck_id IN (${placeholders}) AND created >= ?
        GROUP BY ${getLocalDateSQL("created")}
      `;
      params = [...deckIds, startDate.toISOString()];
    }

    const results = await this.db.querySql(sql, params);
    const counts = new Map<string, number>();

    results.forEach((row: (string | number | null)[]) => {
      const date = row[0] as string;
      const count = row[1] as number;
      counts.set(date, count);
    });

    return counts;
  }

  /**
   * Get retrievability distribution - database aggregation
   */
  async getRetrievabilityDistribution(
    deckIds: string[] = []
  ): Promise<Map<string, number>> {
    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          CASE
            WHEN retrievability < 0.1 THEN '0-10%'
            WHEN retrievability < 0.2 THEN '10-20%'
            WHEN retrievability < 0.3 THEN '20-30%'
            WHEN retrievability < 0.4 THEN '30-40%'
            WHEN retrievability < 0.5 THEN '40-50%'
            WHEN retrievability < 0.6 THEN '50-60%'
            WHEN retrievability < 0.7 THEN '60-70%'
            WHEN retrievability < 0.8 THEN '70-80%'
            WHEN retrievability < 0.9 THEN '80-90%'
            ELSE '90-100%'
          END as bucket,
          COUNT(*) as count
        FROM review_logs
        WHERE retrievability IS NOT NULL AND retrievability >= 0
        GROUP BY bucket
      `;
      params = [];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          CASE
            WHEN rl.retrievability < 0.1 THEN '0-10%'
            WHEN rl.retrievability < 0.2 THEN '10-20%'
            WHEN rl.retrievability < 0.3 THEN '20-30%'
            WHEN rl.retrievability < 0.4 THEN '30-40%'
            WHEN rl.retrievability < 0.5 THEN '40-50%'
            WHEN rl.retrievability < 0.6 THEN '50-60%'
            WHEN rl.retrievability < 0.7 THEN '60-70%'
            WHEN rl.retrievability < 0.8 THEN '70-80%'
            WHEN rl.retrievability < 0.9 THEN '80-90%'
            ELSE '90-100%'
          END as bucket,
          COUNT(*) as count
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${placeholders})
          AND rl.retrievability IS NOT NULL AND rl.retrievability >= 0
        GROUP BY bucket
      `;
      params = [...deckIds];
    }

    const results = await this.db.querySql(sql, params);
    const distribution = new Map<string, number>();

    results.forEach((row: (string | number | null)[]) => {
      const bucket = row[0] as string;
      const count = row[1] as number;
      distribution.set(bucket, count);
    });

    return distribution;
  }

  /**
   * Get true retention statistics - database aggregation
   */
  async getTrueRetentionStats(deckIds: string[] = []): Promise<{
    young: { passed: number; total: number; rate: number };
    mature: { passed: number; total: number; rate: number };
    all: { passed: number; total: number; rate: number };
  }> {
    const MATURITY_THRESHOLD = 30240; // 21 days in minutes
    const MIN_INTERVAL = 1440; // 1 day in minutes

    let sql: string;
    let params: (string | number | null)[];

    if (deckIds.length === 0) {
      sql = `
        SELECT
          CASE
            WHEN COALESCE(old_interval_minutes, new_interval_minutes) <= ? THEN 'young'
            ELSE 'mature'
          END as maturity_type,
          COUNT(*) as total,
          SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) as passed
        FROM review_logs
        WHERE (old_interval_minutes > ? OR (old_state = 'new' AND new_state = 'review' AND new_interval_minutes > ?))
        GROUP BY maturity_type
      `;
      params = [MATURITY_THRESHOLD, MIN_INTERVAL, MIN_INTERVAL];
    } else {
      const placeholders = deckIds.map(() => "?").join(",");
      sql = `
        SELECT
          CASE
            WHEN COALESCE(rl.old_interval_minutes, rl.new_interval_minutes) <= ? THEN 'young'
            ELSE 'mature'
          END as maturity_type,
          COUNT(*) as total,
          SUM(CASE WHEN rl.rating >= 3 THEN 1 ELSE 0 END) as passed
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${placeholders})
          AND (rl.old_interval_minutes > ? OR (rl.old_state = 'new' AND rl.new_state = 'review' AND rl.new_interval_minutes > ?))
        GROUP BY maturity_type
      `;
      params = [MATURITY_THRESHOLD, ...deckIds, MIN_INTERVAL, MIN_INTERVAL];
    }

    const results = await this.db.querySql(sql, params);

    const stats = {
      young: { passed: 0, total: 0, rate: 0 },
      mature: { passed: 0, total: 0, rate: 0 },
      all: { passed: 0, total: 0, rate: 0 },
    };

    let allPassed = 0;
    let allTotal = 0;

    results.forEach((row: (string | number | null)[]) => {
      const maturityType = row[0] as string;
      const total = row[1] as number;
      const passed = row[2] as number;
      const rate = total > 0 ? (passed / total) * 100 : 0;

      if (maturityType === "young") {
        stats.young = { passed, total, rate };
      } else if (maturityType === "mature") {
        stats.mature = { passed, total, rate };
      }

      allPassed += passed;
      allTotal += total;
    });

    stats.all = {
      passed: allPassed,
      total: allTotal,
      rate: allTotal > 0 ? (allPassed / allTotal) * 100 : 0,
    };

    return stats;
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
        this.db.getFlashcardsByDeck(deckId)
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
  getTodayStats(statistics: Statistics | null): {
    date: string;
    reviews: number;
    timeSpent: number;
    newCards: number;
    learningCards: number;
    reviewCards: number;
    correctRate: number;
  } | null {
    if (!statistics?.dailyStats || statistics.dailyStats.length === 0) {
      return null;
    }
    const today = toLocalDateString(new Date());
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
    days: number
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
    const cutoffStr = toLocalDateString(cutoffDate);

    const filteredStats = statistics.dailyStats.filter(
      (day) => day.date >= cutoffStr
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
      }
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
   *
   * NOTE: This method parses bucket labels from getIntervalDistribution() which returns
   * strings like "1d", "2-3d", "1-2w", "1-2m", "6m-1y", "1y+", etc.
   * For multi-value buckets (e.g., "2-3d"), we use the midpoint for averaging.
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

      // Parse bucket labels to extract midpoint values
      // Examples: "1d" -> 1 day, "2-3d" -> 2.5 days, "1-2m" -> 1.5 months
      if (intervalStr === "1y+") {
        minutes = 525600; // 1 year in minutes
      } else if (intervalStr.includes("-")) {
        // Range bucket like "2-3d", "1-2w", "1-2m", "6m-1y"
        const [start, endWithUnit] = intervalStr.split("-");
        const startNum = parseInt(start);
        const endNum = parseInt(endWithUnit);
        const unit = endWithUnit.slice(-1);

        const midpoint = (startNum + endNum) / 2;

        if (unit === "d") {
          minutes = midpoint * 1440;
        } else if (unit === "w") {
          minutes = midpoint * 10080; // weeks to minutes
        } else if (unit === "m") {
          minutes = midpoint * 43200; // months (30 days) to minutes
        } else if (unit === "y") {
          minutes = midpoint * 525600; // years to minutes
        }
      } else {
        // Single value bucket like "1d"
        const num = parseInt(intervalStr);
        const unit = intervalStr.slice(-1);

        if (unit === "h") {
          minutes = num * 60;
        } else if (unit === "d") {
          minutes = num * 1440;
        } else if (unit === "w") {
          minutes = num * 10080;
        } else if (unit === "m") {
          minutes = num * 43200; // months (30 days)
        } else if (unit === "y") {
          minutes = num * 525600;
        }
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
    const today = toLocalDateString(new Date());
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
    const tomorrowStr = toLocalDateString(tomorrow);
    const tomorrowForecast = statistics.forecast.find(
      (day) => day.date === tomorrowStr
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
    totalDays: number
  ): Promise<BacklogForecastData[]> {
    const now = new Date();

    // UTC day boundaries
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
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
      end.toISOString()
    );
    const sched = new Map<string, number>();
    for (const r of rows) sched.set(r.day, r.count | 0);

    // Get deck cards for FSRS extension
    const cards = await this.db.getFlashcardsByDeck(deckId);
    const reviewCards = cards.filter((card) => card.state === "review");

    // Get deck config for FSRS params
    const deck = await this.db.getDeckWithProfile(deckId);
    const deckConfig = deck?.profile ?? DEFAULT_DECK_PROFILE;

    // FSRS extension to simulate future demand
    const ext = await this.simulateFsrsDemand(
      reviewCards,
      startMs,
      endMs,
      deckConfig
    );
    for (const [dayKey, c] of ext) {
      sched.set(dayKey, (sched.get(dayKey) || 0) + c);
    }

    // Compute capacity
    const dailyCap = await this.computeCapacity(
      deckId,
      start.toISOString(),
      30
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
   * Extract empirical performance profile from user's review history
   * Analyzes last 1000 review logs to determine:
   * - Button distribution (Again/Hard/Good/Easy percentages)
   * - Stability growth ratios by rating (for validation only - FSRS class handles actual calculations)
   */
  private async calculateEmpiricalPerformanceProfile(
    deckIds: string[]
  ): Promise<{
    buttonDistribution: {
      again: number;
      hard: number;
      good: number;
      easy: number;
    };
    stabilityGrowthByRating: {
      1: number;
      2: number;
      3: number;
      4: number;
    };
    sampleSize: number;
    hasSufficientData: boolean;
  }> {
    const SAMPLE_SIZE = 1000;
    const MIN_SAMPLE_SIZE = 50;

    // Sort deckIds for deterministic query results
    const sortedDeckIds = [...deckIds].sort();

    // Query last 1000 review logs with stability data
    let sql: string;
    let params: (string | number | null)[];

    if (sortedDeckIds.length === 0) {
      sql = `
        SELECT
          rating,
          old_stability,
          new_stability
        FROM review_logs
        WHERE old_stability > 0
          AND new_stability > 0
          AND old_stability IS NOT NULL
          AND new_stability IS NOT NULL
        ORDER BY reviewed_at DESC
        LIMIT ?
      `;
      params = [SAMPLE_SIZE];
    } else {
      const placeholders = sortedDeckIds.map(() => "?").join(",");
      sql = `
        SELECT
          rl.rating,
          rl.old_stability,
          rl.new_stability
        FROM review_logs rl
        JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${placeholders})
          AND rl.old_stability > 0
          AND rl.new_stability > 0
          AND rl.old_stability IS NOT NULL
          AND rl.new_stability IS NOT NULL
        ORDER BY rl.reviewed_at DESC, rl.flashcard_id ASC
        LIMIT ?
      `;
      params = [...sortedDeckIds, SAMPLE_SIZE];
    }

    const results = await this.db.querySql(sql, params);

    // Default fallback for users with little data
    const defaultProfile = {
      buttonDistribution: {
        again: 0.05,
        hard: 0.1,
        good: 0.75,
        easy: 0.1,
      },
      stabilityGrowthByRating: {
        1: 0.5, // Forgetting - stability drops ~50%
        2: 1.2, // Hard - modest growth
        3: 1.6, // Good - typical growth
        4: 2.2, // Easy - strong growth
      },
      sampleSize: 0,
      hasSufficientData: false,
    };

    if (results.length < MIN_SAMPLE_SIZE) {
      this.logger.debug(
        `[StatisticsService] Insufficient review data (${results.length} reviews), using default performance profile`
      );
      return defaultProfile;
    }

    // Calculate button distribution
    const buttonCounts: { [key: number]: number } = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const stabilityRatios: { [key: number]: number[] } = {
      1: [],
      2: [],
      3: [],
      4: [],
    };

    results.forEach((row: (string | number | null)[]) => {
      const rating = row[0] as number;
      const oldStability = row[1] as number;
      const newStability = row[2] as number;

      if (rating >= 1 && rating <= 4) {
        buttonCounts[rating]++;

        // Calculate stability ratio
        if (
          oldStability > 0 &&
          newStability > 0 &&
          isFinite(newStability / oldStability)
        ) {
          const ratio = newStability / oldStability;
          // Filter outliers (ratio between 0.1 and 10.0)
          if (ratio >= 0.1 && ratio <= 10.0) {
            stabilityRatios[rating].push(ratio);
          }
        }
      }
    });

    const totalReviews = results.length;

    // Calculate percentages
    const buttonDistribution = {
      again: buttonCounts[1] / totalReviews,
      hard: buttonCounts[2] / totalReviews,
      good: buttonCounts[3] / totalReviews,
      easy: buttonCounts[4] / totalReviews,
    };

    // Calculate average stability growth by rating
    const stabilityGrowthByRating = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
    };
    for (const rating of [1, 2, 3, 4] as const) {
      const ratios = stabilityRatios[rating];
      if (ratios.length >= 5) {
        const average = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
        stabilityGrowthByRating[rating] = average;
      } else {
        // Fallback to defaults
        stabilityGrowthByRating[rating] =
          defaultProfile.stabilityGrowthByRating[rating];
      }
    }

    this.logger.debug(
      `[StatisticsService] Calculated empirical performance profile from ${totalReviews} reviews:`,
      { buttonDistribution, stabilityGrowthByRating }
    );

    return {
      buttonDistribution,
      stabilityGrowthByRating,
      sampleSize: totalReviews,
      hasSufficientData: true,
    };
  }

  /**
   * Simulate maturity progression using high-fidelity FSRS-based simulation
   * - Uses empirical button distribution from review history
   * - Respects daily limits (newCardsPerDay, reviewCardsPerDay)
   * - Delegates all FSRS calculations to FSRS class (perfect algorithm fidelity)
   * - Defines maturity by stability (S >= 21 days), not interval
   */
  async simulateMaturityProgression(
    deckIds: string[],
    maxDays = 365
  ): Promise<MaturityProgressionResult> {
    // Reset rating counter for deterministic results
    this.ratingCounter = 0;

    const MATURITY_THRESHOLD_DAYS = 21; // Stability threshold (not interval)

    if (!deckIds || deckIds.length === 0) {
      return {
        dailySnapshots: [],
        maintenanceLevel: null,
        equilibriumDetectedAt: null,
        totalCards: 0,
        empiricalLapseRate: 0,
        theoreticalMaintenanceLevel: null,
      };
    }

    // Yield immediately to allow UI to show loading state
    await yieldToUI();

    // Get all flashcards for the selected decks
    const allCards = [];
    for (const deckId of deckIds) {
      const cards = await this.db.getFlashcardsByDeck(deckId);
      allCards.push(...cards);
    }

    // Sort by card ID to ensure deterministic order
    allCards.sort((a, b) => a.id.localeCompare(b.id));

    if (allCards.length === 0) {
      return {
        dailySnapshots: [],
        maintenanceLevel: null,
        equilibriumDetectedAt: null,
        totalCards: 0,
        empiricalLapseRate: 0,
        theoreticalMaintenanceLevel: null,
      };
    }

    // Yield after database queries complete
    await yieldToUI();

    // Get deck configs for daily limits and FSRS settings
    let totalNewCardsPerDay = 0;
    let totalReviewCardsPerDay = 0;
    let avgRequestRetention = 0;
    let deckCount = 0;

    for (const deckId of deckIds) {
      const deck = await this.db.getDeckWithProfile(deckId);
      if (deck) {
        const config = deck.profile || DEFAULT_DECK_PROFILE;

        // Aggregate daily limits
        if (config.hasNewCardsLimitEnabled && config.newCardsPerDay > 0) {
          totalNewCardsPerDay += config.newCardsPerDay;
        } else {
          totalNewCardsPerDay = Infinity; // Unlimited
        }

        if (config.hasReviewCardsLimitEnabled && config.reviewCardsPerDay > 0) {
          totalReviewCardsPerDay += config.reviewCardsPerDay;
        } else {
          totalReviewCardsPerDay = Infinity; // Unlimited
        }

        avgRequestRetention += config.fsrs.requestRetention || 0.9;
        deckCount++;
      }
    }

    const requestRetention =
      deckCount > 0
        ? Math.round((avgRequestRetention / deckCount) * 10000) / 10000
        : 0.9;

    // If limits are infinite, infer realistic limits from review history
    if (
      totalNewCardsPerDay === Infinity ||
      totalReviewCardsPerDay === Infinity
    ) {
      // Query review history to calculate average reviews per day
      // Join with flashcards to filter by deck_id
      const sql = `
        SELECT COUNT(*) as total_reviews,
               MIN(DATE(rl.reviewed_at)) as first_review,
               MAX(DATE(rl.reviewed_at)) as last_review
        FROM review_logs rl
        INNER JOIN flashcards f ON rl.flashcard_id = f.id
        WHERE f.deck_id IN (${deckIds.map(() => "?").join(",")})
      `;

      const results = await this.db.querySql<{
        total_reviews: number;
        first_review: string | null;
        last_review: string | null;
      }>(sql, deckIds, { asObject: true });

      if (
        results.length > 0 &&
        results[0].first_review &&
        results[0].last_review
      ) {
        const totalReviews = results[0].total_reviews;
        const firstDate = new Date(results[0].first_review);
        const lastDate = new Date(results[0].last_review);
        const daysDiff = Math.max(
          1,
          (lastDate.getTime() - firstDate.getTime()) / 86400000
        );
        const avgReviewsPerDay = Math.round(totalReviews / daysDiff);

        // Only use inferred limits if there's meaningful review history (at least 7 days)
        if (daysDiff >= 7 && avgReviewsPerDay > 0) {
          // Use total historical pace as daily review pool (no arbitrary split)
          const dailyReviewPool = avgReviewsPerDay;

          // If deck limits are enabled and lower, respect them
          if (totalNewCardsPerDay === Infinity) {
            totalNewCardsPerDay = dailyReviewPool; // Can process up to full pool as new cards
          }
          if (totalReviewCardsPerDay === Infinity) {
            totalReviewCardsPerDay = dailyReviewPool; // Can process up to full pool as reviews
          }

          this.logger.debug(
            "[StatisticsService] Using historical daily pace as review pool:",
            {
              dailyReviewPool,
              avgReviewsPerDay,
              daysDiff,
              totalReviews,
            }
          );
        } else {
          // No meaningful review history - use conservative defaults to show realistic forecast
          // Default to 20 new cards/day and 200 review cards/day (typical user behavior)
          if (totalNewCardsPerDay === Infinity) {
            totalNewCardsPerDay = 20;
          }
          if (totalReviewCardsPerDay === Infinity) {
            totalReviewCardsPerDay = 200;
          }

          this.logger.debug(
            "[StatisticsService] No review history, using default limits:",
            {
              totalNewCardsPerDay,
              totalReviewCardsPerDay,
            }
          );
        }
      } else {
        // No review history at all - use conservative defaults
        if (totalNewCardsPerDay === Infinity) {
          totalNewCardsPerDay = 20;
        }
        if (totalReviewCardsPerDay === Infinity) {
          totalReviewCardsPerDay = 200;
        }

        this.logger.debug(
          "[StatisticsService] No review history, using default limits:",
          {
            totalNewCardsPerDay,
            totalReviewCardsPerDay,
          }
        );
      }
    }

    // Calculate empirical performance profile
    const performanceProfile =
      await this.calculateEmpiricalPerformanceProfile(deckIds);

    // Yield after profile calculation
    await yieldToUI();

    // Get total cards and empirical lapse rate
    const totalCards = allCards.length;
    const empiricalLapseRate = performanceProfile.buttonDistribution.again;

    // Get nextDayStartsAt from settings
    const nextDayStartsAt = this.settings.review.nextDayStartsAt || 4;

    const now = new Date();
    const nowMs = now.getTime();

    const cardStates: SimulatedCardState[] = allCards.map((card) => {
      const dueMs = new Date(card.dueDate).getTime();
      const lastReviewedMs = card.lastReviewed
        ? new Date(card.lastReviewed).getTime()
        : dueMs - 86400000; // Default to 1 day before due if never reviewed

      return {
        id: card.id,
        deckId: card.deckId,
        state: card.state,
        stability: card.stability || 1,
        difficulty: card.difficulty || 5,
        dueDate: dueMs,
        lastReviewedDate: lastReviewedMs,
        repetitions: card.repetitions || 0,
        lapses: card.lapses || 0,
      };
    });

    const result: Array<{
      date: string;
      newCards: number;
      learningCards: number;
      matureCards: number;
    }> = [];

    // Track consecutive days without activity to detect true completion
    let consecutiveDaysWithoutActivity = 0;
    const MAX_IDLE_DAYS = 7;

    // Equilibrium detection variables
    const EQUILIBRIUM_WINDOW_DAYS = 14; // Rolling window for variance check
    const EQUILIBRIUM_VARIANCE_THRESHOLD = 0.01; // 1% of total cards
    let equilibriumDetected = false;
    let equilibriumDay: number | null = null;
    let equilibriumMaintenanceLevel: number | null = null;
    const learningCountWindow: number[] = []; // Sliding window of last 14 days' learning counts
    let consecutiveDaysStable = 0; // Count of days variance is below threshold

    // Create FSRS instance (use first deck's config or average settings)
    const firstDeck = await this.db.getDeckWithProfile(deckIds[0]);
    const firstConfig = firstDeck?.profile || DEFAULT_DECK_PROFILE;

    const fsrs = new FSRS({
      requestRetention,
      profile: firstConfig.fsrs.profile || "STANDARD",
      nextDayStartsAt,
    });

    // Yield before starting the main simulation loop
    await yieldToUI();

    // For each day in the future, simulate reviews
    for (let day = 0; day < maxDays; day++) {
      const currentDayMs = nowMs + day * 86400000;
      const currentDate = new Date(currentDayMs);
      const dateKey = toLocalDateString(currentDate);

      // Separate new cards from review cards
      const newCardsDue = cardStates.filter(
        (card) => card.state === "new" && card.dueDate <= currentDayMs
      );
      const reviewCardsDue = cardStates.filter(
        (card) => card.state === "review" && card.dueDate <= currentDayMs
      );

      // Sort by due date (earliest first) with card ID as stable tiebreaker
      newCardsDue.sort((a, b) => {
        const dateDiff = a.dueDate - b.dueDate;
        return dateDiff !== 0 ? dateDiff : a.id.localeCompare(b.id);
      });
      reviewCardsDue.sort((a, b) => {
        const dateDiff = a.dueDate - b.dueDate;
        return dateDiff !== 0 ? dateDiff : a.id.localeCompare(b.id);
      });

      // Calculate daily capacity
      let remainingCapacity = totalReviewCardsPerDay; // This is now dailyReviewPool from Fix 5

      // Priority 1: Process due review cards (sorted by earliest due first)
      const reviewCardsToProcess =
        remainingCapacity === Infinity
          ? reviewCardsDue
          : reviewCardsDue.slice(
              0,
              Math.min(reviewCardsDue.length, remainingCapacity)
            );

      // Deduct processed reviews from capacity
      if (remainingCapacity !== Infinity) {
        remainingCapacity -= reviewCardsToProcess.length;
      }

      // Priority 2: Process new cards with remaining capacity
      const newCardsToProcess =
        remainingCapacity === Infinity || totalNewCardsPerDay === Infinity
          ? newCardsDue.slice(
              0,
              Math.min(
                newCardsDue.length,
                totalNewCardsPerDay === Infinity
                  ? Infinity
                  : totalNewCardsPerDay
              )
            )
          : newCardsDue.slice(
              0,
              Math.min(
                newCardsDue.length,
                Math.min(remainingCapacity, totalNewCardsPerDay)
              )
            );

      let processedCards = 0;

      // Process review cards FIRST (priority)
      for (const cardState of reviewCardsToProcess) {
        processedCards++;

        // Simulate a rating based on empirical distribution
        const ratingNum = this.selectRatingFromDistribution(
          performanceProfile.buttonDistribution
        );
        const ratingLabel = this.ratingNumberToLabel(ratingNum);

        // Convert SimulatedCardState to Flashcard-like object for FSRS
        const cardAsFlashcard: Partial<Flashcard> = {
          id: cardState.id,
          deckId: cardState.deckId,
          state: "review" as FlashcardState,
          stability: cardState.stability,
          difficulty: cardState.difficulty,
          repetitions: cardState.repetitions,
          lapses: cardState.lapses,
          lastReviewed: new Date(cardState.lastReviewedDate).toISOString(),
          dueDate: new Date(cardState.dueDate).toISOString(),
          interval: 0,
          // Other fields not used by FSRS
          front: "",
          back: "",
          created: "",
          modified: "",
        };

        // Use FSRS to calculate the outcome for this rating
        const schedulingInfo = fsrs.getSchedulingInfo(
          cardAsFlashcard as Flashcard,
          currentDate
        );
        const outcome = schedulingInfo[ratingLabel];

        // Update card state from FSRS outcome
        cardState.stability = outcome.stability;
        cardState.difficulty = outcome.difficulty;
        cardState.repetitions = outcome.repetitions;
        cardState.dueDate = new Date(outcome.dueDate).getTime();
        cardState.lastReviewedDate = currentDayMs;

        if (ratingNum === 1) {
          cardState.lapses++;
        }
      }

      // Process new cards SECOND (with remaining capacity)
      for (const cardState of newCardsToProcess) {
        processedCards++;

        // Simulate a rating based on empirical distribution
        const ratingNum = this.selectRatingFromDistribution(
          performanceProfile.buttonDistribution
        );
        const ratingLabel = this.ratingNumberToLabel(ratingNum);

        // Convert SimulatedCardState to Flashcard-like object for FSRS
        const cardAsFlashcard: Partial<Flashcard> = {
          id: cardState.id,
          deckId: cardState.deckId,
          state: "new" as FlashcardState,
          stability: cardState.stability,
          difficulty: cardState.difficulty,
          repetitions: cardState.repetitions,
          lapses: cardState.lapses,
          lastReviewed: new Date(cardState.lastReviewedDate).toISOString(),
          dueDate: new Date(cardState.dueDate).toISOString(),
          interval: 0,
          // Other fields not used by FSRS
          front: "",
          back: "",
          created: "",
          modified: "",
        };

        // Use FSRS to calculate the outcome for this rating
        const schedulingInfo = fsrs.getSchedulingInfo(
          cardAsFlashcard as Flashcard,
          currentDate
        );
        const outcome = schedulingInfo[ratingLabel];

        // Update card state from FSRS outcome
        cardState.state = "review";
        cardState.stability = outcome.stability;
        cardState.difficulty = outcome.difficulty;
        cardState.repetitions = outcome.repetitions;
        cardState.dueDate = new Date(outcome.dueDate).getTime();
        cardState.lastReviewedDate = currentDayMs;

        if (ratingNum === 1) {
          cardState.lapses++;
        }
      }

      // Classify cards by stability (not interval)
      let newCount = 0;
      let learningCount = 0;
      let matureCount = 0;

      for (const cardState of cardStates) {
        if (cardState.state === "new") {
          newCount++;
        } else if (cardState.stability < MATURITY_THRESHOLD_DAYS) {
          learningCount++;
        } else {
          matureCount++;
        }
      }

      result.push({
        date: dateKey,
        newCards: newCount,
        learningCards: learningCount,
        matureCards: matureCount,
      });

      // Equilibrium detection (only start after all new cards are introduced)
      if (newCount === 0 && !equilibriumDetected) {
        // Add current learning count to window
        learningCountWindow.push(learningCount);

        // Keep only last EQUILIBRIUM_WINDOW_DAYS values
        if (learningCountWindow.length > EQUILIBRIUM_WINDOW_DAYS) {
          learningCountWindow.shift();
        }

        // Check if we have a full window
        if (learningCountWindow.length === EQUILIBRIUM_WINDOW_DAYS) {
          // Calculate variance of learning count over window
          const mean =
            learningCountWindow.reduce((sum, val) => sum + val, 0) /
            EQUILIBRIUM_WINDOW_DAYS;
          const variance =
            learningCountWindow.reduce(
              (sum, val) => sum + Math.pow(val - mean, 2),
              0
            ) / EQUILIBRIUM_WINDOW_DAYS;
          const stdDev = Math.sqrt(variance);

          // Check if variance is below threshold (1% of total cards)
          const varianceThreshold = totalCards * EQUILIBRIUM_VARIANCE_THRESHOLD;

          if (stdDev < varianceThreshold) {
            consecutiveDaysStable++;

            // Detect equilibrium after 14 consecutive stable days
            if (
              consecutiveDaysStable >= EQUILIBRIUM_WINDOW_DAYS &&
              !equilibriumDetected
            ) {
              equilibriumDetected = true;
              equilibriumDay = day;
              equilibriumMaintenanceLevel = (mean / totalCards) * 100; // Convert to percentage

              this.logger.debug(
                `[simulateMaturityProgression] Equilibrium detected at day ${day}: ` +
                  `Maintenance level = ${equilibriumMaintenanceLevel.toFixed(2)}% ` +
                  `(~${Math.round(mean)} cards, stdDev=${stdDev.toFixed(1)})`
              );
            }
          } else {
            // Variance exceeded threshold, reset stable counter
            consecutiveDaysStable = 0;
            learningCountWindow.length = 0;
          }
        }
      }

      // Debug logging every 30 days to track progress
      if (day % 30 === 0) {
        this.logger.debug(
          `[simulateMaturityProgression] Day ${day}: ${newCount} new, ${learningCount} learning, ${matureCount} mature. ` +
            `Processed: ${processedCards} cards (${reviewCardsToProcess.length} review, ${newCardsToProcess.length} new). ` +
            `Capacity: ${remainingCapacity === Infinity ? "unlimited" : remainingCapacity} remaining`
        );

        // Log stability distribution for learning cards
        const learningCards = cardStates.filter(
          (c) => c.state !== "new" && c.stability < MATURITY_THRESHOLD_DAYS
        );
        if (learningCards.length > 0) {
          const stabilities = learningCards
            .map((c) => c.stability)
            .sort((a, b) => a - b);
          const median = stabilities[Math.floor(stabilities.length / 2)];
          const min = stabilities[0];
          const max = stabilities[stabilities.length - 1];

          // NEW: Also log elapsed time distribution to verify Fix 3 is working
          const elapsedTimes = learningCards.map(
            (c) => (currentDayMs - c.lastReviewedDate) / 86400000
          );
          const avgElapsed =
            elapsedTimes.reduce((sum, e) => sum + e, 0) / elapsedTimes.length;

          this.logger.debug(
            `  Learning cards stability: min=${min.toFixed(1)}, median=${median.toFixed(1)}, max=${max.toFixed(1)}. ` +
              `Avg elapsed: ${avgElapsed.toFixed(1)} days`
          );

          // Log how many learning cards are due in the next 7 days
          const upcomingDueCounts: number[] = [];
          for (let futureDay = 0; futureDay < 7; futureDay++) {
            const futureDayMs = currentDayMs + futureDay * 86400000;
            const dueCount = learningCards.filter(
              (c) => c.dueDate <= futureDayMs
            ).length;
            upcomingDueCounts.push(dueCount);
          }
          this.logger.debug(
            `  Learning cards due next 7 days: [${upcomingDueCounts.join(", ")}]`
          );
        }
      }

      // Track activity for early exit logic
      if (processedCards > 0) {
        consecutiveDaysWithoutActivity = 0;
      } else {
        consecutiveDaysWithoutActivity++;
      }

      // Early exit conditions:
      // 1. Original: All cards mature and 7+ idle days
      // 2. New: Equilibrium detected and 14 days have passed since detection
      if (
        (newCount === 0 &&
          learningCount === 0 &&
          consecutiveDaysWithoutActivity > MAX_IDLE_DAYS) ||
        (equilibriumDetected &&
          equilibriumDay !== null &&
          day - equilibriumDay >= EQUILIBRIUM_WINDOW_DAYS)
      ) {
        if (equilibriumDetected) {
          this.logger.debug(
            `[simulateMaturityProgression] Early exit after equilibrium: day ${day} ` +
              `(${day - equilibriumDay!} days after detection at day ${equilibriumDay})`
          );
        }
        break;
      }

      // Yield to UI every 5 days to prevent blocking the main thread
      // This is critical for long simulations (up to 1825 days for 5 year forecasts)
      if (day > 0 && day % 5 === 0) {
        await yieldToUI();
      }
    }

    // Define Stable Target Constants for a 90% Retention User
    const TARGET_LAPSE_RATE = 0.1; // 90% Retention target
    const IDEAL_RESIDENCY = 24; // Days to reach S >= 21
    const MATURE_DECK_INTERVAL = 30; // Target average interval for a healthy deck

    // Calculate the Steady-State Population Floor for a Mature Deck
    // Logic: (Daily Influx * Residency) / Total Cards
    const theoreticalStandardCardFloor =
      ((TARGET_LAPSE_RATE * IDEAL_RESIDENCY) / MATURE_DECK_INTERVAL) * 100;

    // Return enhanced result structure
    return {
      dailySnapshots: result,
      maintenanceLevel: equilibriumMaintenanceLevel,
      equilibriumDetectedAt: equilibriumDay,
      totalCards: cardStates.length,
      empiricalLapseRate,
      theoreticalMaintenanceLevel: theoreticalStandardCardFloor,
    };
  }

  private ratingCounter = 0; // Counter for deterministic rating selection

  /**
   * Select a rating based on empirical button distribution (deterministic)
   * Uses round-robin distribution based on percentages
   */
  private selectRatingFromDistribution(distribution: {
    again: number;
    hard: number;
    good: number;
    easy: number;
  }): number {
    // Convert percentages to integer counts out of 100
    // This gives us deterministic round-robin behavior
    const againCount = Math.round(distribution.again * 100);
    const hardCount = Math.round(distribution.hard * 100);
    const goodCount = Math.round(distribution.good * 100);
    // Easy gets the remainder to ensure total = 100

    const position = this.ratingCounter % 100;
    this.ratingCounter++;

    let cumulative = 0;
    if (position < (cumulative += againCount)) return 1;
    if (position < (cumulative += hardCount)) return 2;
    if (position < (cumulative += goodCount)) return 3;
    return 4; // Easy
  }

  /**
   * Convert rating number (1-4) to rating label for FSRS
   */
  private ratingNumberToLabel(rating: number): RatingLabel {
    const labelMap: { [key: number]: RatingLabel } = {
      1: "again",
      2: "hard",
      3: "good",
      4: "easy",
    };
    return labelMap[rating] || "good";
  }

  /**
   * Forecast future review load for multiple decks with optimized SQL aggregation
   */
  async simulateFutureDueLoad(
    deckIds: string[],
    totalDays: number
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
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
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
      end.toISOString()
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

      const deck = await this.db.getDeckWithProfile(deckId);
      deckConfigs.set(deckId, deck?.profile);
    }

    // FSRS extension using aggregated cards (use first deck's config for global params)
    const firstConfig = deckConfigs.values().next().value;
    const ext = await this.simulateFsrsDemand(
      allCards,
      startMs,
      endMs,
      firstConfig
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
        30
      );
      totalDailyCapacity += capacity;
    }

    // Get initial backlog across all decks in one query
    let backlog = await this.db.getCurrentBacklogMulti(
      deckIds,
      start.toISOString()
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
    windowDays: number
  ): Promise<number> {
    const deck = await this.db.getDeckWithProfile(deckId);
    if (!deck) return 0;

    const deckConfig = deck.profile;

    if (
      deckConfig.hasReviewCardsLimitEnabled &&
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
      startStr
    );

    return Math.max(0, totalReviews / windowDays);
  }

  /**
   * FSRS-driven simulation to extend daily due counts beyond stored due dates
   */
  private async simulateFsrsDemand(
    cards: Flashcard[],
    startMs: number,
    endMs: number,
    deckConfig: Omit<DeckProfile, 'id' | 'created' | 'modified' | 'name' | 'isDefault'>
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

    // SimNode interface for heap elements
    interface SimNode {
      cardId: string;
      stability: number;
      difficulty: number;
      lastReview: number;
      nextDue: number;
      events: number;
    }

    // Use min-heap for O(log n) operations instead of sorting
    const heap = new MinHeap<SimNode>((a, b) => a.nextDue - b.nextDue);

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

    while (heap.size() > 0) {
      const node = heap.pop();
      if (!node) break;
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
        Math.min(10, node.difficulty - 0 * (3 - 3)) // w6 * (rating - 3), w6≈0 for good
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
        Math.min(maxDays * 1440, newStability * k * 1440)
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
    onlyNonZero = false
  ): FutureDueData[] {
    if (!statistics?.forecast || statistics.forecast.length === 0) {
      return [];
    }

    const actualForecast = statistics.forecast.slice(
      0,
      Math.min(maxDays, statistics.forecast.length)
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
    timeframeDays: number
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
      0
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
    respectDailyLimits = true
  ): Promise<DeckStats> {
    // Get basic deck stats
    const totalCards = await this.db.countTotalCards(deckId);
    const newCards = await this.db.countNewCards(deckId);
    const dueCards = await this.db.countDueCards(deckId);
    const matureCards = await this.db.getFlashcardsByDeck(deckId);
    const matureCount = matureCards.filter(
      (card) => card.state === "review" && card.interval > 30240
    ).length;

    let finalNewCount = newCards;
    let finalDueCount = dueCards;

    // Apply daily limits if requested
    if (respectDailyLimits) {
      const deck = await this.db.getDeckWithProfile(deckId);
      if (deck) {
        const dailyCounts = await this.db.getDailyReviewCounts(deckId);

        // Apply new card limits
        if (
          deck.profile.hasNewCardsLimitEnabled &&
          deck.profile.newCardsPerDay >= 0
        ) {
          if (deck.profile.newCardsPerDay === 0) {
            finalNewCount = 0;
          } else {
            const remainingNew = Math.max(
              0,
              deck.profile.newCardsPerDay - dailyCounts.newCount
            );
            finalNewCount = Math.min(newCards, remainingNew);
          }
        }

        // Apply review card limits
        if (
          deck.profile.hasReviewCardsLimitEnabled &&
          deck.profile.reviewCardsPerDay >= 0
        ) {
          if (deck.profile.reviewCardsPerDay === 0) {
            finalDueCount = 0;
          } else {
            const remainingReview = Math.max(
              0,
              deck.profile.reviewCardsPerDay - dailyCounts.reviewCount
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
    pastWeekHours: number;
  }> {
    const allLogs = await this.db.getAllReviewLogs();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    let totalMs = 0;
    let monthMs = 0;
    let weekMs = 0;

    allLogs.forEach((log) => {
      const timeElapsed = log.timeElapsedMs || 0;
      totalMs += timeElapsed;

      const reviewDate = new Date(log.reviewedAt);
      if (reviewDate >= oneMonthAgo) {
        monthMs += timeElapsed;
      }
      if (reviewDate >= oneWeekAgo) {
        weekMs += timeElapsed;
      }
    });

    return {
      totalHours: totalMs / (1000 * 60 * 60),
      pastMonthHours: monthMs / (1000 * 60 * 60),
      pastWeekHours: weekMs / (1000 * 60 * 60),
    };
  }
}
