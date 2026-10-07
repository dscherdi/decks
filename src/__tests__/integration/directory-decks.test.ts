import initSqlJs from "sql.js";
import {
  deriveDirectoryCardId,
  directoryDeckId,
  generateContentHash,
  DEFAULT_EXAM_SETTINGS,
  DEFAULT_PROFILE_ID,
  EXAMS_PROFILE_ID,
  packDpkg,
  writeDpkgDeckDb,
  type DirectoryCardContent,
  type ExamSettings,
} from "@decks/core";
import type { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";

const SLUG = "capitals";
const DECK = directoryDeckId(SLUG);

function card(ownerId: string, front: string, back: string): DirectoryCardContent {
  return {
    id: deriveDirectoryCardId(SLUG, ownerId),
    position: 0,
    type: "header-paragraph",
    front,
    back,
    notes: "",
    breadcrumb: "",
    clozeText: null,
    clozeOrder: null,
    hint: "",
    tags: ["geo"],
    templateRow: null,
    contentHash: generateContentHash(back),
  };
}

const CARDS = [card("card_fr", "France", "Paris"), card("card_de", "Germany", "Berlin")];

interface PackagedDeck {
  key: string;
  name: string;
  cards: DirectoryCardContent[];
  exam: ExamSettings | null;
}

/** One deck by default; a package of several when given them. */
async function buildPackage(
  exam: ExamSettings | null = null,
  cards: DirectoryCardContent[] = CARDS,
  decks: PackagedDeck[] = [{ key: "", name: "World capitals", cards, exam }]
): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const deckDb = new SQL.Database();
  writeDpkgDeckDb(
    deckDb,
    SLUG,
    {
      decks: decks.map((deck) => ({ key: deck.key, name: deck.name, fileTags: [], cards: deck.cards })),
      templates: [
        {
          id: "t1",
          sourceFile: "",
          tags: ["geo"],
          frontTemplate: "{{1}}",
          frontType: "md",
          backTemplate: "{{2}}",
          backType: "md",
          notesTemplate: null,
          notesType: null,
          created: "",
          modified: "",
        },
      ],
    },
    "2026-10-01T00:00:00.000Z"
  );
  const bytes = deckDb.export();
  deckDb.close();
  const { bytes: pkg } = await packDpkg({
    manifest: {
      slug: SLUG,
      version: 1,
      title: "World capitals",
      description: "",
      language: "en",
      subject: "geography",
      tags: [],
      license: "personal-use",
      cardCount: decks.reduce((sum, deck) => sum + deck.cards.length, 0),
      typeCounts: {},
      createdAt: "2026-10-01T00:00:00.000Z",
      generator: "test",
      decks: decks.map((deck) => ({ key: deck.key, title: deck.name, cardCount: deck.cards.length, exam: deck.exam })),
    },
    deckDb: bytes,
    cardsJson: "[]",
    media: [],
  });
  return pkg;
}

