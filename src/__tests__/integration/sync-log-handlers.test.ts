// Integration tests for the SyncLog op handlers added in Day 6.
//
// These exercise the handlers against a real MainDatabaseService rather
// than a stub because the handlers use raw INSERT ... ON CONFLICT statements
// that require actual SQLite semantics. One device's DB stands in for the
// "remote" state; we invoke the handler directly with synthesized log entries.

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter } from "./database-test-utils";
import { setupRealSqlJs } from "./setup-real-sql";
import { Logger } from "../../utils/logging";
import { applyOp } from "../../services/SyncLog.handlers";
import { DEFAULT_PROFILE_ID } from "../../database/types";
import type { Flashcard } from "../../database/types";
import type {
  SyncLogEntry,
  ProfileUpsertOp,
  ProfileDeleteOp,
  TagMappingUpsertOp,
  TagMappingDeleteOp,
  CustomDeckUpsertOp,
  CustomDeckDeleteOp,
  CustomDeckCardAddOp,
  CustomDeckCardRemoveOp,
  SessionStartOp,
  SessionProgressOp,
  SessionEndOp,
  DeckResetOp,
  CustomDeckResetOp,
} from "../../services/SyncLog.types";
import type { HLCValue } from "../../services/HLC";

const HLC: HLCValue = [1_000_000, 0, "remote-dev"];

function makeLogger(adapter: InMemoryAdapter): Logger {
  return new Logger(
    { debug: { enableLogging: false, performanceLogs: false } } as never,
    adapter,
    ".obsidian",
    "decks"
  );
}

async function freshDb(): Promise<{ db: MainDatabaseService; adapter: InMemoryAdapter }> {
  await setupRealSqlJs();
  const adapter = new InMemoryAdapter();
  const logger = makeLogger(adapter);
  const db = new MainDatabaseService("/test.db", adapter, logger.debug.bind(logger));
  await db.initialize();
  return { db, adapter };
}

function entry<T extends { o: string; p: unknown }>(seq: number, op: T): SyncLogEntry {
  return { hlc: HLC, s: seq, v: 1, o: op.o, p: op.p } as SyncLogEntry;
}

function profileUpsertOp(
  id: string,
  name: string,
  modified: string,
  extra: Partial<ProfileUpsertOp["p"]> = {}
): ProfileUpsertOp {
  return {
    o: "profile_upsert",
    p: {
      id,
      name,
      hasNewCardsLimitEnabled: false,
      newCardsPerDay: 20,
      hasReviewCardsLimitEnabled: false,
      reviewCardsPerDay: 100,
      headerLevel: 2,
      reviewOrder: "due-date",
      learningSteps: "1m",
      relearningSteps: "10m",
      fsrsRequestRetention: 0.9,
      fsrsProfile: "STANDARD",
      fsrsUseTrained: false,
      clozeEnabled: true,
      clozeShowContext: "hidden",
      isDefault: false,
      created: modified,
      modified,
      ...extra,
    },
  };
}

