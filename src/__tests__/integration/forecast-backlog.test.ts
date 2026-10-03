/**
 * @jest-environment ./src/__tests__/integration/time-zone-environment.ts
 * @jest-environment-options {"timezone": "Asia/Tokyo"}
 */
import { FSRS, StatisticsService, studyDayKey } from "@decks/core";
import type { Flashcard } from "../../database/types";
import type { MainDatabaseService } from "../../database/MainDatabaseService";
import { DEFAULT_SETTINGS } from "../../settings";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";

// Tokyo is far enough ahead of UTC that a 04:00 study-day start is still the previous UTC date.
describe("The forecast's backlog, read from the database", () => {
  let db: MainDatabaseService;
  let stats: StatisticsService;
  // Jest sets the zone in the environment above; runners that share process.env take it here.
  const zone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Asia/Tokyo";
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
    for (const id of ["a", "b"]) {
      await db.createDeck(DatabaseTestUtils.createTestDeck({ id, filepath: `${id}.md` }));
    }
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  // A review card that the simulation will not bring round again within a few days.
  async function review(deckId: string, id: string, due: Date, extra: Partial<Flashcard> = {}): Promise<void> {
    await db.createFlashcard(
      DatabaseTestUtils.createTestFlashcard(deckId, {
        id,
        state: "review",
        dueDate: due.toISOString(),
        stability: 400,
        difficulty: 5,
        lastReviewed: new Date(due.getTime() - 30 * 86400000).toISOString(),
        ...extra,
      })
    );
  }

  it("runs in a zone ahead of UTC", () => {
    expect(new Date(2026, 0, 15, 4).getUTCDate()).toBe(14);
  });

  it("keys study days, counts each due card once across decks, and leaves out suspended and buried ones", async () => {
    // 02:00 on the 15th: today is still the 14th's study day.
    const now = new Date(2026, 0, 15, 2);
    await review("a", "due-a", new Date(2026, 0, 16, 3)); // the 15th's study day
    await review("b", "due-b", new Date(2026, 0, 16, 12));
    await review("a", "late", new Date(2026, 0, 10, 12));
    await review("a", "suspended", new Date(2026, 0, 16, 12));
    await review("b", "buried", new Date(2026, 0, 16, 12));
    await db.suspendCard("suspended");
    await db.buryCard("buried", new Date(2026, 0, 20).toISOString());

    const out = await stats.simulateFutureDueLoad(["a", "b"], 3, now);
    expect(out.map((d) => d.date)).toEqual(["2026-01-14", "2026-01-15", "2026-01-16"]);
    expect(out.map((d) => d.scheduledDue)).toEqual([0, 1, 1]);
    expect(out[0].projectedBacklog).toBe(1);
  });

  it("spends today's review limit as the scheduler does: on review cards, once a card", async () => {
    const now = new Date(2026, 0, 15, 2);
    const profile = await db.getDefaultProfile();
    if (!profile) throw new Error("no default profile");
    await db.updateProfile(profile.id, { hasReviewCardsLimitEnabled: true, reviewCardsPerDay: 10 });
    for (let i = 0; i < 20; i++) await review("a", `late${i}`, new Date(2026, 0, 10, 12));
    // Studied cards, due again long after the window.
    for (const id of ["r1", "r2", "r3", "n1"]) await review("a", id, new Date(2026, 5, 1));
    const studied: [string, Date, "new" | "review"][] = [
      ["r1", new Date(2026, 0, 14, 10), "review"],
      ["r1", new Date(2026, 0, 14, 11), "review"],
      ["r2", new Date(2026, 0, 14, 12), "review"],
      ["n1", new Date(2026, 0, 14, 13), "new"],
      // Before the 04:00 rollover: the 13th's study day.
      ["r3", new Date(2026, 0, 14, 3, 30), "review"],
    ];
    for (const [id, at, oldState] of studied) {
      await db.createReviewLog(DatabaseTestUtils.createTestReviewLog(id, { reviewedAt: at.toISOString(), oldState }));
    }

    const out = await stats.simulateFutureDueLoad(["a"], 2, now);
    // Two review cards studied today leave eight of the ten.
    expect(out[0].projectedBacklog).toBe(12);
  });

  it("brings a TRAINED deck's card back where the scheduler would, with the stored trained weights", async () => {
    const now = new Date(2026, 0, 15, 2);
    const weights = [0.3, 1.1, 2.5, 9, 6, 0.9, 2.8, 0.01, 1.0, 0.2, 0.9, 1.4, 0.07, 0.3, 1.5, 0.5, 1.9, 0.6, 0.1, 0.07, 0.2];
    await db.saveTrainedWeightSet({
      weights,
      trainedAt: "2026-01-01T00:00:00.000Z",
      reviewsTrained: 500,
      cardsTrained: 50,
      beforeLogLoss: null,
      afterLogLoss: null,
      steps: 100,
      durationMs: 1,
      weightsVersion: "fsrs-6",
    });
    const profile = await db.getDefaultProfile();
    if (!profile) throw new Error("no default profile");
    await db.updateProfile(profile.id, {
      hasReviewCardsLimitEnabled: true,
      reviewCardsPerDay: 100,
      fsrs: { ...profile.fsrs, profile: "TRAINED" },
    });
    // Due at 20:00 on the 15th, so reviewed then, a day after its last review.
    const due = new Date(2026, 0, 15, 20);
    const young = { stability: 1, difficulty: 5, lastReviewed: new Date(2026, 0, 14, 20).toISOString() };
    await review("a", "young", due, young);

    const out = await stats.simulateFutureDueLoad(["a"], 60, now);
    const card = DatabaseTestUtils.createTestFlashcard("a", { id: "young", state: "review", dueDate: due.toISOString(), ...young });
    const returnDay = (fsrs: FSRS) => studyDayKey(new Date(fsrs.updateCard(card, "good", due).dueDate), 4);
    const trained = returnDay(new FSRS({ requestRetention: 0.9, profile: "TRAINED", weights, nextDayStartsAt: 4 }));
    expect(trained).not.toBe(returnDay(new FSRS({ requestRetention: 0.9, profile: "STANDARD", nextDayStartsAt: 4 })));
    expect(out.find((d, i) => i > 1 && d.scheduledDue > 0)?.date).toBe(trained);
  });

  it("gives every forecast bar its own day's backlog, across days with nothing due", async () => {
    const now = new Date(2026, 0, 15, 2);
    await review("a", "soon", new Date(2026, 0, 15, 12));
    await review("a", "later", new Date(2026, 0, 18, 12));

    const shown = stats.getFilteredForecastData(
      await stats.getOverallStatistics(["a"], undefined, now),
      30,
      true
    );
    const days = stats.forecastDayOffset(shown[shown.length - 1].date, now) + 1;
    const out = await stats.simulateFutureDueLoad(["a"], days, now);

    expect(shown.map((d) => d.date)).toEqual(["2026-01-15", "2026-01-18"]);
    expect(out).toHaveLength(5);
    expect(stats.backlogOnDays(shown, out)).toEqual([
      out.find((d) => d.date === "2026-01-15")?.projectedBacklog,
      out.find((d) => d.date === "2026-01-18")?.projectedBacklog,
    ]);
    expect(out.find((d) => d.date === "2026-01-18")?.scheduledDue).toBe(1);
  });
});
