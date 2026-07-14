jest.unmock("sql.js");

import initSqlJs from "sql.js";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter, DatabaseTestUtils } from "./database-test-utils";
import { createTestDatabase, cleanupTestDatabase } from "../test-db-utils";
import {
  CREATE_TABLES_SQL,
  buildMigrationSQL,
  generateFlashcardId,
  headerBindingKey,
} from "@decks/core";
import type { DeckProfile } from "@decks/core";

class MtimeAdapter extends InMemoryAdapter {
  public mtimeValue = 0;
  async stat(
    _path: string
  ): Promise<{ type: string; size: number; mtime: number; ctime: number }> {
    return { type: "file", size: 0, mtime: this.mtimeValue, ctime: 0 };
  }
}

const TOKEN_KEY = headerBindingKey("tok1");
const ORIGINAL_FRONT = "What is DNA?";
const EDITED_FRONT = "What is deoxyribonucleic acid?";
const BODY = "The molecule of heredity.";

const contentWithToken = (front: string): string =>
  `## ${front}\n\n${BODY} %%dk:h:tok1%%`;

async function syncContent(
  db: MainDatabaseService,
  deckId: string,
  profile: DeckProfile,
  fileContent: string
): Promise<void> {
  await db.syncFlashcardsForDeck({
    deckId,
    deckName: "Anchors",
    deckFilepath: "/test/anchors.md",
    deckConfig: profile,
    fileContent,
  });
}

