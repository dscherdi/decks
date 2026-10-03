// The round trip the hub depends on: a generator pile is persisted, the hub
// reads it back, and Resume restores it.

import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import type { MainDatabaseService } from "../../database/MainDatabaseService";
import { generatedCardId, type GeneratedCard } from "@decks/core";
import type { GenRow } from "../../components/ai-generator-types";

const card = (front: string, over: Partial<GeneratedCard> = {}): GeneratedCard => ({
  front,
  back: "A",
  notes: "",
  ...over,
});

const row = (id: string, c: GeneratedCard, over: Partial<GenRow> = {}): GenRow => ({
  id,
  card: c,
  keep: true,
  saved: false,
  ...over,
});

/**
 * Mirrors main.ts's persistAiSession. Kept in the test rather than exported so
 * the production path stays private; what matters is that the shape it writes
 * reads back correctly.
 */
async function persist(
  db: MainDatabaseService,
  sessionId: string | null,
  rows: GenRow[],
  source = { ref: "Skripte/Lektion1.pdf", hash: "h1", selected: ["ch-1"] },
  superseded: ReadonlySet<string> = new Set(),
): Promise<string> {
  let id = sessionId;
  if (id) {
    await db.updateAiSession(id, { selectedIds: source.selected });
  } else {
    id = await db.createAiSession({
      sourceKind: "pdf",
      sourceRef: source.ref,
      sourceHash: source.hash,
      selectedIds: source.selected,
      deckId: null,
      profileId: null,
      model: "decks-tier-fast",
      spendCents: 0,
      turns: [],
      archived: false,
    });
  }
  await db.createAiStagedCards(
    rows.map((r) => ({
      id: `${id}:${r.id}`,
      sessionId: id as string,
      front: r.card.front,
      back: r.card.back,
      notes: r.card.notes,
      cardType: "basic" as const,
      options: null,
      correct: null,
      explanation: null,
      valid: null,
      sourcePage: r.card.page ?? null,
      sectionIdx: r.card.section ?? null,
      conceptId: null,
      status: r.saved
        ? "saved"
        : superseded.has(r.id)
          ? "superseded"
          : r.keep
            ? "kept"
            : "discarded",
      rubricVerdict: r.verdict?.verdict ?? null,
      rubricCodes: r.verdict?.codes ?? [],
      fixProposal: r.verdict?.fix || null,
      parentId: r.parentId ? `${id}:${r.parentId}` : null,
      origin: r.origin ?? "generate",
      dedupHash: generatedCardId(r.card),
    })),
  );
  return id;
}

