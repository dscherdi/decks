jest.unmock("sql.js");

import initSqlJs, { Database } from "sql.js";
import * as fs from "node:fs";
import * as path from "node:path";

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter, DatabaseTestUtils } from "./database-test-utils";
import { createTestDatabase, cleanupTestDatabase } from "../test-db-utils";
import { setupRealSqlJs } from "./setup-real-sql";
import {
  CREATE_TABLES_SQL,
  applyOp,
  generateDeckId,
  generateFlashcardId,
} from "@decks/core";
import type { DeckProfile, SyncLogEntry } from "@decks/core";
import type { Logger } from "../../utils/logging";
import type { Deck } from "../../database/types";

class MtimeAdapter extends InMemoryAdapter {
  public mtimeValue = 0;
  async stat(
    _path: string
  ): Promise<{ type: string; size: number; mtime: number; ctime: number }> {
    return { type: "file", size: 0, mtime: this.mtimeValue, ctime: 0 };
  }
}

const FRONT = "What is DNA?";
const BURIED_FRONT = "What is RNA?";
const FILE_CONTENT = `## ${FRONT}\n\nThe molecule of heredity.`;
const TWO_CARD_CONTENT = `## ${FRONT}\n\nThe molecule of heredity.\n\n## ${BURIED_FRONT}\n\nThe messenger molecule.`;

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  } as unknown as Logger;
}

function opEntry<T extends SyncLogEntry["o"]>(
  op: T,
  p: Extract<SyncLogEntry, { o: T }>["p"],
  at: string
): SyncLogEntry {
  return {
    hlc: [Date.parse(at), 0, "remote-dev"],
    s: 1,
    v: 1,
    o: op,
    p,
  } as SyncLogEntry;
}

async function syncContent(
  db: MainDatabaseService,
  deckId: string,
  profile: DeckProfile,
  fileContent: string
): Promise<void> {
  await db.syncFlashcardsForDeck({
    deckId,
    deckName: "Durability",
    deckFilepath: "/test/durability.md",
    deckConfig: profile,
    fileContent,
  });
}

interface OverlayRow {
  flashcard_id: string;
  suspended_at: string | null;
  buried_until: string | null;
  modified: string;
}

async function overlayRow(
  db: MainDatabaseService,
  cardId: string
): Promise<OverlayRow | undefined> {
  const rows = await db.querySql<OverlayRow>(
    "SELECT flashcard_id, suspended_at, buried_until, modified FROM card_state_overlays WHERE flashcard_id = ?",
    [cardId],
    { asObject: true }
  );
  return rows[0];
}

