import { AnchorStamper } from "../services/AnchorStamper";
import { ObsidianNoteAccess } from "../services/ObsidianNoteAccess";
import type { Flashcard } from "../database/types";
import type { App, TFile } from "obsidian";
import type { IDatabaseService } from "@decks/core";
import {
  encodeAnchorValue,
  generateClozeFlashcardId,
  generateFlashcardId,
  generateReverseFlashcardId,
} from "@decks/core";

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
    id: "card_q1",
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
  return new AnchorStamper(new ObsidianNoteAccess(env.app), env.db as unknown as IDatabaseService);
}

/** The value a host carrying these ids gets. */
function value(kind: "a" | "b" | "c" | "p", ids: (string | null)[]): string {
  const encoded = encodeAnchorValue(kind, ids);
  if (encoded === null) throw new Error(`cannot encode ${ids.join(",")}`);
  return encoded;
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
    const v = value("a", ["card_q1"]);
    // Blank line between the last option and the token: a directly-following
    // line would lazily continue the last list item.
    expect(env.currentContent()).toContain(`- [ ] Nitrogen\n\n%%dk:q:${v}%%`);
    expect(env.db.bindings.get(`q:${v}`)).toBe("card_q1");
    expect(card.anchor).toBe(`q:${v}`);
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
    expect(env.currentContent()).toContain(
      `Group 18 explanation.\n\n%%dk:q:${value("a", ["card_q1"])}%%`
    );
  });

  it("rewrites a minted q token in place and leaves a dormant h token alone", async () => {
    const env = mockEnv(
      `## Noble gas?\n\n${OPTIONS}\n%%dk:h:old1%%\n\n%%dk:q:mine2%%\n`
    );
    const card = makeCard({
      front: "Noble gas?",
      back: OPTIONS,
      type: "multiple-choice",
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const v = value("a", ["card_q1"]);
    expect(env.currentContent()).toContain(`%%dk:h:old1%%\n\n%%dk:q:${v}%%`);
    expect(env.currentContent().match(/%%dk:q:/g)).toHaveLength(1);
    expect(env.db.bindings.has("h:old1")).toBe(false);
  });
});

