// AI workbench rows travel through the sync log: device A's writes emit ops,
// device B applies them, and both end up with the same session, pile and ledger.

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter } from "./database-test-utils";
import { setupRealSqlJs } from "./setup-real-sql";
import { Logger } from "../../utils/logging";
import {
  applyOp,
  type AiConceptsSaveOp,
  type AiStagedCard,
  type AiStagedCardsUpsertOp,
  type HLCValue,
  type SyncLogEntry,
  type SyncOpV1,
} from "@decks/core";

const HLC: HLCValue = [1_000_000, 0, "device-a"];

function makeLogger(adapter: InMemoryAdapter): Logger {
  return new Logger(
    { debug: { enableLogging: false, performanceLogs: false } } as never,
    adapter,
    ".obsidian",
    "decks"
  );
}

interface Device {
  db: MainDatabaseService;
  logger: Logger;
  emitted: SyncOpV1[];
}

async function device(): Promise<Device> {
  await setupRealSqlJs();
  const adapter = new InMemoryAdapter();
  const logger = makeLogger(adapter);
  const db = new MainDatabaseService("/test.db", adapter, logger.debug.bind(logger));
  await db.initialize();
  const emitted: SyncOpV1[] = [];
  db.setSyncLog({
    append: (op: SyncOpV1) => {
      emitted.push(op);
      return emitted.length;
    },
  } as unknown as Parameters<typeof db.setSyncLog>[0]);
  return { db, logger, emitted };
}

