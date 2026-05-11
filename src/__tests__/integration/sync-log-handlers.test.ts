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
