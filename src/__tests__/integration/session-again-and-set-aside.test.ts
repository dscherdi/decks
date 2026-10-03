import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler, type DecksSettings, type IBackupService } from "@decks/core";
import { DEFAULT_SETTINGS } from "../../settings";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";

// A review session keeps its promises: a card rated Again comes back before the
// session ends, and a card set aside leaves the count of what is still to do.
describe("review session: Again and set-aside cards", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  const deckId = "deck_session_again";
  const backup: IBackupService = { createBackup: async () => undefined };

  beforeEach(async () => {
    db = await setupTestDatabase();
    const settings: DecksSettings = structuredClone(DEFAULT_SETTINGS);
    settings.review.sessionDuration = 25;
    scheduler = new Scheduler(db, settings, backup);
    await db.createDeck(
      DatabaseTestUtils.createTestDeck({ id: deckId, name: "Again", filepath: "again.md", tag: "#again" })
    );
    for (const id of ["card_a", "card_b", "card_c"]) {
      await db.createFlashcard(
        DatabaseTestUtils.createTestFlashcard(deckId, {
          id,
          front: id,
          state: "review",
          dueDate: new Date(Date.now() - 60_000).toISOString(),
          interval: 1440,
          stability: 2.5,
          difficulty: 5,
          repetitions: 3,
        })
      );
    }
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function startSession(): Promise<string> {
    const { sessionId } = await scheduler.startReviewSession(deckId, new Date(), 25);
    scheduler.setCurrentSession(sessionId);
    return sessionId;
  }

  it("brings a card rated Again back once nothing else is left", async () => {
    await startSession();
    const first = await scheduler.getNext(new Date(), deckId);
    expect(first).not.toBeNull();
    await scheduler.rate(first!, "again");

    const seen = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const next = await scheduler.getNext(new Date(), deckId);
      expect(next).not.toBeNull();
      seen.add(next!.id);
      await scheduler.rate(next!, "good");
    }
    expect(seen.has(first!.id)).toBe(false);

    // Only the Again card is left; it is still in its learning step, yet it is offered.
    const back = await scheduler.getNext(new Date(), deckId);
    expect(back?.id).toBe(first!.id);
    await scheduler.rate(back!, "good");
    expect(await scheduler.getNext(new Date(), deckId)).toBeNull();
  });

  it("does not offer an Again card once its session has ended", async () => {
    const sessionId = await startSession();
    const first = await scheduler.getNext(new Date(), deckId);
    await scheduler.rate(first!, "again");
    await scheduler.endReviewSession(sessionId);
    for (;;) {
      const next = await scheduler.getNext(new Date(), deckId);
      if (!next) break;
      expect(next.id).not.toBe(first!.id);
      await scheduler.rate(next, "good");
    }
  });

  it("takes buried and suspended cards out of what is left to do", async () => {
    const sessionId = await startSession();
    expect((await scheduler.getSessionProgress(sessionId))?.goalTotal).toBe(3);

    const first = await scheduler.getNext(new Date(), deckId);
    await scheduler.buryCard(first!.id, scheduler.getBuryUntilForNextDay(new Date()));
    const second = await scheduler.getNext(new Date(), deckId);
    await scheduler.suspendCard(second!.id);

    const progress = await scheduler.getSessionProgress(sessionId);
    expect(progress?.goalTotal).toBe(1);
    expect(progress?.doneUnique).toBe(0);
  });

  it("does not count a card twice when it is set aside after being graded", async () => {
    const sessionId = await startSession();
    const first = await scheduler.getNext(new Date(), deckId);
    await scheduler.rate(first!, "again");
    await scheduler.suspendCard(first!.id);

    const progress = await scheduler.getSessionProgress(sessionId);
    expect(progress?.goalTotal).toBe(3);
    expect(progress?.doneUnique).toBe(1);
  });
});