describe("SyncLog handlers - profile_upsert / profile_delete", () => {
  it("inserts a new profile", async () => {
    const { db, adapter } = await freshDb();
    await applyOp(
      db,
      "remote-dev",
      entry(1, profileUpsertOp("prof_a", "Math", "2030-01-01T00:00:00Z")),
      makeLogger(adapter)
    );
    const got = await db.getProfileById("prof_a");
    expect(got).not.toBeNull();
    expect(got!.name).toBe("Math");
  });

  it("newer-wins on update", async () => {
    const { db, adapter } = await freshDb();
    await applyOp(
      db,
      "r",
      entry(1, profileUpsertOp("prof_a", "Math", "2030-01-01T00:00:00Z")),
      makeLogger(adapter)
    );
    await applyOp(
      db,
      "r",
      entry(2, profileUpsertOp("prof_a", "Algebra", "2030-02-01T00:00:00Z")),
      makeLogger(adapter)
    );
    expect((await db.getProfileById("prof_a"))!.name).toBe("Algebra");

    // Stale op (older modified) is rejected.
    await applyOp(
      db,
      "r",
      entry(3, profileUpsertOp("prof_a", "Stale", "2029-12-01T00:00:00Z")),
      makeLogger(adapter)
    );
    expect((await db.getProfileById("prof_a"))!.name).toBe("Algebra");
  });

  it("tombstones a profile and the read filter hides it", async () => {
    const { db, adapter } = await freshDb();
    await applyOp(
      db,
      "r",
      entry(1, profileUpsertOp("prof_a", "Math", "2030-01-01T00:00:00Z")),
      makeLogger(adapter)
    );
    const del: ProfileDeleteOp = {
      o: "profile_delete",
      p: { id: "prof_a", deletedAt: "2030-03-01T00:00:00Z" },
    };
    await applyOp(db, "r", entry(2, del), makeLogger(adapter));
    expect(await db.getProfileById("prof_a")).toBeNull();
  });

  it("refuses to tombstone the DEFAULT profile", async () => {
    const { db, adapter } = await freshDb();
    const del: ProfileDeleteOp = {
      o: "profile_delete",
      p: { id: "profile_default", deletedAt: "2030-01-01T00:00:00Z" },
    };
    await applyOp(db, "r", entry(1, del), makeLogger(adapter));
    expect(await db.getProfileById("profile_default")).not.toBeNull();
  });
});

describe("SyncLog handlers - tag mapping ops", () => {
  it("upsert then delete round-trips", async () => {
    const { db, adapter } = await freshDb();
    // Need a profile first.
    await applyOp(
      db,
      "r",
      entry(1, profileUpsertOp("prof_a", "Math", "2030-01-01T00:00:00Z")),
      makeLogger(adapter)
    );
    const up: TagMappingUpsertOp = {
      o: "tag_mapping_upsert",
      p: { id: "m1", profileId: "prof_a", tag: "#math", created: "2030-01-02T00:00:00Z" },
    };
    await applyOp(db, "r", entry(2, up), makeLogger(adapter));
    expect(await db.getProfileIdForTag("#math")).toBe("prof_a");

    const del: TagMappingDeleteOp = {
      o: "tag_mapping_delete",
      p: { id: "m1", deletedAt: "2030-01-03T00:00:00Z" },
    };
    await applyOp(db, "r", entry(3, del), makeLogger(adapter));
    expect(await db.getProfileIdForTag("#math")).toBeNull();
  });

  it("upsert with different id but same tag resolves UNIQUE(tag) by newer-wins", async () => {
    // Regression: two devices independently mapped the same tag to a profile,
    // producing different `id` values for the same `tag`. The remote op must
    // not throw UNIQUE constraint failed: profile_tag_mappings.tag.
    const { db, adapter } = await freshDb();
    await applyOp(
      db,
      "r",
      entry(1, profileUpsertOp("prof_a", "Math", "2030-01-01T00:00:00Z")),
      makeLogger(adapter)
    );
    await applyOp(
      db,
      "r",
      entry(2, profileUpsertOp("prof_b", "Science", "2030-01-01T00:00:00Z")),
      makeLogger(adapter)
    );

    const localFirst: TagMappingUpsertOp = {
      o: "tag_mapping_upsert",
      p: { id: "m_local", profileId: "prof_a", tag: "#shared", created: "2030-01-02T00:00:00Z" },
    };
    await applyOp(db, "r", entry(3, localFirst), makeLogger(adapter));

    // Remote op has a different id, same tag, newer created → remote wins.
    const remoteNewer: TagMappingUpsertOp = {
      o: "tag_mapping_upsert",
      p: { id: "m_remote", profileId: "prof_b", tag: "#shared", created: "2030-01-03T00:00:00Z" },
    };
    await applyOp(db, "r", entry(4, remoteNewer), makeLogger(adapter));

    const mappings = await db.getAllTagMappings();
    const shared = mappings.filter((m) => m.tag === "#shared");
    expect(shared).toHaveLength(1);
    expect(shared[0].id).toBe("m_remote");
    expect(shared[0].profileId).toBe("prof_b");
  });

  it("upsert with different id but same tag and older created keeps local", async () => {
    const { db, adapter } = await freshDb();
    await applyOp(
      db,
      "r",
      entry(1, profileUpsertOp("prof_a", "Math", "2030-01-01T00:00:00Z")),
      makeLogger(adapter)
    );
    await applyOp(
      db,
      "r",
      entry(2, profileUpsertOp("prof_b", "Science", "2030-01-01T00:00:00Z")),
      makeLogger(adapter)
    );

    const localNewer: TagMappingUpsertOp = {
      o: "tag_mapping_upsert",
      p: { id: "m_local", profileId: "prof_a", tag: "#shared", created: "2030-01-05T00:00:00Z" },
    };
    await applyOp(db, "r", entry(3, localNewer), makeLogger(adapter));

    const remoteOlder: TagMappingUpsertOp = {
      o: "tag_mapping_upsert",
      p: { id: "m_remote", profileId: "prof_b", tag: "#shared", created: "2030-01-02T00:00:00Z" },
    };
    await applyOp(db, "r", entry(4, remoteOlder), makeLogger(adapter));

    const mappings = await db.getAllTagMappings();
    const shared = mappings.filter((m) => m.tag === "#shared");
    expect(shared).toHaveLength(1);
    expect(shared[0].id).toBe("m_local");
    expect(shared[0].profileId).toBe("prof_a");
  });

  it("upsert revives a tombstoned mapping when remote created is newer", async () => {
    const { db, adapter } = await freshDb();
    await applyOp(
      db,
      "r",
      entry(1, profileUpsertOp("prof_a", "Math", "2030-01-01T00:00:00Z")),
      makeLogger(adapter)
    );
    await applyOp(
      db,
      "r",
      entry(2, {
        o: "tag_mapping_upsert",
        p: { id: "m1", profileId: "prof_a", tag: "#math", created: "2030-01-02T00:00:00Z" },
      } satisfies TagMappingUpsertOp),
      makeLogger(adapter)
    );
    await applyOp(
      db,
      "r",
      entry(3, {
        o: "tag_mapping_delete",
        p: { id: "m1", deletedAt: "2030-01-03T00:00:00Z" },
      } satisfies TagMappingDeleteOp),
      makeLogger(adapter)
    );
    expect(await db.getProfileIdForTag("#math")).toBeNull();

    await applyOp(
      db,
      "r",
      entry(4, {
        o: "tag_mapping_upsert",
        p: { id: "m2", profileId: "prof_a", tag: "#math", created: "2030-01-04T00:00:00Z" },
      } satisfies TagMappingUpsertOp),
      makeLogger(adapter)
    );
    expect(await db.getProfileIdForTag("#math")).toBe("prof_a");
  });
});

