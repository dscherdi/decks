/**
 * @jest-environment ./src/__tests__/integration/time-zone-environment.ts
 */
import { Scheduler, type IBackupService } from "@decks/core";
import type { DeckOrGroup, Flashcard } from "../../database/types";
import type { MainDatabaseService } from "../../database/MainDatabaseService";
import { DEFAULT_SETTINGS } from "../../settings";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";

// Europe/Berlin: 2026-10-25 has 25 hours and 2026-03-29 has 23, its 02:00-03:00 skipped.
describe("Cram on the nights the clocks change", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  // Jest sets the zone in the environment above; runners that share process.env take it here.
  const zone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
  });

  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  function schedulerRollingOverAt(nextDayStartsAt: number): Scheduler {
    const settings = { ...DEFAULT_SETTINGS, review: { ...DEFAULT_SETTINGS.review, nextDayStartsAt } };
    const backups: IBackupService = { createBackup: async () => undefined };
    return new Scheduler(db, settings, backups);
  }

  beforeEach(async () => {
    db = await setupTestDatabase();
    scheduler = schedulerRollingOverAt(4);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function deckWithCard(name: string): Promise<{ deck: DeckOrGroup; card: Flashcard }> {
    const deck = DatabaseTestUtils.createTestDeck({
      id: `cram_${name}_deck`,
      name,
      filepath: `cram-${name}.md`,
      tag: `#cram-${name}`,
    });
    await db.createDeck(deck);
    const card = DatabaseTestUtils.createTestFlashcard(deck.id, {
      id: `cram_${name}_card`,
      front: `Front ${name}`,
      state: "new",
    });
    await db.createFlashcard(card);
    return { deck: { ...(await db.getDeckWithProfile(deck.id))!, type: "file" }, card };
  }

  // The intervals a card gets from Again, then Goods until it graduates, all rated at `now`.
  async function drill(now: Date, name: string): Promise<number[]> {
    const { deck, card } = await deckWithCard(name);
    const { sessionId } = await scheduler.startCramSession(deck, [card], now);
    const intervals = [(await scheduler.rateCram(sessionId, card.id, "again", now)).interval];
    for (let i = 0; i < 10; i++) {
      const result = await scheduler.rateCram(sessionId, card.id, "good", now);
      intervals.push(result.interval);
      if (result.graduated) break;
    }
    return intervals;
  }

  it("runs in a zone whose clocks change on those nights", () => {
    expect(new Date(2026, 9, 25, 12).getTimezoneOffset()).toBe(
      new Date(2026, 9, 24, 12).getTimezoneOffset() + 60,
    );
    expect(new Date(2026, 2, 29, 12).getTimezoneOffset()).toBe(
      new Date(2026, 2, 28, 12).getTimezoneOffset() - 60,
    );
  });

  it("drills a card rated at 03:30 after the clocks went back as on any other night", async () => {
    const ordinary = await drill(new Date(2026, 9, 18, 3, 30), "ordinary");
    const clocksBack = await drill(new Date(2026, 9, 25, 3, 30), "clocksback");

    expect(ordinary[ordinary.length - 1]).toBeGreaterThanOrEqual(1440);
    expect(clocksBack.length).toBe(ordinary.length);
    expect(clocksBack[clocksBack.length - 1]).toBeGreaterThanOrEqual(1440);
  });

  it("drills a card when a day back falls in the skipped hour", async () => {
    // With the day rolling over at 03:00, 02:30 a day back is skipped and moves past the rollover.
    scheduler = schedulerRollingOverAt(3);
    const ordinary = await drill(new Date(2026, 2, 23, 2, 30), "ordinary");
    const skipped = await drill(new Date(2026, 2, 30, 2, 30), "skipped");

    expect(skipped.length).toBe(ordinary.length);
    expect(skipped[skipped.length - 1]).toBeGreaterThanOrEqual(1440);
  });
});
