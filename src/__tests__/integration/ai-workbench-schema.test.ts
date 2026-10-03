// Schema v41 integration: the two AI workbench tables, their CRUD, and the
// merge rules — including the one that makes `saved` terminal.

import {
  CREATE_TABLES_SQL,
  CURRENT_SCHEMA_VERSION,
  buildMigrationSQL,
} from "@decks/core";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import type { MainDatabaseService } from "../../database/MainDatabaseService";
import initSqlJs from "sql.js";
import * as path from "node:path";

describe("AI workbench schema (v41)", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const session = () => ({
    sourceKind: "pdf" as const,
    sourceRef: "Skripte/Lektion1.pdf",
    sourceHash: "abc_123",
    selectedIds: ["ch-1", "ch-2"],
    deckId: null,
    profileId: null,
    model: "decks-tier-fast",
    spendCents: 0,
    turns: [],
    archived: false,
  });

  const staged = (id: string, sessionId: string, over = {}) => ({
    id,
    sessionId,
    front: `Q ${id}`,
    back: "A",
    notes: "",
    cardType: "basic" as const,
    options: null,
    correct: null,
    explanation: null,
    valid: null,
    sourcePage: 70,
    sectionIdx: 1,
    conceptId: null,
    status: "proposed" as const,
    rubricVerdict: null,
    rubricCodes: [],
    fixProposal: null,
    parentId: null,
    origin: "generate" as const,
    dedupHash: null,
    ...over,
  });

  it("round-trips a session, including the fields that are JSON on disk", async () => {
    const id = await db.createAiSession(session());
    const got = await db.getAiSession(id);
    expect(got).toMatchObject({
      sourceKind: "pdf",
      sourceRef: "Skripte/Lektion1.pdf",
      sourceHash: "abc_123",
      selectedIds: ["ch-1", "ch-2"],
      archived: false,
    });
    expect(got?.turns).toEqual([]);
  });

  it("keeps the turn log append-only", async () => {
    const id = await db.createAiSession(session());
    await db.appendAiSessionTurn(id, { role: "user", text: "first", at: "t1" });
    await db.appendAiSessionTurn(id, {
      role: "assistant",
      text: "second",
      at: "t2",
    });
    const got = await db.getAiSession(id);
    expect(got?.turns.map((t) => t.text)).toEqual(["first", "second"]);
  });

  it("orders the hub by most recently touched, archived last", async () => {
    const a = await db.createAiSession(session());
    const b = await db.createAiSession(session());
    // Touching b must float it above a.
    await db.updateAiSession(b, { model: "decks-tier-quality" });
    const live = await db.getAiSessions();
    expect(live[0].id).toBe(b);

    await db.updateAiSession(a, { archived: true }, { touch: false });
    expect((await db.getAiSessions()).map((s) => s.id)).toEqual([b]);
    expect((await db.getAiSessions(true)).map((s) => s.id)).toEqual([b, a]);
  });

  it("archiving does not promote a session up the hub", async () => {
    const a = await db.createAiSession(session());
    const b = await db.createAiSession(session());
    await db.updateAiSession(b, { model: "m" });
    await db.updateAiSession(a, { archived: true }, { touch: false });
    const all = await db.getAiSessions(true);
    // a is archived, so it sorts last whatever its timestamp — but its
    // touched_at must also not have moved.
    const before = all.find((s) => s.id === a);
    expect(before?.touchedAt).toBe(before?.created);
  });

  it("stores a staged card's verdict, lineage and provenance", async () => {
    const sid = await db.createAiSession(session());
    await db.createAiStagedCards([
      staged("c1", sid, {
        rubricVerdict: "flagged",
        rubricCodes: ["enumeration", "two_facts"],
        fixProposal: "Split into three.",
      }),
      staged("c2", sid, { parentId: "c1", origin: "split" }),
    ]);
    const cards = await db.getAiStagedCards(sid);
    expect(cards).toHaveLength(2);
    const [c1, c2] = cards;
    expect(c1.rubricCodes).toEqual(["enumeration", "two_facts"]);
    expect(c1.sourcePage).toBe(70);
    expect(c2.parentId).toBe("c1");
    expect(c2.origin).toBe("split");
  });

  it("keeps unjudged distinct from passing", async () => {
    const sid = await db.createAiSession(session());
    await db.createAiStagedCards([staged("c1", sid)]);
    const [card] = await db.getAiStagedCards(sid);
    // A critique that never ran must not read as a clean bill of health.
    expect(card.rubricVerdict).toBeNull();
    expect(card.valid).toBeNull();
  });

  it("round-trips an MCQ's options and correct set", async () => {
    const sid = await db.createAiSession(session());
    await db.createAiStagedCards([
      staged("q1", sid, {
        cardType: "mcq",
        options: ["Varianz", "Standardabweichung", "Spannweite"],
        correct: [1],
        explanation: "The root restores the original unit.",
        valid: true,
      }),
    ]);
    const [q] = await db.getAiStagedCards(sid);
    expect(q.options).toEqual(["Varianz", "Standardabweichung", "Spannweite"]);
    expect(q.correct).toEqual([1]);
    expect(q.valid).toBe(true);
  });

  it("counts the hub's piles in one query", async () => {
    const a = await db.createAiSession(session());
    const b = await db.createAiSession(session());
    await db.createAiStagedCards([
      staged("a1", a),
      staged("a2", a, { rubricVerdict: "flagged", rubricCodes: ["trivial"] }),
      staged("a3", a, { status: "saved" }),
      // Discarded cards are not staged, and a saved card never returns to triage.
      staged("a4", a, { status: "discarded", rubricVerdict: "flagged" }),
      staged("b1", b),
    ]);
    const counts = await db.getAiSessionCounts();
    expect(counts[a]).toMatchObject({ staged: 2, flagged: 1, saved: 1 });
    expect(counts[b]).toMatchObject({ staged: 1, flagged: 0, saved: 0 });
  });

  it("gathers flagged cards across every session for one triage queue", async () => {
    const a = await db.createAiSession(session());
    const b = await db.createAiSession(session());
    await db.createAiStagedCards([
      staged("a1", a, { rubricVerdict: "flagged", rubricCodes: ["trivial"] }),
      staged("b1", b, { rubricVerdict: "flagged", rubricCodes: ["two_facts"] }),
      staged("b2", b, { rubricVerdict: "pass" }),
      // Already dealt with: flagged but saved.
      staged("b3", b, { rubricVerdict: "flagged", status: "saved" }),
    ]);
    const flagged = await db.getFlaggedAiStagedCards();
    expect(flagged.map((c) => c.id).sort()).toEqual(["a1", "b1"]);
  });

  it("deleting a session takes its staged cards with it", async () => {
    const sid = await db.createAiSession(session());
    await db.createAiStagedCards([staged("c1", sid), staged("c2", sid)]);
    await db.deleteAiSession(sid);
    expect(await db.getAiSession(sid)).toBeNull();
    expect(await db.getAiStagedCards(sid)).toEqual([]);
  });
});