describe("SyncLog handlers - custom_deck ops", () => {
  it("upsert + delete + idempotent replay", async () => {
    const { db, adapter } = await freshDb();
    const up: CustomDeckUpsertOp = {
      o: "custom_deck_upsert",
      p: {
        id: "cd_a",
        name: "Hard cards",
        deckType: "manual",
        filterDefinition: null,
        lastReviewed: null,
        created: "2030-01-01T00:00:00Z",
        modified: "2030-01-01T00:00:00Z",
      },
    };
    await applyOp(db, "r", entry(1, up), makeLogger(adapter));
    expect((await db.getCustomDeckById("cd_a"))!.name).toBe("Hard cards");

    // Replay is a no-op (modified isn't newer).
    await applyOp(db, "r", entry(2, up), makeLogger(adapter));
    expect((await db.getCustomDeckById("cd_a"))!.name).toBe("Hard cards");

    const del: CustomDeckDeleteOp = {
      o: "custom_deck_delete",
      p: { id: "cd_a", deletedAt: "2030-02-01T00:00:00Z" },
    };
    await applyOp(db, "r", entry(3, del), makeLogger(adapter));
    expect(await db.getCustomDeckById("cd_a")).toBeNull();
  });
});

describe("SyncLog handlers - custom_deck_card ops", () => {
  it("add + remove + tombstone blocks resurrection", async () => {
    const { db, adapter } = await freshDb();

    // Seed real deck + flashcard so the FK constraint on custom_deck_cards
    // is satisfied. Use the live CRUD methods so the rows match production.
    await db.createDeck({
      id: "deck_real",
      name: "Real",
      filepath: "/real.md",
      tag: "#flashcards",
      lastReviewed: null,
      profileId: DEFAULT_PROFILE_ID,
    });
    await db.createFlashcard({
      id: "card_x",
      deckId: "deck_real",
      front: "Q",
      back: "A",
      type: "header-paragraph",
      sourceFile: "/real.md",
      contentHash: "h",
      breadcrumb: "",
      notes: "",
      tags: [],
      clozeText: null,
      clozeOrder: null,
      state: "new",
      dueDate: "2030-01-01T00:00:00Z",
      interval: 0,
      repetitions: 0,
      difficulty: 5,
      stability: 0,
      lapses: 0,
      lastReviewed: null,
    } as Omit<Flashcard, "created" | "modified">);

    // Create the host custom deck.
    await applyOp(
      db,
      "r",
      entry(1, {
        o: "custom_deck_upsert",
        p: {
          id: "cd_a",
          name: "Set",
          deckType: "manual",
          filterDefinition: null,
          lastReviewed: null,
          created: "2030-01-01T00:00:00Z",
          modified: "2030-01-01T00:00:00Z",
        },
      } satisfies CustomDeckUpsertOp),
      makeLogger(adapter)
    );

    const add: CustomDeckCardAddOp = {
      o: "custom_deck_card_add",
      p: { customDeckId: "cd_a", flashcardId: "card_x", created: "2030-01-02T00:00:00Z" },
    };
    await applyOp(db, "r", entry(2, add), makeLogger(adapter));
    expect(await db.getFlashcardIdsForCustomDeck("cd_a")).toEqual(["card_x"]);

    const remove: CustomDeckCardRemoveOp = {
      o: "custom_deck_card_remove",
      p: { customDeckId: "cd_a", flashcardId: "card_x", removedAt: "2030-01-03T00:00:00Z" },
    };
    await applyOp(db, "r", entry(3, remove), makeLogger(adapter));
    expect(await db.getFlashcardIdsForCustomDeck("cd_a")).toEqual([]);

    // Late-arriving `_add` op is filtered by the local tombstone.
    await applyOp(db, "r", entry(4, add), makeLogger(adapter));
    expect(await db.getFlashcardIdsForCustomDeck("cd_a")).toEqual([]);
  });

  it("custom_deck_card_add skips silently when the flashcard is not yet local", async () => {
    const { db, adapter } = await freshDb();
    await applyOp(
      db,
      "r",
      entry(1, {
        o: "custom_deck_upsert",
        p: {
          id: "cd_a",
          name: "Set",
          deckType: "manual",
          filterDefinition: null,
          lastReviewed: null,
          created: "2030-01-01T00:00:00Z",
          modified: "2030-01-01T00:00:00Z",
        },
      } satisfies CustomDeckUpsertOp),
      makeLogger(adapter)
    );
    // No flashcard seeded — the add should be skipped, not throw.
    await applyOp(
      db,
      "r",
      entry(2, {
        o: "custom_deck_card_add",
        p: { customDeckId: "cd_a", flashcardId: "card_missing", created: "2030-01-02T00:00:00Z" },
      } satisfies CustomDeckCardAddOp),
      makeLogger(adapter)
    );
    expect(await db.getFlashcardIdsForCustomDeck("cd_a")).toEqual([]);
  });
});

