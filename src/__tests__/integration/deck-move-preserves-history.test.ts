jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler, generateDeckId, generateFlashcardId } from "@decks/core";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import type { Deck, DeckProfile } from "../../database/types";

describe("Card move between decks preserves review history", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;

  beforeEach(async () => {
    db = await setupTestDatabase();
    const mockSettings = {
      review: { nextDayStartsAt: 4 },
      backup: { enableAutoBackup: false },
      debug: { enableLogging: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBackupService = { createBackup: jest.fn() } as any;
    scheduler = new Scheduler(db, mockSettings, mockBackupService);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function makeDeck(
    name: string
  ): Promise<{ deck: Deck; profile: DeckProfile }> {
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

  const CONTENT = `## Topic

| Front | Back |
|-------|------|
| Capital of France | Paris |
`;

  it("keeps the same ID and restores FSRS when a card moves to another deck", async () => {
    const a = await makeDeck("deck-a");
    const b = await makeDeck("deck-b");
    expect(a.deck.id).not.toBe(b.deck.id);

    // The card lives in deck A and gets reviewed.
    await db.syncFlashcardsForDeck({
      deckId: a.deck.id,
      deckName: a.deck.name,
      deckFilepath: a.deck.filepath,
      deckConfig: a.profile,
      fileContent: CONTENT,
    });
    const [cardInA] = await db.getFlashcardsByDeck(a.deck.id);
    expect(cardInA.id).toBe(generateFlashcardId("Capital of France"));

    await scheduler.rate(cardInA.id, "good");
    const reviewed = await db.getFlashcardById(cardInA.id);
    expect(reviewed!.state).toBe("review");
    expect(reviewed!.stability).toBeGreaterThan(0);
    const reviewedStability = reviewed!.stability;

    // Move: the card leaves deck A (file emptied) and reappears in deck B.
    await db.syncFlashcardsForDeck({
      deckId: a.deck.id,
      deckName: a.deck.name,
      deckFilepath: a.deck.filepath,
      deckConfig: a.profile,
      fileContent: "## Topic\n",
    });
    expect(await db.getFlashcardsByDeck(a.deck.id)).toHaveLength(0);

    await db.syncFlashcardsForDeck({
      deckId: b.deck.id,
      deckName: b.deck.name,
      deckFilepath: b.deck.filepath,
      deckConfig: b.profile,
      fileContent: CONTENT,
    });

    const cardsInB = await db.getFlashcardsByDeck(b.deck.id);
    expect(cardsInB).toHaveLength(1);
    const cardInB = cardsInB[0];
    // Same identity across the move (deck-independent ID)...
    expect(cardInB.id).toBe(cardInA.id);
    // ...and its review progress followed it (Smart Restoration).
    expect(cardInB.state).toBe("review");
    expect(cardInB.stability).toBe(reviewedStability);
  });
});
