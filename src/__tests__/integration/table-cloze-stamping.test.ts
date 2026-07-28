jest.unmock("sql.js");

import type { App, TFile } from "obsidian";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { DatabaseTestUtils } from "./database-test-utils";
import { createTestDatabase, cleanupTestDatabase } from "../test-db-utils";
import { AnchorStamper } from "../../services/AnchorStamper";
import {
  generateAnchorId,
  generateClozeFlashcardId,
  generateFlashcardId,
} from "@decks/core";
import type { DeckProfile } from "@decks/core";

class TFileLike {
  public stat = { mtime: 100 };
  constructor(public path: string) {}
}

function mockVault(content: string): {
  app: App;
  currentContent: () => string;
} {
  let stored = content;
  const file = new TFileLike("/test/anchors.md");
  const { TFile: MockTFile } = jest.requireActual("../../__mocks__/obsidian");
  Object.setPrototypeOf(file, MockTFile.prototype);
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) =>
        p === "/test/anchors.md" ? file : null,
      cachedRead: async () => stored,
      process: async (_f: TFile, fn: (c: string) => string) => {
        stored = fn(stored);
        file.stat.mtime += 1;
        return stored;
      },
    },
  } as unknown as App;
  return { app, currentContent: () => stored };
}

describe("table cloze stamping through the real pipeline", () => {
  let db: MainDatabaseService;
  let profile: DeckProfile;
  let deckId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    profile = await db.getDefaultProfile();
    const deck = DatabaseTestUtils.createTestDeck({
      filepath: "/test/anchors.md",
    });
    await db.createDeck(deck);
    deckId = deck.id;
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  async function sync(fileContent: string): Promise<void> {
    await db.syncFlashcardsForDeck({
      deckId,
      deckName: "Anchors",
      deckFilepath: "/test/anchors.md",
      deckConfig: profile,
      fileContent,
      clozeEnabled: true,
    });
  }

  it("stamps a 2-col back-cell cloze row and re-anchors on resync", async () => {
    const content = `---\ntags:\n  - test\n---\n\n## Organs\n\n| Front | Back |\n|---|---|\n| word | The ==heart== and ==lungs== |\n`;
    await sync(content);

    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(2);
    // The key probe: real rows must carry templateRow through the pipeline.
    expect(cards.every((c) => c.templateRow != null)).toBe(true);

    const card = cards.find((c) => c.clozeText === "lungs");
    expect(card).toBeDefined();
    const env = mockVault(content);
    const stamper = new AnchorStamper(env.app, db);
    const outcome = await stamper.ensureAnchored(card!);

    expect(outcome).toEqual(
      expect.objectContaining({ ok: true })
    );
    const tokenId = generateAnchorId("word");
    expect(env.currentContent()).toContain(
      `| word %%dk:t:${tokenId}%% | The ==heart== and ==lungs== |`
    );
    expect(await db.getAnchorBinding(`t:${tokenId}#0`)).toBe(
      generateClozeFlashcardId("word", "heart", 0)
    );
    expect(await db.getAnchorBinding(`t:${tokenId}#1`)).toBe(
      generateClozeFlashcardId("word", "lungs", 1)
    );

    await sync(env.currentContent());
    const after = await db.getFlashcardsByDeck(deckId);
    expect(after).toHaveLength(2);
    expect(after.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
    expect(after.every((c) => c.anchor?.startsWith(`t:${tokenId}#`))).toBe(true);
  });

  it("stamps a 1-col front-cell cloze row", async () => {
    const sentence = "Water is ==H2O== of course";
    const content = `---\ntags:\n  - test\n---\n\n## Facts\n\n| Front |\n|---|\n| ${sentence} |\n`;
    await sync(content);

    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(1);
    expect(cards[0].templateRow).not.toBeNull();

    const env = mockVault(content);
    const outcome = await new AnchorStamper(env.app, db).ensureAnchored(cards[0]);

    expect(outcome).toEqual(expect.objectContaining({ ok: true }));
    const tokenId = generateAnchorId(sentence);
    expect(env.currentContent()).toContain(
      `| ${sentence} %%dk:t:${tokenId}%% |`
    );
    expect(await db.getAnchorBinding(`t:${tokenId}#0`)).toBe(
      generateClozeFlashcardId(sentence, "H2O", 0)
    );
  });

  it("stamps a 3-col back-cell cloze row with notes", async () => {
    const content = `---\ntags:\n  - test\n---\n\n## Organs\n\n| Front | Back | Notes |\n|---|---|---|\n| pump | The ==heart== pumps | anatomy |\n`;
    await sync(content);

    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(1);

    const env = mockVault(content);
    const outcome = await new AnchorStamper(env.app, db).ensureAnchored(cards[0]);

    expect(outcome).toEqual(expect.objectContaining({ ok: true }));
    const tokenId = generateAnchorId("pump");
    expect(env.currentContent()).toContain(
      `| pump %%dk:t:${tokenId}%% | The ==heart== pumps | anatomy |`
    );
  });

  it("shares one row token across all clozes of a <br>-bearing cell (user-reported shape)", async () => {
    const front =
      "Was ist der Unterschied zwischen einer Grundgesamtheit und einer Stichprobe?";
    const backCell =
      "Die ==Grundgesamtheit== ist die Gesamtmenge aller relevanten Einheiten. Die Stichprobe ist die untersuchte ==Teilmenge==.<br>Kot some info ==cloze==";
    const content = `---\ntags:\n  - test\n---\n\n## Statistik\n\n| Front | Back | Notes |\n|---|---|---|\n| ${front} | ${backCell} |  |\n`;
    await sync(content);

    const cards = await db.getFlashcardsByDeck(deckId);
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.type === "cloze")).toBe(true);

    // Review the FIRST cloze: stamps the row once and binds all three ords.
    const first = cards.find((c) => c.clozeOrder === 0);
    const env = mockVault(content);
    const stamper = new AnchorStamper(env.app, db);
    const outcome = await stamper.ensureAnchored(first!);
    expect(outcome).toEqual(expect.objectContaining({ ok: true }));

    const tokenId = generateAnchorId(front);
    expect(env.currentContent()).toContain(`${front} %%dk:t:${tokenId}%% |`);
    for (let k = 0; k < 3; k++) {
      expect(await db.getAnchorBinding(`t:${tokenId}#${k}`)).toBe(
        cards.find((c) => c.clozeOrder === k)!.id
      );
    }

    // Resync: every cloze card anchors to the shared token; ids unchanged.
    await sync(env.currentContent());
    const after = await db.getFlashcardsByDeck(deckId);
    expect(after.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
    expect(
      after.every((c) => c.anchor === `t:${tokenId}#${c.clozeOrder}`)
    ).toBe(true);

    // Reviewing another cloze adopts silently — no second token, no file change.
    const before = env.currentContent();
    const second = after.find((c) => c.clozeOrder === 1);
    const outcome2 = await stamper.ensureAnchored(second!);
    expect(outcome2).toEqual({ ok: false, reason: "already_anchored" });
    expect(env.currentContent()).toBe(before);
    expect((env.currentContent().match(/%%dk:t:/g) ?? []).length).toBe(1);
  });

  it("stamps a plain table row loaded from the real database", async () => {
    const content = `---\ntags:\n  - test\n---\n\n## Vocab\n\n| Front | Back |\n|---|---|\n| chat | cat |\n`;
    await sync(content);

    const cards = await db.getFlashcardsByDeck(deckId);
    const env = mockVault(content);
    const outcome = await new AnchorStamper(env.app, db).ensureAnchored(cards[0]);

    expect(outcome).toEqual(expect.objectContaining({ ok: true }));
    expect(await db.getAnchorBinding(`t:${generateAnchorId("chat")}`)).toBe(
      generateFlashcardId("chat")
    );
  });
});
