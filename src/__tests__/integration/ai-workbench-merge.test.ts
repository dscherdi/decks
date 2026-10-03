jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter } from "./database-test-utils";

// InMemoryAdapter reports a fixed mtime of 0, so merge-before-save never fires.
// Bumping it simulates another device having written the file — the situation
// iCloud and Dropbox create routinely.
class MtimeAdapter extends InMemoryAdapter {
  public mtimeValue = 0;
  async stat(
    _path: string
  ): Promise<{ type: string; size: number; mtime: number; ctime: number }> {
    return { type: "file", size: 0, mtime: this.mtimeValue, ctime: 0 };
  }
}

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
  sourcePage: null,
  sectionIdx: null,
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

describe("AI workbench survives a multi-device merge", () => {
  let adapter: MtimeAdapter;
  let db: MainDatabaseService;

  beforeEach(async () => {
    adapter = new MtimeAdapter();
    db = new MainDatabaseService("test.db", adapter, () => {});
    await db.initialize();
  });
  afterEach(async () => {
    await db.close();
  });

  async function mergeFromDisk(step: number): Promise<void> {
    adapter.mtimeValue = step;
    await db.syncWithDisk();
  }

  it("keeps a saved card saved when the stale snapshot still calls it proposed", async () => {
    const sid = await db.createAiSession({
      sourceKind: "pdf",
      sourceRef: "a.pdf",
      sourceHash: null,
      selectedIds: [],
      deckId: null,
      profileId: null,
      model: null,
      spendCents: 0,
      turns: [],
      archived: false,
    });
    await db.createAiStagedCards([staged("c1", sid)]);

    // Snapshot to disk while the card is still a proposal.
    await db.save();

    // This device saves it into the vault.
    await db.updateAiStagedCard("c1", { status: "saved" });
    expect((await db.getAiStagedCards(sid))[0].status).toBe("saved");

    // The other device's older snapshot comes back. It must not win, even
    // though it is the row the merge would otherwise prefer on a timestamp:
    // the card is in the vault now, and re-saving it would write a duplicate.
    await mergeFromDisk(1);
    expect((await db.getAiStagedCards(sid))[0].status).toBe("saved");

    // Repeated merges keep it saved.
    await mergeFromDisk(2);
    expect((await db.getAiStagedCards(sid))[0].status).toBe("saved");
  });

  it("carries a session and its pile across from the other device", async () => {
    // The snapshot on disk holds a session this device does not have. Resuming
    // it on either device is the point of merging at all.
    //
    // Note what this also demonstrates: without a tombstone, a session deleted
    // here is indistinguishable from one this device has never seen, so a stale
    // snapshot resurrects it. That is why the hub archives rather than deletes —
    // archived is a field on the row and merges like any other change.
    const sid = await db.createAiSession({
      sourceKind: "pdf",
      sourceRef: "remote.pdf",
      sourceHash: "h",
      selectedIds: ["ch-1"],
      deckId: null,
      profileId: null,
      model: null,
      spendCents: 0,
      turns: [],
      archived: false,
    });
    await db.createAiStagedCards([staged("r1", sid), staged("r2", sid)]);
    await db.save();

    await db.deleteAiSession(sid);
    expect(await db.getAiSession(sid)).toBeNull();

    await mergeFromDisk(1);
    expect(await db.getAiSession(sid)).not.toBeNull();
    expect((await db.getAiStagedCards(sid)).map((c) => c.id).sort()).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("lets a newer triage decision win over the snapshot", async () => {
    const sid = await db.createAiSession({
      sourceKind: "note",
      sourceRef: "n.md",
      sourceHash: null,
      selectedIds: [],
      deckId: null,
      profileId: null,
      model: null,
      spendCents: 0,
      turns: [],
      archived: false,
    });
    await db.createAiStagedCards([staged("c1", sid)]);
    await db.save();

    // Discarding is an ordinary mutable change: newest wins.
    await db.updateAiStagedCard("c1", { status: "discarded" });
    await mergeFromDisk(1);
    expect((await db.getAiStagedCards(sid))[0].status).toBe("discarded");
  });

  it("keeps the newer session state rather than the snapshot's", async () => {
    const sid = await db.createAiSession({
      sourceKind: "pdf",
      sourceRef: "a.pdf",
      sourceHash: null,
      selectedIds: ["ch-1"],
      deckId: null,
      profileId: null,
      model: null,
      spendCents: 0,
      turns: [],
      archived: false,
    });
    await db.save();

    await db.updateAiSession(sid, { selectedIds: ["ch-1", "ch-2"] });
    await db.appendAiSessionTurn(sid, {
      role: "user",
      text: "more atomic please",
      at: "t1",
    });

    await mergeFromDisk(1);
    const got = await db.getAiSession(sid);
    expect(got?.selectedIds).toEqual(["ch-1", "ch-2"]);
    expect(got?.turns.map((t) => t.text)).toEqual(["more atomic please"]);
  });
});
