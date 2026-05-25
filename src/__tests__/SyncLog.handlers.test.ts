import { applyOp } from "../services/SyncLog.handlers";
import type { SyncLogEntry, RateOp } from "../services/SyncLog.types";
import type { Flashcard, ReviewLog } from "../database/types";
import type { Logger } from "../utils/logging";
import type { IDatabaseService } from "../database/DatabaseFactory";

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  } as unknown as Logger;
}

// Minimal in-memory IDatabaseService stub covering only the methods the
// rate handler touches. We don't need an actual SQL backend here — we
// just want to observe what the handler tries to do.
class FakeDb {
  private cards = new Map<string, Flashcard>();
  private logs = new Map<string, ReviewLog>();
  insertReviewLogCalls = 0;
  updateFlashcardCalls: Array<{ id: string; updates: Partial<Flashcard> }> = [];
  executeSqlCalls: Array<{ sql: string; params: unknown[] }> = [];

  seedCard(card: Flashcard): void {
    this.cards.set(card.id, card);
  }

  async getFlashcardById(id: string): Promise<Flashcard | null> {
    return this.cards.get(id) ?? null;
  }
  async insertReviewLog(log: ReviewLog): Promise<void> {
    this.insertReviewLogCalls += 1;
    this.logs.set(log.id, log);
  }
  async reviewLogExists(id: string): Promise<boolean> {
    return this.logs.has(id);
  }
  async getReviewLogById(id: string): Promise<ReviewLog | null> {
    return this.logs.get(id) ?? null;
  }
  async deleteReviewLogById(id: string): Promise<void> {
    this.logs.delete(id);
  }
  async updateFlashcard(id: string, updates: Partial<Flashcard>): Promise<void> {
    this.updateFlashcardCalls.push({ id, updates });
    const existing = this.cards.get(id);
    if (existing) this.cards.set(id, { ...existing, ...updates } as Flashcard);
  }
  // Card-state overlay handlers (card_suspend etc.) talk to the DB via raw
  // executeSql. We don't run SQL here — just record the call so tests can
  // assert the predicate shape (e.g. only-if-newer guard) and params.
  async executeSql(sql: string, params: unknown[] = []): Promise<void> {
    this.executeSqlCalls.push({ sql, params });
  }

  // Snapshot helpers for assertions.
  getCard(id: string): Flashcard | undefined {
    return this.cards.get(id);
  }
  getLog(id: string): ReviewLog | undefined {
    return this.logs.get(id);
  }
}

function asDb(fake: FakeDb): IDatabaseService {
  return fake as unknown as IDatabaseService;
}

function rateEntry(
  cardId: string,
  reviewedAt: string,
  overrides: Partial<RateOp["p"]> = {}
): SyncLogEntry {
  const logId = `log_${cardId}_${reviewedAt}`;
  return {
    hlc: [Date.parse(reviewedAt), 0, "remote-dev"],
    s: 1,
    v: 1,
    o: "rate",
    p: {
      c: cardId,
      st: 4.2,
      d: 5.1,
      due: "2026-05-20T00:00:00Z",
      rep: 2,
      lap: 0,
      state: "review",
      lastReviewed: reviewedAt,
      interval: 1440,
      log: {
        id: logId,
        flashcardId: cardId,
        sessionId: null,
        lastReviewedAt: "2026-05-10T00:00:00Z",
        shownAt: null,
        reviewedAt,
        rating: 3,
        ratingLabel: "good",
        timeElapsedMs: 1000,
        oldState: "new",
        oldRepetitions: 0,
        oldLapses: 0,
        oldStability: 0,
        oldDifficulty: 5,
        newState: "review",
        newRepetitions: 2,
        newLapses: 0,
        newStability: 4.2,
        newDifficulty: 5.1,
        oldIntervalMinutes: 0,
        newIntervalMinutes: 1440,
        oldDueAt: "2026-05-10T00:00:00Z",
        newDueAt: "2026-05-20T00:00:00Z",
        elapsedDays: 1,
        retrievability: 0.9,
        requestRetention: 0.9,
        profile: "STANDARD",
        maximumIntervalDays: 36500,
        minMinutes: 1,
        fsrsWeightsVersion: "1.0",
        schedulerVersion: "1.0",
        noteModelId: null,
        cardTemplateId: null,
        contentHash: null,
        client: null,
      },
      ...overrides,
    },
  };
}

function seedCard(card: Partial<Flashcard> & { id: string; modified: string }): Flashcard {
  return {
    id: card.id,
    deckId: "deck_1",
    front: "Q",
    back: "A",
    type: "header-paragraph",
    sourceFile: "test.md",
    contentHash: "hash",
    breadcrumb: "",
    notes: "",
    tags: [],
    clozeText: null,
    clozeOrder: null,
    state: "new",
    dueDate: "2026-05-10T00:00:00Z",
    interval: 0,
    repetitions: 0,
    difficulty: 5,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
    created: "2026-05-01T00:00:00Z",
    modified: card.modified,
    ...card,
  };
}

