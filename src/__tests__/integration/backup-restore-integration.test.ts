jest.unmock("sql.js");

import initSqlJs, { Database } from "sql.js";
import * as fs from "node:fs";
import * as path from "node:path";

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
  InMemoryAdapter,
} from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import { CURRENT_SCHEMA_VERSION } from "@decks/core";
import { getCurrentSchemaVersion, migrate } from "../../database/migrations";
import type { Deck, DeckProfile, FilterDefinition } from "../../database/types";

function tableHasColumn(db: Database, table: string, column: string): boolean {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  let found = false;
  while (stmt.step()) {
    const row = stmt.get();
    if (row[1] === column) {
      found = true;
      break;
    }
  }
  stmt.free();
  return found;
}

async function loadSqlJs() {
  const sqlJsBinary = fs.readFileSync(
    path.resolve(__dirname, "../../../node_modules/sql.js/dist/sql-wasm.wasm")
  );
  return await initSqlJs({ wasmBinary: sqlJsBinary as unknown as ArrayBuffer });
}

describe("Backup and restore integration", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createTestDeck(name: string): Promise<{ deck: Deck; profile: DeckProfile }> {
    const profile = await db.getDefaultProfile();
    const filepath = `/test/${name}.md`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name,
      filepath,
      tag: "decks/test",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    return { deck, profile };
  }

  describe("backup file contents", () => {
    it("writes a backup file at the requested path with the current schema version", async () => {
      const { deck, profile } = await createTestDeck("backup-basic");
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: `## Card #math\n\nAnswer\n`,
      });

      const backupPath = "/backup-basic.db";
      await db.createBackupDatabase(backupPath);

      const adapter = db["adapter"] as InMemoryAdapter;
      expect(await adapter.exists(backupPath)).toBe(true);

      const buffer = await adapter.readBinary(backupPath);
      const SQL = await loadSqlJs();
      const backupDb = new SQL.Database(new Uint8Array(buffer));

      expect(getCurrentSchemaVersion(backupDb)).toBe(CURRENT_SCHEMA_VERSION);

      // All current-schema tables should exist in the backup
      for (const table of [
        "decks",
        "flashcards",
        "deckprofiles",
        "profile_tag_mappings",
        "review_sessions",
        "review_logs",
        "custom_decks",
        "custom_deck_cards",
      ]) {
        expect(tableHasColumn(backupDb, table, "id")).toBe(true);
      }

      // Flashcard tags column exists and stores the value
      expect(tableHasColumn(backupDb, "flashcards", "tags")).toBe(true);
      const stmt = backupDb.prepare("SELECT front, tags FROM flashcards");
      const cards: Array<{ front: string; tags: string }> = [];
      while (stmt.step()) {
        const row = stmt.get();
        cards.push({ front: row[0] as string, tags: row[1] as string });
      }
      stmt.free();
      expect(cards).toHaveLength(1);
      expect(cards[0].tags).toBe("math");

      backupDb.close();
    });
  });

  describe("backup → restore roundtrip", () => {
    it("preserves deckprofiles", async () => {
      const profileId = "profile_aggressive";
      await db.createProfile({
        id: profileId,
        name: "Aggressive",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 50,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 200,
        headerLevel: 3,
        reviewOrder: "random",
        learningSteps: "5m 15m",
        relearningSteps: "20m",
        fsrs: { requestRetention: 0.85, profile: "TRAINED" },
        clozeEnabled: true,
        clozeShowContext: "open",
        isDefault: false,
      });

      const backupPath = "/backup-profiles.db";
      await db.createBackupDatabase(backupPath);

      await db["executeSql"]("DELETE FROM deckprofiles WHERE id = ?", [profileId]);
      expect(await db.getProfileById(profileId)).toBeNull();

      await db.restoreFromBackupDatabase(backupPath);

      const restored = await db.getProfileById(profileId);
      expect(restored).not.toBeNull();
      expect(restored?.name).toBe("Aggressive");
      expect(restored?.fsrs.profile).toBe("TRAINED");
      expect(restored?.newCardsPerDay).toBe(50);
      expect(restored?.learningSteps).toBe("5m 15m");
    });

    it("preserves custom decks (manual and filter)", async () => {
      const manualId = await db.createCustomDeck("manual-deck", "manual", null);
      const filterDef: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "tags", operator: "contains", value: "math" }],
      };
      const filterId = await db.createCustomDeck(
        "filter-deck",
        "filter",
        JSON.stringify(filterDef)
      );

      const backupPath = "/backup-custom.db";
      await db.createBackupDatabase(backupPath);

      await db["executeSql"]("DELETE FROM custom_decks", []);
      expect(await db.getCustomDeckById(manualId)).toBeNull();
      expect(await db.getCustomDeckById(filterId)).toBeNull();

      await db.restoreFromBackupDatabase(backupPath);

      const manual = await db.getCustomDeckById(manualId);
      expect(manual?.deckType).toBe("manual");
      expect(manual?.filterDefinition).toBeNull();

      const filter = await db.getCustomDeckById(filterId);
      expect(filter?.deckType).toBe("filter");
      const restoredFilter = JSON.parse(filter!.filterDefinition!) as FilterDefinition;
      expect(restoredFilter.rules[0].field).toBe("tags");
      expect(restoredFilter.rules[0].value).toBe("math");
    });

    it("preserves review_logs (so FSRS state can be restored on next sync)", async () => {
      const { deck, profile } = await createTestDeck("backup-logs");
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: `## Card\n\nAnswer\n`,
      });
      const cards = await db.getFlashcardsByDeck(deck.id);
      const cardId = cards[0].id;

      // Insert a review log directly
      await db["executeSql"](
        `INSERT INTO review_logs (
          id, flashcard_id, last_reviewed_at, reviewed_at,
          rating, rating_label, time_elapsed_ms,
          old_state, old_repetitions, old_lapses, old_stability, old_difficulty,
          new_state, new_repetitions, new_lapses, new_stability, new_difficulty,
          old_interval_minutes, new_interval_minutes, old_due_at, new_due_at,
          elapsed_days, retrievability, request_retention, profile,
          maximum_interval_days, min_minutes, fsrs_weights_version, scheduler_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "log_test", cardId, new Date().toISOString(), new Date().toISOString(),
          3, "good", 5000,
          "new", 0, 0, 0, 5.0,
          "review", 1, 0, 2.5, 5.0,
          0, 1440, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString(),
          1.0, 0.9, 0.9, "STANDARD",
          36500, 1, "4.5", "1.0",
        ]
      );

      const backupPath = "/backup-logs.db";
      await db.createBackupDatabase(backupPath);

      // Wipe review_logs
      await db["executeSql"]("DELETE FROM review_logs", []);
      const beforeStmt = await db["querySql"]("SELECT COUNT(*) FROM review_logs");
      expect((beforeStmt as unknown as number[][])[0][0]).toBe(0);

      await db.restoreFromBackupDatabase(backupPath);

      const afterStmt = await db["querySql"]("SELECT COUNT(*), flashcard_id FROM review_logs");
      const afterRows = afterStmt as unknown as (string | number)[][];
      expect(afterRows[0][0]).toBe(1);
      expect(afterRows[0][1]).toBe(cardId);
    });

    it("preserves profile_tag_mappings", async () => {
      const profile = await db.getDefaultProfile();
      await db["executeSql"](
        `INSERT INTO profile_tag_mappings (id, profile_id, tag, created)
         VALUES (?, ?, ?, ?)`,
        ["mapping_1", profile.id, "decks/math", new Date().toISOString()]
      );

      const backupPath = "/backup-mappings.db";
      await db.createBackupDatabase(backupPath);

      await db["executeSql"]("DELETE FROM profile_tag_mappings", []);

      await db.restoreFromBackupDatabase(backupPath);

      const rows = (await db["querySql"](
        "SELECT id, tag FROM profile_tag_mappings"
      )) as (string | number)[][];
      expect(rows).toHaveLength(1);
      expect(rows[0][0]).toBe("mapping_1");
      expect(rows[0][1]).toBe("decks/math");
    });

    it("does NOT restore the flashcards table (vault re-sync repopulates it)", async () => {
      // This documents the deliberate design: flashcards are NOT in the
      // restore path because they're regenerated from vault content.
      const { deck, profile } = await createTestDeck("backup-flashcards");
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: `## Card\n\nAnswer\n`,
      });

      const backupPath = "/backup-no-flashcards.db";
      await db.createBackupDatabase(backupPath);

      // Wipe flashcards locally
      await db["executeSql"]("DELETE FROM flashcards", []);
      expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(0);

      // Restore — flashcards are intentionally NOT restored
      await db.restoreFromBackupDatabase(backupPath);
      expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(0);
    });
  });

  describe("backward compatibility (older backups)", () => {
    it("restores a v14-style backup (no tags column on flashcards) without errors", async () => {
      // Restore code maps columns dynamically — missing columns on the remote
      // side are skipped, and the local side keeps its current schema.
      const SQL = await loadSqlJs();
      const v14Db = new SQL.Database();
      v14Db.run(`
        PRAGMA foreign_keys = OFF;
        BEGIN;

        CREATE TABLE custom_decks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          deck_type TEXT NOT NULL DEFAULT 'manual',
          filter_definition TEXT,
          last_reviewed TEXT,
          created TEXT NOT NULL,
          modified TEXT NOT NULL
        );

        INSERT INTO custom_decks (id, name, deck_type, filter_definition, last_reviewed, created, modified)
        VALUES (
          'cd_v14', 'legacy-filter', 'filter',
          '{"version":1,"logic":"AND","rules":[{"field":"state","operator":"is_new","value":""}]}',
          NULL, datetime('now'), datetime('now')
        );

        PRAGMA user_version = 14;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
      const v14Bytes = v14Db.export();
      v14Db.close();

      const adapter = db["adapter"] as InMemoryAdapter;
      const backupPath = "/backup-v14.db";
      await adapter.writeBinary(
        backupPath,
        v14Bytes.buffer.slice(0) as ArrayBuffer
      );

      // Should not throw
      await db.restoreFromBackupDatabase(backupPath);

      // Legacy custom deck made it across
      const restored = await db.getCustomDeckById("cd_v14");
      expect(restored).not.toBeNull();
      expect(restored?.deckType).toBe("filter");
    });
  });

  describe("v22 profile migration (INTENSIVE/trained-flag collapse)", () => {
    function readProfile(database: Database, id: string): Record<string, unknown> {
      const stmt = database.prepare(
        `SELECT fsrs_profile FROM deckprofiles WHERE id = ?`
      );
      stmt.bind([id]);
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }

    it("maps INTENSIVE -> STANDARD, trained flag -> TRAINED, and drops fsrs_use_trained", async () => {
      const SQL = await loadSqlJs();
      const oldDb = new SQL.Database();
      // Pre-v22 deckprofiles: INTENSIVE in the CHECK and a separate fsrs_use_trained flag.
      oldDb.run(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE deckprofiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          has_new_cards_limit_enabled INTEGER NOT NULL DEFAULT 0,
          new_cards_per_day INTEGER NOT NULL DEFAULT 20,
          has_review_cards_limit_enabled INTEGER NOT NULL DEFAULT 0,
          review_cards_per_day INTEGER NOT NULL DEFAULT 100,
          header_level INTEGER NOT NULL DEFAULT 2,
          review_order TEXT NOT NULL DEFAULT 'due-date',
          learning_steps TEXT NOT NULL DEFAULT '1m',
          relearning_steps TEXT NOT NULL DEFAULT '10m',
          fsrs_request_retention REAL NOT NULL DEFAULT 0.9,
          fsrs_profile TEXT NOT NULL DEFAULT 'STANDARD' CHECK (fsrs_profile IN ('INTENSIVE', 'STANDARD')),
          fsrs_use_trained INTEGER NOT NULL DEFAULT 0,
          cloze_enabled INTEGER NOT NULL DEFAULT 1,
          cloze_show_context TEXT NOT NULL DEFAULT 'hidden',
          is_default INTEGER NOT NULL DEFAULT 0,
          created TEXT NOT NULL,
          modified TEXT NOT NULL,
          deleted_at TEXT
        );
        INSERT INTO deckprofiles (id, name, fsrs_profile, fsrs_use_trained, is_default, created, modified) VALUES
          ('profile_default', 'DEFAULT', 'STANDARD', 0, 1, datetime('now'), datetime('now')),
          ('profile_intensive', 'Intensive', 'INTENSIVE', 0, 0, datetime('now'), datetime('now')),
          ('profile_trained', 'Trained', 'STANDARD', 1, 0, datetime('now'), datetime('now'));
        PRAGMA user_version = 21;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);

      migrate(oldDb);

      expect(getCurrentSchemaVersion(oldDb)).toBe(CURRENT_SCHEMA_VERSION);
      // The trained flag column is gone.
      expect(tableHasColumn(oldDb, "deckprofiles", "fsrs_use_trained")).toBe(false);
      // Values are remapped onto the two surviving profiles.
      expect(readProfile(oldDb, "profile_default").fsrs_profile).toBe("STANDARD");
      expect(readProfile(oldDb, "profile_intensive").fsrs_profile).toBe("STANDARD");
      expect(readProfile(oldDb, "profile_trained").fsrs_profile).toBe("TRAINED");

      oldDb.close();
    });

    it("preserves legacy INTENSIVE values in review_logs for training", async () => {
      const SQL = await loadSqlJs();
      const oldDb = new SQL.Database();
      oldDb.run(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE review_logs (
          id TEXT PRIMARY KEY,
          flashcard_id TEXT NOT NULL,
          session_id TEXT,
          last_reviewed_at TEXT NOT NULL,
          shown_at TEXT,
          reviewed_at TEXT NOT NULL,
          rating INTEGER NOT NULL,
          rating_label TEXT NOT NULL,
          time_elapsed_ms INTEGER,
          old_state TEXT NOT NULL,
          old_repetitions INTEGER NOT NULL DEFAULT 0,
          old_lapses INTEGER NOT NULL DEFAULT 0,
          old_stability REAL NOT NULL DEFAULT 0,
          old_difficulty REAL NOT NULL DEFAULT 5.0,
          new_state TEXT NOT NULL,
          new_repetitions INTEGER NOT NULL DEFAULT 0,
          new_lapses INTEGER NOT NULL DEFAULT 0,
          new_stability REAL NOT NULL DEFAULT 2.5,
          new_difficulty REAL NOT NULL DEFAULT 5.0,
          old_interval_minutes INTEGER NOT NULL,
          new_interval_minutes INTEGER NOT NULL,
          old_due_at TEXT NOT NULL,
          new_due_at TEXT NOT NULL,
          elapsed_days REAL NOT NULL,
          retrievability REAL NOT NULL,
          request_retention REAL NOT NULL,
          profile TEXT NOT NULL DEFAULT 'STANDARD' CHECK (profile IN ('INTENSIVE', 'STANDARD')),
          maximum_interval_days INTEGER NOT NULL,
          min_minutes INTEGER NOT NULL,
          fsrs_weights_version TEXT NOT NULL,
          scheduler_version TEXT NOT NULL,
          note_model_id TEXT,
          card_template_id TEXT,
          content_hash TEXT,
          client TEXT
        );
        INSERT INTO review_logs (id, flashcard_id, last_reviewed_at, reviewed_at, rating, rating_label,
          old_state, new_state, old_interval_minutes, new_interval_minutes, old_due_at, new_due_at,
          elapsed_days, retrievability, request_retention, profile, maximum_interval_days, min_minutes,
          fsrs_weights_version, scheduler_version)
        VALUES ('log_1', 'card_1', datetime('now'), datetime('now'), 3, 'good',
          'review', 'review', 6, 10, datetime('now'), datetime('now'),
          0.004, 0.9, 0.9, 'INTENSIVE', 36500, 1, '1.0', '1.0');
        PRAGMA user_version = 21;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);

      migrate(oldDb);

      const stmt = oldDb.prepare(`SELECT profile FROM review_logs WHERE id = 'log_1'`);
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();
      // Historical review rows keep their snapshot profile so the optimizer can train on them.
      expect(row.profile).toBe("INTENSIVE");

      oldDb.close();
    });
  });

  describe("v23 trained weight sets migration", () => {
    it("creates fsrs_weight_sets and adds review_logs.fsrs_weight_set_id", async () => {
      const SQL = await loadSqlJs();
      const oldDb = new SQL.Database();
      // Minimal pre-v23 DB: a review_logs table without the new column, no weight-sets table.
      oldDb.run(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE review_logs (
          id TEXT PRIMARY KEY,
          flashcard_id TEXT NOT NULL,
          last_reviewed_at TEXT NOT NULL,
          reviewed_at TEXT NOT NULL,
          rating INTEGER NOT NULL,
          rating_label TEXT NOT NULL,
          old_state TEXT NOT NULL,
          new_state TEXT NOT NULL,
          old_interval_minutes INTEGER NOT NULL,
          new_interval_minutes INTEGER NOT NULL,
          old_due_at TEXT NOT NULL,
          new_due_at TEXT NOT NULL,
          elapsed_days REAL NOT NULL,
          retrievability REAL NOT NULL,
          request_retention REAL NOT NULL,
          profile TEXT NOT NULL DEFAULT 'STANDARD',
          maximum_interval_days INTEGER NOT NULL,
          min_minutes INTEGER NOT NULL,
          fsrs_weights_version TEXT NOT NULL,
          scheduler_version TEXT NOT NULL
        );
        PRAGMA user_version = 22;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);

      migrate(oldDb);

      expect(getCurrentSchemaVersion(oldDb)).toBe(CURRENT_SCHEMA_VERSION);
      expect(tableHasColumn(oldDb, "review_logs", "fsrs_weight_set_id")).toBe(true);
      // The weight-sets table now exists.
      const tables = oldDb.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='fsrs_weight_sets'`
      );
      expect(tables.length).toBe(1);

      oldDb.close();
    });
  });
});
