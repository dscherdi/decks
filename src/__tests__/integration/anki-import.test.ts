import { unzipSync } from "fflate";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import { createRealDatabase } from "./setup-real-sql";
import {
  buildSampleApkg,
  buildSampleApkgNewFormat,
  buildSampleApkgV18,
  SAMPLE,
} from "./fixtures/anki-sample-apkg";
import { isZstd } from "@decks/core";
import { pickAnkiCollection, readAnkiMediaMap } from "../../utils/ankiCollection";
import {
  AnkiCollectionParser,
  AnkiDeckRenderer,
  AnkiHistoryImporter,
  generateDeckId,
} from "@decks/core";
import type { AnkiDeckItem, AnkiRenderedDeck, DeckProfile, RawDatabase } from "@decks/core";

// A tiny self-contained `.apkg` built in memory from representative samples —
// no dependency on any local Anki export. See fixtures/anki-sample-apkg.ts.
let APKG: Uint8Array;
let ENTRIES: Record<string, Uint8Array>;

function loadCollection(): RawDatabase {
  const bytes = ENTRIES["collection.anki21"] ?? ENTRIES["collection.anki2"];
  return createRealDatabase(bytes) as unknown as RawDatabase;
}

function getMediaText(): (name: string) => string | undefined {
  const map = JSON.parse(new TextDecoder().decode(ENTRIES["media"])) as Record<string, string>;
  const byName = new Map<string, string>();
  for (const [key, name] of Object.entries(map)) byName.set(name, key);
  return (name: string): string | undefined => {
    const key = byName.get(name);
    return key && ENTRIES[key] ? new TextDecoder().decode(ENTRIES[key]) : undefined;
  };
}