describe("AI workbench schema: the worker migration path", () => {
  // Production runs ONLY buildMigrationSQL, never CREATE_TABLES_SQL afterwards,
  // so a table added to just one of them never reaches an existing database.
  it("upgrades a simulated v40 database", async () => {
    const wasmPath = path.join(
      process.cwd(),
      "node_modules/sql.js/dist/sql-wasm.wasm"
    );
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const raw = new SQL.Database();
    try {
      raw.run(CREATE_TABLES_SQL);
      raw.run(`
        DROP TABLE IF EXISTS ai_staged_cards;
        DROP TABLE IF EXISTS ai_sessions;
        DROP TABLE IF EXISTS ai_source_concepts;
        DROP TABLE IF EXISTS ai_source_extractions;
        PRAGMA user_version = 40;
      `);
      expect(
        raw.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%'"
        )
      ).toEqual([]);

      raw.exec(buildMigrationSQL(raw));

      const tables = raw
        .exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%'"
        )[0]
        .values.map((v) => v[0])
        .sort();
      // Every workbench table, not just the ones v41 added: a database two
      // versions behind still arrives complete through this one path.
      expect(tables).toEqual([
        "ai_sessions",
        "ai_source_concepts",
        "ai_source_extractions",
        "ai_staged_cards",
      ]);

      const version = raw.exec("PRAGMA user_version")[0].values[0][0];
      expect(version).toBe(CURRENT_SCHEMA_VERSION);
      expect(CURRENT_SCHEMA_VERSION).toBe(42);
    } finally {
      raw.close();
    }
  });

  it("is a no-op on a database that already has the tables", async () => {
    const wasmPath = path.join(
      process.cwd(),
      "node_modules/sql.js/dist/sql-wasm.wasm"
    );
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const raw = new SQL.Database();
    try {
      raw.run(CREATE_TABLES_SQL);
      raw.run(`
        INSERT INTO ai_sessions (
          id, source_kind, source_ref, selected_ids, spend_cents, turns,
          archived, touched_at, created, modified
        ) VALUES ('s1', 'pdf', 'a.pdf', '[]', 0, '[]', 0, 't', 't', 't');
        PRAGMA user_version = 40;
      `);
      raw.exec(buildMigrationSQL(raw));
      // Re-running must not drop what is already there.
      const rows = raw.exec("SELECT id FROM ai_sessions")[0].values;
      expect(rows).toEqual([["s1"]]);
    } finally {
      raw.close();
    }
  });
});
