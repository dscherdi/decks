import initSqlJs from "sql.js";
import {
  deriveDirectoryCardId,
  directoryDeckId,
  generateContentHash,
  DEFAULT_EXAM_SETTINGS,
  DEFAULT_PROFILE_ID,
  directoryPackageGroup,
  directoryProfileId,
  Scheduler,
  packDpkg,
  writeDpkgDeckDb,
  type DirectoryCardContent,
  type DpkgProfile,
  type ILogger,
  type SyncLogEntry,
  applyOp,
  type IBackupService,
  type ExamSettings,
} from "@decks/core";
import type { MainDatabaseService } from "../../database/MainDatabaseService";
import { DEFAULT_SETTINGS } from "../../settings";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";

const SLUG = "capitals";
const REF = `decksmd/${SLUG}`;
const DECK = directoryDeckId(REF);

function card(ownerId: string, front: string, back: string): DirectoryCardContent {
  return {
    id: deriveDirectoryCardId(REF, ownerId),
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
  profile?: DpkgProfile;
}

function carried(key: string, newCardsPerDay: number | null): DpkgProfile {
  return {
    key,
    newCardsPerDay,
    reviewCardsPerDay: null,
    reviewOrder: "due-date",
    learningSteps: "1m",
    relearningSteps: "10m",
    requestRetention: 0.9,
    clozeShowContext: "hidden",
    ttsLang: null,
    ttsRate: null,
  };
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
    REF,
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
      publisher: { id: "decksmd", name: "DecksMD" },
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
      decks: decks.map((deck) => ({
        key: deck.key,
        title: deck.name,
        cardCount: deck.cards.length,
        exam: deck.exam,
        profile: deck.profile?.key ?? null,
      })),
      profiles: [...new Map(decks.flatMap((deck) => (deck.profile ? [[deck.profile.key, deck.profile]] : []))).values()],
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
    expect(deck).toMatchObject({ name: "World capitals", filepath: `decks-directory:${REF}` });
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
    const capitals = directoryDeckId(REF, "capitals");
    const exam = directoryDeckId(REF, "exam");

    expect(result.deckId).toBe(DECK);
    const installed = (await db.getAllDecks()).filter((d) => d.filepath.startsWith(`decks-directory:${REF}`));
    expect(installed.map((d) => [d.id, d.name]).sort()).toEqual([[capitals, "Capitals"], [exam, "Exam"]].sort());
    expect(await db.getExamEnabledDeckIds()).toEqual([exam]);
    expect((await db.getFlashcardsByDeck(capitals)).map((c) => c.id).sort()).toEqual(CARDS.map((c) => c.id).sort());
    expect((await db.getDirectoryTemplates(DECK)).map((t) => t.tags)).toEqual([["geo"]]);

    await db.removeDirectoryDeck(DECK);
    expect((await db.getAllDecks()).filter((d) => d.filepath.startsWith("decks-directory:"))).toEqual([]);
    expect(await db.getFlashcardsByDeck(exam)).toEqual([]);
  });

  it("keeps package decks on their own profiles, whatever tags are mapped", async () => {
    const question: DirectoryCardContent = {
      ...card("qcard_gas", "Which element is a noble gas?", "- [ ] Oxygen\n- [x] Argon"),
      type: "multiple-choice",
    };
    const settings = { ...DEFAULT_EXAM_SETTINGS, questionCount: 1, passScorePct: 70 };
    await db.importDirectoryPackage(
      await buildPackage(null, CARDS, [
        { key: "capitals", name: "Capitals", cards: CARDS, exam: null },
        { key: "exam", name: "Exam", cards: [question], exam: settings },
      ])
    );
    const ids = [directoryDeckId(REF, "capitals"), directoryDeckId(REF, "exam")];
    const own = [directoryProfileId(REF, "preset:study"), directoryProfileId(REF, "preset:exam:exam")];
    const profiles = async () => Promise.all(ids.map(async (id) => (await db.getDeckById(id))?.profileId));
    const other =
      (await db.getAllProfiles()).find((p) => p.id !== DEFAULT_PROFILE_ID && !own.includes(p.id))?.id ?? "";
    expect(await profiles()).toEqual(own);
    expect((await db.getProfileById(own[1]))?.examSettings).toEqual(settings);

    await db.applyProfileToTag(other, "#decks/elsewhere");
    await db.applyProfileToTag(other, `#directory/${REF}`);
    expect(await profiles()).toEqual(own);
    expect(await db.getExamEnabledDeckIds()).toEqual([ids[1]]);
  });

  it("reviews a package's folder within each deck's own daily limits", async () => {
    const question: DirectoryCardContent = {
      ...card("qcard_gas", "Which element is a noble gas?", "- [ ] Oxygen\n- [x] Argon"),
      type: "multiple-choice",
    };
    await db.importDirectoryPackage(
      await buildPackage(null, CARDS, [
        { key: "capitals", name: "Capitals", cards: CARDS, exam: null, profile: carried("study", 1) },
        { key: "exam", name: "Exam", cards: [question], exam: DEFAULT_EXAM_SETTINGS, profile: carried("final", 0) },
      ])
    );
    const record = (await db.listDirectoryDecks())[0];
    const group = directoryPackageGroup(record, await db.getAllDecksWithProfiles(), `pkg:${REF}`);
    expect(group?.deckIds).toEqual([directoryDeckId(REF, "capitals"), directoryDeckId(REF, "exam")]);
    if (!group) return;
    const backups: IBackupService = { createBackup: async () => undefined };
    const scheduler = new Scheduler(db, DEFAULT_SETTINGS, backups);

    const first = await scheduler.getNextForDeckGroup(new Date(), group, { allowNew: true });
    expect(first?.deckId).toBe(directoryDeckId(REF, "capitals"));
    if (!first) return;

    // With the study deck's one new card of the day studied, the exam deck's limit of none still holds.
    await scheduler.rate(first, "good", 4000, new Date());
    expect(await scheduler.getNextForDeckGroup(new Date(), group, { allowNew: true })).toBeNull();
    // A folder that took the group's limits would offer every new card.
    const uncapped = { ...group, deckLimits: false, profile: { ...group.profile, hasNewCardsLimitEnabled: false } };
    expect(await scheduler.getNextForDeckGroup(new Date(), uncapped, { allowNew: true })).not.toBeNull();
  });

  it("lets a learner change a package profile's study settings, never its own", async () => {
    await db.importDirectoryPackage(await buildPackage(null, CARDS));
    const own = directoryProfileId(REF, "preset:study");
    await db.updateProfile(own, { hasNewCardsLimitEnabled: true, newCardsPerDay: 5, fsrs: { requestRetention: 0.85, profile: "STANDARD" } });
    expect(await db.getProfileById(own)).toMatchObject({ hasNewCardsLimitEnabled: true, newCardsPerDay: 5 });
    expect((await db.getProfileById(own))?.fsrs.requestRetention).toBe(0.85);

    await expect(db.updateProfile(own, { name: "Mine" })).rejects.toThrow();
    await expect(db.updateProfile(own, { examEnabled: true })).rejects.toThrow();
    await expect(db.deleteProfile(own)).rejects.toThrow();
    await expect(db.applyProfileToTag(own, "#decks/elsewhere")).rejects.toThrow();

    await db.setDirectoryProfileSettings(own, null);
    expect(await db.getProfileById(own)).toMatchObject({ hasNewCardsLimitEnabled: false, newCardsPerDay: 20 });
  });

  it("takes a learner's settings from another device's sync op", async () => {
    await db.importDirectoryPackage(await buildPackage(null, CARDS));
    const own = directoryProfileId(REF, "preset:study");
    const logger: ILogger = { debug: () => undefined, error: () => undefined };
    const op = (settings: string, modified: string): SyncLogEntry => ({
      hlc: [1_000_000, 0, "phone"],
      s: 1,
      v: 1,
      o: "directory_profile_settings",
      p: { profileId: own, settings, modified },
    });
    await applyOp(db, "phone", op(JSON.stringify({ review_order: "random" }), "2030-01-01T00:00:00.000Z"), logger);
    expect((await db.getProfileById(own))?.reviewOrder).toBe("random");
    // An older op never undoes a newer setting.
    await applyOp(db, "phone", op("{}", "2029-01-01T00:00:00.000Z"), logger);
    expect((await db.getProfileById(own))?.reviewOrder).toBe("random");
  });

  it("removes the package's own profiles with it", async () => {
    await db.importDirectoryPackage(await buildPackage(null, CARDS));
    const own = directoryProfileId(REF, "preset:study");
    expect((await db.getProfileById(own))?.name).toBe("World capitals");
    await db.removeDirectoryDeck(DECK);
    expect(await db.getProfileById(own)).toBeNull();
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
