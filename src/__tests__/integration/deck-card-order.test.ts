jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { generateDeckId } from "@decks/core";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";

// An exam drawn "in file order" takes a deck's cards in the order they come back.
describe("A deck's cards keep the note's order", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("returns cards synced together in the order the note writes them", async () => {
    const profile = await db.getDefaultProfile();
    const filepath = "/test/order.md";
    const deckId = generateDeckId(filepath);
    const now = new Date().toISOString();
    await db.createDeck({
      id: deckId,
      name: "order",
      filepath,
      tag: "decks/test",
      lastReviewed: null,
      profileId: profile.id,
      created: now,
      modified: now,
    });

    await db.syncFlashcardsForDeck({
      deckId,
      deckName: "order",
      deckFilepath: filepath,
      deckConfig: profile,
      fileContent: "## Zebra\n\nstripes\n\n## Apple\n\nfruit\n\n## Mango\n\nalso fruit\n",
    });

    const fronts = (await db.getFlashcardsByDeck(deckId)).map((card) => card.front);
    expect(fronts).toEqual(["Zebra", "Apple", "Mango"]);
  });
});