describe("suspend/bury durability", () => {
  describe("schema migration preserves suspend state", () => {
    it("v37→v38 seeds overlays before the flashcards drop and re-sync restores state", async () => {
      const bin = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../node_modules/sql.js/dist/sql-wasm.wasm"
        )
      );
      const SQL = await initSqlJs({
        wasmBinary: bin as unknown as ArrayBuffer,
      });
      await setupRealSqlJs();

      const deckId = generateDeckId("/test/durability.md");
      const suspendedId = generateFlashcardId(FRONT);
      const buriedId = generateFlashcardId(BURIED_FRONT);
      const suspendedAt = "2026-07-01T10:00:00.000Z";
      const buriedUntil = "2099-01-01T04:00:00.000Z";

      // Build a v37 database: overlay table absent, state only on flashcards.
      const raw: Database = new SQL.Database();
      raw.run(CREATE_TABLES_SQL);
      raw.run("PRAGMA foreign_keys = OFF");
      raw.run("DROP TABLE card_state_overlays");
      raw.run(
        `INSERT INTO decks (id, name, filepath, tag, profile_id, created, modified)
         VALUES (?, 'Durability', '/test/durability.md', 'decks/test', 'default', datetime('now'), datetime('now'))`,
        [deckId]
      );
      const insertCard = `INSERT INTO flashcards
         (id, deck_id, front, back, type, source_file, content_hash, state,
          due_date, interval, stability, repetitions, difficulty, lapses,
          created, modified, suspended_at, buried_until)
         VALUES (?, ?, ?, 'b', 'header-paragraph', '/test/durability.md', 'h', 'review',
                 datetime('now'), 600, 5, 2, 5, 0, datetime('now'), ?, ?, ?)`;
      raw.run(insertCard, [
        suspendedId,
        deckId,
        FRONT,
        suspendedAt,
        suspendedAt,
        null,
      ]);
      raw.run(insertCard, [
        buriedId,
        deckId,
        BURIED_FRONT,
        suspendedAt,
        null,
        buriedUntil,
      ]);
      raw.run("PRAGMA user_version = 37");
      const bytes = raw.export();
      raw.close();

      const adapter = new InMemoryAdapter();
      await adapter.writeBinary(
        "/db.db",
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        )
      );
      const db = new MainDatabaseService("/db.db", adapter, () => undefined);
      await db.initialize();
      try {
        // Migration dropped flashcards but seeded the overlay first.
        expect(await db.getFlashcardsByDeck(deckId)).toHaveLength(0);
        expect((await overlayRow(db, suspendedId))?.suspended_at).toBe(
          suspendedAt
        );
        expect((await overlayRow(db, buriedId))?.buried_until).toBe(
          buriedUntil
        );

        // Re-sync from the vault: recreated cards get their state back.
        const profile = await db.getDefaultProfile();
        const deck: Deck = {
          id: deckId,
          name: "Durability",
          filepath: "/test/durability.md",
          tag: "decks/test",
          lastReviewed: null,
          profileId: profile.id,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        };
        await db.createDeck(deck);
        await syncContent(db, deckId, profile, TWO_CARD_CONTENT);

        const suspended = await db.getFlashcardById(suspendedId);
        expect(suspended?.suspendedAt).toBe(suspendedAt);
        const buried = await db.getFlashcardById(buriedId);
        expect(buried?.buriedUntil).toBe(buriedUntil);
        expect(buried?.suspendedAt).toBeNull();
      } finally {
        await db.close();
      }
    });
  });

  describe("delete + re-sync", () => {
    let db: MainDatabaseService;
    let profile: DeckProfile;
    let deckId: string;

    beforeEach(async () => {
      db = await createTestDatabase();
      profile = await db.getDefaultProfile();
      const deck = DatabaseTestUtils.createTestDeck({
        filepath: "/test/durability.md",
      });
      await db.createDeck(deck);
      deckId = deck.id;
    });

    afterEach(async () => {
      await cleanupTestDatabase(db);
    });

    it("a deleted suspended card is recreated suspended", async () => {
      await syncContent(db, deckId, profile, FILE_CONTENT);
      const cardId = generateFlashcardId(FRONT);
      await db.suspendCard(cardId);
      const suspendedAt = (await db.getFlashcardById(cardId))?.suspendedAt;
      expect(suspendedAt).not.toBeNull();

      await db.executeSql("DELETE FROM flashcards WHERE id = ?", [cardId]);
      await syncContent(db, deckId, profile, FILE_CONTENT);

      const recreated = await db.getFlashcardById(cardId);
      expect(recreated).not.toBeNull();
      expect(recreated?.suspendedAt).toBe(suspendedAt);
    });

    it("a deleted buried card is recreated buried", async () => {
      await syncContent(db, deckId, profile, FILE_CONTENT);
      const cardId = generateFlashcardId(FRONT);
      const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.buryCard(cardId, until);

      await db.executeSql("DELETE FROM flashcards WHERE id = ?", [cardId]);
      await syncContent(db, deckId, profile, FILE_CONTENT);

      expect((await db.getFlashcardById(cardId))?.buriedUntil).toBe(until);
    });

    it("unsuspended state also survives delete + re-sync (tombstone row)", async () => {
      await syncContent(db, deckId, profile, FILE_CONTENT);
      const cardId = generateFlashcardId(FRONT);
      await db.suspendCard(cardId);
      await db.unsuspendCard(cardId);

      await db.executeSql("DELETE FROM flashcards WHERE id = ?", [cardId]);
      await syncContent(db, deckId, profile, FILE_CONTENT);

      expect((await db.getFlashcardById(cardId))?.suspendedAt).toBeNull();
    });
  });

  describe("sync-op replay", () => {
    let db: MainDatabaseService;
    let profile: DeckProfile;
    let deckId: string;

    beforeEach(async () => {
      db = await createTestDatabase();
      profile = await db.getDefaultProfile();
      const deck = DatabaseTestUtils.createTestDeck({
        filepath: "/test/durability.md",
      });
      await db.createDeck(deck);
      deckId = deck.id;
    });

    afterEach(async () => {
      await cleanupTestDatabase(db);
    });

    it("card_suspend applies even when the local row's modified is not older than at", async () => {
      await syncContent(db, deckId, profile, FILE_CONTENT);
      const cardId = generateFlashcardId(FRONT);
      // An op whose at predates the row's content modified: the old
      // flashcards.modified guard dropped this; the overlay guard must not.
      const at = "2020-01-01T00:00:00.000Z";
      await applyOp(
        db,
        "remote-dev",
        opEntry("card_suspend", { c: cardId, at }, at),
        makeLogger()
      );

      expect((await db.getFlashcardById(cardId))?.suspendedAt).toBe(at);
    });

    it("stale suspend replay loses to a newer unsuspend", async () => {
      await syncContent(db, deckId, profile, FILE_CONTENT);
      const cardId = generateFlashcardId(FRONT);
      const t1 = "2026-07-01T10:00:00.000Z";
      const t2 = "2026-07-02T10:00:00.000Z";

      await applyOp(
        db,
        "remote-dev",
        opEntry("card_suspend", { c: cardId, at: t1 }, t1),
        makeLogger()
      );
      await applyOp(
        db,
        "remote-dev",
        opEntry("card_unsuspend", { c: cardId, at: t2 }, t2),
        makeLogger()
      );
      // Stale replay of the older suspend must stay a no-op.
      await applyOp(
        db,
        "remote-dev",
        opEntry("card_suspend", { c: cardId, at: t1 }, t1),
        makeLogger()
      );

      expect((await db.getFlashcardById(cardId))?.suspendedAt).toBeNull();
      expect((await overlayRow(db, cardId))?.modified).toBe(t2);
    });

    it("card_suspend arriving before the card exists persists and applies on sync", async () => {
      const cardId = generateFlashcardId(FRONT);
      const at = "2026-07-01T10:00:00.000Z";
      await applyOp(
        db,
        "remote-dev",
        opEntry("card_suspend", { c: cardId, at }, at),
        makeLogger()
      );
      expect((await overlayRow(db, cardId))?.suspended_at).toBe(at);

      await syncContent(db, deckId, profile, FILE_CONTENT);
      expect((await db.getFlashcardById(cardId))?.suspendedAt).toBe(at);
    });

    it("card_reset clears suspend and bury via the overlay", async () => {
      await syncContent(db, deckId, profile, FILE_CONTENT);
      const cardId = generateFlashcardId(FRONT);
      await db.suspendCard(cardId);
      const resetAt = new Date(Date.now() + 1000).toISOString();
      await applyOp(
        db,
        "remote-dev",
        opEntry("card_reset", { c: cardId, at: resetAt }, resetAt),
        makeLogger()
      );

      const card = await db.getFlashcardById(cardId);
      expect(card?.suspendedAt).toBeNull();
      expect(card?.buriedUntil).toBeNull();
      const row = await overlayRow(db, cardId);
      expect(row?.suspended_at).toBeNull();
      expect(row?.modified).toBe(resetAt);
    });
  });

  describe("two-device binary merge", () => {
    it("suspend on device A lands on device B through the merge despite modified == at", async () => {
      // Device A: card synced from the vault, then suspended.
      const db = await createTestDatabase();
      const profile = await db.getDefaultProfile();
      const deck = DatabaseTestUtils.createTestDeck({
        filepath: "/test/durability.md",
      });
      await db.createDeck(deck);
      const deckId = deck.id;
      try {
        await syncContent(db, deckId, profile, FILE_CONTENT);
        const cardId = generateFlashcardId(FRONT);
        await db.suspendCard(cardId);
        const cardA = await db.getFlashcardById(cardId);
        // Vector-2 precondition: writer stamps suspended_at == modified.
        expect(cardA?.suspendedAt).toBe(cardA?.modified);
        await db.save();

        // Device B: same vault content synced independently, not suspended.
        const adapterB = new MtimeAdapter();
        const dbB = new MainDatabaseService("test.db", adapterB, jest.fn());
        await dbB.initialize();
        try {
          const deckB = DatabaseTestUtils.createTestDeck({
            id: deckId,
            filepath: "/test/durability.md",
          });
          await dbB.createDeck(deckB);
          const profileB = await dbB.getDefaultProfile();
          await syncContent(dbB, deckId, profileB, FILE_CONTENT);
          expect((await dbB.getFlashcardById(cardId))?.suspendedAt).toBeNull();

          // Device A's snapshot arrives on B.
          const snapshot = await db.exportDatabaseToBuffer();
          await adapterB.writeBinary(
            "test.db",
            snapshot.buffer.slice(
              snapshot.byteOffset,
              snapshot.byteOffset + snapshot.byteLength
            ) as ArrayBuffer
          );
          adapterB.mtimeValue = 1;
          await dbB.syncWithDisk();

          const merged = await dbB.getFlashcardById(cardId);
          expect(merged?.suspendedAt).toBe(cardA?.suspendedAt);

          // Replaying A's op afterwards stays idempotent (the old
          // flashcards.modified < at guard dead-zoned exactly this case).
          await applyOp(
            dbB,
            "device-a",
            opEntry(
              "card_suspend",
              { c: cardId, at: cardA!.suspendedAt! },
              cardA!.suspendedAt!
            ),
            makeLogger()
          );
          expect((await dbB.getFlashcardById(cardId))?.suspendedAt).toBe(
            cardA?.suspendedAt
          );
        } finally {
          await dbB.close();
        }
      } finally {
        await cleanupTestDatabase(db);
      }
    });

    it("a newer unsuspend on A overrides an older suspend already on B", async () => {
      const db = await createTestDatabase();
      const profile = await db.getDefaultProfile();
      const deck = DatabaseTestUtils.createTestDeck({
        filepath: "/test/durability.md",
      });
      await db.createDeck(deck);
      const deckId = deck.id;
      try {
        await syncContent(db, deckId, profile, FILE_CONTENT);
        const cardId = generateFlashcardId(FRONT);

        const adapterB = new MtimeAdapter();
        const dbB = new MainDatabaseService("test.db", adapterB, jest.fn());
        await dbB.initialize();
        try {
          const deckB = DatabaseTestUtils.createTestDeck({
            id: deckId,
            filepath: "/test/durability.md",
          });
          await dbB.createDeck(deckB);
          const profileB = await dbB.getDefaultProfile();
          await syncContent(dbB, deckId, profileB, FILE_CONTENT);

          // B holds an old suspend; A suspended and later unsuspended.
          const t1 = "2026-07-01T10:00:00.000Z";
          await applyOp(
            dbB,
            "device-a",
            opEntry("card_suspend", { c: cardId, at: t1 }, t1),
            makeLogger()
          );
          await db.suspendCard(cardId);
          await db.unsuspendCard(cardId);
          await db.save();

          const snapshot = await db.exportDatabaseToBuffer();
          await adapterB.writeBinary(
            "test.db",
            snapshot.buffer.slice(
              snapshot.byteOffset,
              snapshot.byteOffset + snapshot.byteLength
            ) as ArrayBuffer
          );
          adapterB.mtimeValue = 1;
          await dbB.syncWithDisk();

          expect((await dbB.getFlashcardById(cardId))?.suspendedAt).toBeNull();
        } finally {
          await dbB.close();
        }
      } finally {
        await cleanupTestDatabase(db);
      }
    });
  });

  describe("backup restore", () => {
    it("backup restore onto a fresh database brings back suspend state and anchor bindings", async () => {
      const db = await createTestDatabase();
      const profile = await db.getDefaultProfile();
      const deck = DatabaseTestUtils.createTestDeck({
        filepath: "/test/durability.md",
      });
      await db.createDeck(deck);
      const deckId = deck.id;
      try {
        await syncContent(db, deckId, profile, FILE_CONTENT);
        const cardId = generateFlashcardId(FRONT);
        await db.suspendCard(cardId);
        const suspendedAt = (await db.getFlashcardById(cardId))?.suspendedAt;
        await db.insertAnchorBindings([
          { anchor: "h:tok9", flashcardId: cardId },
        ]);
        const backup = await db.exportDatabaseToBuffer();

        const dbB = new MainDatabaseService(
          "restore.db",
          new InMemoryAdapter(),
          jest.fn()
        );
        await dbB.initialize();
        try {
          await dbB.restoreFromBackupData(backup);

          expect((await overlayRow(dbB, cardId))?.suspended_at).toBe(
            suspendedAt
          );
          expect(await dbB.getAnchorBinding("h:tok9")).toBe(cardId);

          // Vault sync after restore materializes the card suspended.
          const deckB = DatabaseTestUtils.createTestDeck({
            id: deckId,
            filepath: "/test/durability.md",
          });
          await dbB.createDeck(deckB);
          const profileB = await dbB.getDefaultProfile();
          await syncContent(dbB, deckId, profileB, FILE_CONTENT);
          expect((await dbB.getFlashcardById(cardId))?.suspendedAt).toBe(
            suspendedAt
          );
        } finally {
          await dbB.close();
        }
      } finally {
        await cleanupTestDatabase(db);
      }
    });

    it("backup restore respects the newer-wins guard in both directions", async () => {
      const t1 = "2026-07-01T10:00:00.000Z";
      const t2 = "2026-07-03T10:00:00.000Z";
      const tMid = "2026-07-02T10:00:00.000Z";
      const tNewest = "2026-07-04T10:00:00.000Z";

      // Backup source: suspended at t1, unsuspended at t2 → NULL tombstone @ t2.
      const db = await createTestDatabase();
      const profile = await db.getDefaultProfile();
      const deck = DatabaseTestUtils.createTestDeck({
        filepath: "/test/durability.md",
      });
      await db.createDeck(deck);
      const deckId = deck.id;
      try {
        await syncContent(db, deckId, profile, FILE_CONTENT);
        const cardId = generateFlashcardId(FRONT);
        await applyOp(
          db,
          "device-a",
          opEntry("card_suspend", { c: cardId, at: t1 }, t1),
          makeLogger()
        );
        await applyOp(
          db,
          "device-a",
          opEntry("card_unsuspend", { c: cardId, at: t2 }, t2),
          makeLogger()
        );
        const backup = await db.exportDatabaseToBuffer();

        const dbB = new MainDatabaseService(
          "restore.db",
          new InMemoryAdapter(),
          jest.fn()
        );
        await dbB.initialize();
        try {
          const deckB = DatabaseTestUtils.createTestDeck({
            id: deckId,
            filepath: "/test/durability.md",
          });
          await dbB.createDeck(deckB);
          const profileB = await dbB.getDefaultProfile();
          await syncContent(dbB, deckId, profileB, FILE_CONTENT);

          // Backup newer than local: local suspend @ tMid loses to the t2
          // unsuspend, and the mirror updates the existing card row.
          await applyOp(
            dbB,
            "device-b",
            opEntry("card_suspend", { c: cardId, at: tMid }, tMid),
            makeLogger()
          );
          await dbB.restoreFromBackupData(backup);
          expect((await dbB.getFlashcardById(cardId))?.suspendedAt).toBeNull();
          expect((await overlayRow(dbB, cardId))?.modified).toBe(t2);

          // Local newer than backup: suspend @ tNewest survives a re-restore.
          await applyOp(
            dbB,
            "device-b",
            opEntry("card_suspend", { c: cardId, at: tNewest }, tNewest),
            makeLogger()
          );
          await dbB.restoreFromBackupData(backup);
          expect((await dbB.getFlashcardById(cardId))?.suspendedAt).toBe(
            tNewest
          );
        } finally {
          await dbB.close();
        }
      } finally {
        await cleanupTestDatabase(db);
      }
    });

    it("restoring a pre-v38 backup without the new tables still restores review logs", async () => {
      const bin = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../node_modules/sql.js/dist/sql-wasm.wasm"
        )
      );
      const SQL = await initSqlJs({ wasmBinary: bin as unknown as ArrayBuffer });
      const raw: Database = new SQL.Database();
      raw.run(CREATE_TABLES_SQL);
      raw.run("DROP TABLE card_state_overlays");
      raw.run("DROP TABLE anchor_bindings");
      raw.run(
        `INSERT INTO review_logs
           (id, flashcard_id, last_reviewed_at, reviewed_at, rating, rating_label,
            old_state, new_state, old_interval_minutes, new_interval_minutes,
            old_due_at, new_due_at, elapsed_days, retrievability, request_retention,
            profile, maximum_interval_days, min_minutes, fsrs_weights_version,
            scheduler_version, new_stability)
         VALUES ('log_pre38', 'card_x', datetime('now'), datetime('now'), 3, 'good',
                 'new', 'review', 0, 600, datetime('now'), datetime('now'),
                 1.0, 0.9, 0.9, 'STANDARD', 36500, 1, '1.0', '1.0', 42)`
      );
      const bytes = raw.export();
      raw.close();

      const db = await createTestDatabase();
      try {
        await db.restoreFromBackupData(bytes);
        const logs = await db.getAllReviewLogs();
        expect(logs.some((l) => l.id === "log_pre38")).toBe(true);
      } finally {
        await cleanupTestDatabase(db);
      }
    });
  });
});