describe("SyncLog handlers - rate", () => {
  it("inserts the review log row and updates the card's FSRS state", async () => {
    const db = new FakeDb();
    db.seedCard(seedCard({ id: "card_a", modified: "2026-05-01T00:00:00Z" }));

    await applyOp(
      asDb(db),
      "remote-dev",
      rateEntry("card_a", "2026-05-11T00:00:00Z"),
      makeLogger()
    );

    expect(db.insertReviewLogCalls).toBe(1);
    const log = db.getLog("log_card_a_2026-05-11T00:00:00Z")!;
    expect(log).toBeDefined();
    expect(log.flashcardId).toBe("card_a");

    expect(db.updateFlashcardCalls).toHaveLength(1);
    const card = db.getCard("card_a")!;
    expect(card.state).toBe("review");
    expect(card.stability).toBeCloseTo(4.2);
    expect(card.difficulty).toBeCloseTo(5.1);
    expect(card.dueDate).toBe("2026-05-20T00:00:00Z");
    // modified is set to reviewedAt so future merge comparisons work.
    expect(card.modified).toBe("2026-05-11T00:00:00Z");
  });

  it("is idempotent: applying the same op twice does not double-insert the log row", async () => {
    const db = new FakeDb();
    db.seedCard(seedCard({ id: "card_a", modified: "2026-05-01T00:00:00Z" }));

    const entry = rateEntry("card_a", "2026-05-11T00:00:00Z");
    await applyOp(asDb(db), "remote-dev", entry, makeLogger());
    await applyOp(asDb(db), "remote-dev", entry, makeLogger());

    // Second call sees the log already present and skips the insert.
    expect(db.insertReviewLogCalls).toBe(1);
    // But the card update fires both times. The first run sets modified =
    // reviewedAt; the second run sees local.modified >= reviewedAt and skips.
    expect(db.updateFlashcardCalls).toHaveLength(1);
  });

  it("does NOT update the card when local modified >= remote reviewedAt (newer-wins)", async () => {
    const db = new FakeDb();
    // Local card was modified AFTER the incoming remote review.
    db.seedCard(seedCard({ id: "card_a", modified: "2026-05-12T00:00:00Z" }));

    await applyOp(
      asDb(db),
      "remote-dev",
      rateEntry("card_a", "2026-05-11T00:00:00Z"),
      makeLogger()
    );

    // Review log is still preserved (history is append-only).
    expect(db.insertReviewLogCalls).toBe(1);
    // But the card state is not overwritten by the older remote review.
    expect(db.updateFlashcardCalls).toHaveLength(0);
    expect(db.getCard("card_a")!.modified).toBe("2026-05-12T00:00:00Z");
  });

  it("preserves the review log even when the card doesn't exist locally yet (vault not yet synced)", async () => {
    const db = new FakeDb();
    // No card seeded.

    await applyOp(
      asDb(db),
      "remote-dev",
      rateEntry("card_missing", "2026-05-11T00:00:00Z"),
      makeLogger()
    );

    expect(db.insertReviewLogCalls).toBe(1);
    expect(db.updateFlashcardCalls).toHaveLength(0);
  });

  it("skips unknown op types with a debug log", async () => {
    const db = new FakeDb();
    const logger = makeLogger();
    const unknownEntry = {
      ...rateEntry("card_a", "2026-05-11T00:00:00Z"),
      o: "some_future_op_type",
    } as unknown as SyncLogEntry;

    await applyOp(asDb(db), "remote-dev", unknownEntry, logger);

    expect(db.insertReviewLogCalls).toBe(0);
    expect(db.updateFlashcardCalls).toHaveLength(0);
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("SyncLog handlers - rate_undo", () => {
  function rateUndoEntry(logId: string): SyncLogEntry {
    return {
      hlc: [Date.now() + 1, 0, "remote-dev"],
      s: 2,
      v: 1,
      o: "rate_undo",
      p: { logId },
    };
  }

  it("reverts the card to oldState and deletes the log row when modified matches reviewedAt", async () => {
    const db = new FakeDb();
    db.seedCard(seedCard({ id: "card_a", modified: "2026-05-01T00:00:00Z" }));

    // Apply the original rate first so the log row + new state exist.
    const reviewedAt = "2026-05-11T00:00:00Z";
    await applyOp(asDb(db), "remote-dev", rateEntry("card_a", reviewedAt), makeLogger());
    expect(db.getCard("card_a")!.state).toBe("review");
    expect(db.getCard("card_a")!.stability).toBeCloseTo(4.2);

    // Now undo.
    const logId = `log_card_a_${reviewedAt}`;
    await applyOp(asDb(db), "remote-dev", rateUndoEntry(logId), makeLogger());

    const card = db.getCard("card_a")!;
    expect(card.state).toBe("new"); // oldState from the log
    expect(card.stability).toBe(0); // oldStability from the log
    expect(card.difficulty).toBeCloseTo(5); // oldDifficulty from the log
    expect(db.getLog(logId)).toBeUndefined(); // log row deleted
  });

  it("does NOT revert when local card was modified by a newer change (modified-match guard)", async () => {
    const db = new FakeDb();
    db.seedCard(seedCard({ id: "card_a", modified: "2026-05-01T00:00:00Z" }));

    const reviewedAt = "2026-05-11T00:00:00Z";
    await applyOp(asDb(db), "remote-dev", rateEntry("card_a", reviewedAt), makeLogger());
    // Simulate a CONCURRENT rate from a different device that landed
    // after the original rate but before the undo. Bumps `modified` past
    // `reviewedAt` of the log.
    await db.updateFlashcard("card_a", { modified: "2026-05-12T00:00:00Z", stability: 9.9 });
    db.updateFlashcardCalls.length = 0; // reset to count only the undo's calls

    const logId = `log_card_a_${reviewedAt}`;
    await applyOp(asDb(db), "remote-dev", rateUndoEntry(logId), makeLogger());

    const card = db.getCard("card_a")!;
    // The concurrent newer state is preserved...
    expect(card.stability).toBeCloseTo(9.9);
    expect(card.modified).toBe("2026-05-12T00:00:00Z");
    // ...no updateFlashcard call from the undo handler...
    expect(db.updateFlashcardCalls).toHaveLength(0);
    // ...but the log row is still cleaned up.
    expect(db.getLog(logId)).toBeUndefined();
  });

  it("is a silent no-op when the referenced log doesn't exist locally", async () => {
    const db = new FakeDb();
    db.seedCard(seedCard({ id: "card_a", modified: "2026-05-01T00:00:00Z" }));

    await applyOp(
      asDb(db),
      "remote-dev",
      rateUndoEntry("log_never_existed"),
      makeLogger()
    );

    // No mutations.
    expect(db.updateFlashcardCalls).toHaveLength(0);
    expect(db.getCard("card_a")!.modified).toBe("2026-05-01T00:00:00Z");
  });

  it("deletes the log row even when the card no longer exists locally", async () => {
    const db = new FakeDb();
    // No card seeded — but seed a log row directly to simulate the
    // "card was unsynced/deleted but log lingers" edge case.
    const log = {
      id: "log_orphan",
      flashcardId: "card_gone",
      reviewedAt: "2026-05-11T00:00:00Z",
      lastReviewedAt: "2026-05-10T00:00:00Z",
      rating: 3 as const,
      ratingLabel: "good" as const,
      oldState: "new" as const,
      oldRepetitions: 0,
      oldLapses: 0,
      oldStability: 0,
      oldDifficulty: 5,
      newState: "review" as const,
      newRepetitions: 1,
      newLapses: 0,
      newStability: 1,
      newDifficulty: 5,
      oldIntervalMinutes: 0,
      newIntervalMinutes: 1440,
      oldDueAt: "2026-05-11T00:00:00Z",
      newDueAt: "2026-05-12T00:00:00Z",
      elapsedDays: 0,
      retrievability: 0.9,
      requestRetention: 0.9,
      profile: "STANDARD" as const,
      maximumIntervalDays: 36500,
      minMinutes: 1,
      fsrsWeightsVersion: "1.0",
      schedulerVersion: "1.0",
    };
    await db.insertReviewLog(log);

    await applyOp(asDb(db), "remote-dev", rateUndoEntry("log_orphan"), makeLogger());

    expect(db.updateFlashcardCalls).toHaveLength(0);
    expect(db.getLog("log_orphan")).toBeUndefined();
  });
});

describe("card_suspend / card_unsuspend / card_bury / card_unbury / card_reset", () => {
  function entry<T extends SyncLogEntry["o"]>(
    op: T,
    p: Extract<SyncLogEntry, { o: T }>["p"],
    at = "2026-05-12T00:00:00Z"
  ): SyncLogEntry {
    return {
      hlc: [Date.parse(at), 0, "remote-dev"],
      s: 1,
      v: 1,
      o: op,
      p,
    } as SyncLogEntry;
  }

  it("handleCardSuspend issues only-if-newer UPDATE with the at timestamp", async () => {
    const db = new FakeDb();
    await applyOp(
      asDb(db),
      "remote-dev",
      entry("card_suspend", { c: "card_a", at: "2026-05-12T00:00:00Z" }),
      makeLogger()
    );

    expect(db.executeSqlCalls).toHaveLength(1);
    const call = db.executeSqlCalls[0];
    expect(call.sql).toContain("UPDATE flashcards");
    expect(call.sql).toContain("suspended_at = ?");
    expect(call.sql).toContain("modified < ?");
    expect(call.params).toEqual([
      "2026-05-12T00:00:00Z",
      "2026-05-12T00:00:00Z",
      "card_a",
      "2026-05-12T00:00:00Z",
    ]);
  });

  it("handleCardUnsuspend sets suspended_at to NULL and guards by modified", async () => {
    const db = new FakeDb();
    await applyOp(
      asDb(db),
      "remote-dev",
      entry("card_unsuspend", { c: "card_a", at: "2026-05-12T00:00:00Z" }),
      makeLogger()
    );

    const call = db.executeSqlCalls[0];
    expect(call.sql).toContain("suspended_at = NULL");
    expect(call.sql).toContain("modified < ?");
    expect(call.params).toEqual([
      "2026-05-12T00:00:00Z",
      "card_a",
      "2026-05-12T00:00:00Z",
    ]);
  });

  it("handleCardBury sets buried_until to the until ISO and guards by modified", async () => {
    const db = new FakeDb();
    await applyOp(
      asDb(db),
      "remote-dev",
      entry("card_bury", {
        c: "card_b",
        until: "2026-05-13T04:00:00Z",
        at: "2026-05-12T14:00:00Z",
      }),
      makeLogger()
    );

    const call = db.executeSqlCalls[0];
    expect(call.sql).toContain("buried_until = ?");
    expect(call.sql).toContain("modified < ?");
    expect(call.params).toEqual([
      "2026-05-13T04:00:00Z",
      "2026-05-12T14:00:00Z",
      "card_b",
      "2026-05-12T14:00:00Z",
    ]);
  });

  it("handleCardUnbury sets buried_until to NULL", async () => {
    const db = new FakeDb();
    await applyOp(
      asDb(db),
      "remote-dev",
      entry("card_unbury", { c: "card_b", at: "2026-05-12T14:00:00Z" }),
      makeLogger()
    );

    const call = db.executeSqlCalls[0];
    expect(call.sql).toContain("buried_until = NULL");
    expect(call.params).toEqual([
      "2026-05-12T14:00:00Z",
      "card_b",
      "2026-05-12T14:00:00Z",
    ]);
  });

  it("handleCardReset issues a scoped DELETE for review_logs + scoped FSRS reset", async () => {
    const db = new FakeDb();
    await applyOp(
      asDb(db),
      "remote-dev",
      entry("card_reset", { c: "card_c", at: "2026-05-12T00:00:00Z" }),
      makeLogger()
    );

    expect(db.executeSqlCalls).toHaveLength(2);
    const [del, upd] = db.executeSqlCalls;
    expect(del.sql).toContain("DELETE FROM review_logs");
    expect(del.sql).toContain("flashcard_id = ?");
    expect(del.sql).toContain("reviewed_at <= ?");
    expect(del.params).toEqual(["card_c", "2026-05-12T00:00:00Z"]);

    expect(upd.sql).toContain("UPDATE flashcards");
    expect(upd.sql).toContain("state = 'new'");
    expect(upd.sql).toContain("suspended_at = NULL");
    expect(upd.sql).toContain("buried_until = NULL");
    expect(upd.sql).toContain("modified <= ?");
    expect(upd.params).toEqual([
      "2026-05-12T00:00:00Z", // due_date = at
      "2026-05-12T00:00:00Z", // modified = at
      "card_c",
      "2026-05-12T00:00:00Z",
    ]);
  });

  it("idempotent: replaying card_suspend yields the same SQL twice (no-op via modified guard)", async () => {
    const db = new FakeDb();
    const e = entry("card_suspend", {
      c: "card_a",
      at: "2026-05-12T00:00:00Z",
    });
    await applyOp(asDb(db), "remote-dev", e, makeLogger());
    await applyOp(asDb(db), "remote-dev", e, makeLogger());
    // Both calls emit the same UPDATE. The modified-guard inside SQL is what
    // makes the second a no-op in production. Behavior verified end-to-end
    // by the suspend-bury-reset integration test.
    expect(db.executeSqlCalls).toHaveLength(2);
    expect(db.executeSqlCalls[0].sql).toBe(db.executeSqlCalls[1].sql);
    expect(db.executeSqlCalls[0].params).toEqual(db.executeSqlCalls[1].params);
  });
});