async function deliver(ops: SyncOpV1[], to: Device): Promise<void> {
  let seq = 0;
  for (const op of ops) {
    seq += 1;
    const entry = { hlc: HLC, s: seq, v: 1, o: op.o, p: op.p } as SyncLogEntry;
    await applyOp(to.db, "device-a", entry, to.logger);
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

function staged(
  sessionId: string,
  rowId: string,
  over: Partial<AiStagedCard> = {}
): Omit<AiStagedCard, "created" | "modified"> {
  return {
    id: `${sessionId}:${rowId}`,
    sessionId,
    front: `Front ${rowId}`,
    back: "Back",
    notes: "",
    cardType: "basic",
    options: null,
    correct: null,
    explanation: null,
    valid: null,
    sourcePage: 3,
    sectionIdx: null,
    conceptId: null,
    status: "kept",
    rubricVerdict: null,
    rubricCodes: [],
    fixProposal: null,
    parentId: null,
    origin: "generate",
    dedupHash: null,
    ...over,
  };
}

async function newSession(db: MainDatabaseService): Promise<string> {
  return db.createAiSession({
    sourceKind: "pdf",
    sourceRef: "Lecture 1.pdf",
    sourceHash: "h1",
    selectedIds: ["ch-1"],
    deckId: null,
    profileId: null,
    model: null,
    spendCents: 0,
    turns: [{ role: "user", text: "Cards on chapter 1", at: "2030-01-01T00:00:00Z" }],
    archived: false,
  });
}

describe("AI workbench over the sync log", () => {
  it("a session, its pile and the concept ledger reach another device", async () => {
    const a = await device();
    const b = await device();
    const id = await newSession(a.db);
    await a.db.createAiStagedCards([staged(id, "r1"), staged(id, "r2")]);
    await tick();
    await a.db.updateAiStagedCard(`${id}:r2`, { status: "discarded" });
    await a.db.updateAiSession(id, { selectedIds: ["ch-1", "ch-2"] });
    await a.db.saveAiConcepts("h1", [3], [{ page: 3, term: "Variance", blurb: "Spread" }]);

    await deliver(a.emitted, b);

    expect(await b.db.getAiSession(id)).toEqual(await a.db.getAiSession(id));
    expect(await b.db.getAiStagedCards(id)).toEqual(await a.db.getAiStagedCards(id));
    expect(await b.db.getAiConcepts("h1")).toEqual(await a.db.getAiConcepts("h1"));
    expect(await b.db.getAiExtractedPages("h1")).toEqual([3]);
    expect(await b.db.getAiSessionCounts()).toEqual(await a.db.getAiSessionCounts());
  });

  it("a rewrite that changes nothing sends nothing and leaves the session where it was", async () => {
    const a = await device();
    const id = await newSession(a.db);
    await a.db.createAiStagedCards([staged(id, "r1"), staged(id, "r2")]);
    const before = await a.db.getAiSession(id);
    await tick();
    a.emitted.length = 0;

    await a.db.createAiStagedCards([staged(id, "r1"), staged(id, "r2")]);
    await a.db.updateAiSession(id, { selectedIds: ["ch-1"] });
    await a.db.updateAiStagedCard(`${id}:r1`, { status: "kept" });

    expect(a.emitted).toEqual([]);
    expect((await a.db.getAiSession(id))?.touchedAt).toBe(before?.touchedAt);
  });

  it("only the rows a rewrite changed are sent", async () => {
    const a = await device();
    const id = await newSession(a.db);
    await a.db.createAiStagedCards([staged(id, "r1"), staged(id, "r2")]);
    await tick();
    a.emitted.length = 0;

    await a.db.createAiStagedCards([
      staged(id, "r1"),
      staged(id, "r2", { status: "discarded" }),
    ]);

    const rows = a.emitted.flatMap((op) =>
      op.o === "ai_staged_cards_upsert" ? op.p.rows : []
    );
    expect(rows.map((r) => [r.id, r.status])).toEqual([[`${id}:r2`, "discarded"]]);
  });

  it("the newer row wins in either order, and a saved card stays saved", async () => {
    const row = (status: AiStagedCard["status"], modified: string): AiStagedCardsUpsertOp => ({
      o: "ai_staged_cards_upsert",
      p: {
        rows: [
          { ...staged("s1", "r1", { status }), created: "2030-01-01T00:00:00Z", modified },
        ],
      },
    });
    const older = row("kept", "2030-01-02T00:00:00Z");
    const newer = row("discarded", "2030-01-03T00:00:00Z");

    const b = await device();
    const c = await device();
    await deliver([older, newer], b);
    await deliver([newer, older], c);
    expect((await b.db.getAiStagedCards("s1"))[0].status).toBe("discarded");
    expect((await c.db.getAiStagedCards("s1"))[0].status).toBe("discarded");

    await deliver([row("saved", "2030-01-04T00:00:00Z"), row("kept", "2030-01-05T00:00:00Z")], b);
    expect((await b.db.getAiStagedCards("s1"))[0].status).toBe("saved");
  });

  it("replaying a device's own ops changes nothing", async () => {
    const a = await device();
    const id = await newSession(a.db);
    await a.db.createAiStagedCards([staged(id, "r1")]);
    await a.db.saveAiConcepts("h1", [3], [{ page: 3, term: "Mean", blurb: "" }]);
    const session = await a.db.getAiSession(id);
    const pile = await a.db.getAiStagedCards(id);
    const concepts = await a.db.getAiConcepts("h1");

    await deliver([...a.emitted], a);

    expect(await a.db.getAiSession(id)).toEqual(session);
    expect(await a.db.getAiStagedCards(id)).toEqual(pile);
    expect(await a.db.getAiConcepts("h1")).toEqual(concepts);
  });

  it("the later extraction of a page wins whichever arrives first", async () => {
    const pass = (term: string, at: string): AiConceptsSaveOp => ({
      o: "ai_concepts_save",
      p: { sourceHash: "h1", pages: [3], concepts: [{ page: 3, term, blurb: "" }], at },
    });
    const first = pass("Mean", "2030-01-01T00:00:00Z");
    const second = pass("Median", "2030-01-02T00:00:00Z");

    const b = await device();
    const c = await device();
    await deliver([first, second], b);
    await deliver([second, first], c);

    const terms = async (d: Device): Promise<string[]> =>
      (await d.db.getAiConcepts("h1")).map((x) => x.term);
    expect(await terms(b)).toEqual(["Median"]);
    expect(await terms(c)).toEqual(["Median"]);
  });
});
