import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  Scheduler,
  generateDeckId,
  type Deck,
  type DecksSettings,
  type IBackupService,
  type SqlJsValue,
} from "@decks/core";
import { DEFAULT_SETTINGS } from "../../settings";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";

const SPANISH = "## comer\n\nto eat\n\n## beber\n\nto drink\n";

// Renaming a deck while SQLite enforces the flashcards → decks foreign key.
describe("deck rename with foreign keys on", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  const backup: IBackupService = { createBackup: async () => undefined };

  beforeEach(async () => {
    db = await setupTestDatabase();
    const settings: DecksSettings = structuredClone(DEFAULT_SETTINGS);
    scheduler = new Scheduler(db, settings, backup);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function foreignKeys(): Promise<number> {
    const [row] = await db.querySql<{ foreign_keys: number }>("PRAGMA foreign_keys", [], { asObject: true });
    return row.foreign_keys;
  }

  async function violations(): Promise<SqlJsValue[][]> {
    return db.querySql("PRAGMA foreign_key_check", []);
  }

  async function studiedDeck(filepath: string) {
    const profile = await db.getDefaultProfile();
    const id = generateDeckId(filepath);
    await db.createDeck({
      id,
      name: "Spanish",
      filepath,
      tag: "#decks",
      lastReviewed: null,
      profileId: profile.id,
    });
    const deck: Deck | null = await db.getDeckById(id);
    if (!deck) throw new Error("deck not created");
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: filepath,
      deckConfig: profile,
      fileContent: SPANISH,
    });
    const comer = (await db.getFlashcardsByDeck(deck.id)).find((card) => card.front === "comer");
    if (!comer) throw new Error("card not synced");
    const reviewed = await scheduler.rate(comer.id, "good");
    const favourites = await db.createCustomDeck("Favourites");
    await db.addCardsToCustomDeck(favourites, [comer.id]);
    const sessionId = await db.createReviewSession({
      deckId: deck.id,
      startedAt: new Date().toISOString(),
      endedAt: null,
      goalTotal: 2,
      doneUnique: 1,
    });
    return { deck, cardId: comer.id, dueDate: reviewed.dueDate, favourites, sessionId };
  }

  it("moves the deck to its new id with its cards, history, memberships and sessions", async () => {
    const before = await studiedDeck("Languages/Spanish.md");
    const newPath = "Archive/Spanish.md";
    const newId = generateDeckId(newPath);

    await db.executeSql("PRAGMA foreign_keys = ON");
    await db.renameDeck(before.deck.id, newId, "Spanish", newPath);
    expect(await foreignKeys()).toBe(1);
    expect(await violations()).toEqual([]);

    expect(await db.getDeckById(before.deck.id)).toBeNull();
    expect(await db.getDeckById(newId)).toMatchObject({
      name: "Spanish",
      filepath: newPath,
      created: before.deck.created,
    });
    const cards = await db.getFlashcardsByDeck(newId);
    expect(cards.map((card) => card.front).sort()).toEqual(["beber", "comer"]);
    expect(cards.find((card) => card.id === before.cardId)?.dueDate).toBe(before.dueDate);
    expect((await db.getReviewLogsByDeck(newId)).map((log) => log.flashcardId)).toEqual([before.cardId]);
    expect((await db.getFlashcardsForCustomDeck(before.favourites)).map((card) => card.id)).toEqual([
      before.cardId,
    ]);
    expect((await db.getReviewSessionById(before.sessionId))?.deckId).toBe(newId);
    expect(await foreignKeys()).toBe(1);
  });

  it("renames in place when the id does not change", async () => {
    const before = await studiedDeck("Languages/Spanish.md");

    await db.executeSql("PRAGMA foreign_keys = ON");
    await db.renameDeck(before.deck.id, before.deck.id, "Español", before.deck.filepath);
    expect(await foreignKeys()).toBe(1);
    expect(await violations()).toEqual([]);

    expect(await db.getDeckById(before.deck.id)).toMatchObject({ name: "Español", created: before.deck.created });
    expect(await db.getFlashcardsByDeck(before.deck.id)).toHaveLength(2);
    expect((await db.getFlashcardsForCustomDeck(before.favourites)).map((card) => card.id)).toEqual([
      before.cardId,
    ]);
    expect((await db.getReviewSessionById(before.sessionId))?.deckId).toBe(before.deck.id);
  });
});
