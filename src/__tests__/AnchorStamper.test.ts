import { AnchorStamper } from "../services/AnchorStamper";
import type { Flashcard } from "../database/types";
import type { App, TFile } from "obsidian";
import type { IDatabaseService } from "@decks/core";
import { generateAnchorId, generateClozeFlashcardId } from "@decks/core";

class TFileLike {
  public stat = { mtime: 100 };
  constructor(public path: string) {}
}

class FakeDb {
  bindings = new Map<string, string>();
  columns = new Map<string, string>();
  cards = new Map<string, Flashcard>();
  lastSynced = 0;
  mtimeStamps: number[] = [];

  async getAnchorBinding(anchor: string): Promise<string | null> {
    return this.bindings.get(anchor) ?? null;
  }
  async insertAnchorBindings(
    rows: { anchor: string; flashcardId: string }[]
  ): Promise<void> {
    for (const row of rows) {
      if (!this.bindings.has(row.anchor)) {
        this.bindings.set(row.anchor, row.flashcardId);
      }
    }
  }
  async setFlashcardAnchor(id: string, anchor: string): Promise<void> {
    this.columns.set(id, anchor);
  }
  async getFlashcardById(id: string): Promise<Flashcard | null> {
    return this.cards.get(id) ?? null;
  }
  async getDeckWithProfile(deckId: string): Promise<unknown> {
    return {
      id: deckId,
      profile: { headerLevel: 2, clozeEnabled: true },
    };
  }
  async getDeckLastSyncedMtime(): Promise<number> {
    return this.lastSynced;
  }
  async setDeckLastSyncedMtime(_deckId: string, mtime: number): Promise<void> {
    this.mtimeStamps.push(mtime);
  }
  async countNodeCards(): Promise<number> {
    return 1;
  }
}

function mockEnv(content: string): {
  app: App;
  db: FakeDb;
  file: TFileLike;
  currentContent: () => string;
} {
  let stored = content;
  const file = new TFileLike("test.md");
  const { TFile: MockTFile } = jest.requireActual("../__mocks__/obsidian");
  Object.setPrototypeOf(file, MockTFile.prototype);
  const db = new FakeDb();
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (p === "test.md" ? file : null),
      cachedRead: async () => stored,
      process: async (_f: TFile, fn: (c: string) => string) => {
        stored = fn(stored);
        file.stat.mtime += 1;
        return stored;
      },
    },
  } as unknown as App;
  return { app, db, file, currentContent: () => stored };
}

function makeCard(partial: Partial<Flashcard>): Flashcard {
  return {
    id: "card_1",
    deckId: "deck_1",
    front: "",
    back: "",
    type: "header-paragraph",
    sourceFile: "test.md",
    contentHash: "hash",
    breadcrumb: "",
    notes: "",
    tags: [],
    hint: "",
    clozeText: null,
    clozeOrder: null,
    sourceNodeId: null,
    anchor: null,
    state: "new",
    dueDate: new Date().toISOString(),
    interval: 0,
    repetitions: 1,
    difficulty: 5,
    stability: 0,
    lapses: 0,
    lastReviewed: new Date().toISOString(),
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    ...partial,
  };
}

function stamperFor(env: { app: App; db: FakeDb }): AnchorStamper {
  return new AnchorStamper(env.app, env.db as unknown as IDatabaseService);
}

