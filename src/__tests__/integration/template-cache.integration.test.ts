jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId, resolveCardTemplate, FlashcardParser } from "@decks/core";
import type { Deck, DeckProfile } from "../../database/types";
import { FlashcardWriter } from "../../services/FlashcardWriter";

/** In-memory app stand-in: the writer only uses getAbstractFileByPath + process. */
function makeWritableApp(filepath: string, initialContent: string) {
  let stored = initialContent;
  const { TFile } = jest.requireActual("../../__mocks__/obsidian");
  const file = new TFile(filepath);
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (p === filepath ? file : null),
      process: async (_f: unknown, fn: (c: string) => string): Promise<string> => {
        stored = fn(stored);
        return stored;
      },
    },
  };
  return { app: app as never, getContent: () => stored };
}

describe("Tag-driven template cache (integration)", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createDeck(name: string): Promise<{ deck: Deck; profile: DeckProfile }> {
    const profile = await db.getDefaultProfile();
    const filepath = `/test/${name}.md`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name,
      filepath,
      tag: "flashcards/test",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    return { deck, profile };
  }

  // The binding tag lives on the HEADER that contains the table.
  const TABLE = [
    "## Cards #chemistry",
    "| Word | Definition |",
    "| --- | --- |",
    "| Bonjour | Hello |",
  ].join("\n");

  it("upserts, lists, and deletes deck_templates", async () => {
    await db.upsertDeckTemplate({
      id: "tpl_a",
      sourceFile: "Templates/Chem.md",
      tags: ["chemistry"],
      frontTemplate: "<b>{{Word}}</b>",
      frontType: "html",
      backTemplate: "{{Definition}}",
      backType: "md",
      notesTemplate: null,
      notesType: null,
    });
    let templates = await db.getAllDeckTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      sourceFile: "Templates/Chem.md",
      tags: ["chemistry"],
      frontType: "html",
    });

    await db.deleteDeckTemplateByFile("Templates/Chem.md");
    templates = await db.getAllDeckTemplates();
    expect(templates).toHaveLength(0);
  });

  it("persists deck file_tags", async () => {
    const { deck } = await createDeck("biology");
    await db.setDeckFileTags(deck.id, ["#biology", "#exam"]);
    const reloaded = await db.getDeckById(deck.id);
    expect(reloaded?.fileTags).toEqual(["#biology", "#exam"]);
  });

  it("captures templateRow on synced table cards and binds by tag at render time", async () => {
    const { deck, profile } = await createDeck("chem");
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: TABLE,
    });
    await db.upsertDeckTemplate({
      id: "tpl_chem",
      sourceFile: "Templates/Chem.md",
      tags: ["chemistry"],
      frontTemplate: "<b>{{Word}}</b>",
      frontType: "html",
      backTemplate: "Def: {{Definition}}",
      backType: "md",
      notesTemplate: null,
      notesType: null,
    });

    const cards = await db.getFlashcardsByDeck(deck.id);
    const card = cards.find((c) => c.front === "Bonjour")!;
    expect(card.tags).toContain("chemistry");
    expect(card.templateRow).toEqual({
      headers: ["Word", "Definition"],
      cells: ["Bonjour", "Hello"],
    });

    const templates = await db.getAllDeckTemplates();
    const resolved = resolveCardTemplate(card.tags, [], card.templateRow ?? null, templates);
    expect(resolved).toEqual({
      front: "<b>Bonjour</b>",
      frontType: "html",
      back: "Def: Hello",
      backType: "md",
    });
  });

  it("re-renders with an edited template WITHOUT changing the flashcard row", async () => {
    const { deck, profile } = await createDeck("chem-edit");
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: TABLE,
    });
    const before = (await db.getFlashcardsByDeck(deck.id))[0];

    await db.upsertDeckTemplate({
      id: "tpl_chem",
      sourceFile: "Templates/Chem.md",
      tags: ["chemistry"],
      frontTemplate: "v1 {{Word}}",
      frontType: "md",
      backTemplate: "{{Definition}}",
      backType: "md",
      notesTemplate: null,
      notesType: null,
    });
    const r1 = resolveCardTemplate(before.tags, [], before.templateRow ?? null, await db.getAllDeckTemplates());
    expect(r1?.front).toBe("v1 Bonjour");

    // Edit the template file (same source_file → UPSERT replaces it).
    await db.upsertDeckTemplate({
      id: "tpl_chem",
      sourceFile: "Templates/Chem.md",
      tags: ["chemistry"],
      frontTemplate: "v2 {{Word}}",
      frontType: "md",
      backTemplate: "{{Definition}}",
      backType: "md",
      notesTemplate: null,
      notesType: null,
    });
    const after = (await db.getFlashcardsByDeck(deck.id))[0];
    const r2 = resolveCardTemplate(after.tags, [], after.templateRow ?? null, await db.getAllDeckTemplates());

    expect(r2?.front).toBe("v2 Bonjour"); // new template output
    expect(after.id).toBe(before.id); // flashcard row untouched
    expect(after.front).toBe(before.front);
    expect(after.modified).toBe(before.modified);
  });

  it("rewrites all N table cells when editing a template card's columns", async () => {
    const { deck, profile } = await createDeck("cols");
    const content = [
      "## Kanji #vocab",
      "| Word | Reading | Meaning |",
      "| --- | --- | --- |",
      "| 火 | ひ | fire |",
    ].join("\n");
    await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });
    const card = (await db.getFlashcardsByDeck(deck.id))[0];
    expect(card.templateRow?.cells).toEqual(["火", "ひ", "fire"]);

    // Edit the 2nd and 3rd columns (first column / id basis unchanged).
    const { app, getContent } = makeWritableApp(deck.filepath, content);
    const writer = new FlashcardWriter(app);
    const result = await writer.editFlashcard(card, {
      type: "table",
      front: "火",
      back: "ひらがな",
      notes: "flame",
      columns: ["火", "ひらがな", "flame"],
    });
    expect(result.ok).toBe(true);

    // The whole row is rewritten; re-parsing yields the new cells.
    const reparsed = FlashcardParser.parseFlashcardsFromContent(getContent(), 2);
    expect(reparsed[0].templateRow?.cells).toEqual(["火", "ひらがな", "flame"]);
    expect(getContent()).toContain("| 火 | ひらがな | flame |");
  });
});
