jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase, DatabaseTestUtils } from "./database-test-utils";
import { AnkiDeckRenderer, generateDeckId, generateFlashcardId, readAnkiEarlierRows } from "@decks/core";
import type { AnkiParsedCard, AnkiScheduling, Deck } from "@decks/core";

const SCHED: AnkiScheduling = { type: 0, queue: 0, due: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, data: "{}" };

function basic(noteId: number, front: string, back: string): AnkiParsedCard {
  return {
    noteId, cardId: noteId * 10, ord: 0, kind: "basic", isCloze: false, deckName: "EN",
    front, back, notes: "", media: [], scheduling: SCHED, tableLayout: true,
  };
}

// Imported cards carry their ids in tokens, so a front shared with another deck no
// longer needs a " (n)" suffix; a suffix an earlier import wrote is kept on re-import.
describe("Anki import fronts next to existing decks", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function deckAt(filepath: string): Promise<Deck> {
    const deck = DatabaseTestUtils.createTestDeck({ id: generateDeckId(filepath), filepath });
    await db.createDeck(deck);
    return deck;
  }

  async function sync(deck: Deck, fileContent: string): Promise<void> {
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: await db.getDefaultProfile(),
      fileContent,
    });
  }

  it("lands an imported card beside another deck's card with the same front", async () => {
    const exam = await deckAt("exam/deck.md");
    await sync(exam, "## T\n\n| Front | Back |\n| --- | --- |\n| tie | draw |\n");

    const imported = basic(1, "tie", "necktie");
    const [rendered] = AnkiDeckRenderer.render([imported], "decks/anki", 2);
    const target = await deckAt(`Anki Import/${rendered.relativePath}.md`);
    await sync(target, rendered.content);

    expect(await db.countAllCards()).toBe(2);
    expect((await db.getFlashcardsByDeck(exam.id)).map((c) => c.front)).toEqual(["tie"]);
    const landed = await db.getFlashcardsByDeck(target.id);
    expect(landed.map((c) => c.front)).toEqual(["tie"]);
    expect(landed[0].id).toBe(AnkiDeckRenderer.decksCardId(imported));
  });

  it("reads only the rows in the import's target folder", async () => {
    await sync(await deckAt("exam/deck.md"), "## T\n\n| Front | Back |\n| --- | --- |\n| tie | draw |\n");
    await sync(await deckAt("Anki Import/EN.md"), "## T\n\n| Front | Back |\n| --- | --- |\n| être (2) | to be |\n");

    const rows = await readAnkiEarlierRows(db, "Anki Import/");
    expect(rows.map((r) => r.front)).toEqual(["être (2)"]);
  });

  it("keeps the progress of a suffixed card an import without tokens wrote", async () => {
    // An import before tokens: the row's id is the content id of its suffixed front.
    const target = await deckAt("Anki Import/EN.md");
    await sync(target, "## EN\n\n| Front | Back |\n| --- | --- |\n| tie (2) | necktie |\n");
    const oldId = generateFlashcardId("tie (2)");
    await db.updateFlashcard(oldId, { state: "review", repetitions: 5, stability: 12 });

    const card = basic(1, "tie", "necktie");
    const earlierRows = await readAnkiEarlierRows(db, "Anki Import/");
    const [rendered] = AnkiDeckRenderer.render([card], "decks/anki", 2, true, 1000, { earlierRows });
    expect(card.front).toBe("tie (2)");
    await sync(target, rendered.content);

    const [row] = await db.getFlashcardsByDeck(target.id);
    expect(row.id).toBe(AnkiDeckRenderer.decksCardId(card));
    expect(row.front).toBe("tie (2)");
    expect(row.repetitions).toBe(5);
    expect(row.stability).toBe(12);
  });
});