describe("AnchorStamper", () => {
  it("writes the card's id on its own line after the body", async () => {
    const env = mockEnv("## Question\n\nFirst line.\nLast line.\n");
    const card = makeCard({ front: "Question", back: "First line.\nLast line." });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const v = value("a", ["card_q1"]);
    expect(env.currentContent()).toContain(`Last line.\n%%dk:h:${v}%%`);
    // Compatibility row for versions that still resolve through bindings.
    expect(env.db.bindings.get(`h:${v}`)).toBe("card_q1");
    expect(card.anchor).toBe(`h:${v}`);
  });

  it("does nothing for a card whose token already carries its id", async () => {
    const v = value("a", ["card_q1"]);
    const env = mockEnv(`## Question\n\nBody text.\n%%dk:h:${v}%%\n`);
    const card = makeCard({ front: "Question", back: "Body text.", anchor: `h:${v}` });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome).toEqual({ ok: false, reason: "already_anchored" });
    expect(env.db.mtimeStamps).toEqual([]);
  });

  it("upgrades a minted token in place to the id its binding names", async () => {
    const env = mockEnv(
      "## Question\n\nBody text.\n%%dk:h:zzz%%\nAdded afterwards.\n"
    );
    // Bound before the front was edited, so the bound id is not the content id.
    env.db.bindings.set("h:zzz", "card_old7");
    const card = makeCard({
      id: "card_old7",
      front: "Question",
      back: "Body text.\n\nAdded afterwards.",
      anchor: "h:zzz",
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const v = value("a", ["card_old7"]);
    expect(env.currentContent()).toBe(
      `## Question\n\nBody text.\n%%dk:h:${v}%%\nAdded afterwards.\n`
    );
    expect(card.anchor).toBe(`h:${v}`);
  });

  it("gives a copied token's card its own id", async () => {
    const original = value("a", ["card_q1"]);
    const env = mockEnv(
      `## First\n\nBody one.\n%%dk:h:${original}%%\n\n## Second\n\nBody two.\n%%dk:h:${original}%%\n`
    );
    const copyId = generateFlashcardId("Second");
    const card = makeCard({ id: copyId, front: "Second", back: "Body two." });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    expect(env.currentContent()).toContain(
      `Body one.\n%%dk:h:${original}%%`
    );
    expect(env.currentContent()).toContain(
      `Body two.\n%%dk:h:${value("a", [copyId])}%%`
    );
  });

  it("leaves a token naming another id alone until this device has synced it", async () => {
    const other = value("a", ["card_zz9"]);
    const content = `## Question\n\nBody text.\n%%dk:h:${other}%%\n`;
    const env = mockEnv(content);
    const card = makeCard({ front: "Question", back: "Body text." });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome).toEqual({ ok: false, reason: "stale" });
    expect(env.currentContent()).toBe(content);
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

  it("packs every deletion on the line into one token", async () => {
    const body = "The ==heart== pumps ==blood== around.";
    const env = mockEnv(`## Anatomy\n\n${body}\n`);
    const blood = generateClozeFlashcardId("Anatomy", "blood", 1);
    const heart = generateClozeFlashcardId("Anatomy", "heart", 0);
    const card = makeCard({
      id: blood,
      front: "Anatomy",
      back: body,
      type: "cloze",
      clozeText: "blood",
      clozeOrder: 1,
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const v = value("p", [heart, blood]);
    expect(env.currentContent()).toContain(`around. %%dk:c:${v}%%`);
    expect(env.db.bindings.get(`c:${v}#0`)).toBe(heart);
    expect(env.db.bindings.get(`c:${v}#1`)).toBe(blood);
    if (outcome.ok) expect(outcome.anchorKey).toBe(`c:${v}#1`);
  });

  it("counts deletions as the parser does, skipping code spans", async () => {
    const body = "Use `==x==` then ==real== here.";
    const env = mockEnv(`## Syntax\n\n${body}\n`);
    const real = generateClozeFlashcardId("Syntax", "real", 0);
    const card = makeCard({
      id: real,
      front: "Syntax",
      back: body,
      type: "cloze",
      clozeText: "real",
      clozeOrder: 0,
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    expect(env.currentContent()).toContain(`here. %%dk:c:${value("p", [real])}%%`);
  });

  it("stamps each cloze line of a group against the evolving file", async () => {
    const body = [
      "- it is to ==create== life",
      "- it is to ==help== others",
      "- it is to ==participate== in creation of god",
    ].join("\n");
    const env = mockEnv(`###### What is the meaning of life\n\n${body}\n`);
    const stamper = stamperFor(env);
    const front = "What is the meaning of life";
    const texts = ["create", "help", "participate"];

    for (let order = 0; order < 3; order++) {
      const card = makeCard({
        id: generateClozeFlashcardId(front, texts[order], order),
        front,
        back: body,
        type: "cloze",
        clozeText: texts[order],
        clozeOrder: order,
      });
      const outcome = await stamper.ensureAnchored(card);
      expect(outcome.ok).toBe(true);
    }

    const tokenCount = (env.currentContent().match(/%%dk:c:/g) ?? []).length;
    expect(tokenCount).toBe(3);
    const last = generateClozeFlashcardId(front, "participate", 2);
    expect(env.currentContent()).toContain(
      `creation of god %%dk:c:${value("p", [last])}%%`
    );
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

  it("writes both ids when the note makes reverse cards", async () => {
    const env = mockEnv("---\nreverse: true\n---\n## Base front\n\nBase back.\n");
    const baseId = generateFlashcardId("Base front");
    const reverseId = generateReverseFlashcardId("Base front");
    const reverse = makeCard({
      id: reverseId,
      front: "Base back.",
      back: "Base front",
    });
    const outcome = await stamperFor(env).ensureAnchored(reverse);

    expect(outcome.ok).toBe(true);
    const v = value("b", [baseId, reverseId]);
    expect(env.currentContent()).toContain(`Base back.\n%%dk:h:${v}%%`);
    expect(env.db.bindings.get(`h:${v}`)).toBe(baseId);
    expect(env.db.bindings.get(`h:${v}:rev`)).toBe(reverseId);
    expect(reverse.anchor).toBe(`h:${v}:rev`);
  });

  it("reads the reverse flag as a YAML boolean, as Obsidian does", async () => {
    const env = mockEnv("---\r\nreverse: True # both ways\r\n---\r\n## Base front\n\nBase back.\n");
    const baseId = generateFlashcardId("Base front");
    const outcome = await stamperFor(env).ensureAnchored(
      makeCard({ id: baseId, front: "Base front", back: "Base back." })
    );

    expect(outcome.ok).toBe(true);
    const v = value("b", [baseId, generateReverseFlashcardId("Base front")]);
    expect(env.currentContent()).toContain(`Base back.\n%%dk:h:${v}%%`);
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
    const v = value("a", ["card_q1"]);
    expect(env.currentContent()).toContain(`| chat %%dk:t:${v}%% |  cat  |`);
    expect(card.anchor).toBe(`t:${v}`);
  });

  it("packs every cloze in a table row's cloze cell", async () => {
    const back = "The ==heart== and ==lungs==";
    const env = mockEnv(
      `## Organs\n\n| Front | Back |\n|---|---|\n| word | ${back} |\n`
    );
    const heart = generateClozeFlashcardId("word", "heart", 0);
    const lungs = generateClozeFlashcardId("word", "lungs", 1);
    const card = makeCard({
      id: lungs,
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
    const v = value("p", [heart, lungs]);
    expect(env.currentContent()).toContain(`| word %%dk:t:${v}%% |`);
    expect(env.db.bindings.get(`t:${v}#0`)).toBe(heart);
    if (outcome.ok) expect(outcome.anchorKey).toBe(`t:${v}#1`);
  });

  it("stamps a table-hosted cloze even when templateRow is missing", async () => {
    const back = "The ==heart== and ==lungs==";
    const env = mockEnv(
      `## Organs\n\n| Front | Back |\n|---|---|\n| word | ${back} |\n`
    );
    const heart = generateClozeFlashcardId("word", "heart", 0);
    const card = makeCard({
      id: heart,
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
    const v = value("p", [heart, generateClozeFlashcardId("word", "lungs", 1)]);
    expect(env.currentContent()).toContain(`| word %%dk:t:${v}%% |`);
    if (outcome.ok) expect(outcome.anchorKey).toBe(`t:${v}#0`);
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

  it("rewrites an existing t token wherever it sits in the row", async () => {
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

    expect(outcome.ok).toBe(true);
    expect(env.currentContent()).toContain(
      `| chat | cat %%dk:t:${value("a", ["card_q1"])}%% |`
    );
    expect((env.currentContent().match(/%%dk:t:/g) ?? []).length).toBe(1);
  });

  it("stamps an occlusion item line", async () => {
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
    const v = value("c", ["ccard_occ"]);
    expect(env.currentContent()).toContain(`1. ==Femur== %%dk:o:${v}%%`);
    expect(env.currentContent()).toContain("2. ==Tibia==\n");
    expect(env.db.bindings.get(`o:${v}`)).toBe("ccard_occ");
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
    const result = await stamperFor(env).stampFileBatch("test.md", cards);

    expect(result.stamped).toBe(2);
    expect(result.skipped).toBe(0);
    expect(processCalls).toBe(1);
    expect(env.currentContent()).toContain(
      `Body one.\n%%dk:h:${value("a", ["card_a"])}%%`
    );
    expect(env.currentContent()).toContain(
      `Body two.\n%%dk:h:${value("a", ["card_b"])}%%`
    );
  });
});

describe("AnchorStamper title mode", () => {
  function titleEnv(content: string): ReturnType<typeof mockEnv> {
    const env = mockEnv(content);
    env.db.getDeckWithProfile = async (deckId: string) => ({
      id: deckId,
      profile: { headerLevel: 0, clozeEnabled: true },
    });
    return env;
  }

  it("writes the note's token into its body, leaving decks-id alone", async () => {
    const env = titleEnv("---\ndecks-id: abc\n---\nThe body.\n");
    env.db.bindings.set("p:abc", "card_t1");
    const card = makeCard({ id: "card_t1", front: "Note", back: "The body.", anchor: "p:abc" });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    const v = value("a", ["card_t1"]);
    expect(env.currentContent()).toBe(`---\ndecks-id: abc\n---\nThe body.\n%%dk:h:${v}%%\n`);
    expect(card.anchor).toBe(`h:${v}`);
  });

  it("packs a title note's cloze line", async () => {
    const env = titleEnv("Water is ==wet== and ==clear==.\n");
    const wet = generateClozeFlashcardId("Note", "wet", 0);
    const clear = generateClozeFlashcardId("Note", "clear", 1);
    const card = makeCard({
      id: clear,
      front: "Note",
      back: "Water is ==wet== and ==clear==.",
      type: "cloze",
      clozeText: "clear",
      clozeOrder: 1,
    });
    const outcome = await stamperFor(env).ensureAnchored(card);

    expect(outcome.ok).toBe(true);
    expect(env.currentContent()).toBe(
      `Water is ==wet== and ==clear==. %%dk:c:${value("p", [wet, clear])}%%\n`
    );
  });
});
