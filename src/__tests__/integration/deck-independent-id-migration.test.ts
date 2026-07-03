jest.unmock("sql.js");

import initSqlJs, { Database } from "sql.js";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  CREATE_TABLES_SQL,
  CURRENT_SCHEMA_VERSION,
  generateFlashcardId,
  generateReverseFlashcardId,
  generateClozeFlashcardId,
  generateLegacyDeckScopedFlashcardId,
  remapCardIdsToDeckIndependent,
} from "@decks/core";
import { getCurrentSchemaVersion, migrate } from "../../database/migrations";

async function loadSqlJs() {
  const sqlJsBinary = fs.readFileSync(
    path.resolve(__dirname, "../../../node_modules/sql.js/dist/sql-wasm.wasm")
  );
  return await initSqlJs({ wasmBinary: sqlJsBinary as unknown as ArrayBuffer });
}

let SQL: Awaited<ReturnType<typeof loadSqlJs>>;

beforeAll(async () => {
  SQL = await loadSqlJs();
});

function freshDb(): Database {
  const db = new SQL.Database();
  db.run(CREATE_TABLES_SQL);
  // These tests exercise review-log remapping; skip seeding decks by not
  // enforcing the flashcards→decks foreign key on the fixture inserts.
  db.run("PRAGMA foreign_keys = OFF");
  return db;
}

interface CardOpts {
  back?: string;
  type?: string;
  clozeText?: string | null;
  clozeOrder?: number | null;
}

function insertCard(
  db: Database,
  id: string,
  deckId: string,
  front: string,
  opts: CardOpts = {}
): void {
  db.run(
    `INSERT INTO flashcards
       (id, deck_id, front, back, type, source_file, content_hash,
        cloze_text, cloze_order, state, due_date, interval, created, modified)
     VALUES (?, ?, ?, ?, ?, 'note.md', 'hash', ?, ?, 'review',
             datetime('now'), 10, datetime('now'), datetime('now'))`,
    [
      id,
      deckId,
      front,
      opts.back ?? "back",
      opts.type ?? "header-paragraph",
      opts.clozeText ?? null,
      opts.clozeOrder ?? null,
    ]
  );
}

function insertLog(db: Database, logId: string, flashcardId: string): void {
  db.run(
    `INSERT INTO review_logs
       (id, flashcard_id, last_reviewed_at, reviewed_at, rating, rating_label,
        old_state, new_state, old_interval_minutes, new_interval_minutes,
        old_due_at, new_due_at, elapsed_days, retrievability, request_retention,
        profile, maximum_interval_days, min_minutes, fsrs_weights_version,
        scheduler_version)
     VALUES (?, ?, datetime('now'), datetime('now'), 3, 'good',
             'review', 'review', 6, 10, datetime('now'), datetime('now'),
             1.0, 0.9, 0.9, 'STANDARD', 36500, 1, '1.0', '1.0')`,
    [logId, flashcardId]
  );
}

function logFlashcardId(db: Database, logId: string): string | undefined {
  const stmt = db.prepare("SELECT flashcard_id FROM review_logs WHERE id = ?");
  stmt.bind([logId]);
  const id = stmt.step()
    ? (stmt.getAsObject().flashcard_id as string)
    : undefined;
  stmt.free();
  return id;
}

