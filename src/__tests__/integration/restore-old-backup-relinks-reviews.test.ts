jest.unmock("sql.js");

import initSqlJs from "sql.js";
import * as fs from "node:fs";
import * as path from "node:path";

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { BackupService } from "../../services/BackupService";
import { InMemoryAdapter, DatabaseTestUtils } from "./database-test-utils";
import { setupRealSqlJs } from "./setup-real-sql";
import {
  CREATE_TABLES_SQL,
  generateDeckId,
  generateFlashcardId,
  generateLegacyDeckScopedFlashcardId,
} from "@decks/core";
import type { Deck } from "../../database/types";

async function freshDb(
  p: string
): Promise<{ db: MainDatabaseService; adapter: InMemoryAdapter }> {
  await setupRealSqlJs();
  const adapter = new InMemoryAdapter();
  const db = new MainDatabaseService(p, adapter, () => undefined);
  await db.initialize();
  return { db, adapter };
}

async function loadSqlJs() {
  const bin = fs.readFileSync(
    path.resolve(__dirname, "../../../node_modules/sql.js/dist/sql-wasm.wasm")
  );
  return await initSqlJs({ wasmBinary: bin as unknown as ArrayBuffer });
}

describe("restoring a pre-v36 backup re-links deck-scoped reviews", () => {
  it("re-points restored hash(deckId+front) logs to the current card and rebuilds FSRS", async () => {
    const { db, adapter } = await freshDb("/dst.db");

    // Current vault state: a deck with one card on the deck-independent scheme.
    const filepath = "/test/geo.md";
    const profile = await db.getDefaultProfile();
    const deck: Deck = {
      id: generateDeckId(filepath),
      name: "geo",
      filepath,
      tag: "decks/test",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    const cardId = generateFlashcardId("Capital of France");
    await db.createFlashcard(
      DatabaseTestUtils.createTestFlashcard(deck.id, {
        id: cardId,
        front: "Capital of France",
        back: "Paris",
        state: "new",
        stability: 0,
        repetitions: 0,
      })
    );

    // Build a pre-v36 backup whose review_log is keyed to the OLD deck-scoped
    // ID (hash(deckId + front)) — restore only carries review_logs, not cards.
    const oldFlashcardId = generateLegacyDeckScopedFlashcardId(
      "Capital of France",
      deck.id
    );
    const SQL = await loadSqlJs();
    const raw = new SQL.Database();
    raw.run(CREATE_TABLES_SQL);
    raw.run(
      `INSERT INTO review_logs
         (id, flashcard_id, last_reviewed_at, reviewed_at, rating, rating_label,
          old_state, new_state, old_interval_minutes, new_interval_minutes,
          old_due_at, new_due_at, elapsed_days, retrievability, request_retention,
          profile, maximum_interval_days, min_minutes, fsrs_weights_version,
          scheduler_version, new_stability)
       VALUES ('log_old', ?, datetime('now'), datetime('now'), 3, 'good',
               'new', 'review', 0, 600, datetime('now'), datetime('now'),
               1.0, 0.9, 0.9, 'STANDARD', 36500, 1, '1.0', '1.0', 42)`,
      [oldFlashcardId]
    );
    raw.run("PRAGMA user_version = 35");
    const backupBytes = raw.export();
    raw.close();

    // Restore it (schema v35 < 36 triggers the auto re-link).
    const backupService = new BackupService(adapter, "/unused", () => undefined);
    await backupService.restoreFromFile(backupBytes, db);

    // The restored review now links to the current card, and its FSRS state was
    // rebuilt from that log.
    const latest = await db.getLatestReviewLogForFlashcard(cardId);
    expect(latest).not.toBeNull();
    const card = await db.getFlashcardById(cardId);
    expect(card?.state).toBe("review");
    expect(card?.stability).toBeCloseTo(42);
  });
});