describe("SyncLog handlers - session ops", () => {
  it("start + progress (monotonic) + end", async () => {
    const { db, adapter } = await freshDb();
    const start: SessionStartOp = {
      o: "session_start",
      p: { id: "s1", deckId: "deck_x", startedAt: "2030-01-01T00:00:00Z", goalTotal: 10 },
    };
    await applyOp(db, "r", entry(1, start), makeLogger(adapter));
    const s = await db.getReviewSessionById("s1");
    expect(s!.goalTotal).toBe(10);
    expect(s!.doneUnique).toBe(0);

    const progress: SessionProgressOp = {
      o: "session_progress",
      p: { id: "s1", doneUnique: 5 },
    };
    await applyOp(db, "r", entry(2, progress), makeLogger(adapter));
    expect((await db.getReviewSessionById("s1"))!.doneUnique).toBe(5);

    // A stale progress op (lower count) is rejected.
    await applyOp(
      db,
      "r",
      entry(3, { o: "session_progress", p: { id: "s1", doneUnique: 3 } } satisfies SessionProgressOp),
      makeLogger(adapter)
    );
    expect((await db.getReviewSessionById("s1"))!.doneUnique).toBe(5);

    const end: SessionEndOp = {
      o: "session_end",
      p: { id: "s1", endedAt: "2030-01-01T01:00:00Z" },
    };
    await applyOp(db, "r", entry(4, end), makeLogger(adapter));
    expect((await db.getReviewSessionById("s1"))!.endedAt).toBe("2030-01-01T01:00:00Z");
  });

  it("session_start replay is a no-op (INSERT OR IGNORE)", async () => {
    const { db, adapter } = await freshDb();
    const start: SessionStartOp = {
      o: "session_start",
      p: { id: "s1", deckId: "d", startedAt: "2030-01-01T00:00:00Z", goalTotal: 10 },
    };
    await applyOp(db, "r", entry(1, start), makeLogger(adapter));
    await applyOp(db, "r", entry(2, start), makeLogger(adapter));
    const all = await db.getAllReviewSessions();
    expect(all.filter((s) => s.id === "s1")).toHaveLength(1);
  });
});