describe("Anki import pipeline (integration)", () => {
  let db: MainDatabaseService;
  let profile: DeckProfile;

  beforeEach(async () => {
    db = await setupTestDatabase();
    profile = await db.getDefaultProfile();
    // sql.js is initialized by setupTestDatabase, so build the fixture now.
    APKG = buildSampleApkg();
    ENTRIES = unzipSync(APKG);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("parses every model kind into the expected cards, decks, and media", () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });
    expect(parsed.cardCount).toBe(SAMPLE.cardCount);
    expect(parsed.noteCount).toBe(SAMPLE.noteCount);
    expect(parsed.withHistory).toBe(SAMPLE.withHistory);
    expect(parsed.deckNames.some((name) => SAMPLE.germanDeckMatch.test(name))).toBe(true);
    expect(parsed.mediaFiles.some((name) => name.endsWith(".mp3"))).toBe(true);

    const byKind = (k: string) => parsed.cards.filter((c) => c.kind === k);
    // German (multi-field, no layout CSS) imports as a basic card; only the
    // CSS-layout PeriodicTable model uses a template.
    expect(byKind("basic").length).toBe(2); // Basic + German
    expect(byKind("template").length).toBe(1); // PeriodicTable (rich CSS)
    expect(byKind("cloze").length).toBe(1);
    expect(byKind("occlusion").length).toBe(1);
  });

  it("imports a multi-field model without layout CSS as a clean basic card", () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });

    const card = parsed.cards.find((c) => c.front.includes(SAMPLE.germanFront));
    expect(card).toBeDefined();
    expect(card?.kind).toBe("basic"); // no rich CSS → basic markdown, not a template
    expect(card?.back).toContain(SAMPLE.germanBack);
    expect(card?.templateRow).toBeUndefined();
  });

  it("imports a CSS-layout multi-field model as a template row carrying every field", () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });
    const card = parsed.cards.find((c) => c.kind === "template");
    expect(card).toBeDefined();
    expect(card?.templateRow?.headers.length).toBeGreaterThan(2);
    expect(card?.templateTag).toBeTruthy();
  });

  it("generates HTML + cloze template files and injects model CSS", () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });
    expect(parsed.templateFiles.length).toBeGreaterThan(0);
    // Multi-field models export an HTML template; the cloze-with-extras a markdown one.
    expect(parsed.templateFiles.some((t) => t.content.includes("```decks-html-front"))).toBe(true);
    expect(parsed.templateFiles.some((t) => t.content.includes("```decks-md-notes"))).toBe(true);
    // The PeriodicTable model ships CSS → a <style> block in its template.
    expect(parsed.templateFiles.some((t) => t.content.includes("<style>"))).toBe(true);
  });

  it("gives cloze cards a real sentence front (never a 'Cloze <id>' fallback)", () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });
    const cloze = parsed.cards.filter((c) => c.kind === "cloze");
    expect(cloze.length).toBe(1);
    expect(cloze.every((c) => !/^Cloze \d+$/.test(c.front))).toBe(true);
    expect(cloze[0].clozeBody).toBe(SAMPLE.clozeSentence);
  });

  it("extracts occlusion masks as percentages from the real mask SVG", () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });
    const occ = parsed.cards.filter((c) => c.kind === "occlusion");
    expect(occ.length).toBe(1);
    expect(occ[0].imagePath).toBe(SAMPLE.occlusionImage);
    expect(occ[0].masks?.length).toBeGreaterThan(0);
    const mask = occ[0].masks![0];
    expect(mask.x).toBeGreaterThanOrEqual(0);
    expect(mask.x).toBeLessThanOrEqual(100);
  });

  it("renders markdown the real parser can sync across every deck", async () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });
    const decks = AnkiDeckRenderer.render(parsed.cards, "decks/anki", profile.headerLevel);
    expect(decks.length).toBeGreaterThan(1);

    let total = 0;
    for (const deck of decks) {
      const deckId = await syncDeck(`Anki Import/${deck.relativePath}.md`, deck);
      const cards = await db.getFlashcardsByDeck(deckId);
      total += cards.length;
      expect(cards.every((c) => c.front.trim().length > 0)).toBe(true);
    }
    expect(total).toBeGreaterThan(0);
  });

  it("escalates the compact basic card into an aggregated table", async () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });
    const decks = AnkiDeckRenderer.render(parsed.cards, "decks/anki", profile.headerLevel);

    // The single basic card (single-paragraph answer) escalates to a table.
    const basicDeck = decks.find((d) => d.cards.some((c) => c.kind === "basic"));
    expect(basicDeck).toBeDefined();
    expect(basicDeck!.content).toContain("| Front | Back |");

    const deckId = await syncDeck(`Anki Import/${basicDeck!.relativePath}.md`, basicDeck!);
    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.front.trim().length > 0)).toBe(true);
  });

  it("renders occlusion blocks the real OcclusionV2 parser can sync", async () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });
    const occ = parsed.cards.filter((c) => c.kind === "occlusion");
    const decks = AnkiDeckRenderer.render(occ, "decks/anki", profile.headerLevel);
    const target = decks.find((d) => d.content.includes("```decks-occlusion"));
    expect(target).toBeDefined();

    const deckId = await syncDeck(`Anki Import/${target!.relativePath}.md`, target!);
    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.type === "image-occlusion-v2")).toBe(true);
  });

  it("imports review history for the reviewed card, idempotently", async () => {
    const parsed = AnkiCollectionParser.parse(loadCollection(), { getMediaText: getMediaText() });
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
    const options = {
      collectionCreatedMs: AnkiCollectionParser.readCollectionCreatedMs(collection),
      revlogByCard: AnkiCollectionParser.readRevlog(collection),
    };
    const first = await AnkiHistoryImporter.importHistory(db, items, options);
    expect(first.injected).toBe(SAMPLE.withHistory);
    expect(first.reviews).toBe(SAMPLE.reviewCount);

    // Re-running imports nothing new (deterministic ids → idempotent).
    const second = await AnkiHistoryImporter.importHistory(db, items, options);
    expect(second.injected).toBe(0);
  });

  async function syncDeck(filepath: string, deck: AnkiRenderedDeck | { content: string; relativePath?: string }): Promise<string> {
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

// The modern export ships a zstd `collection.anki21b` + a protobuf media
// manifest. Mirror the controller's pickCollection/readMediaMap decode path.
describe("Anki import — modern format (zstd + protobuf media)", () => {
  beforeEach(async () => {
    await setupTestDatabase(); // initializes sql.js for createRealDatabase
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("picks anki21b over the legacy stub and reads the protobuf media manifest", () => {
    const entries = unzipSync(buildSampleApkgNewFormat());
    // Mirrors a real modern export: zstd anki21b + a legacy anki2 "please update" stub.
    expect(isZstd(entries["collection.anki21b"])).toBe(true);
    expect(entries["collection.anki2"]).toBeDefined();

    // pickAnkiCollection must prefer anki21b, not the stub.
    const collectionBytes = pickAnkiCollection(entries);
    const collection = createRealDatabase(collectionBytes) as unknown as RawDatabase;

    // Protobuf manifest resolves the occlusion SVG so masks extract end-to-end.
    const mediaByName = readAnkiMediaMap(entries);
    const mediaText = (name: string): string | undefined => {
      const key = mediaByName.get(name);
      return key && entries[key] ? new TextDecoder().decode(entries[key]) : undefined;
    };

    const parsed = AnkiCollectionParser.parse(collection, { getMediaText: mediaText });
    expect(parsed.cardCount).toBe(SAMPLE.cardCount);
    expect(parsed.mediaFiles.some((name) => name.endsWith(".mp3"))).toBe(true);

    const occ = parsed.cards.filter((c) => c.kind === "occlusion");
    expect(occ.length).toBe(1);
    expect(occ[0].masks?.length).toBeGreaterThan(0);
    expect(occ[0].imagePath).toBe(SAMPLE.occlusionImage);
  });

  it("parses a schema-18 collection (models/decks in normalized protobuf tables)", () => {
    const entries = unzipSync(buildSampleApkgV18());
    const collection = createRealDatabase(pickAnkiCollection(entries)) as unknown as RawDatabase;
    // The v18 media manifest is zstd-compressed; readAnkiMediaMap decompresses it.
    const mediaByName = readAnkiMediaMap(entries);
    expect(mediaByName.size).toBeGreaterThan(0);
    const mediaText = (name: string): string | undefined => {
      const key = mediaByName.get(name);
      return key && entries[key] ? new TextDecoder().decode(entries[key]) : undefined;
    };

    const parsed = AnkiCollectionParser.parse(collection, { getMediaText: mediaText });
    expect(parsed.cardCount).toBe(SAMPLE.cardCount); // models reconstructed from notetypes/templates/fields
    expect(parsed.deckNames.some((name) => SAMPLE.germanDeckMatch.test(name))).toBe(true);
    expect(parsed.mediaFiles.some((name) => name.endsWith(".mp3"))).toBe(true);

    const occ = parsed.cards.filter((c) => c.kind === "occlusion");
    expect(occ.length).toBe(1);
    expect(occ[0].masks?.length).toBeGreaterThan(0);
    // Cloze model (kind=1 from protobuf) still routes to a cloze card.
    expect(parsed.cards.some((c) => c.kind === "cloze")).toBe(true);
  });
});
