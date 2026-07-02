import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler, CREATE_TABLES_SQL, buildMigrationSQL } from "@decks/core";
import type { DeckOrGroup, Flashcard } from "../../database/types";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { Deck } from "../../database/types";
import initSqlJs from "sql.js";
import * as path from "node:path";

describe("Cram (drill) Integration", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  let testDeck: Deck;
  let fileDeck: DeckOrGroup;

  const mockSettings = {
    review: {
      nextDayStartsAt: 4,
      showProgress: true,
      enableKeyboardShortcuts: true,
      sessionDuration: 25,
    },
    backup: { enableAutoBackup: false, maxBackups: 3 },
    debug: { enableLogging: false, performanceLogs: false },
  } as any;

  async function countReviewLogs(): Promise<number> {
    const rows = await db.querySql<{ c: number }>(
      "SELECT COUNT(*) as c FROM review_logs",
      [],
      { asObject: true }
    );
    return rows[0]?.c ?? 0;
  }

  async function seedCards(count: number): Promise<Flashcard[]> {
    const cards: Flashcard[] = [];
    for (let i = 0; i < count; i++) {
      const card = DatabaseTestUtils.createTestFlashcard(testDeck.id, {
        id: `cram_card_${i}`,
        front: `Front ${i}`,
        state: "new",
      });
      await db.createFlashcard(card);
      cards.push(card);
    }
    return cards;
  }

  beforeEach(async () => {
    db = await setupTestDatabase();
    scheduler = new Scheduler(db, mockSettings, {
      createBackup: jest.fn(),
    } as any);

    testDeck = DatabaseTestUtils.createTestDeck({
      id: "cram_test_deck",
      name: "Cram Test Deck",
      filepath: "cram-test.md",
      tag: "#cram-test",
    });
    await db.createDeck(testDeck);
    fileDeck = {
      ...(await db.getDeckWithProfile(testDeck.id))!,
      type: "file",
    };
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("creates the cram tables on a fresh (migrated) database", async () => {
    const rows = await db.querySql<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cram_sessions','cram_cards')",
      [],
      { asObject: true }
    );
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(["cram_cards", "cram_sessions"]);
  });

  // Regression: the production worker migration path runs ONLY buildMigrationSQL
  // (never CREATE_TABLES_SQL afterward), so cram tables MUST be materialized by
  // buildMigrationSQL itself. An earlier build shipped them only in
  // CREATE_TABLES_SQL, leaving existing vaults stuck without the tables.
  it("worker migration path (buildMigrationSQL only) creates cram tables on an older DB", async () => {
    const wasmPath = path.join(
      process.cwd(),
      "node_modules/sql.js/dist/sql-wasm.wasm"
    );
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const raw = new SQL.Database();
    try {
      raw.run(CREATE_TABLES_SQL);
      // Simulate a pre-cram vault: tables absent, older schema version.
      raw.run(
        "DROP TABLE IF EXISTS cram_cards; DROP TABLE IF EXISTS cram_sessions;"
      );
      raw.run("PRAGMA user_version = 30;");

      // Mirror worker-entry.checkMigrationNeeded(): buildMigrationSQL only.
      raw.exec(buildMigrationSQL(raw));

      const tables = raw
        .exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cram%'"
        )[0]
        .values.map((v) => v[0])
        .sort();
      expect(tables).toEqual(["cram_cards", "cram_sessions"]);
    } finally {
      raw.close();
    }
  });

  it("seeds a cram session with one entry per card, reset to 'new'", async () => {
    const cards = await seedCards(3);
    const { sessionId } = await scheduler.startCramSession(fileDeck, cards);

    const progress = await scheduler.getCramProgress(sessionId);
    expect(progress).not.toBeNull();
    expect(progress!.goalTotal).toBe(3);
    expect(progress!.graduated).toBe(0);

    const cramCard = await db.getCramCardById(`${sessionId}:${cards[0].id}`);
    expect(cramCard).not.toBeNull();
    expect(cramCard!.tempState).toBe("new");
    expect(cramCard!.graduatedAt).toBeNull();
  });

  it("graduates a card on Good and never writes a review log or mutates the card", async () => {
    const cards = await seedCards(1);
    const before = { ...(await db.getFlashcardById(cards[0].id))! };
    const logsBefore = await countReviewLogs();

    const { sessionId } = await scheduler.startCramSession(fileDeck, cards);

    let card = await scheduler.getNextCramCard(sessionId);
    expect(card?.id).toBe(cards[0].id);

    const result = await scheduler.rateCram(sessionId, cards[0].id, "good");
    expect(result.graduated).toBe(true);
    expect(result.interval).toBeGreaterThanOrEqual(1440);

    // Queue is now empty (only card graduated).
    card = await scheduler.getNextCramCard(sessionId);
    expect(card).toBeNull();

    const progress = await scheduler.getCramProgress(sessionId);
    expect(progress!.graduated).toBe(1);
    expect(progress!.progress).toBe(100);

    // No review logs written.
    expect(await countReviewLogs()).toBe(logsBefore);

    // Real card scheduling state is byte-for-byte unchanged.
    const after = await db.getFlashcardById(cards[0].id);
    expect(after!.state).toBe(before.state);
    expect(after!.dueDate).toBe(before.dueDate);
    expect(after!.interval).toBe(before.interval);
    expect(after!.stability).toBe(before.stability);
    expect(after!.difficulty).toBe(before.difficulty);
    expect(after!.repetitions).toBe(before.repetitions);
    expect(after!.lapses).toBe(before.lapses);
    expect(after!.lastReviewed).toBe(before.lastReviewed);
  });

  it("keeps a card cycling on Again (sub-day) until Good graduates it", async () => {
    const cards = await seedCards(1);
    const { sessionId } = await scheduler.startCramSession(fileDeck, cards);

    const again = await scheduler.rateCram(sessionId, cards[0].id, "again");
    expect(again.graduated).toBe(false);
    expect(again.interval).toBeLessThan(1440);

    // Still in the queue and not graduated.
    const stillDue = await scheduler.getNextCramCard(sessionId);
    expect(stillDue?.id).toBe(cards[0].id);
    const mid = await db.getCramCardById(`${sessionId}:${cards[0].id}`);
    expect(mid!.graduatedAt).toBeNull();
    expect(mid!.reps).toBe(1);

    // After a lapse the cram stability is low, so it may take a few Goods to
    // climb back to a >= 1 day interval (drill until it sticks). It must
    // eventually graduate.
    let graduated = false;
    for (let i = 0; i < 10 && !graduated; i++) {
      graduated = (await scheduler.rateCram(sessionId, cards[0].id, "good"))
        .graduated;
    }
    expect(graduated).toBe(true);
    expect(await scheduler.getNextCramCard(sessionId)).toBeNull();

    // Real card is still untouched despite many cram ratings.
    const after = await db.getFlashcardById(cards[0].id);
    expect(after!.state).toBe("new");
    expect(after!.interval).toBe(0);
    expect(await countReviewLogs()).toBe(0);
  });

  it("resumes an unfinished cram session for the same deck", async () => {
    const cards = await seedCards(2);
    const first = await scheduler.startCramSession(fileDeck, cards);
    // Graduate one of two.
    await scheduler.rateCram(first.sessionId, cards[0].id, "good");

    const second = await scheduler.startCramSession(fileDeck, cards);
    expect(second.sessionId).toBe(first.sessionId);

    const progress = await scheduler.getCramProgress(second.sessionId);
    expect(progress!.graduated).toBe(1);
    expect(progress!.goalTotal).toBe(2);
  });

  it("starts a fresh session once the previous one is fully graduated", async () => {
    const cards = await seedCards(1);
    const first = await scheduler.startCramSession(fileDeck, cards);
    await scheduler.rateCram(first.sessionId, cards[0].id, "good");

    const second = await scheduler.startCramSession(fileDeck, cards);
    expect(second.sessionId).not.toBe(first.sessionId);
    const progress = await scheduler.getCramProgress(second.sessionId);
    expect(progress!.graduated).toBe(0);
    expect(progress!.goalTotal).toBe(1);
  });

  it("does NOT resume a cram session started on a previous study day", async () => {
    const cards = await seedCards(2);
    const first = await scheduler.startCramSession(fileDeck, cards);
    // Backdate the session two days so it is a different study day.
    await db.executeSql("UPDATE cram_sessions SET started_at = ? WHERE id = ?", [
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      first.sessionId,
    ]);

    const second = await scheduler.startCramSession(fileDeck, cards);
    expect(second.sessionId).not.toBe(first.sessionId);
    const progress = await scheduler.getCramProgress(second.sessionId);
    expect(progress!.graduated).toBe(0);
    expect(progress!.goalTotal).toBe(2);
  });

  it("hasResumableCram reflects same-day / completion / staleness", async () => {
    const cards = await seedCards(2);
    // No session yet.
    expect(await scheduler.hasResumableCram(fileDeck)).toBe(false);

    const { sessionId } = await scheduler.startCramSession(fileDeck, cards);
    // Mid-session, same study day → resumable.
    expect(await scheduler.hasResumableCram(fileDeck)).toBe(true);

    // Backdate → different study day → not resumable.
    await db.executeSql("UPDATE cram_sessions SET started_at = ? WHERE id = ?", [
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      sessionId,
    ]);
    expect(await scheduler.hasResumableCram(fileDeck)).toBe(false);

    // Restore to today and graduate everything → completed → not resumable.
    await db.executeSql("UPDATE cram_sessions SET started_at = ? WHERE id = ?", [
      new Date().toISOString(),
      sessionId,
    ]);
    await scheduler.rateCram(sessionId, cards[0].id, "good");
    await scheduler.rateCram(sessionId, cards[1].id, "good");
    expect(await scheduler.hasResumableCram(fileDeck)).toBe(false);
  });
});
