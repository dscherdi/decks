import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import {
  LegacySrMigrator,
  SrHistoryImporter,
  generateDeckId,
  generateFlashcardId,
  generateReverseFlashcardId,
  generateClozeFlashcardId,
} from "@decks/core";
import type { DeckProfile, MigrationDeckItem } from "@decks/core";

describe("SR migration pipeline (integration)", () => {
  let db: MainDatabaseService;
  let profile: DeckProfile;

  beforeEach(async () => {
    db = await setupTestDatabase();
    profile = await db.getDefaultProfile();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const profileFsrs = () => ({
    requestRetention: profile.fsrs.requestRetention,
    profile: profile.fsrs.profile,
  });

  async function syncFile(
    filepath: string,
    content: string,
    reverseCards = false
  ): Promise<string> {
    const deckId = generateDeckId(filepath);
    await db.createDeck({
      id: deckId,
      name: filepath,
      filepath,
      tag: "#decks",
      lastReviewed: null,
      profileId: profile.id,
    });
    await db.syncFlashcardsForDeck({
      deckId,
      deckName: filepath,
      deckFilepath: filepath,
      deckConfig: profile,
      fileContent: content,
      reverseCards,
      clozeEnabled: profile.clozeEnabled,
    });
    return deckId;
  }

  it("restores forward FSRS state for a migrated card", async () => {
    const source = "Capital of France :: Paris <!--SR:!2024-06-18,12,250!4.5,12.2,3,1-->";
    const { dbRecords } = LegacySrMigrator.processFile(source, {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
    });
    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", profile.headerLevel);

    const filepath = "Decks/geo.md";
    const deckId = await syncFile(filepath, rendered.content);

    // Before injection the synced card is brand new.
    const cardId = generateFlashcardId("Capital of France", deckId);
    const fresh = await db.getFlashcardById(cardId);
    expect(fresh).not.toBeNull();
    expect(fresh!.state).toBe("new");

    const items: MigrationDeckItem[] = [
      { deckId, profileFsrs: profileFsrs(), cards: rendered.cards },
    ];
    const { injected } = await SrHistoryImporter.importHistory(db, items);
    expect(injected).toBe(1);

    const restored = await db.getFlashcardById(cardId);
    expect(restored!.state).toBe("review");
    expect(restored!.stability).toBeCloseTo(12.2);
    expect(restored!.difficulty).toBeCloseTo(4.5);
    expect(restored!.repetitions).toBe(3);
    expect(restored!.lapses).toBe(1);
    expect(restored!.interval).toBe(Math.round(12.2 * 1440));

    const log = await db.getReviewLogById(`log_migrate_${cardId}`);
    expect(log).not.toBeNull();
    expect(log!.flashcardId).toBe(cardId);
    expect(log!.newState).toBe("review");
  });

  it("restores independent forward and reverse history for a reversed card", async () => {
    const source = "Cat ::: Gato <!--SR:!2024-06-18,4,260!2024-06-20,40,200-->";
    const { dbRecords } = LegacySrMigrator.processFile(source, {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
    });
    const files = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", profile.headerLevel);
    const reversedFile = files.find((f) => f.reverse)!;
    expect(reversedFile.content).toContain("reverse: true");

    const filepath = "Decks/animals (reversed).md";
    const deckId = await syncFile(filepath, reversedFile.content, true);

    const fwdId = generateFlashcardId("Cat", deckId);
    const revId = generateReverseFlashcardId("Cat", deckId);
    expect(await db.getFlashcardById(fwdId)).not.toBeNull();
    expect(await db.getFlashcardById(revId)).not.toBeNull();

    const items: MigrationDeckItem[] = [
      { deckId, profileFsrs: profileFsrs(), cards: reversedFile.cards },
    ];
    await SrHistoryImporter.importHistory(db, items);

    const fwd = await db.getFlashcardById(fwdId);
    const rev = await db.getFlashcardById(revId);
    expect(fwd!.stability).toBe(4); // forward interval
    expect(rev!.stability).toBe(40); // reverse interval — independent
    expect(fwd!.difficulty).toBe(3); // ease 260 -> 3
    expect(rev!.difficulty).toBe(8); // ease 200 -> 8

    const fwdLog = await db.getReviewLogById(`log_migrate_${fwdId}`);
    const revLog = await db.getReviewLogById(`log_migrate_${revId}`);
    expect(fwdLog).not.toBeNull();
    expect(revLog).not.toBeNull();
    expect(fwdLog!.id).not.toBe(revLog!.id);
  });

  it("is idempotent across re-runs (no duplicate logs)", async () => {
    const source = "Dog :: Perro <!--SR:!2024-06-18,12,250-->";
    const { dbRecords } = LegacySrMigrator.processFile(source, {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
    });
    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", profile.headerLevel);
    const deckId = await syncFile("Decks/dog.md", rendered.content);

    const items: MigrationDeckItem[] = [
      { deckId, profileFsrs: profileFsrs(), cards: rendered.cards },
    ];
    await SrHistoryImporter.importHistory(db, items);
    await SrHistoryImporter.importHistory(db, items);

    const logs = await db.getReviewLogsByDeck(deckId);
    expect(logs).toHaveLength(1);
  });

  it("renders headings at the selected profile's header level", async () => {
    const custom = { ...profile, headerLevel: 3 };
    const { dbRecords } = LegacySrMigrator.processFile("Q :: A", {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
    });
    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", custom.headerLevel, {
      format: "headers",
    });
    expect(rendered.content).toContain("### Q");
  });

  it("smart-routes a mixed file: table card + header card both sync and get history", async () => {
    const source = [
      "Short :: Answer <!--SR:!2024-06-18,4,250-->",
      "",
      "Long question",
      "?",
      "Multi-line",
      "answer <!--SR:!2024-06-18,8,250-->",
    ].join("\n");
    const { dbRecords } = LegacySrMigrator.processFile(source, {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
    });
    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", profile.headerLevel, {
      format: "smart",
    });
    expect(rendered.content).toContain("| Front | Back | Notes |"); // single-line -> table
    expect(rendered.content).toContain("## Long question"); // multi-line -> header

    const filepath = "Decks/mixed.md";
    const deckId = await syncFile(filepath, rendered.content);

    const tableCardId = generateFlashcardId("Short", deckId);
    const headerCardId = generateFlashcardId("Long question", deckId);
    expect(await db.getFlashcardById(tableCardId)).not.toBeNull();
    expect(await db.getFlashcardById(headerCardId)).not.toBeNull();

    const { injected } = await SrHistoryImporter.importHistory(
      db,
      [{ deckId, profileFsrs: profileFsrs(), cards: rendered.cards }]
    );
    expect(injected).toBe(2);
    expect((await db.getFlashcardById(tableCardId))!.state).toBe("review");
    expect((await db.getFlashcardById(headerCardId))!.state).toBe("review");
  });

  it("delete-mode tables: parent header propagates tags to the table rows", async () => {
    const { dbRecords } = LegacySrMigrator.processFile("Hola :: Hi #flashcards/es", {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
    });
    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", profile.headerLevel, {
      withBlockRefs: true,
      format: "tables",
      noteTitle: "Vocab",
    });

    const deckId = await syncFile("Decks/vocab.md", rendered.content);
    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("Hola");
    expect(cards[0].tags).toContain("decks/es");
  });

  it("ships preinstalled per-header + review profiles in a fresh database", async () => {
    const profiles = await db.getAllProfiles();
    const names = profiles.map((p) => p.name);
    for (let level = 1; level <= 6; level++) {
      const p = profiles.find((x) => x.name === `Heading ${level}`);
      expect(p).toBeDefined();
      expect(p!.headerLevel).toBe(level);
    }
    expect(names).toContain("Review notes");
    const review = profiles.find((p) => p.name === "Review notes")!;
    expect(review.headerLevel).toBe(0);
    expect(review.clozeEnabled).toBe(false);
  });

  it("migrates a nested note: front equals the flattened breadcrumb path", async () => {
    const source = [
      "# Biology",
      "## Cell Anatomy",
      "* Mitochondria",
      "  * Function :: Powerhouse <!--SR:!2024-06-18,9,250-->",
    ].join("\n");
    const { dbRecords } = LegacySrMigrator.processFile(source, {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
    });
    const expectedFront = "Cell Anatomy > Mitochondria > Function";
    expect(dbRecords[0].front).toBe(expectedFront);

    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", 2, {
      format: "headers",
    });
    const deckId = await syncFile("Decks/biology.md", rendered.content);
    const cardId = generateFlashcardId(expectedFront, deckId);

    await SrHistoryImporter.importHistory(
      db,
      [{ deckId, profileFsrs: profileFsrs(), cards: rendered.cards }]
    );
    const card = await db.getFlashcardById(cardId);
    expect(card).not.toBeNull();
    expect(card!.front).toBe(expectedFront);
    expect(card!.state).toBe("review");
    expect(card!.stability).toBe(9);
  });

  it("suspends a #sr-skip card after sync (suspendedAt set, no marker)", async () => {
    const { dbRecords } = LegacySrMigrator.processFile("Cat :: Gato #sr-skip", {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
    });
    expect(dbRecords[0].suspended).toBe(true);
    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", profile.headerLevel, {
      format: "headers",
    });
    const deckId = await syncFile("Decks/skip.md", rendered.content);

    const { suspended } = await SrHistoryImporter.importHistory(
      db,
      [{ deckId, profileFsrs: profileFsrs(), cards: rendered.cards }]
    );
    expect(suspended).toBe(1);

    const cardId = generateFlashcardId("Cat", deckId);
    const card = await db.getFlashcardById(cardId);
    expect(card!.suspendedAt).not.toBeNull();
  });

  it("migrates with a custom inline separator end-to-end", async () => {
    const { dbRecords } = LegacySrMigrator.processFile("Perro == Dog <!--SR:!2024-06-18,7,250-->", {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
      inlineSep: "==",
    });
    expect(dbRecords[0].front).toBe("Perro");
    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", profile.headerLevel, {
      format: "headers",
    });
    const deckId = await syncFile("Decks/custom.md", rendered.content);
    await SrHistoryImporter.importHistory(
      db,
      [{ deckId, profileFsrs: profileFsrs(), cards: rendered.cards }]
    );
    const card = await db.getFlashcardById(generateFlashcardId("Perro", deckId));
    expect(card!.state).toBe("review");
    expect(card!.stability).toBe(7);
  });

  it("migrates a cloze note: N cloze cards under generateClozeFlashcardId with injected state", async () => {
    const source =
      "The capital is ==Paris== in {{c1::France}}.\n<!--SR:!2024-06-18,4,250!2024-06-19,9,250-->";
    const { dbRecords } = LegacySrMigrator.processFile(source, {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
      noteTitle: "Geo",
    });
    expect(dbRecords[0].clozes).toBeDefined();
    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", profile.headerLevel);

    const deckId = await syncFile("Decks/geo.md", rendered.content);
    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(2); // one cloze card per highlight
    expect(cards.every((c) => c.type === "cloze")).toBe(true);

    const { injected } = await SrHistoryImporter.importHistory(
      db,
      [{ deckId, profileFsrs: profileFsrs(), cards: rendered.cards }]
    );
    expect(injected).toBe(2);

    const front = dbRecords[0].front;
    const parisId = generateClozeFlashcardId(front, "Paris", 0, deckId);
    const franceId = generateClozeFlashcardId(front, "France", 1, deckId);
    expect((await db.getFlashcardById(parisId))!.stability).toBe(4);
    expect((await db.getFlashcardById(franceId))!.stability).toBe(9);
  });

  it("migrates a whole-note review as a single title-mode card with restored state", async () => {
    const titleProfile: Omit<DeckProfile, "created" | "modified"> = {
      ...profile,
      id: "profile_review_test",
      name: "Review notes test",
      headerLevel: 0,
      clozeEnabled: false,
      isDefault: false,
    };
    await db.createProfile(titleProfile);

    const note = [
      "---",
      "sr-due: 2024-06-18",
      "sr-interval: 20",
      "sr-ease: 250",
      "tags: review",
      "---",
      "",
      "## Section A",
      "Body content with its own headings.",
    ].join("\n");
    // The review note is DUPLICATED into a new title-mode file (tag
    // decks/review, SR metadata stripped); the original is untouched.
    const card = LegacySrMigrator.processWholeNote(note, "Photosynthesis");
    const duplicate = LegacySrMigrator.renderTitleModeFile(card, "decks/review");
    expect(duplicate).toContain("- decks/review");
    expect(duplicate).not.toContain("sr-due");
    expect(duplicate).toContain("Body content with its own headings.");

    const filepath = "Decks/Photosynthesis.md"; // new duplicate location
    const deckId = generateDeckId(filepath);
    await db.createDeck({
      id: deckId,
      name: filepath,
      filepath,
      tag: "#decks/review",
      lastReviewed: null,
      profileId: titleProfile.id,
    });
    const result = await db.syncFlashcardsForDeck({
      deckId,
      deckName: filepath,
      deckFilepath: filepath,
      deckConfig: { ...titleProfile, created: "", modified: "" },
      fileContent: duplicate,
      fileTitle: "Photosynthesis",
    });
    expect(result.parsedCount).toBe(1); // one card per whole note, headings not split

    card.front = "Photosynthesis";
    await SrHistoryImporter.importHistory(
      db,
      [{ deckId, profileFsrs: profileFsrs(), cards: [card] }]
    );

    const cardId = generateFlashcardId("Photosynthesis", deckId);
    const restored = await db.getFlashcardById(cardId);
    expect(restored).not.toBeNull();
    expect(restored!.state).toBe("review");
    expect(restored!.stability).toBe(20);
  });

  it("does not create false cards from a fenced code block (end-to-end)", async () => {
    const source = [
      "Here is a real card. :: It syncs.",
      "",
      "```js",
      "const x = a ? b : c;",
      "// not a card :: really",
      "```",
    ].join("\n");
    const { dbRecords } = LegacySrMigrator.processFile(source, {
      srBaseTag: "#flashcards",
      decksBaseTag: "#decks",
    });
    expect(dbRecords).toHaveLength(1); // only the real card, none from the code

    const [rendered] = LegacySrMigrator.renderDecksFiles(dbRecords, "#decks", profile.headerLevel);
    const deckId = await syncFile("Decks/code.md", rendered.content);
    const total = await db.countTotalCards(deckId);
    expect(total).toBe(1);
  });
});
