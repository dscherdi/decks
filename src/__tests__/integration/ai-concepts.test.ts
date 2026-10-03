// Schema v42: the concept ledger, and the distinction it exists to make.

import {
  CREATE_TABLES_SQL,
  CURRENT_SCHEMA_VERSION,
  buildMigrationSQL,
  pageConceptTone,
} from "@decks/core";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import { DatabaseTestUtils } from "./database-test-utils";
import type { MainDatabaseService } from "../../database/MainDatabaseService";
import { generateDeckId, generateFlashcardId } from "@decks/core";
import initSqlJs from "sql.js";
import * as path from "node:path";

describe("the concept ledger", () => {
  let db: MainDatabaseService;
  beforeEach(async () => {
    db = await setupTestDatabase();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("stores concepts against the source hash", async () => {
    await db.saveAiConcepts("h1", [61, 62], [
      { page: 61, term: "Median", blurb: "Middle value" },
      { page: 62, term: "Varianz", blurb: "Mean squared deviation" },
    ]);
    const got = await db.getAiConcepts("h1");
    expect(got.map((c) => c.term)).toEqual(["Median", "Varianz"]);
    expect(got[0].page).toBe(61);
  });

  it("records a page that yielded nothing, so it is not read as a gap", async () => {
    // The whole reason the ledger exists: a solutions page has nothing on it,
    // and that is different from a page nobody has looked at.
    await db.saveAiConcepts("h1", [83, 84], []);
    expect(await db.getAiConcepts("h1")).toEqual([]);
    expect(await db.getAiExtractedPages("h1")).toEqual([83, 84]);

    expect(pageConceptTone(true, 0, 0)).toBe("empty");
    expect(pageConceptTone(false, 0, 0)).toBe("empty");
  });

  it("re-extracting a page replaces its concepts rather than doubling them", async () => {
    await db.saveAiConcepts("h1", [61], [{ page: 61, term: "Median", blurb: "v1" }]);
    await db.saveAiConcepts("h1", [61], [{ page: 61, term: "Median", blurb: "v2" }]);
    const got = await db.getAiConcepts("h1");
    expect(got).toHaveLength(1);
    expect(got[0].blurb).toBe("v2");
  });

  it("leaves pages outside the re-extracted range alone", async () => {
    await db.saveAiConcepts("h1", [61, 62], [
      { page: 61, term: "Median", blurb: "" },
      { page: 62, term: "Varianz", blurb: "" },
    ]);
    await db.saveAiConcepts("h1", [61], [{ page: 61, term: "Median neu", blurb: "" }]);
    const got = await db.getAiConcepts("h1");
    expect(got.map((c) => c.term).sort()).toEqual(["Median neu", "Varianz"]);
  });

  it("keeps two sources apart", async () => {
    await db.saveAiConcepts("h1", [1], [{ page: 1, term: "A", blurb: "" }]);
    await db.saveAiConcepts("h2", [1], [{ page: 1, term: "B", blurb: "" }]);
    expect((await db.getAiConcepts("h1")).map((c) => c.term)).toEqual(["A"]);
    expect((await db.getAiConcepts("h2")).map((c) => c.term)).toEqual(["B"]);
  });

  it("clears a source so Re-extract starts from nothing", async () => {
    await db.saveAiConcepts("h1", [61], [{ page: 61, term: "Median", blurb: "" }]);
    await db.clearAiConcepts("h1");
    expect(await db.getAiConcepts("h1")).toEqual([]);
    expect(await db.getAiExtractedPages("h1")).toEqual([]);
  });

  it("is a no-op when no pages were extracted", async () => {
    await db.saveAiConcepts("h1", [], [{ page: 1, term: "stray", blurb: "" }]);
    expect(await db.getAiConcepts("h1")).toEqual([]);
  });
});

describe("the v42 migration", () => {
  it("adds the ledger to a v41 database through the worker path", async () => {
    const wasmPath = path.join(
      process.cwd(),
      "node_modules/sql.js/dist/sql-wasm.wasm",
    );
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const raw = new SQL.Database();
    try {
      raw.run(CREATE_TABLES_SQL);
      raw.run(`
        DROP TABLE IF EXISTS ai_source_extractions;
        DROP TABLE IF EXISTS ai_source_concepts;
        INSERT INTO ai_sessions (
          id, source_kind, source_ref, selected_ids, spend_cents, turns,
          archived, touched_at, created, modified
        ) VALUES ('s1', 'pdf', 'a.pdf', '[]', 0, '[]', 0, 't', 't', 't');
        PRAGMA user_version = 41;
      `);

      raw.exec(buildMigrationSQL(raw));

      const tables = raw
        .exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_source%'",
        )[0]
        .values.map((v) => v[0])
        .sort();
      expect(tables).toEqual(["ai_source_concepts", "ai_source_extractions"]);
      expect(raw.exec("PRAGMA user_version")[0].values[0][0]).toBe(
        CURRENT_SCHEMA_VERSION,
      );
      expect(CURRENT_SCHEMA_VERSION).toBe(42);
      // The v41 tables and their rows survive.
      expect(raw.exec("SELECT id FROM ai_sessions")[0].values).toEqual([["s1"]]);
    } finally {
      raw.close();
    }
  });
});

describe("the cards a source has produced", () => {
  let db: MainDatabaseService;
  beforeEach(async () => {
    db = await setupTestDatabase();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function session(hash: string): Promise<string> {
    return db.createAiSession({
      sourceKind: "pdf",
      sourceRef: "a.pdf",
      sourceHash: hash,
      selectedIds: [],
      deckId: null,
      profileId: null,
      model: null,
      spendCents: 0,
      turns: [],
      archived: false,
    });
  }

  function staged(
    id: string,
    sessionId: string,
    front: string,
    status: "kept" | "saved" | "discarded",
  ) {
    return {
      id,
      sessionId,
      front,
      back: "B",
      notes: "",
      cardType: "basic" as const,
      options: null,
      correct: null,
      explanation: null,
      valid: null,
      sourcePage: null,
      sectionIdx: null,
      conceptId: null,
      status,
      rubricVerdict: null,
      rubricCodes: [],
      fixProposal: null,
      parentId: null,
      origin: "generate" as const,
      dedupHash: generateFlashcardId(front),
    };
  }

  it("spans every session over the same source", async () => {
    const a = await session("h1");
    const b = await session("h1");
    const other = await session("h2");
    await db.createAiStagedCards([
      staged("a1", a, "Median", "kept"),
      staged("b1", b, "Varianz", "saved"),
      staged("o1", other, "Elsewhere", "kept"),
    ]);
    const cards = await db.getAiCardsForSource("h1");
    expect(cards.map((c) => c.text).sort()).toEqual(["Median\nB", "Varianz\nB"]);
  });

  it("leaves out discarded cards, which cover nothing", async () => {
    const a = await session("h1");
    await db.createAiStagedCards([
      staged("a1", a, "Median", "kept"),
      staged("a2", a, "Dropped", "discarded"),
    ]);
    expect(await db.getAiCardsForSource("h1")).toHaveLength(1);
  });

  it("excludes a session on request, so a live pile is not counted twice", async () => {
    const a = await session("h1");
    const b = await session("h1");
    await db.createAiStagedCards([
      staged("a1", a, "Median", "kept"),
      staged("b1", b, "Varianz", "kept"),
    ]);
    const cards = await db.getAiCardsForSource("h1", a);
    expect(cards.map((c) => c.text)).toEqual(["Varianz\nB"]);
  });

  it("carries the review record of a card that reached the vault", async () => {
    const deck = DatabaseTestUtils.createTestDeck({
      id: generateDeckId("deck.md"),
      filepath: "deck.md",
    });
    await db.createDeck(deck);
    const card = DatabaseTestUtils.createTestFlashcard(deck.id, {
      front: "Median",
      back: "B",
    });
    card.id = generateFlashcardId("Median");
    card.lapses = 3;
    await db.createFlashcard(card);

    const a = await session("h1");
    await db.createAiStagedCards([staged("a1", a, "Median", "saved")]);
    const [got] = await db.getAiCardsForSource("h1");
    // This join is what separates "covered" from "covered and still failing".
    expect(got.lapses).toBe(3);
  });

  it("reports no lapses for a card that was never saved", async () => {
    const a = await session("h1");
    await db.createAiStagedCards([staged("a1", a, "Median", "kept")]);
    expect((await db.getAiCardsForSource("h1"))[0].lapses).toBe(0);
  });
});

describe("where a missed card came from", () => {
  let db: MainDatabaseService;
  beforeEach(async () => {
    db = await setupTestDatabase();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function session(hash: string, ref = "Skripte/L1.pdf"): Promise<string> {
    return db.createAiSession({
      sourceKind: "pdf",
      sourceRef: ref,
      sourceHash: hash,
      selectedIds: [],
      deckId: null,
      profileId: null,
      model: null,
      spendCents: 0,
      turns: [],
      archived: false,
    });
  }

  function staged(id: string, sessionId: string, front: string, page: number | null) {
    return {
      id,
      sessionId,
      front,
      back: "B",
      notes: "",
      cardType: "basic" as const,
      options: null,
      correct: null,
      explanation: null,
      valid: null,
      sourcePage: page,
      sectionIdx: null,
      conceptId: null,
      status: "saved" as const,
      rubricVerdict: null,
      rubricCodes: [],
      fixProposal: null,
      parentId: null,
      origin: "generate" as const,
      dedupHash: generateFlashcardId(front),
    };
  }

  it("resolves a flashcard id to its page and source", async () => {
    const sid = await session("h1");
    await db.createAiStagedCards([staged("a1", sid, "Median", 61)]);
    const origins = await db.getAiCardOrigins([generateFlashcardId("Median")]);
    expect(origins.get(generateFlashcardId("Median"))).toEqual({
      page: 61,
      sourceHash: "h1",
      sourceRef: "Skripte/L1.pdf",
    });
  });

  it("prefers a row that knows the page over one that does not", async () => {
    const a = await session("h1");
    const b = await session("h1");
    await db.createAiStagedCards([
      staged("a1", a, "Median", null),
      staged("b1", b, "Median", 61),
    ]);
    const origins = await db.getAiCardOrigins([generateFlashcardId("Median")]);
    expect(origins.get(generateFlashcardId("Median"))?.page).toBe(61);
  });

  it("says nothing about a card the workbench never wrote", async () => {
    expect((await db.getAiCardOrigins(["card_unknown"])).size).toBe(0);
  });

  it("is a no-op for an empty request", async () => {
    expect((await db.getAiCardOrigins([])).size).toBe(0);
  });
});