describe("SyncLog handlers - deck_reset", () => {
  // Helper: seed a deck with two cards and a review_log row each. The
  // cards land with reviewed state and modified timestamps in the past so
  // the resetAt cutoff (well after) catches them all.
  async function seedReviewedDeck(db: MainDatabaseService): Promise<void> {
    await db.createDeck({
      id: "deck_a",
      name: "A",
      filepath: "/a.md",
      tag: "#flashcards",
      lastReviewed: null,
      profileId: DEFAULT_PROFILE_ID,
    });
    for (const id of ["card_1", "card_2"]) {
      await db.createFlashcard({
        id,
        deckId: "deck_a",
        front: id,
        back: "back",
        type: "header-paragraph",
        sourceFile: "/a.md",
        contentHash: "h",
        breadcrumb: "",
        notes: "",
        tags: [],
        clozeText: null,
        clozeOrder: null,
        state: "review",
        dueDate: "2030-01-10T00:00:00Z",
        interval: 1440,
        repetitions: 3,
        difficulty: 6,
        stability: 4.2,
        lapses: 0,
        lastReviewed: "2030-01-01T00:00:00Z",
      } as Omit<Flashcard, "created" | "modified">);
      // Force modified to the historical timestamp so the cutoff math hits.
      await db.updateFlashcard(id, { modified: "2030-01-01T00:00:00Z" });
      await db.insertReviewLog({
        id: `log_${id}`,
        flashcardId: id,
        sessionId: undefined,
        lastReviewedAt: "2029-12-31T00:00:00Z",
        shownAt: undefined,
        reviewedAt: "2030-01-01T00:00:00Z",
        rating: 3,
        ratingLabel: "good",
        timeElapsedMs: 1000,
        oldState: "new",
        oldRepetitions: 0,
        oldLapses: 0,
        oldStability: 0,
        oldDifficulty: 5,
        newState: "review",
        newRepetitions: 3,
        newLapses: 0,
        newStability: 4.2,
        newDifficulty: 6,
        oldIntervalMinutes: 0,
        newIntervalMinutes: 1440,
        oldDueAt: "2030-01-01T00:00:00Z",
        newDueAt: "2030-01-10T00:00:00Z",
        elapsedDays: 1,
        retrievability: 0.9,
        requestRetention: 0.9,
        profile: "STANDARD",
        maximumIntervalDays: 36500,
        minMinutes: 1,
        fsrsWeightsVersion: "1.0",
        schedulerVersion: "1.0",
      });
    }
  }

  it("resets cards + deletes their logs when cutoff is later than their modified", async () => {
    const { db, adapter } = await freshDb();
    await seedReviewedDeck(db);

    // Sanity: both cards are in `review` state with review_logs.
    expect((await db.getFlashcardById("card_1"))!.state).toBe("review");
    const logsBefore = (await db.querySql<{ c: number }>(
      "SELECT COUNT(*) as c FROM review_logs WHERE flashcard_id IN ('card_1','card_2')",
      [],
      { asObject: true }
    ))[0].c;
    expect(logsBefore).toBe(2);

    const reset: DeckResetOp = {
      o: "deck_reset",
      p: { deckId: "deck_a", resetAt: "2030-06-01T00:00:00Z" },
    };
    await applyOp(db, "r", entry(1, reset), makeLogger(adapter));

    // Cards reset.
    const c1 = (await db.getFlashcardById("card_1"))!;
    expect(c1.state).toBe("new");
    expect(c1.stability).toBe(0);
    expect(c1.repetitions).toBe(0);
    expect(c1.lapses).toBe(0);
    // Logs gone.
    const logsAfter = (await db.querySql<{ c: number }>(
      "SELECT COUNT(*) as c FROM review_logs WHERE flashcard_id IN ('card_1','card_2')",
      [],
      { asObject: true }
    ))[0].c;
    expect(logsAfter).toBe(0);
  });

  it("preserves cards modified AFTER the cutoff (concurrent-rate guard)", async () => {
    const { db, adapter } = await freshDb();
    await seedReviewedDeck(db);

    // Simulate a concurrent rate on Device B AFTER Device A's reset moment:
    // bump card_1's modified to 2030-08-01, well past the reset cutoff.
    await db.updateFlashcard("card_1", { modified: "2030-08-01T00:00:00Z", stability: 9.9 });

    const reset: DeckResetOp = {
      o: "deck_reset",
      p: { deckId: "deck_a", resetAt: "2030-06-01T00:00:00Z" },
    };
    await applyOp(db, "r", entry(1, reset), makeLogger(adapter));

    // card_1 was newer than the reset — left alone.
    const c1 = (await db.getFlashcardById("card_1"))!;
    expect(c1.state).toBe("review");
    expect(c1.stability).toBeCloseTo(9.9);
    expect(c1.modified).toBe("2030-08-01T00:00:00Z");

    // card_2 was older — reset.
    const c2 = (await db.getFlashcardById("card_2"))!;
    expect(c2.state).toBe("new");
    expect(c2.stability).toBe(0);
  });

  it("only deletes review_logs with reviewed_at <= cutoff", async () => {
    const { db, adapter } = await freshDb();
    await seedReviewedDeck(db);

    // Add a newer log row (post-cutoff) — should survive the reset.
    await db.insertReviewLog({
      id: "log_newer",
      flashcardId: "card_1",
      sessionId: undefined,
      lastReviewedAt: "2030-07-31T00:00:00Z",
      shownAt: undefined,
      reviewedAt: "2030-08-01T00:00:00Z",
      rating: 4,
      ratingLabel: "easy",
      timeElapsedMs: 800,
      oldState: "review",
      oldRepetitions: 3,
      oldLapses: 0,
      oldStability: 4.2,
      oldDifficulty: 6,
      newState: "review",
      newRepetitions: 4,
      newLapses: 0,
      newStability: 9.9,
      newDifficulty: 5,
      oldIntervalMinutes: 1440,
      newIntervalMinutes: 2880,
      oldDueAt: "2030-01-10T00:00:00Z",
      newDueAt: "2030-08-05T00:00:00Z",
      elapsedDays: 213,
      retrievability: 0.95,
      requestRetention: 0.9,
      profile: "STANDARD",
      maximumIntervalDays: 36500,
      minMinutes: 1,
      fsrsWeightsVersion: "1.0",
      schedulerVersion: "1.0",
    });

    const reset: DeckResetOp = {
      o: "deck_reset",
      p: { deckId: "deck_a", resetAt: "2030-06-01T00:00:00Z" },
    };
    await applyOp(db, "r", entry(1, reset), makeLogger(adapter));

    const remainingLogIds = (await db.querySql<{ id: string }>(
      "SELECT id FROM review_logs",
      [],
      { asObject: true }
    )).map((r) => r.id);
    expect(remainingLogIds).toEqual(["log_newer"]);
  });

  it("is idempotent on replay (cards already reset stay reset)", async () => {
    const { db, adapter } = await freshDb();
    await seedReviewedDeck(db);

    const reset: DeckResetOp = {
      o: "deck_reset",
      p: { deckId: "deck_a", resetAt: "2030-06-01T00:00:00Z" },
    };
    await applyOp(db, "r", entry(1, reset), makeLogger(adapter));
    await applyOp(db, "r", entry(2, reset), makeLogger(adapter));

    const c1 = (await db.getFlashcardById("card_1"))!;
    expect(c1.state).toBe("new");
    expect(c1.modified).toBe("2030-06-01T00:00:00Z");
  });

  it("is a no-op when the deck doesn't exist locally (vault not synced)", async () => {
    const { db, adapter } = await freshDb();

    const reset: DeckResetOp = {
      o: "deck_reset",
      p: { deckId: "deck_unknown", resetAt: "2030-06-01T00:00:00Z" },
    };
    // Shouldn't throw, shouldn't affect anything.
    await applyOp(db, "r", entry(1, reset), makeLogger(adapter));
    expect(await db.getDeckById("deck_unknown")).toBeNull();
  });
});

