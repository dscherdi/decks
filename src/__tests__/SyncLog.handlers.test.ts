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
  async updateFlashcard(id: string, updates: Partial<Flashcard>): Promise<void> {
    this.updateFlashcardCalls.push({ id, updates });
    const existing = this.cards.get(id);
    if (existing) this.cards.set(id, { ...existing, ...updates } as Flashcard);
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