describe("AnchorStamper multiple-choice (q role)", () => {
  const OPTIONS = "- [ ] Oxygen\n- [x] Argon\n- [ ] Nitrogen";

  it("stamps the q token as its own paragraph after the list, blank-line separated", async () => {
    const env = mockEnv(`## Noble gas?\n\n${OPTIONS}\n`);
    const card = makeCard({
      front: "Noble gas?",
      back: OPTIONS,
      type: "multiple-choice",
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId("Noble gas?");
    // Blank line between the last option and the token: a directly-following
    // line would lazily continue the last list item.
    expect(env.currentContent()).toContain(
      `- [ ] Nitrogen\n\n%%dk:q:${tokenId}%%`
    );
    expect(env.db.bindings.get(`q:${tokenId}`)).toBe("card_1");
    expect(card.anchor).toBe(`q:${tokenId}`);
  });

  it("stamps after the notes divider region, still blank-line separated", async () => {
    const env = mockEnv(
      `## Noble gas?\n\n${OPTIONS}\n\n---\nGroup 18 explanation.\n`
    );
    const card = makeCard({
      front: "Noble gas?",
      back: OPTIONS,
      type: "multiple-choice",
      notes: "Group 18 explanation.",
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId("Noble gas?");
    expect(env.currentContent()).toContain(
      `Group 18 explanation.\n\n%%dk:q:${tokenId}%%`
    );
  });

  it("adopts an existing q token and ignores a dormant h token", async () => {
    const env = mockEnv(
      `## Noble gas?\n\n${OPTIONS}\n%%dk:h:old1%%\n\n%%dk:q:mine2%%\n`
    );
    const card = makeCard({
      front: "Noble gas?",
      back: OPTIONS,
      type: "multiple-choice",
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok && outcome.adopted).toBe(true);
    expect(env.db.bindings.get("q:mine2")).toBe("card_1");
    expect(env.db.bindings.has("h:old1")).toBe(false);
    // No second token was written.
    expect(env.currentContent().match(/%%dk:q:/g)).toHaveLength(1);
  });

  it("never adopts a dormant h token for a question", async () => {
    const env = mockEnv(`## Noble gas?\n\n${OPTIONS}\n%%dk:h:old1%%\n`);
    const card = makeCard({
      front: "Noble gas?",
      back: OPTIONS,
      type: "multiple-choice",
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId("Noble gas?");
    expect(card.anchor).toBe(`q:${tokenId}`);
    expect(env.db.bindings.has("h:old1")).toBe(false);
  });
});

describe("AnchorStamper", () => {
  it("writes the h token on its own line after the body and binds it", async () => {
    const env = mockEnv("## Question\n\nFirst line.\nLast line.\n");
    const card = makeCard({ front: "Question", back: "First line.\nLast line." });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId("Question");
    expect(env.currentContent()).toContain(`Last line.\n%%dk:h:${tokenId}%%`);
    expect(env.db.bindings.get(`h:${tokenId}`)).toBe("card_1");
    expect(card.anchor).toBe(`h:${tokenId}`);
  });

  it("adopts an existing token instead of double-stamping", async () => {
    const env = mockEnv("## Question\n\nBody text. %%dk:h:zzz%%\n");
    const card = makeCard({ front: "Question", back: "Body text." });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok && outcome.adopted).toBe(true);
    expect(env.currentContent()).not.toContain("%%dk:h:zzz%% %%dk:h:");
    expect(env.db.bindings.get("h:zzz")).toBe("card_1");
  });

  it("adopts a token line that is no longer last in the body", async () => {
    const env = mockEnv(
      "## Question\n\nBody text.\n%%dk:h:zzz%%\nAdded afterwards.\n"
    );
    const card = makeCard({
      front: "Question",
      back: "Body text.\n\nAdded afterwards.",
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok && outcome.adopted).toBe(true);
    const tokenCount = (env.currentContent().match(/%%dk:h:/g) ?? []).length;
    expect(tokenCount).toBe(1);
    expect(env.db.bindings.get("h:zzz")).toBe("card_1");
  });

  it("skips duplicate fronts deterministically", async () => {
    const env = mockEnv(
      "## Question\n\nBody one.\n\n## Question\n\nBody two.\n"
    );
    const card = makeCard({ front: "Question", back: "Body one." });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome).toEqual({ ok: false, reason: "ambiguous_front" });
    expect(env.currentContent()).not.toContain("%%dk:");
  });

  it("skips stale content without writing", async () => {
    const env = mockEnv("## Question\n\nEdited since load.\n");
    const card = makeCard({ front: "Question", back: "Original body." });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome).toEqual({ ok: false, reason: "stale" });
    expect(env.currentContent()).not.toContain("%%dk:");
  });

  it("stamps the cloze line and binds every sibling on it", async () => {
    const body = "The ==heart== pumps ==blood== around.";
    const env = mockEnv(`## Anatomy\n\n${body}\n`);
    const card = makeCard({
      front: "Anatomy",
      back: body,
      type: "cloze",
      clozeText: "blood",
      clozeOrder: 1,
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId(body);
    expect(env.currentContent()).toContain(`around. %%dk:c:${tokenId}%%`);
    expect(env.db.bindings.get(`c:${tokenId}#0`)).toBe(
      generateClozeFlashcardId("Anatomy", "heart", 0)
    );
    expect(env.db.bindings.get(`c:${tokenId}#1`)).toBe(
      generateClozeFlashcardId("Anatomy", "blood", 1)
    );
    if (outcome.ok) expect(outcome.anchorKey).toBe(`c:${tokenId}#1`);
  });

  it("stamps every member of a cloze group sequentially against the evolving file", async () => {
    const body = [
      "- it is to ==create== life",
      "- it is to ==help== others",
      "- it is to ==participate== in creation of god",
    ].join("\n");
    const env = mockEnv(`###### What is the meaning of life\n\n${body}\n`);
    const stamper = stamperFor(env);
    const front = "What is the meaning of life";

    for (let order = 0; order < 3; order++) {
      const card = makeCard({
        id: `ccard_${order}`,
        front,
        back: body,
        type: "cloze",
        clozeOrder: order,
      });
      const outcome = await stamper.ensureAnchored(card);
      expect(outcome.ok).toBe(true);
    }

    const tokenCount = (env.currentContent().match(/%%dk:c:/g) ?? []).length;
    expect(tokenCount).toBe(3);
    expect(env.currentContent()).toMatch(/creation of god %%dk:c:[a-z0-9]+%%/);
  });

  it("stamps the third cloze when two lines already carry tokens", async () => {
    const env = mockEnv(
      "###### What is the meaning of life\n\n" +
        "- it is to ==create== life %%dk:c:ealgpb%%\n" +
        "- it is to ==help== others  %%dk:c:91gt5d%%\n" +
        "- it is to ==participate== in creation of god\n"
    );
    const back = [
      "- it is to ==create== life",
      "- it is to ==help== others",
      "- it is to ==participate== in creation of god",
    ].join("\n");
    const card = makeCard({
      id: "ccard_2",
      front: "What is the meaning of life",
      back,
      type: "cloze",
      clozeText: "participate",
      clozeOrder: 2,
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    expect(env.currentContent()).toMatch(/creation of god %%dk:c:[a-z0-9]+%%/);
  });

  it("suppresses the resync mtime only when the deck was clean", async () => {
    const clean = mockEnv("## Q\n\nBody.\n");
    clean.db.lastSynced = 100;
    await stamperFor(clean).ensureAnchored(makeCard({ front: "Q", back: "Body." }));
    expect(clean.db.mtimeStamps).toEqual([101]);

    const dirty = mockEnv("## Q\n\nBody.\n");
    dirty.db.lastSynced = 50;
    await stamperFor(dirty).ensureAnchored(makeCard({ front: "Q", back: "Body." }));
    expect(dirty.db.mtimeStamps).toEqual([]);
  });

  it("no-ops when the card's key is already bound to another card", async () => {
    const env = mockEnv("irrelevant");
    env.db.bindings.set("e:edge9", "card_other");
    const card = makeCard({ id: "scard_1", type: "spatial", edgeId: "edge9" });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome).toEqual({ ok: false, reason: "binding_conflict" });
    expect(env.db.bindings.get("e:edge9")).toBe("card_other");
  });

  it("binds canvas cards without touching the file", async () => {
    const env = mockEnv("canvas json untouched");
    const card = makeCard({ id: "scard_1", type: "spatial", edgeId: "edge9" });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    expect(env.db.bindings.get("e:edge9")).toBe("scard_1");
    expect(env.currentContent()).toBe("canvas json untouched");
  });

  it("stamps the base card when a reverse card is rated, binding both keys", async () => {
    const env = mockEnv("## Base front\n\nBase back.\n");
    const { generateFlashcardId } = jest.requireActual("@decks/core");
    const baseId = generateFlashcardId("Base front");
    env.db.cards.set(baseId, makeCard({ id: baseId, front: "Base front", back: "Base back." }));
    const reverse = makeCard({
      id: "rcard_1",
      front: "Base back.",
      back: "Base front",
    });
    const outcome = await stamperFor(env).ensureAnchored(reverse);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId("Base front");
    expect(env.currentContent()).toContain(`Base back.\n%%dk:h:${tokenId}%%`);
    expect(env.db.bindings.get(`h:${tokenId}`)).toBe(baseId);
    expect(env.db.bindings.get(`h:${tokenId}:rev`)).toBe("rcard_1");
  });

  it("never stamps occlusion v2 cards (mask ids are already stable)", async () => {
    const env = mockEnv("irrelevant");
    const outcome = await stamperFor(env).ensureAnchored(
      makeCard({ type: "image-occlusion-v2" })
    );
    expect(outcome).toEqual({ ok: false, reason: "not_stampable" });
    expect(env.currentContent()).toBe("irrelevant");
  });

  it("stamps a table row into its first cell, preserving the rest byte-for-byte", async () => {
    const env = mockEnv(
      "## Vocab\n\n| Front | Back |\n|---|---|\n| chat |  cat  |\n"
    );
    const card = makeCard({
      front: "chat",
      back: "cat",
      type: "table",
      breadcrumb: "Vocab",
      templateRow: { headers: ["Front", "Back"], cells: ["chat", "cat"] },
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId("chat");
    expect(env.currentContent()).toContain(
      `| chat %%dk:t:${tokenId}%% |  cat  |`
    );
    expect(env.db.bindings.get(`t:${tokenId}`)).toBe("card_1");
    expect(card.anchor).toBe(`t:${tokenId}`);
  });

  it("binds every cloze in a table row's cloze cell", async () => {
    const env = mockEnv(
      "## Organs\n\n| Front | Back |\n|---|---|\n| word | The ==heart== and ==lungs== |\n"
    );
    const back = "The ==heart== and ==lungs==";
    const card = makeCard({
      id: "ccard_x",
      front: "word",
      back,
      type: "cloze",
      breadcrumb: "Organs",
      clozeText: "lungs",
      clozeOrder: 1,
      templateRow: { headers: ["Front", "Back"], cells: ["word", back] },
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId("word");
    expect(env.db.bindings.get(`t:${tokenId}#0`)).toBe(
      generateClozeFlashcardId("word", "heart", 0)
    );
    expect(env.db.bindings.get(`t:${tokenId}#1`)).toBe(
      generateClozeFlashcardId("word", "lungs", 1)
    );
    if (outcome.ok) expect(outcome.anchorKey).toBe(`t:${tokenId}#1`);
  });

  it("stamps a table-hosted cloze even when templateRow is missing", async () => {
    const back = "The ==heart== and ==lungs==";
    const env = mockEnv(
      `## Organs\n\n| Front | Back |\n|---|---|\n| word | ${back} |\n`
    );
    const card = makeCard({
      id: "ccard_x",
      front: "word",
      back,
      type: "cloze",
      breadcrumb: "Organs",
      clozeText: "heart",
      clozeOrder: 0,
      templateRow: null,
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId("word");
    expect(env.currentContent()).toContain(`| word %%dk:t:${tokenId}%% |`);
    expect(env.db.bindings.get(`t:${tokenId}#0`)).toBe(
      generateClozeFlashcardId("word", "heart", 0)
    );
    if (outcome.ok) expect(outcome.anchorKey).toBe(`t:${tokenId}#0`);
  });

  it("skips duplicate table fronts deterministically", async () => {
    const env = mockEnv(
      "## Vocab\n\n| Front | Back |\n|---|---|\n| chat | cat |\n| chat | chatter |\n"
    );
    const card = makeCard({
      front: "chat",
      back: "cat",
      type: "table",
      breadcrumb: "Vocab",
      templateRow: { headers: ["Front", "Back"], cells: ["chat", "cat"] },
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome).toEqual({ ok: false, reason: "ambiguous_front" });
    expect(env.currentContent()).not.toContain("%%dk:");
  });

  it("adopts an existing t token in any cell of the row", async () => {
    const env = mockEnv(
      "## Vocab\n\n| Front | Back |\n|---|---|\n| chat | cat %%dk:t:zz99%% |\n"
    );
    const card = makeCard({
      front: "chat",
      back: "cat",
      type: "table",
      breadcrumb: "Vocab",
      templateRow: { headers: ["Front", "Back"], cells: ["chat", "cat"] },
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok && outcome.adopted).toBe(true);
    expect((env.currentContent().match(/%%dk:t:/g) ?? []).length).toBe(1);
    expect(env.db.bindings.get("t:zz99")).toBe("card_1");
  });

  it("stamps an occlusion item line and binds it", async () => {
    const env = mockEnv(
      "## Anatomy\n\n![[skeleton.png]]\n1. ==Femur==\n2. ==Tibia==\n"
    );
    const card = makeCard({
      id: "ccard_occ",
      front: "![[skeleton.png]]",
      back: "1. ==Femur==\n2. ==Tibia==",
      type: "image-occlusion",
      breadcrumb: "Anatomy",
      clozeText: "Femur",
      clozeOrder: 0,
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const tokenId = generateAnchorId("Femur");
    expect(env.currentContent()).toContain(`1. ==Femur== %%dk:o:${tokenId}%%`);
    expect(env.currentContent()).toContain("2. ==Tibia==\n");
    expect(env.db.bindings.get(`o:${tokenId}`)).toBe("ccard_occ");
  });

  it("stamps a whole file in one write via stampFileBatch", async () => {
    const env = mockEnv(
      "## First\n\nBody one.\n\n## Second\n\nBody two.\n"
    );
    let processCalls = 0;
    const originalProcess = env.app.vault.process.bind(env.app.vault);
    env.app.vault.process = async (f, fn) => {
      processCalls++;
      return originalProcess(f, fn);
    };
    const cards = [
      makeCard({ id: "card_a", front: "First", back: "Body one." }),
      makeCard({ id: "card_b", front: "Second", back: "Body two." }),
    ];
    const result = await stamperFor(env).stampFileBatch(
      env.file as unknown as TFile,
      cards
    );

    expect(result).toEqual({ stamped: 2, skipped: 0 });
    expect(processCalls).toBe(1);
    expect(env.currentContent()).toContain(
      `Body one.\n%%dk:h:${generateAnchorId("First")}%%`
    );
    expect(env.currentContent()).toContain(
      `Body two.\n%%dk:h:${generateAnchorId("Second")}%%`
    );
  });
});