describe("SyncLog handlers - custom_deck_reset", () => {
  // Set up a manual custom deck with one card in it that has review history.
  async function seedManualCustomDeck(db: MainDatabaseService): Promise<void> {
    await db.createDeck({
      id: "deck_host",
      name: "Host",
      filepath: "/host.md",
      tag: "#flashcards",
      lastReviewed: null,
      profileId: DEFAULT_PROFILE_ID,
    });
    await db.createFlashcard({
      id: "card_x",
      deckId: "deck_host",
      front: "Q",
      back: "A",
      type: "header-paragraph",
      sourceFile: "/host.md",
      contentHash: "h",
      breadcrumb: "",
      notes: "",
      tags: [],
      clozeText: null,
      clozeOrder: null,
      state: "review",
      dueDate: "2030-01-10T00:00:00Z",
      interval: 1440,
      repetitions: 3,
      difficulty: 6,
      stability: 4.2,
      lapses: 0,
      lastReviewed: "2030-01-01T00:00:00Z",
    } as Omit<Flashcard, "created" | "modified">);
    await db.updateFlashcard("card_x", { modified: "2030-01-01T00:00:00Z" });

    await db.createCustomDeck("My set", "manual", null);
    const cd = await db.getCustomDeckByName("My set");
    await db.addCardsToCustomDeck(cd!.id, ["card_x"]);

    await db.insertReviewLog({
      id: "log_x",
      flashcardId: "card_x",
      sessionId: undefined,
      lastReviewedAt: "2029-12-31T00:00:00Z",
      shownAt: undefined,
      reviewedAt: "2030-01-01T00:00:00Z",
      rating: 3,
      ratingLabel: "good",
      timeElapsedMs: 1000,
      oldState: "new",
      oldRepetitions: 0,
      oldLapses: 0,
      oldStability: 0,
      oldDifficulty: 5,
      newState: "review",
      newRepetitions: 3,
      newLapses: 0,
      newStability: 4.2,
      newDifficulty: 6,
      oldIntervalMinutes: 0,
      newIntervalMinutes: 1440,
      oldDueAt: "2030-01-01T00:00:00Z",
      newDueAt: "2030-01-10T00:00:00Z",
      elapsedDays: 1,
      retrievability: 0.9,
      requestRetention: 0.9,
      profile: "STANDARD",
      maximumIntervalDays: 36500,
      minMinutes: 1,
      fsrsWeightsVersion: "1.0",
      schedulerVersion: "1.0",
    });
  }

  it("resets cards + deletes logs for manual custom decks", async () => {
    const { db, adapter } = await freshDb();
    await seedManualCustomDeck(db);
    const cd = (await db.getCustomDeckByName("My set"))!;

    const reset: CustomDeckResetOp = {
      o: "custom_deck_reset",
      p: { customDeckId: cd.id, resetAt: "2030-06-01T00:00:00Z" },
    };
    await applyOp(db, "r", entry(1, reset), makeLogger(adapter));

    const c = (await db.getFlashcardById("card_x"))!;
    expect(c.state).toBe("new");
    expect(c.repetitions).toBe(0);
    const logRow = await db.getReviewLogById("log_x");
    expect(logRow).toBeNull();
  });

  it("is a no-op when the custom deck doesn't exist locally", async () => {
    const { db, adapter } = await freshDb();
    const reset: CustomDeckResetOp = {
      o: "custom_deck_reset",
      p: { customDeckId: "nope", resetAt: "2030-06-01T00:00:00Z" },
    };
    await applyOp(db, "r", entry(1, reset), makeLogger(adapter));
    expect(await db.getCustomDeckById("nope")).toBeNull();
  });
});

