/**
 * @jest-environment ./src/__tests__/integration/time-zone-environment.ts
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

// Europe/Berlin skips 02:00 to 03:00 on 2026-03-29, and study days here start at 02:00, the missing hour.
describe("The forecast's backlog on the night the clocks go forward", () => {
  let db: MainDatabaseService;
  let stats: StatisticsService;
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
      review: { ...DEFAULT_SETTINGS.review, nextDayStartsAt: 2 },
    });
    const profile = await db.getDefaultProfile();
    if (!profile) throw new Error("no default profile");
    await db.updateProfile(profile.id, { hasReviewCardsLimitEnabled: true, reviewCardsPerDay: 100 });
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  // One deck per card, so each is simulated alone.
  async function deckWith(id: string, due: Date, extra: Partial<Flashcard>): Promise<Flashcard> {
    await db.createDeck(DatabaseTestUtils.createTestDeck({ id, filepath: `${id}.md` }));
    const card = DatabaseTestUtils.createTestFlashcard(id, {
      id: `${id}-card`,
      state: "review",
      dueDate: due.toISOString(),
      ...extra,
    });
    await db.createFlashcard(card);
    return card;
  }

  // The study days a lone card is due on when the scheduler reviews it "Good" each time it comes due,
  // a return within the same study day moved to the next day's start.
  function scheduledDays(card: Flashcard, lastDay: string): string[] {
    const fsrs = new FSRS({ requestRetention: 0.9, profile: "STANDARD", nextDayStartsAt: 2 });
    const days: string[] = [];
    let current = card;
    let due = new Date(card.dueDate);
    while (studyDayKey(due, 2) <= lastDay) {
      const day = studyDayKey(due, 2);
      days.push(day);
      current = fsrs.updateCard(current, "good", due);
      due = new Date(current.dueDate);
      if (studyDayKey(due, 2) === day) {
        const [y, m, d] = day.split("-").map(Number);
        due = new Date(y, m - 1, d + 1, 2);
      }
    }
    return days;
  }

  it("runs where 02:00 is skipped", () => {
    expect(new Date(2026, 2, 29, 2).getHours()).toBe(3);
  });

  it("brings cards reviewed on the short day back on the days the scheduler does", async () => {
    const now = new Date(2026, 2, 28, 12);
    const cards: Flashcard[] = [];
    for (const stability of [0.3, 0.6644, 1, 1.7, 2.5, 4]) {
      for (const difficulty of [3, 6, 9]) {
        for (const hour of [3.5, 20]) {
          const due = new Date(2026, 2, 29, Math.floor(hour), (hour % 1) * 60);
          const lastReviewed = new Date(due.getTime() - stability * 86400000).toISOString();
          const id = `d${cards.length}`;
          cards.push(await deckWith(id, due, { stability, difficulty, lastReviewed }));
        }
      }
    }
    // Reviewed late on the 28th: its first day-scale return counts from the short day's 03:00 start.
    cards.push(
      await deckWith("drift", new Date(2026, 2, 29, 3, 30), {
        stability: 0.6644,
        difficulty: 6,
        lastReviewed: "2026-03-28T10:34:00.000Z",
      })
    );

    const mismatches: string[] = [];
    for (const card of cards) {
      const out = await stats.simulateFutureDueLoad([card.deckId], 60, now);
      const simulated = out.filter((d) => d.scheduledDue > 0).map((d) => d.date);
      const expected = scheduledDays(card, out[out.length - 1].date);
      if (simulated.join() !== expected.join()) {
        mismatches.push(`${card.deckId}: ${simulated.join()} vs ${expected.join()}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("starts each study day at its own 02:00 when today is the short day", async () => {
    const now = new Date(2026, 2, 29, 12);
    // Where the scheduler puts cards due a day and five days on: each day's 02:00.
    await deckWith("soon", new Date(2026, 2, 30, 2), { stability: 400 });
    await deckWith("later", new Date(2026, 3, 3, 2), { stability: 400 });

    const out = await stats.simulateFutureDueLoad(["soon", "later"], 7, now);
    expect(out.filter((d) => d.scheduledDue > 0).map((d) => d.date)).toEqual(["2026-03-30", "2026-04-03"]);
  });
});