describe("directory decks in the plugin database", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("installs a package as a deck with its cards, no note behind it", async () => {
    const result = await db.importDirectoryPackage(await buildPackage());

    expect(result.deckId).toBe(DECK);
    const deck = (await db.getAllDecks()).find((d) => d.id === DECK);
    expect(deck).toMatchObject({ name: "World capitals", filepath: `decks-directory:${SLUG}` });
    const cards = await db.getFlashcardsByDeck(DECK);
    expect(cards.map((c) => c.id).sort()).toEqual(CARDS.map((c) => c.id).sort());
    expect((await db.listDirectoryDecks()).map((d) => d.slug)).toEqual([SLUG]);
    expect((await db.getDirectoryTemplates(DECK)).map((t) => t.tags)).toEqual([["geo"]]);
  });

  it("offers an exam deck's exam, multiple-choice questions included", async () => {
    const question: DirectoryCardContent = {
      ...card("qcard_gas", "Which element is a noble gas?", "- [ ] Oxygen\n- [x] Argon"),
      type: "multiple-choice",
    };
    await db.importDirectoryPackage(await buildPackage(DEFAULT_EXAM_SETTINGS, [...CARDS, question]));

    expect(await db.getExamEnabledDeckIds()).toContain(DECK);
    const stored = (await db.getFlashcardsByDeck(DECK)).find((c) => c.id === question.id);
    expect(stored?.type).toBe("multiple-choice");
  });

  it("installs a package of several decks, offers its exam deck, and removes them together", async () => {
    const question: DirectoryCardContent = {
      ...card("qcard_gas", "Which element is a noble gas?", "- [ ] Oxygen\n- [x] Argon"),
      type: "multiple-choice",
    };
    const result = await db.importDirectoryPackage(
      await buildPackage(null, CARDS, [
        { key: "capitals", name: "Capitals", cards: CARDS, exam: null },
        { key: "exam", name: "Exam", cards: [question], exam: DEFAULT_EXAM_SETTINGS },
      ])
    );
    const capitals = directoryDeckId(SLUG, "capitals");
    const exam = directoryDeckId(SLUG, "exam");

    expect(result.deckId).toBe(DECK);
    const installed = (await db.getAllDecks()).filter((d) => d.filepath.startsWith(`decks-directory:${SLUG}`));
    expect(installed.map((d) => [d.id, d.name]).sort()).toEqual([[capitals, "Capitals"], [exam, "Exam"]].sort());
    expect(await db.getExamEnabledDeckIds()).toEqual([exam]);
    expect((await db.getFlashcardsByDeck(capitals)).map((c) => c.id).sort()).toEqual(CARDS.map((c) => c.id).sort());
    expect((await db.getDirectoryTemplates(DECK)).map((t) => t.tags)).toEqual([["geo"]]);

    await db.removeDirectoryDeck(DECK);
    expect((await db.getAllDecks()).filter((d) => d.filepath.startsWith("decks-directory:"))).toEqual([]);
    expect(await db.getFlashcardsByDeck(exam)).toEqual([]);
  });

  it("keeps an exam deck on the Exams preset when another tag is mapped, and follows its own mapping", async () => {
    const question: DirectoryCardContent = {
      ...card("qcard_gas", "Which element is a noble gas?", "- [ ] Oxygen\n- [x] Argon"),
      type: "multiple-choice",
    };
    await db.importDirectoryPackage(
      await buildPackage(null, CARDS, [
        { key: "capitals", name: "Capitals", cards: CARDS, exam: null },
        { key: "exam", name: "Exam", cards: [question], exam: DEFAULT_EXAM_SETTINGS },
      ])
    );
    const ids = [directoryDeckId(SLUG, "capitals"), directoryDeckId(SLUG, "exam")];
    const profiles = async () => Promise.all(ids.map(async (id) => (await db.getDeckById(id))?.profileId));
    const other = (await db.getAllProfiles()).find((p) => p.id !== DEFAULT_PROFILE_ID && p.id !== EXAMS_PROFILE_ID)?.id ?? "";

    await db.applyProfileToTag(other, "#decks/elsewhere");
    expect(await profiles()).toEqual([DEFAULT_PROFILE_ID, EXAMS_PROFILE_ID]);
    expect(await db.getExamEnabledDeckIds()).toEqual([ids[1]]);

    await db.applyProfileToTag(other, `#directory/${SLUG}`);
    expect(await profiles()).toEqual([other, other]);

    await db.applyProfileToTag(DEFAULT_PROFILE_ID, `#directory/${SLUG}`);
    expect(await profiles()).toEqual([DEFAULT_PROFILE_ID, EXAMS_PROFILE_ID]);
  });

  it("is a no-op to rebuild when nothing changed", async () => {
    await db.importDirectoryPackage(await buildPackage());
    const result = await db.materialiseDirectoryDecks();
    expect(result.materialised).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it("removes the deck and its cards, and a re-import brings the cards back", async () => {
    await db.importDirectoryPackage(await buildPackage());
    await db.removeDirectoryDeck(DECK);

    expect((await db.getAllDecks()).some((d) => d.id === DECK)).toBe(false);
    expect(await db.getFlashcardsByDeck(DECK)).toHaveLength(0);
    expect(await db.listDirectoryDecks()).toHaveLength(0);

    await db.importDirectoryPackage(await buildPackage());
    expect(await db.getFlashcardsByDeck(DECK)).toHaveLength(CARDS.length);
  });
});
