// A package is built from the note as it reads now, even when the database
// holds an older parse of a note the mtime gate treats as unchanged.
jest.unmock("sql.js");

import { TFile, type App, type MetadataCache, type Vault } from "obsidian";
import { classifyExamBody, unpackDpkg, type DirectoryCardContent } from "@decks/core";
import type { SqlJsStatic } from "sql.js";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { DeckManager } from "../../services/DeckManager";
import { DirectoryExporter, type ReparseDeck } from "../../services/DirectoryExporter";
import type { DirectoryExportDetails } from "../../settings";
import { cleanupTestDatabase, createTestDatabase } from "../test-db-utils";

jest.mock("../../database/loadSqlJsMainThread", () => ({
  loadSqlJsMainThread: () => (globalThis as unknown as { initSqlJs: () => Promise<SqlJsStatic> }).initSqlJs(),
}));

const PATH = "Goethe/Lesen.md";

// What an earlier parse kept: each exercise's shared text, without its questions.
const EARLIER = ["## Lesen Teil 1", "Bei Stefan Berger gibt es Gerichte.", ""].join("\n");

const NOTE = [
  "## Lesen Teil 1",
  "Bei Stefan Berger gibt es Gerichte.",
  "",
  "### Was gibt es bei Stefan Berger?",
  "- [x] Gerichte",
  "- [ ] Bücher",
  "",
  "### Wie heißt der Koch?",
  "Stefan Berger",
  "",
  "## Lesen Teil 2",
  "> [!passage] Apotheke am Markt",
  "> Samstag bis 13 Uhr geöffnet.",
  "",
  "### Wann schließt sie samstags?",
  "- [ ] 18.30",
  "- [x] 13 Uhr",
  "",
  "### Wie heißt die Apotheke?",
  "Apotheke am Markt",
  "",
].join("\n");

const DETAILS: DirectoryExportDetails = {
  slug: "goethe-lesen",
  title: "Goethe Lesen",
  description: "",
  language: "de",
  subject: "",
  version: 1,
  license: "",
  publisher: { id: "u-testpublsh", name: "Tester" },
};

interface Note {
  app: App;
  vault: Vault;
  metadataCache: MetadataCache;
  file: TFile;
  setContent: (content: string) => void;
  content: () => string;
}

function note(initial: string): Note {
  let stored = initial;
  const file = new TFile(PATH);
  file.stat = { mtime: 100, ctime: 100 };
  const vault = {
    getAbstractFileByPath: (path: string) => (path === PATH ? file : null),
    read: async () => stored,
    cachedRead: async () => stored,
    process: async (_file: TFile, edit: (current: string) => string) => {
      stored = edit(stored);
      file.stat.mtime += 1;
      return stored;
    },
  } as unknown as Vault;
  const metadataCache = {
    getFileCache: () => null,
    getFirstLinkpathDest: () => null,
  } as unknown as MetadataCache;
  return {
    app: { vault, metadataCache } as unknown as App,
    vault,
    metadataCache,
    file,
    // Replaces the text without moving the mtime, as the gate then sees nothing new.
    setContent: (content) => (stored = content),
    content: () => stored,
  };
}

describe("directory export re-parses its notes", () => {
  let db: MainDatabaseService;
  let deckId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    const profile = await db.getDefaultProfile();
    await db.createProfile({ ...profile, id: "profile_exam", name: "Exam", examEnabled: true, isDefault: false });
    deckId = await db.createDeck({ id: "deck_lesen", name: "Lesen", filepath: PATH, tag: "#decks", lastReviewed: null, profileId: "profile_exam" });
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  async function staleSetup(): Promise<{ vaultNote: Note; manager: DeckManager; reparse: ReparseDeck }> {
    const vaultNote = note(EARLIER);
    const manager = new DeckManager(vaultNote.vault, vaultNote.metadataCache, db);
    expect(await manager.syncFlashcardsForDeck(deckId)).toBe(true);
    vaultNote.setContent(NOTE);
    // The gate skips the note, so its rows stay the earlier parse.
    await manager.syncFlashcardsForDeck(deckId);
    expect((await db.getFlashcardsByDeck(deckId)).map((card) => card.type)).toEqual(["header-paragraph"]);
    return { vaultNote, manager, reparse: (id) => manager.syncFlashcardsForDeck(id, undefined, { force: true }) };
  }

  async function deck() {
    const found = await db.getDeckWithProfile(deckId);
    if (!found) throw new Error("deck missing");
    return found;
  }

  it("plans from the note's current text", async () => {
    const { vaultNote, reparse } = await staleSetup();
    const exporter = new DirectoryExporter(vaultNote.app, db, "test", reparse);
    expect((await exporter.plan([await deck()], DETAILS)).cardCount).toBe(2);
  });

  it("packages every exercise with its questions and stamps the note", async () => {
    const { vaultNote, reparse } = await staleSetup();
    const exporter = new DirectoryExporter(vaultNote.app, db, "test", reparse);

    const output = await exporter.export([await deck()], DETAILS);
    const contents = await unpackDpkg(output.bytes, { includeMedia: false });

    expect(contents.manifest.formatVersion).toBe(3);
    const cards = JSON.parse(contents.cardsJson ?? "[]") as DirectoryCardContent[];
    expect(cards.map((card) => [card.type, card.front])).toEqual([
      ["multiple-choice", "Lesen Teil 1"],
      ["multiple-choice", "Lesen Teil 2"],
    ]);
    const second = classifyExamBody(cards[1].back);
    expect(second.kind === "exercise" && second.items.map((item) => item.kind)).toEqual(["choice", "typed"]);
    expect(vaultNote.content().match(/%%dk:/g)).toHaveLength(2);
  });

  it("refuses to export a note it could not read, rather than packaging the old rows", async () => {
    const { vaultNote, reparse } = await staleSetup();
    vaultNote.setContent("");
    const exporter = new DirectoryExporter(vaultNote.app, db, "test", reparse);

    await expect(exporter.export([await deck()], DETAILS)).rejects.toThrow(`Could not read the note "${PATH}"`);
    await expect(exporter.plan([await deck()], DETAILS)).rejects.toThrow(PATH);
  });
});
