jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "@decks/core";
import type { Deck, DeckProfile } from "../../database/types";
import { FlashcardWriter } from "../../services/FlashcardWriter";

/**
 * Lightweight in-memory app stand-in for the writer. The writer only
 * touches `vault.getAbstractFileByPath` and `vault.process`.
 */
function makeWritableApp(filepath: string, initialContent: string) {
  let stored = initialContent;
  const { TFile } = jest.requireActual("../../__mocks__/obsidian");
  const file = new TFile(filepath);
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (p === filepath ? file : null),
      process: async (
        _file: unknown,
        fn: (content: string) => string,
      ): Promise<string> => {
        stored = fn(stored);
        return stored;
      },
    },
  };
  return {
    app: app as never,
    getContent: () => stored,
  };
}

async function createDeckWith(
  db: MainDatabaseService,
  name: string,
  clozeEnabled = false,
): Promise<{ deck: Deck; profile: DeckProfile }> {
  if (clozeEnabled) {
    const defaultProfile = await db.getDefaultProfile();
    await db.updateProfile(defaultProfile.id, {
      clozeEnabled: true,
      clozeShowContext: "hidden",
    });
    await db.save();
  }
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

describe("Inline edit round-trip", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("rewrites header-paragraph back text and re-sync picks it up", async () => {
    const { deck, profile } = await createDeckWith(db, "edit-hp");
    const initial = "## Question?\nold answer\n## Next\nbody";
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: initial,
      clozeEnabled: false,
    });
    const cards = await db.getFlashcardsByDeck(deck.id);
    const target = cards.find((c) => c.front === "Question?");
    expect(target).toBeDefined();

    const { app, getContent } = makeWritableApp(deck.filepath, initial);
    const writer = new FlashcardWriter(app);
    const result = await writer.editFlashcard(target!, {
      type: "header-paragraph",
      front: "Question?",
      back: "new improved answer",
    });
    expect(result).toEqual({ ok: true });

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: getContent(),
      clozeEnabled: false,
    });
    const updated = await db.getFlashcardsByDeck(deck.id);
    const reloaded = updated.find((c) => c.front === "Question?");
    expect(reloaded!.back).toBe("new improved answer");
    expect(reloaded!.id).toBe(target!.id);
  });

  it("rewrites a table row's notes column", async () => {
    const { deck, profile } = await createDeckWith(db, "edit-table");
    const initial =
      "## Vocab\n| Front | Back | Notes |\n|---|---|---|\n| Q1 | A1 | n1 |\n| Q2 | A2 | n2 |";
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: initial,
      clozeEnabled: false,
    });
    const cards = await db.getFlashcardsByDeck(deck.id);
    const q2 = cards.find((c) => c.front === "Q2")!;

    const { app, getContent } = makeWritableApp(deck.filepath, initial);
    const writer = new FlashcardWriter(app);
    const result = await writer.editFlashcard(q2, {
      type: "table",
      front: "Q2",
      back: "A2",
      notes: "n2 revised",
    });
    expect(result).toEqual({ ok: true });

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: getContent(),
      clozeEnabled: false,
    });
    const updated = await db.getFlashcardsByDeck(deck.id);
    const q2Reloaded = updated.find((c) => c.front === "Q2")!;
    expect(q2Reloaded.notes).toBe("n2 revised");
    expect(q2Reloaded.id).toBe(q2.id);
  });

  it("appending a new cloze span at the end preserves existing card ids", async () => {
    const { deck, profile } = await createDeckWith(db, "edit-cloze-append", true);
    const initial = "## Pacific?\nThe ==Pacific== is the largest ==ocean==.";
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: initial,
      clozeEnabled: true,
    });
    const beforeCards = await db.getFlashcardsByDeck(deck.id);
    expect(beforeCards.length).toBe(2);
    const beforeIds = new Set(beforeCards.map((c) => c.id));

    // Edit card 0 (clozeOrder=0). Append a new ==span== at the end.
    const target = beforeCards.find((c) => c.clozeOrder === 0)!;
    const { app, getContent } = makeWritableApp(deck.filepath, initial);
    const writer = new FlashcardWriter(app);
    const result = await writer.editFlashcard(target, {
      type: "cloze",
      front: target.front,
      sentence:
        "The ==Pacific== is the largest ==ocean== on the ==planet==.",
    });
    expect(result).toEqual({ ok: true });

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: getContent(),
      clozeEnabled: true,
    });
    const afterCards = await db.getFlashcardsByDeck(deck.id);
    expect(afterCards.length).toBe(3);
    // Original two ids are still present
    const stillPresent = afterCards
      .map((c) => c.id)
      .filter((id) => beforeIds.has(id));
    expect(stillPresent.length).toBe(2);
  });

  it("rewrites an image-occlusion list item", async () => {
    const { deck, profile } = await createDeckWith(db, "edit-image-occ", true);
    const initial =
      "## Diagram\n![[brain.png]]\n1. ==Hippocampus==\n2. ==Amygdala==\n3. ==Thalamus==";
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: initial,
      clozeEnabled: true,
    });
    const cards = await db.getFlashcardsByDeck(deck.id);
    const amygdala = cards.find((c) => c.clozeOrder === 1)!;
    expect(amygdala.type).toBe("image-occlusion");

    const { app, getContent } = makeWritableApp(deck.filepath, initial);
    const writer = new FlashcardWriter(app);
    const result = await writer.editFlashcard(amygdala, {
      type: "image-occlusion",
      listItem: "==Lateral amygdala==",
    });
    expect(result).toEqual({ ok: true });

    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: getContent(),
      clozeEnabled: true,
    });
    const updated = await db.getFlashcardsByDeck(deck.id);
    const renamed = updated.find(
      (c) => c.clozeOrder === 1 && c.type === "image-occlusion",
    );
    expect(renamed).toBeDefined();
    expect(renamed!.clozeText).toBe("Lateral amygdala");
  });
});
