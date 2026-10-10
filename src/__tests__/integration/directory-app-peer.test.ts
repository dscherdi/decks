import initSqlJs from "sql.js";
import {
  CREATE_TABLES_SQL,
  applyOp,
  deriveDirectoryCardId,
  directoryDeckId,
  ensureDirectoryTables,
  generateContentHash,
  importDpkgContent,
  packDpkg,
  removeDirectoryDeck,
  sha256Hex,
  unpackDpkg,
  writeDpkgDeckDb,
  type DirectoryCardContent,
  type ILogger,
  type SyncLogEntry,
} from "@decks/core";
import type { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";

const REF = "decksmd/capitals";
const DECK = directoryDeckId(REF);
const INSTALLED_AT = "2026-10-01T00:00:00.000Z";

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
    tags: [],
    templateRow: null,
    contentHash: generateContentHash(back),
  };
}

const CARDS = [card("card_fr", "France", "Paris"), card("card_de", "Germany", "Berlin")];

async function buildPackage(): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const deckDb = new SQL.Database();
  writeDpkgDeckDb(deckDb, REF, { decks: [{ key: "", name: "World capitals", fileTags: [], cards: CARDS }], templates: [] }, INSTALLED_AT);
  const bytes = deckDb.export();
  deckDb.close();
  const { bytes: pkg } = await packDpkg({
    manifest: {
      publisher: { id: "decksmd", name: "DecksMD" },
      slug: "capitals",
      version: 1,
      title: "World capitals",
      description: "",
      language: "en",
      subject: "geography",
      tags: [],
      license: "personal-use",
      cardCount: CARDS.length,
      typeCounts: {},
      createdAt: INSTALLED_AT,
      generator: "test",
      decks: [{ key: "", title: "World capitals", cardCount: CARDS.length, exam: null, profile: null }],
      profiles: [],
    },
    deckDb: bytes,
    cardsJson: "[]",
    media: [],
  });
  return pkg;
}

/** The app's own database file with the package installed, and optionally removed later. */
async function appDatabase(removedAt: string | null = null): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const app = new SQL.Database();
  app.exec(CREATE_TABLES_SQL);
  ensureDirectoryTables(app);
  const pkg = await buildPackage();
  const contents = await unpackDpkg(pkg, { includeMedia: false });
  importDpkgContent(app, contents, await sha256Hex(pkg), (bytes) => new SQL.Database(bytes), INSTALLED_AT);
  if (removedAt) removeDirectoryDeck(app, DECK, removedAt);
  const bytes = app.export();
  app.close();
  return bytes;
}

// What the app's sync log brings for a review of a card this device does not have yet.
function rateOp(cardId: string): SyncLogEntry {
  const reviewedAt = "2026-10-02T09:00:00.000Z";
  return {
    hlc: [1_000_000, 0, "phone"],
    s: 1,
    v: 1,
    o: "rate",
    p: {
      c: cardId,
      st: 4.2,
      d: 5.1,
      due: "2026-10-05T09:00:00.000Z",
      rep: 1,
      lap: 0,
      state: "review",
      lastReviewed: reviewedAt,
      interval: 4320,
      log: {
        id: "log_phone_1",
        flashcardId: cardId,
        sessionId: null,
        lastReviewedAt: INSTALLED_AT,
        shownAt: null,
        reviewedAt,
        rating: 3,
        ratingLabel: "good",
        timeElapsedMs: 1500,
        oldState: "new",
        oldRepetitions: 0,
        oldLapses: 0,
        oldStability: 0,
        oldDifficulty: 5,
        newState: "review",
        newRepetitions: 1,
        newLapses: 0,
        newStability: 4.2,
        newDifficulty: 5.1,
        oldIntervalMinutes: 0,
        newIntervalMinutes: 4320,
        oldDueAt: INSTALLED_AT,
        newDueAt: "2026-10-05T09:00:00.000Z",
        elapsedDays: 1,
        retrievability: 0.9,
        requestRetention: 0.9,
        profile: "STANDARD",
        maximumIntervalDays: 36500,
        minMinutes: 1,
        fsrsWeightsVersion: "1.0",
        schedulerVersion: "1.0",
        noteModelId: null,
        cardTemplateId: null,
        contentHash: null,
        client: "mobile",
      },
    },
  };
}

describe("directory decks the DecksMD app installed", () => {
  let db: MainDatabaseService;
  const logger: ILogger = { debug: () => undefined, error: () => undefined };

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("arrive from the app's database, with the reviews the app's log already brought", async () => {
    await applyOp(db, "phone", rateOp(CARDS[0].id), logger);

    expect(await db.mergePeerDirectory(await appDatabase())).toEqual({ merged: true, changed: true });

    expect((await db.getAllDecks()).find((d) => d.id === DECK)).toMatchObject({ filepath: `decks-directory:${REF}` });
    const cards = await db.getFlashcardsByDeck(DECK);
    expect(cards.map((c) => c.id).sort()).toEqual(CARDS.map((c) => c.id).sort());
    const reviewed = cards.find((c) => c.id === CARDS[0].id);
    expect(reviewed).toMatchObject({ state: "review", repetitions: 1 });
    expect(cards.find((c) => c.id === CARDS[1].id)).toMatchObject({ state: "new", repetitions: 0 });
  });

  it("change nothing when the same file is merged again", async () => {
    const bytes = await appDatabase();
    await db.mergePeerDirectory(bytes);

    expect(await db.mergePeerDirectory(bytes)).toEqual({ merged: true, changed: false });
  });

  it("leave when the app removes them", async () => {
    await db.mergePeerDirectory(await appDatabase());
    await db.mergePeerDirectory(await appDatabase("2026-10-03T00:00:00.000Z"));

    expect((await db.getAllDecks()).some((d) => d.id === DECK)).toBe(false);
    expect(await db.getFlashcardsByDeck(DECK)).toHaveLength(0);
  });

  it("stay removed here when the app's copy is older", async () => {
    const bytes = await appDatabase();
    await db.mergePeerDirectory(bytes);
    await db.removeDirectoryDeck(DECK);

    await db.mergePeerDirectory(bytes);
    expect((await db.getAllDecks()).some((d) => d.id === DECK)).toBe(false);
  });

  it("skip a file that is not a database yet, so it is read again", async () => {
    expect(await db.mergePeerDirectory(new Uint8Array([1, 2, 3]))).toEqual({ merged: false, changed: false });
    const half = await appDatabase();
    expect(await db.mergePeerDirectory(half.subarray(0, 4096))).toEqual({ merged: false, changed: false });
  });
});