describe("a generator pile reaches the hub and comes back", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("creates the session on the first write, and reuses it after", async () => {
    const id = await persist(db, null, [row("gen-0", card("Q1"))]);
    expect((await db.getAiSessions()).map((s) => s.id)).toEqual([id]);

    const same = await persist(db, id, [
      row("gen-0", card("Q1")),
      row("gen-1", card("Q2")),
    ]);
    expect(same).toBe(id);
    // One session, not two — re-writing the pile must not fork it.
    expect(await db.getAiSessions()).toHaveLength(1);
    expect(await db.getAiStagedCards(id)).toHaveLength(2);
  });

  it("is idempotent: rewriting the same pile does not duplicate rows", async () => {
    const rows = [row("gen-0", card("Q1")), row("gen-1", card("Q2"))];
    const id = await persist(db, null, rows);
    await persist(db, id, rows);
    await persist(db, id, rows);
    expect(await db.getAiStagedCards(id)).toHaveLength(2);
  });

  it("carries a later decision over the earlier one", async () => {
    const id = await persist(db, null, [row("gen-0", card("Q1"))]);
    await persist(db, id, [row("gen-0", card("Q1"), { keep: false })]);
    expect((await db.getAiStagedCards(id))[0].status).toBe("discarded");

    await persist(db, id, [row("gen-0", card("Q1"), { saved: true })]);
    expect((await db.getAiStagedCards(id))[0].status).toBe("saved");
  });

  it("keeps provenance, verdict and lineage through the round trip", async () => {
    const id = await persist(db, null, [
      row("gen-0", card("Q1", { page: 70, section: 2 }), {
        verdict: {
          id: "gen-0",
          verdict: "flagged",
          codes: ["enumeration"],
          fix: "Split into three.",
        },
      }),
      row("gen-1", card("Q1a"), { parentId: "gen-0", origin: "split" }),
    ]);
    const [a, b] = await db.getAiStagedCards(id);
    expect(a.sourcePage).toBe(70);
    expect(a.sectionIdx).toBe(2);
    expect(a.rubricVerdict).toBe("flagged");
    expect(a.rubricCodes).toEqual(["enumeration"]);
    expect(a.fixProposal).toBe("Split into three.");
    // The lineage pointer is namespaced to the session, and still resolves.
    expect(b.parentId).toBe(a.id);
    expect(b.origin).toBe("split");
  });

  it("gives the hub the counts it draws", async () => {
    const id = await persist(db, null, [
      row("gen-0", card("Q1")),
      row("gen-1", card("Q2"), {
        verdict: { id: "gen-1", verdict: "flagged", codes: ["trivial"], fix: "" },
      }),
      row("gen-2", card("Q3"), { saved: true }),
      row("gen-3", card("Q4"), { keep: false }),
    ]);
    const counts = await db.getAiSessionCounts();
    expect(counts[id]).toMatchObject({ staged: 2, flagged: 1, saved: 1 });

    const outcome = await db.getAiOutcome("1970-01-01T00:00:00.000Z");
    expect(outcome).toEqual({ saved: 1, discarded: 1 });
  });

  it("counts a card in a replaced round as neither staged nor decided", async () => {
    const source = { ref: "n.md", hash: "h1", selected: [] };
    const id = await persist(
      db,
      null,
      [row("gen-0", card("Q1")), row("gen-1", card("Q1 shorter"))],
      source,
      new Set(["gen-0"]),
    );
    expect((await db.getAiSessionCounts())[id]).toMatchObject({ staged: 1, flagged: 0, saved: 0 });
    expect(await db.getAiOutcome("1970-01-01T00:00:00.000Z")).toEqual({ saved: 0, discarded: 0 });
    expect(await db.getAiCardsForSource("h1")).toHaveLength(1);
  });

  it("keeps when a card was staged across re-saves, and dates only a change", async () => {
    const rows = [row("gen-0", card("Q1")), row("gen-1", card("Q2"))];
    const id = await persist(db, null, rows);
    const [first] = await db.getAiStagedCards(id);
    await new Promise((r) => setTimeout(r, 15));
    const between = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 15));

    await persist(db, id, rows);
    const [again] = await db.getAiStagedCards(id);
    expect(again.created).toBe(first.created);
    expect(again.modified).toBe(first.modified);

    // A save re-writes the whole pile; only the card that changed is dated now.
    await persist(db, id, [row("gen-0", card("Q1"), { saved: true }), rows[1]]);
    const after = await db.getAiStagedCards(id);
    expect(after[0].created).toBe(first.created);
    expect(after[0].modified > between).toBe(true);
    expect(after[1].modified < between).toBe(true);
    expect(await db.getAiOutcome(between)).toEqual({ saved: 1, discarded: 0 });
  });

  it("does not count decisions from before the window", async () => {
    await persist(db, null, [row("gen-0", card("Q1"), { saved: true })]);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(await db.getAiOutcome(future)).toEqual({ saved: 0, discarded: 0 });
  });

  it("restores a pile including the cards that were discarded", async () => {
    const id = await persist(db, null, [
      row("gen-0", card("Q1")),
      row("gen-1", card("Q2"), { keep: false }),
    ]);
    const restored = await db.getAiStagedCards(id);
    // A dropped card is still evidence of what the model already proposed, so
    // Resume brings it back rather than quietly forgetting it.
    expect(restored.map((c) => c.status)).toEqual(["kept", "discarded"]);
    const session = await db.getAiSession(id);
    expect(session?.sourceRef).toBe("Skripte/Lektion1.pdf");
    expect(session?.selectedIds).toEqual(["ch-1"]);
  });
});

describe("the conversation survives a reload", () => {
  let db: MainDatabaseService;
  beforeEach(async () => {
    db = await setupTestDatabase();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  const turn = (role: "user" | "assistant", text: string, extra = {}) => ({
    role,
    text,
    at: "2026-09-18T10:00:00.000Z",
    ...extra,
  });

  it("stores and returns the questions and answers in order", async () => {
    const id = await db.createAiSession({
      sourceKind: "pdf",
      sourceRef: "a.pdf",
      sourceHash: "h1",
      selectedIds: [],
      deckId: null,
      profileId: null,
      model: null,
      spendCents: 0,
      turns: [
        turn("user", "what does Chebyshev bound?"),
        turn("assistant", "The share outside k sigma.", {
          pages: [73],
          gaps: [{ term: "Perzentilband", page: 77 }],
        }),
      ],
      archived: false,
    });
    const back = await db.getAiSession(id);
    expect(back?.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    // The chips and the gap actions are part of the answer, not decoration on
    // it — an answer that comes back bare cannot be acted on.
    expect(back?.turns[1].pages).toEqual([73]);
    expect(back?.turns[1].gaps).toEqual([{ term: "Perzentilband", page: 77 }]);
  });

  it("replaces the log rather than appending on every save", async () => {
    const id = await db.createAiSession({
      sourceKind: "pdf",
      sourceRef: "a.pdf",
      sourceHash: "h1",
      selectedIds: [],
      deckId: null,
      profileId: null,
      model: null,
      spendCents: 0,
      turns: [turn("user", "first")],
      archived: false,
    });
    await db.updateAiSession(id, {
      turns: [turn("user", "first"), turn("assistant", "second")],
    });
    expect((await db.getAiSession(id))?.turns).toHaveLength(2);
  });
});
