/**
 * @jest-environment ./src/__tests__/integration/time-zone-environment.ts
 */
import { StatisticsService } from "@decks/core";
import type { Deck } from "../../database/types";
import type { MainDatabaseService } from "../../database/MainDatabaseService";
import { DEFAULT_SETTINGS } from "../../settings";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";

// Europe/Berlin: 2026-10-25 has 25 hours. A study day starts at 04:00.
describe("Statistics across the night the clocks go back", () => {
  let db: MainDatabaseService;
  let stats: StatisticsService;
  let deck: Deck;
  // Jest sets the zone in the environment above; runners that share process.env take it here.
  const zone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
  });

  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  beforeEach(async () => {
    db = await setupTestDatabase();
    stats = new StatisticsService(db, {
      ...DEFAULT_SETTINGS,
      review: { ...DEFAULT_SETTINGS.review, nextDayStartsAt: 4 },
    });
    deck = DatabaseTestUtils.createTestDeck({ id: "dst_deck", filepath: "dst.md" });
    await db.createDeck(deck);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await teardownTestDatabase();
  });

  // Only the clock is faked: sql.js and the timers it relies on stay real.
  function pinClock(now: Date): void {
    jest.useFakeTimers({
      now,
      doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout",
        "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"],
    });
  }

  async function reviewCardDue(id: string, due: Date): Promise<void> {
    await db.createFlashcard(
      DatabaseTestUtils.createTestFlashcard(deck.id, {
        id,
        state: "review",
        dueDate: due.toISOString(),
        stability: 3,
        difficulty: 5,
        interval: 3 * 1440,
        repetitions: 2,
        lastReviewed: new Date(due.getTime() - 3 * 86400000).toISOString(),
      })
    );
  }

  it("runs in a zone whose clocks go back that night", () => {
    expect(new Date(2026, 9, 25, 12).getTimezoneOffset()).toBe(
      new Date(2026, 9, 24, 12).getTimezoneOffset() + 60,
    );
  });

  // Months are 0-based; the dates are built in the test, once the zone is set.
  it.each([
    ["across the clock change", 9, 10, "2026-11-01"],
    ["on an ordinary month", 0, 1, "2026-02-01"],
  ])("counts a card due on the last study day of the forecast %s", async (_when, month, dueMonth, day) => {
    pinClock(new Date(2026, month, 2, 12));
    await reviewCardDue("last-day", new Date(2026, dueMonth, 1, 4));
    const forecast = (await stats.getOverallStatistics([deck.id])).forecast;
    expect(forecast.find((f) => f.date === day)?.dueCount).toBe(1);
  });

  it("simulates one day per calendar day, starting just after midnight on the long day", async () => {
    const now = new Date(2026, 9, 25, 0, 30);
    for (let i = 0; i < 4; i++) await reviewCardDue(`due-${i}`, new Date(2026, 9, 25 + i, 4));

    const dates = (await stats.simulateMaturityProgression([deck.id], 4, now)).dailySnapshots.map(
      (snapshot) => snapshot.date,
    );
    expect(dates.slice(0, 3)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27"]);
  });

  it("starts the simulation at now during the repeated hour", async () => {
    // 01:30 UTC is 02:30 CET, the second time 02:30 comes round that night.
    const now = new Date(Date.UTC(2026, 9, 25, 1, 30));
    await db.createFlashcard(
      DatabaseTestUtils.createTestFlashcard(deck.id, {
        id: "new-due",
        state: "new",
        dueDate: new Date(now.getTime() - 30 * 60000).toISOString(),
      })
    );

    const [first] = (await stats.simulateMaturityProgression([deck.id], 2, now)).dailySnapshots;
    expect(first.newCards).toBe(0);
  });
});
