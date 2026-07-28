jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import { generateDeckId, parseOcclusionBack } from "@decks/core";
import type { Deck, DeckProfile } from "../../database/types";

function v2Block(image: string, masks: Array<{ id: string; answer?: string }>): string {
  const lines = ["```decks-occlusion", `image: "${image}"`, "masks:"];
  let x = 5;
  for (const m of masks) {
    lines.push(`  - id: ${m.id}`);
    lines.push(`    x: ${x}`);
    lines.push("    y: 10");
    lines.push("    w: 8");
    lines.push("    h: 6");
    lines.push(`    answer: "${m.answer ?? ""}"`);
    x += 10;
  }
  lines.push("```");
  return lines.join("\n");
}

describe("Image Occlusion V2 Integration", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createDeck(name: string): Promise<{ deck: Deck; profile: DeckProfile }> {
    const defaultProfile = await db.getDefaultProfile();
    await db.updateProfile(defaultProfile.id, { clozeEnabled: true, clozeShowContext: "hidden" });
    await db.save();
    const profile = await db.getProfileById(defaultProfile.id);
    const filepath = `/test/${name}.md`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name,
      filepath,
      tag: "decks/test",
      lastReviewed: null,
      profileId: profile!.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    return { deck, profile: profile! };
  }

  function sync(deck: Deck, profile: DeckProfile, content: string) {
    return db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
      clozeEnabled: true,
    });
  }

  it("creates one card per mask, grouped by image front", async () => {
    const { deck, profile } = await createDeck("v2-basic");
    const content = `## Heart\n\n${v2Block("[[heart.png]]", [
      { id: "m1", answer: "Aorta" },
      { id: "m2", answer: "" },
    ])}`;

    const result = await sync(deck, profile, content);
    expect(result.success).toBe(true);

    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.type).toBe("image-occlusion-v2");
      expect(c.front).toBe("![[heart.png]]");
      expect(parseOcclusionBack(c.back)?.masks).toHaveLength(2);
    }
  });

  it("editing one answer updates only that card; siblings keep their hash", async () => {
    const { deck, profile } = await createDeck("v2-edit");
    const before = `## H\n\n${v2Block("[[h.png]]", [
      { id: "m1", answer: "A" },
      { id: "m2", answer: "B" },
    ])}`;
    await sync(deck, profile, before);

    const initial = await db.getFlashcardsByDeck(deck.id);
    const m1 = initial.find((c) => parseOcclusionBack(c.back)?.masks[c.clozeOrder ?? 0].id === "m1")!;
    const m2 = initial.find((c) => parseOcclusionBack(c.back)?.masks[c.clozeOrder ?? 0].id === "m2")!;

    const after = `## H\n\n${v2Block("[[h.png]]", [
      { id: "m1", answer: "A changed" },
      { id: "m2", answer: "B" },
    ])}`;
    await sync(deck, profile, after);

    const updated = await db.getFlashcardsByDeck(deck.id);
    expect(updated).toHaveLength(2);
    const m1b = updated.find((c) => c.id === m1.id)!;
    const m2b = updated.find((c) => c.id === m2.id)!;
    // Same card ids (identity preserved by mask id).
    expect(m1b).toBeDefined();
    expect(m2b).toBeDefined();
    // m1's content hash changes, m2's does not.
    expect(m1b.contentHash).not.toBe(m1.contentHash);
    expect(m2b.contentHash).toBe(m2.contentHash);
  });

  it("moving a box does not change the card id (history preserved)", async () => {
    const { deck, profile } = await createDeck("v2-move");
    await sync(deck, profile, `## H\n\n${v2Block("[[h.png]]", [{ id: "m1", answer: "A" }])}`);
    const first = (await db.getFlashcardsByDeck(deck.id))[0];

    const moved = [
      "## H",
      "",
      "```decks-occlusion",
      'image: "[[h.png]]"',
      "masks:",
      "  - id: m1",
      "    x: 80",
      "    y: 80",
      "    w: 8",
      "    h: 6",
      '    answer: "A"',
      "```",
    ].join("\n");
    await sync(deck, profile, moved);

    const after = await db.getFlashcardsByDeck(deck.id);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first.id);
  });

  it("deleting a mask removes only that card", async () => {
    const { deck, profile } = await createDeck("v2-delete");
    await sync(deck, profile, `## H\n\n${v2Block("[[h.png]]", [
      { id: "m1", answer: "A" },
      { id: "m2", answer: "B" },
    ])}`);
    expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(2);

    await sync(deck, profile, `## H\n\n${v2Block("[[h.png]]", [{ id: "m1", answer: "A" }])}`);
    const after = await db.getFlashcardsByDeck(deck.id);
    expect(after).toHaveLength(1);
    expect(parseOcclusionBack(after[0].back)?.masks[after[0].clozeOrder ?? 0].id).toBe("m1");
  });

  it("legacy and V2 occlusion coexist in one file", async () => {
    const { deck, profile } = await createDeck("v2-coexist");
    const content = [
      "## Heart",
      "",
      v2Block("[[heart.png]]", [{ id: "m1", answer: "Aorta" }]),
      "",
      "## Skeleton",
      "",
      "![[skeleton.png]]",
      "1. ==Femur==",
      "2. ==Tibia==",
    ].join("\n");

    await sync(deck, profile, content);
    const cards = await db.getFlashcardsByDeck(deck.id);
    expect(cards.filter((c) => c.type === "image-occlusion-v2")).toHaveLength(1);
    expect(cards.filter((c) => c.type === "image-occlusion")).toHaveLength(2);
  });
});
