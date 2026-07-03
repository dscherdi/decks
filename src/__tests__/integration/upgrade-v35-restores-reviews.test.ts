jest.unmock("sql.js");

import initSqlJs, { Database } from "sql.js";
import * as fs from "node:fs";
import * as path from "node:path";

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter } from "./database-test-utils";
import { setupRealSqlJs } from "./setup-real-sql";
import {
  CREATE_TABLES_SQL,
  generateDeckId,
  generateFlashcardId,
  generateLegacyDeckScopedFlashcardId,
} from "@decks/core";
import type { Deck } from "../../database/types";

async function loadSqlJs() {
  const bin = fs.readFileSync(
    path.resolve(__dirname, "../../../node_modules/sql.js/dist/sql-wasm.wasm")
  );
  return await initSqlJs({ wasmBinary: bin as unknown as ArrayBuffer });
}

const FRONT = "Capital of France";
const FILE_CONTENT = `## Topic

| Front | Back |
|-------|------|
| ${FRONT} | Paris |
`;

// Build a v35 database (deck-scoped card ID + a matching review log) as bytes,
// mimicking what a user upgrading from the previous release would have on disk.
function buildV35Bytes(SQL: { Database: new () => Database }): Uint8Array {
  const deckId = generateDeckId("/geo.md");
  const oldCardId = generateLegacyDeckScopedFlashcardId(FRONT, deckId);
  const raw = new SQL.Database();
  raw.run(CREATE_TABLES_SQL);
  raw.run("PRAGMA foreign_keys = OFF");
  raw.run(
    `INSERT INTO decks (id, name, filepath, tag, profile_id, created, modified)
     VALUES (?, 'geo', '/geo.md', 'decks/test', 'default', datetime('now'), datetime('now'))`,
    [deckId]
  );
  raw.run(
    `INSERT INTO flashcards
       (id, deck_id, front, back, type, source_file, content_hash, state,
        due_date, interval, stability, repetitions, difficulty, lapses,
        created, modified)
     VALUES (?, ?, ?, 'Paris', 'header-paragraph', '/geo.md', 'h', 'review',
             datetime('now'), 600, 42, 3, 5, 0, datetime('now'), datetime('now'))`,
    [oldCardId, deckId, FRONT]
  );
  raw.run(
    `INSERT INTO review_logs
       (id, flashcard_id, last_reviewed_at, reviewed_at, rating, rating_label,
        old_state, new_state, old_interval_minutes, new_interval_minutes,
        old_due_at, new_due_at, elapsed_days, retrievability, request_retention,
        profile, maximum_interval_days, min_minutes, fsrs_weights_version,
        scheduler_version, new_stability)
     VALUES ('log1', ?, datetime('now'), datetime('now'), 3, 'good',
             'new', 'review', 0, 600, datetime('now'), datetime('now'),
             1.0, 0.9, 0.9, 'STANDARD', 36500, 1, '1.0', '1.0', 42)`,
    [oldCardId]
  );
  raw.run("PRAGMA user_version = 35");
  const bytes = raw.export();
  raw.close();
  return bytes;
}

describe("upgrading a v35 database to deck-independent IDs", () => {
  it("re-links review history to the re-synced cards (no manual rebuild needed)", async () => {
    const SQL = await loadSqlJs();
    await setupRealSqlJs();

    const deckId = generateDeckId("/geo.md");
    const bytes = buildV35Bytes(SQL);

    // Put the v35 DB on disk, then open it — this runs the real migration path
    // (MainDatabaseService.migrateSchemaIfNeeded → remap + buildMigrationSQL).
    const adapter = new InMemoryAdapter();
    await adapter.writeBinary(
      "/db.db",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
    const db = new MainDatabaseService("/db.db", adapter, () => undefined);
    await db.initialize();

    // The migration drops flashcards (rebuilt from the vault) but keeps the
    // review_logs — re-pointed to the deck-independent ID.
    expect(await db.getFlashcardsByDeck(deckId)).toHaveLength(0);

    // Startup re-sync recreates the card with its deck-independent ID; Smart
    // Restoration pulls the FSRS state back from the re-pointed review log.
    const profile = await db.getDefaultProfile();
    const deck: Deck = {
      id: deckId,
      name: "geo",
      filepath: "/geo.md",
      tag: "decks/test",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    await db.syncFlashcardsForDeck({
      deckId,
      deckName: "geo",
      deckFilepath: "/geo.md",
      deckConfig: profile,
      fileContent: FILE_CONTENT,
    });

    const cardId = generateFlashcardId(FRONT);
    const card = await db.getFlashcardById(cardId);
    expect(card).not.toBeNull();
    expect(card!.state).toBe("review");
    expect(card!.stability).toBeCloseTo(42);
    expect(await db.getLatestReviewLogForFlashcard(cardId)).not.toBeNull();
  });
});
