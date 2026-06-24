import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import { createRealDatabase } from "./setup-real-sql";
import {
  AnkiCollectionParser,
  AnkiDeckRenderer,
  AnkiHistoryImporter,
  generateDeckId,
} from "@decks/core";
import type { AnkiDeckItem, AnkiRenderedDeck, DeckProfile, RawDatabase } from "@decks/core";

// The sample decks live at the repo root (not committed as fixtures). Skip
// gracefully when absent so CI without the files still passes.
const REPO_ROOT = resolve(__dirname, "../../../../..");
const APKG_PATH = resolve(REPO_ROOT, "test-anki-deck.apkg");
const TEMPLATES_APKG_PATH = resolve(REPO_ROOT, "test-anki-templates.apkg");
const HAS_APKG = existsSync(APKG_PATH);
const describeIf = HAS_APKG ? describe : describe.skip;
const describeIfTemplates = existsSync(TEMPLATES_APKG_PATH) ? describe : describe.skip;

function loadFrom(path: string): RawDatabase {
  const entries = unzipSync(new Uint8Array(readFileSync(path)));
  const bytes = entries["collection.anki21"] ?? entries["collection.anki2"];
  return createRealDatabase(bytes) as unknown as RawDatabase;
}

function loadCollection(): RawDatabase {
  return loadFrom(APKG_PATH);
}

describeIf("Anki import pipeline (integration)", () => {
  let db: MainDatabaseService;
  let profile: DeckProfile;

  beforeEach(async () => {
    db = await setupTestDatabase();
    profile = await db.getDefaultProfile();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("parses notes/cards and resolves field roles", () => {
    const parsed = AnkiCollectionParser.parse(loadCollection());
    expect(parsed.cardCount).toBeGreaterThan(400);
    expect(parsed.noteCount).toBeGreaterThan(200);
    expect(parsed.deckNames.some((name) => /German/i.test(name))).toBe(true);
    expect(parsed.mediaFiles.some((name) => name.endsWith(".mp3"))).toBe(true);

    // Templates are rendered in full now, so the front/back contain (not equal)
    // the key text alongside any other template content.
    const forward = parsed.cards.find((c) => c.front.includes("Das Wetter ist heute schön."));
    expect(forward).toBeDefined();
    expect(forward?.back).toContain("The weather is nice today.");

    // The reverse template yields an independent card with swapped roles.
    const reverse = parsed.cards.find((c) => c.front.includes("The weather is nice today."));
    expect(reverse).toBeDefined();
    expect(reverse?.back).toContain("Das Wetter ist heute schön.");
  });

  it("renders header-paragraph markdown that the real parser can sync", async () => {
    const parsed = AnkiCollectionParser.parse(loadCollection());
    const decks = AnkiDeckRenderer.render(parsed.cards, "decks/anki", profile.headerLevel);
    expect(decks.length).toBeGreaterThan(1);

    // Sync the largest deck and confirm cards land in the database.
    const largest = decks.reduce((a, b) => (b.cards.length > a.cards.length ? b : a));
    const filepath = `Anki Import/${largest.relativePath}.md`;
    const deckId = await syncDeck(filepath, largest);

    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.front.trim().length > 0)).toBe(true);
  });

  it("runs history import without injecting state for an all-new deck", async () => {
    const parsed = AnkiCollectionParser.parse(loadCollection());
    const decks = AnkiDeckRenderer.render(parsed.cards, "decks/anki", profile.headerLevel);

    const items: AnkiDeckItem[] = [];
    for (const deck of decks) {
      const filepath = `Anki Import/${deck.relativePath}.md`;
      await syncDeck(filepath, deck);
      items.push({
        deckId: generateDeckId(filepath),
        profileFsrs: { requestRetention: profile.fsrs.requestRetention, profile: profile.fsrs.profile },
        cards: deck.cards,
      });
    }

    const collection = loadCollection();
    const result = await AnkiHistoryImporter.importHistory(db, items, {
      collectionCreatedMs: AnkiCollectionParser.readCollectionCreatedMs(collection),
      revlogByCard: AnkiCollectionParser.readRevlog(collection),
    });
    // The sample deck is entirely new (empty revlog), so nothing is injected.
    expect(result.injected).toBe(0);
    expect(result.reviews).toBe(0);
  });

  it("renders table format that the real parser can sync", async () => {
    const parsed = AnkiCollectionParser.parse(loadCollection());
    const decks = AnkiDeckRenderer.render(parsed.cards, "decks/anki", profile.headerLevel, "table");

    const largest = decks.reduce((a, b) => (b.cards.length > a.cards.length ? b : a));
    expect(largest.content).toContain("| Front | Back");

    const filepath = `Anki Import/${largest.relativePath}.md`;
    const deckId = await syncDeck(filepath, largest);
    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.front.trim().length > 0)).toBe(true);
  });

  async function syncDeck(filepath: string, deck: AnkiRenderedDeck): Promise<string> {
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
      fileContent: deck.content,
      reverseCards: false,
      clozeEnabled: profile.clozeEnabled,
    });
    return deckId;
  }
});

// The templates deck exercises the deterministic engine: Basic/Cloze models +
// 7 image-occlusion models that must be skipped.
describeIfTemplates("Anki template engine (integration, templates deck)", () => {
  // Initialize SQL.js (createRealDatabase needs the module loaded).
  beforeAll(async () => {
    await setupTestDatabase();
  });
  afterAll(async () => {
    await teardownTestDatabase();
  });

  it("renders Basic models cleanly and skips image-occlusion notes", () => {
    const parsed = AnkiCollectionParser.parse(loadFrom(TEMPLATES_APKG_PATH));
    expect(parsed.cardCount).toBeGreaterThan(1000);

    // No card should carry image-occlusion script/markup (those models are skipped).
    expect(parsed.cards.some((c) => /io-overlay|io-original/.test(c.front + c.back))).toBe(false);

    // Basic cards have non-empty front + back, with the answer side resolved.
    const basics = parsed.cards.filter((c) => !c.isCloze);
    expect(basics.length).toBeGreaterThan(0);
    expect(basics.every((c) => c.front.trim().length > 0)).toBe(true);
  });
});