describe("anchor binding durability", () => {
  let db: MainDatabaseService;
  let profile: DeckProfile;
  let deckId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    profile = await db.getDefaultProfile();
    const deck = DatabaseTestUtils.createTestDeck({
      filepath: "/test/anchors.md",
    });
    await db.createDeck(deck);
    deckId = deck.id;
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  it("keeps identity and history across a front edit once bound", async () => {
    await syncContent(db, deckId, profile, contentWithToken(ORIGINAL_FRONT));
    const originalId = generateFlashcardId(ORIGINAL_FRONT);
    const created = await db.getFlashcardById(originalId);
    expect(created).not.toBeNull();
    expect(created?.anchor).toBe(TOKEN_KEY);
    // Token without history stays unbound (no speculative bindings).
    expect(await db.getAnchorBinding(TOKEN_KEY)).toBeNull();

    // Review + stamp: history plus the durable binding.
    await db.insertReviewLog(DatabaseTestUtils.createTestReviewLog(originalId));
    await db.insertAnchorBindings([
      { anchor: TOKEN_KEY, flashcardId: originalId },
    ]);

    await syncContent(db, deckId, profile, contentWithToken(EDITED_FRONT));
    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(originalId);
    expect(cards[0].front).toBe(EDITED_FRONT);
    const logs = await db.getAllReviewLogs();
    expect(logs.some((l) => l.flashcardId === originalId)).toBe(true);
  });

  it("nulls the locator column when the token is removed (re-arms stamping)", async () => {
    await syncContent(db, deckId, profile, contentWithToken(ORIGINAL_FRONT));
    const originalId = generateFlashcardId(ORIGINAL_FRONT);

    await syncContent(db, deckId, profile, `## ${ORIGINAL_FRONT}\n\n${BODY}`);
    const card = await db.getFlashcardById(originalId);
    expect(card).not.toBeNull();
    expect(card?.anchor).toBeNull();
  });

  it("token deletion plus front edit resets instead of fuzzy re-attaching", async () => {
    await syncContent(db, deckId, profile, contentWithToken(ORIGINAL_FRONT));
    const originalId = generateFlashcardId(ORIGINAL_FRONT);
    await db.insertReviewLog(DatabaseTestUtils.createTestReviewLog(originalId));
    await db.insertAnchorBindings([
      { anchor: TOKEN_KEY, flashcardId: originalId },
    ]);
    // Anchor column is set on the row; removing the token AND editing the
    // front is a delete-and-rewrite gesture: identical back must NOT trigger
    // the strong rename pass for anchored rows.
    await syncContent(db, deckId, profile, `## ${EDITED_FRONT}\n\n${BODY}`);

    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(generateFlashcardId(EDITED_FRONT));
    expect(cards[0].state).toBe("new");
    expect(cards[0].repetitions).toBe(0);
  });

  it("re-attaches history on a fresh device after merge, with no speculative binding in the window", async () => {
    // Device A: bound + reviewed card whose front was edited after stamping.
    await syncContent(db, deckId, profile, contentWithToken(ORIGINAL_FRONT));
    const originalId = generateFlashcardId(ORIGINAL_FRONT);
    await db.insertReviewLog(DatabaseTestUtils.createTestReviewLog(originalId));
    await db.insertAnchorBindings([
      { anchor: TOKEN_KEY, flashcardId: originalId },
    ]);
    await syncContent(db, deckId, profile, contentWithToken(EDITED_FRONT));
    await db.save();

    // Device B: fresh database sees the token-bearing FILE before the DB merge.
    const adapterB = new MtimeAdapter();
    const dbB = new MainDatabaseService("test.db", adapterB, jest.fn());
    await dbB.initialize();
    try {
      const deckB = DatabaseTestUtils.createTestDeck({
        id: deckId,
        filepath: "/test/anchors.md",
      });
      await dbB.createDeck(deckB);
      const profileB = await dbB.getDefaultProfile();
      await syncContent(dbB, deckId, profileB, contentWithToken(EDITED_FRONT));

      // File-before-DB window: content identity, no binding invented.
      const transientId = generateFlashcardId(EDITED_FRONT);
      expect(await dbB.getFlashcardById(transientId)).not.toBeNull();
      expect(await dbB.getAnchorBinding(TOKEN_KEY)).toBeNull();

      // Device A's snapshot arrives (bindings, review logs, cards).
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
      expect(await dbB.getAnchorBinding(TOKEN_KEY)).toBe(originalId);

      // Next parse converges: bound id wins, transient duplicate collapses.
      await syncContent(dbB, deckId, profileB, contentWithToken(EDITED_FRONT));
      const cards = await dbB.getFlashcardsByDeck(deckId);
      expect(cards).toHaveLength(1);
      expect(cards[0].id).toBe(originalId);
      expect(cards[0].front).toBe(EDITED_FRONT);
      const logs = await dbB.getAllReviewLogs();
      expect(logs.some((l) => l.flashcardId === originalId)).toBe(true);
    } finally {
      await dbB.close();
    }
  });

  it("keeps a table row's identity and history across a front-cell edit once bound", async () => {
    const tableContent = (front: string): string =>
      `## Vocab\n\n| Front | Back |\n|---|---|\n| ${front} %%dk:t:tt1%% | cat |`;
    await syncContent(db, deckId, profile, tableContent("chat"));
    const originalId = generateFlashcardId("chat");
    const created = await db.getFlashcardById(originalId);
    expect(created?.anchor).toBe("t:tt1");

    await db.insertReviewLog(DatabaseTestUtils.createTestReviewLog(originalId));
    await db.insertAnchorBindings([{ anchor: "t:tt1", flashcardId: originalId }]);

    await syncContent(db, deckId, profile, tableContent("chatte"));
    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(originalId);
    expect(cards[0].front).toBe("chatte");
  });

  it("keeps identities stable when bound table rows are reordered", async () => {
    const rows = (order: [string, string]): string =>
      `## Vocab\n\n| Front | Back |\n|---|---|\n| ${order[0]} |\n| ${order[1]} |`
        .replace(order[0], `${order[0]}`)
        .replace(/\| (chat) \|/g, "| chat %%dk:t:aa1%% | cat |")
        .replace(/\| (chien) \|/g, "| chien %%dk:t:bb2%% | dog |");
    await syncContent(db, deckId, profile, rows(["chat", "chien"]));
    const chatId = generateFlashcardId("chat");
    const chienId = generateFlashcardId("chien");
    await db.insertAnchorBindings([
      { anchor: "t:aa1", flashcardId: chatId },
      { anchor: "t:bb2", flashcardId: chienId },
    ]);

    await syncContent(db, deckId, profile, rows(["chien", "chat"]));
    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.front === "chat")?.id).toBe(chatId);
    expect(cards.find((c) => c.front === "chien")?.id).toBe(chienId);
  });

  it("preserves bindings through a schema re-migration that rebuilds flashcards", async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
    });
    const raw = new SQL.Database();
    raw.run(CREATE_TABLES_SQL);
    raw.run(
      "INSERT INTO anchor_bindings (anchor, flashcard_id, created) VALUES ('h:tok1', 'card_abc', datetime('now'))"
    );
    raw.run(buildMigrationSQL(raw));
    const result = raw.exec(
      "SELECT flashcard_id FROM anchor_bindings WHERE anchor = 'h:tok1'"
    );
    expect(result[0]?.values[0]?.[0]).toBe("card_abc");
    const flashcards = raw.exec("SELECT COUNT(*) FROM flashcards");
    expect(flashcards[0]?.values[0]?.[0]).toBe(0);
    raw.close();
  });
});