describe("BaseDatabaseService.removeAllCardsFromCustomDeck (sync emission)", () => {
  it("emits one custom_deck_card_remove op per cleared membership + writes local tombstones", async () => {
    const { db } = await freshDb();

    // Seed deck + two cards + custom deck holding both.
    await db.createDeck({
      id: "deck_host",
      name: "Host",
      filepath: "/host.md",
      tag: "#flashcards",
      lastReviewed: null,
      profileId: DEFAULT_PROFILE_ID,
    });
    for (const id of ["card_1", "card_2"]) {
      await db.createFlashcard({
        id,
        deckId: "deck_host",
        front: id,
        back: "back",
        type: "header-paragraph",
        sourceFile: "/host.md",
        contentHash: "h",
        breadcrumb: "",
        notes: "",
        tags: [],
        clozeText: null,
        clozeOrder: null,
        state: "new",
        dueDate: "2030-01-01T00:00:00Z",
        interval: 0,
        repetitions: 0,
        difficulty: 5,
        stability: 0,
        lapses: 0,
        lastReviewed: null,
      } as Omit<Flashcard, "created" | "modified">);
    }
    await db.createCustomDeck("Bulk", "manual", null);
    const cd = (await db.getCustomDeckByName("Bulk"))!;
    await db.addCardsToCustomDeck(cd.id, ["card_1", "card_2"]);

    // Spy on sync emission via the typed setter — BaseDatabaseService.emitSyncOp
    // routes through whatever syncLog is attached, so install a minimal stub.
    const emitted: Array<{ o: string; p: unknown }> = [];
    db.setSyncLog({
      append: (op: { o: string; p: unknown }) => {
        emitted.push(op);
        return 0;
      },
    } as unknown as Parameters<typeof db.setSyncLog>[0]);

    // The actual call under test.
    await db.removeAllCardsFromCustomDeck(cd.id);

    // Both junction rows removed.
    const remaining = await db.getFlashcardIdsForCustomDeck(cd.id);
    expect(remaining).toEqual([]);

    // One custom_deck_card_remove op per card.
    const removeOps = emitted.filter((o) => o.o === "custom_deck_card_remove");
    expect(removeOps).toHaveLength(2);
    const targets = removeOps
      .map((o) => (o.p as { flashcardId: string }).flashcardId)
      .sort();
    expect(targets).toEqual(["card_1", "card_2"]);

    // Tombstones written locally so stale remote _add ops can't resurrect.
    const tombs = (await db.querySql<{ flashcard_id: string }>(
      "SELECT flashcard_id FROM custom_deck_card_tombstones WHERE custom_deck_id = ?",
      [cd.id],
      { asObject: true }
    )).map((r) => r.flashcard_id).sort();
    expect(tombs).toEqual(["card_1", "card_2"]);
  });

  it("is a no-op (emits nothing) when the custom deck is empty", async () => {
    const { db } = await freshDb();
    await db.createCustomDeck("Empty", "manual", null);
    const cd = (await db.getCustomDeckByName("Empty"))!;

    const emitted: Array<{ o: string; p: unknown }> = [];
    db.setSyncLog({
      append: (op: { o: string; p: unknown }) => {
        emitted.push(op);
        return 0;
      },
    } as unknown as Parameters<typeof db.setSyncLog>[0]);

    await db.removeAllCardsFromCustomDeck(cd.id);

    expect(emitted).toHaveLength(0);
  });
});
