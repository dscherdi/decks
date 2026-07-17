// Schema v39 integration: exam tables, deckprofiles exam columns, the Exams
// preset, the widened flashcards.type CHECK, and the profile plumbing
// (round-trip, parsingAffected gate, profile_upsert handler).

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  CREATE_TABLES_SQL,
  DEFAULT_EXAM_SETTINGS,
  EXAMS_PROFILE_ID,
  applyOp,
  buildMigrationSQL,
  type HLCValue,
  type ProfileUpsertOp,
  type SyncLogEntry,
} from "@decks/core";
import {
  DatabaseTestUtils,
  InMemoryAdapter,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { Logger } from "../../utils/logging";
import initSqlJs from "sql.js";
import * as path from "node:path";

const HLC: HLCValue = [1_000_000, 0, "remote-dev"];

function makeLogger(adapter: InMemoryAdapter): Logger {
  return new Logger(
    { debug: { enableLogging: false, performanceLogs: false } } as never,
    adapter,
    ".obsidian",
    "decks"
  );
}

function entry<T extends { o: string; p: unknown }>(seq: number, op: T): SyncLogEntry {
  return { hlc: HLC, s: seq, v: 1, o: op.o, p: op.p } as SyncLogEntry;
}

function profileUpsertOp(
  id: string,
  modified: string,
  extra: Partial<ProfileUpsertOp["p"]> = {}
): ProfileUpsertOp {
  return {
    o: "profile_upsert",
    p: {
      id,
      name: `Profile ${id}`,
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
      clozeEnabled: true,
      clozeShowContext: "hidden",
      isDefault: false,
      created: modified,
      modified,
      ...extra,
    },
  };
}

describe("Exam schema v39", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("creates the exam tables on a fresh (migrated) database", async () => {
    const rows = await db.querySql<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('exam_sessions','exam_answers')",
      [],
      { asObject: true }
    );
    expect(rows.map((r) => r.name).sort()).toEqual(["exam_answers", "exam_sessions"]);
  });

  it("seeds the Exams preset with exam enabled and a zeroed new-cards limit", async () => {
    const preset = await db.getProfileById(EXAMS_PROFILE_ID);
    expect(preset).not.toBeNull();
    expect(preset!.name).toBe("Exams");
    expect(preset!.examEnabled).toBe(true);
    expect(preset!.hasNewCardsLimitEnabled).toBe(true);
    expect(preset!.newCardsPerDay).toBe(0);
    expect(preset!.clozeEnabled).toBe(true);
    expect(preset!.headerLevel).toBe(2);
    expect(preset!.examSettings).toEqual(DEFAULT_EXAM_SETTINGS);
  });

  it("accepts type='multiple-choice' in the flashcards CHECK", async () => {
    const deck = DatabaseTestUtils.createTestDeck({
      id: "exam_check_deck",
      filepath: "exam-check.md",
      tag: "#exam-check",
    });
    await db.createDeck(deck);
    const card = DatabaseTestUtils.createTestFlashcard(deck.id, {
      id: "mcq_card_1",
      front: "Which element is a noble gas?",
    });
    await db.createFlashcard({ ...card, type: "multiple-choice" });
    const got = await db.getFlashcardById("mcq_card_1");
    expect(got?.type).toBe("multiple-choice");
  });

  // The production worker migration path runs ONLY buildMigrationSQL, so the
  // v38→v39 additions (tables, columns, preset) must all materialize there.
  it("worker migration path upgrades a simulated v38 database", async () => {
    const wasmPath = path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm");
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const raw = new SQL.Database();
    try {
      raw.run(CREATE_TABLES_SQL);
      // Rebuild deckprofiles to the v38 shape (no exam columns), drop the
      // exam tables and the seeded preset, and rewind the version.
      raw.run(`
        CREATE TABLE deckprofiles_v38 AS SELECT
          id, name, has_new_cards_limit_enabled, new_cards_per_day,
          has_review_cards_limit_enabled, review_cards_per_day,
          header_level, extra_header_levels, review_order,
          learning_steps, relearning_steps,
          fsrs_request_retention, fsrs_profile,
          cloze_enabled, cloze_show_context,
          is_default, created, modified, deleted_at
        FROM deckprofiles;
        DROP TABLE deckprofiles;
        ALTER TABLE deckprofiles_v38 RENAME TO deckprofiles;
        DELETE FROM deckprofiles WHERE id = '${EXAMS_PROFILE_ID}';
        DROP TABLE IF EXISTS exam_answers;
        DROP TABLE IF EXISTS exam_sessions;
        PRAGMA user_version = 38;
      `);

      raw.exec(buildMigrationSQL(raw));

      const tables = raw
        .exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'exam%'")[0]
        .values.map((v) => v[0])
        .sort();
      expect(tables).toEqual(["exam_answers", "exam_sessions"]);

      const cols = raw
        .exec("PRAGMA table_info(deckprofiles)")[0]
        .values.map((v) => v[1]);
      expect(cols).toContain("exam_enabled");
      expect(cols).toContain("exam_settings");

      const preset = raw.exec(
        `SELECT exam_enabled, has_new_cards_limit_enabled, new_cards_per_day
         FROM deckprofiles WHERE id = '${EXAMS_PROFILE_ID}'`
      )[0].values[0];
      expect(preset).toEqual([1, 1, 0]);

      // Pre-existing profiles keep defaults for the new columns.
      const defaults = raw.exec(
        "SELECT exam_enabled, exam_settings FROM deckprofiles WHERE id = 'profile_default'"
      )[0].values[0];
      expect(defaults).toEqual([0, "{}"]);
    } finally {
      raw.close();
    }
  });

  it("round-trips exam fields through create/get/update", async () => {
    const created = await db.getDefaultProfile();
    await db.createProfile({
      ...created,
      id: "prof_exam_rt",
      name: "Exam round trip",
      isDefault: false,
      examEnabled: true,
      examSettings: { ...DEFAULT_EXAM_SETTINGS, passScorePct: 80, timeLimitMinutes: 15 },
    });
    const got = await db.getProfileById("prof_exam_rt");
    expect(got!.examEnabled).toBe(true);
    expect(got!.examSettings!.passScorePct).toBe(80);
    expect(got!.examSettings!.timeLimitMinutes).toBe(15);

    await db.updateProfile("prof_exam_rt", {
      examSettings: { ...DEFAULT_EXAM_SETTINGS, questionCount: 10 },
    });
    const updated = await db.getProfileById("prof_exam_rt");
    expect(updated!.examSettings!.questionCount).toBe(10);
    expect(updated!.examEnabled).toBe(true);
  });

  it("re-parses decks when examEnabled flips, but not for examSettings-only changes", async () => {
    const deck = DatabaseTestUtils.createTestDeck({
      id: "exam_gate_deck",
      filepath: "exam-gate.md",
      tag: "#exam-gate",
    });
    await db.createDeck(deck);
    const profile = await db.getDefaultProfile();
    await db.createProfile({
      ...profile,
      id: "prof_exam_gate",
      name: "Exam gate",
      isDefault: false,
      examEnabled: false,
    });
    await db.executeSql(
      "UPDATE decks SET profile_id = ?, last_synced_mtime = 12345 WHERE id = ?",
      ["prof_exam_gate", deck.id]
    );

    const mtime = async (): Promise<number> => {
      const rows = await db.querySql<{ m: number }>(
        "SELECT last_synced_mtime as m FROM decks WHERE id = ?",
        [deck.id],
        { asObject: true }
      );
      return rows[0].m;
    };

    await db.updateProfile("prof_exam_gate", {
      examSettings: { ...DEFAULT_EXAM_SETTINGS, passScorePct: 90 },
    });
    expect(await mtime()).toBe(12345);

    await db.updateProfile("prof_exam_gate", { examEnabled: true });
    expect(await mtime()).toBe(0);
  });

  it("applies profile_upsert ops with and without exam fields", async () => {
    const adapter = new InMemoryAdapter();
    const logger = makeLogger(adapter);

    await applyOp(
      db,
      "remote-dev",
      entry(
        1,
        profileUpsertOp("prof_op_exam", "2030-01-01T00:00:00Z", {
          examEnabled: true,
          examSettings: { ...DEFAULT_EXAM_SETTINGS, optionLabels: "numbers" },
        })
      ),
      logger
    );
    const withExam = await db.getProfileById("prof_op_exam");
    expect(withExam!.examEnabled).toBe(true);
    expect(withExam!.examSettings!.optionLabels).toBe("numbers");

    // An op from an older client omits the fields → column defaults apply.
    await applyOp(
      db,
      "remote-dev",
      entry(2, profileUpsertOp("prof_op_legacy", "2030-01-01T00:00:00Z")),
      logger
    );
    const legacy = await db.getProfileById("prof_op_legacy");
    expect(legacy!.examEnabled).toBe(false);
    expect(legacy!.examSettings).toEqual(DEFAULT_EXAM_SETTINGS);
  });
});