describe("deck-independent card ID migration", () => {
  describe("remapCardIdsToDeckIndependent", () => {
    it("re-points review logs from deck-scoped IDs to front-based IDs", () => {
      const db = freshDb();
      const oldId = generateLegacyDeckScopedFlashcardId(
        "Capital of France",
        "deck_geo"
      );
      insertCard(db, oldId, "deck_geo", "Capital of France");
      insertLog(db, "log_1", oldId);

      const remapped = remapCardIdsToDeckIndependent(db);

      expect(remapped).toBe(1);
      expect(logFlashcardId(db, "log_1")).toBe(
        generateFlashcardId("Capital of France")
      );
      db.close();
    });

    it("converges identical fronts in different decks to one shared history", () => {
      const db = freshDb();
      const idA = generateLegacyDeckScopedFlashcardId("Shared Q", "deck_a");
      const idB = generateLegacyDeckScopedFlashcardId("Shared Q", "deck_b");
      expect(idA).not.toBe(idB); // deck-scoped: distinct before migration
      insertCard(db, idA, "deck_a", "Shared Q");
      insertCard(db, idB, "deck_b", "Shared Q");
      insertLog(db, "log_a", idA);
      insertLog(db, "log_b", idB);

      remapCardIdsToDeckIndependent(db);

      const shared = generateFlashcardId("Shared Q");
      expect(logFlashcardId(db, "log_a")).toBe(shared);
      expect(logFlashcardId(db, "log_b")).toBe(shared);
      db.close();
    });

    it("re-points reverse and cloze cards by their front-based IDs", () => {
      const db = freshDb();
      // Reverse card: the stored back is the original front the ID is keyed on.
      insertCard(db, "rcard_legacy", "deck_x", "front", {
        back: "original front",
      });
      insertLog(db, "log_rev", "rcard_legacy");
      insertCard(db, "ccard_legacy", "deck_x", "Sentence", {
        type: "cloze",
        clozeText: "answer",
        clozeOrder: 0,
      });
      insertLog(db, "log_cloze", "ccard_legacy");

      remapCardIdsToDeckIndependent(db);

      expect(logFlashcardId(db, "log_rev")).toBe(
        generateReverseFlashcardId("original front")
      );
      expect(logFlashcardId(db, "log_cloze")).toBe(
        generateClozeFlashcardId("Sentence", "answer", 0)
      );
      db.close();
    });

    it("preserves every review log row (no data loss)", () => {
      const db = freshDb();
      const oldId = generateLegacyDeckScopedFlashcardId("Q", "deck_1");
      insertCard(db, oldId, "deck_1", "Q");
      insertLog(db, "log_1", oldId);
      insertLog(db, "log_2", oldId);

      remapCardIdsToDeckIndependent(db);

      const stmt = db.prepare("SELECT COUNT(*) AS c FROM review_logs");
      stmt.step();
      expect((stmt.getAsObject() as { c: number }).c).toBe(2);
      stmt.free();
      db.close();
    });

    it("does not disturb logs already on a front-based ID (idempotent data)", () => {
      const db = freshDb();
      const oldId = generateLegacyDeckScopedFlashcardId("Q", "deck_1");
      insertCard(db, oldId, "deck_1", "Q");
      insertLog(db, "log_1", oldId);

      remapCardIdsToDeckIndependent(db);
      const afterFirst = logFlashcardId(db, "log_1");
      remapCardIdsToDeckIndependent(db);

      expect(logFlashcardId(db, "log_1")).toBe(afterFirst);
      expect(afterFirst).toBe(generateFlashcardId("Q"));
      db.close();
    });
  });

  describe("migrate() end-to-end", () => {
    it("bumps to the current version and preserves re-pointed review logs", () => {
      const db = freshDb();
      const oldId = generateLegacyDeckScopedFlashcardId(
        "Mitochondria",
        "deck_bio"
      );
      insertCard(db, oldId, "deck_bio", "Mitochondria");
      insertLog(db, "log_1", oldId);
      db.run("PRAGMA user_version = 35");

      migrate(db);

      expect(getCurrentSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
      // review_logs is the durable table: the row survives the rebuild and now
      // points at the new deck-independent ID.
      const stmt = db.prepare("SELECT COUNT(*) AS c FROM review_logs");
      stmt.step();
      expect((stmt.getAsObject() as { c: number }).c).toBe(1);
      stmt.free();
      expect(logFlashcardId(db, "log_1")).toBe(
        generateFlashcardId("Mitochondria")
      );
      db.close();
    });
  });
});
