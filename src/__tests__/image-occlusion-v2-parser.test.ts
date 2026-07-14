import { FlashcardParser, isOcclusionV2, parseOcclusionBack } from "@decks/core";

const V2_BLOCK = [
  "## Heart #anatomy",
  "",
  "```decks-occlusion",
  'image: "[[heart.png]]"',
  "masks:",
  "  - id: m1",
  "    x: 10",
  "    y: 20",
  "    w: 15",
  "    h: 8",
  "    answer: |",
  "      Left **ventricle**",
  "  - id: m2",
  "    x: 50",
  "    y: 30",
  "    w: 12",
  "    h: 6",
  "    answer: ''",
  "```",
].join("\n");

describe("FlashcardParser V2 occlusion extraction", () => {
  it("extracts one card per mask from a codeblock when cloze is enabled", () => {
    const cards = FlashcardParser.parseFlashcardsFromContent(V2_BLOCK, 2, undefined, true);
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.type).toBe("image-occlusion-v2");
      expect(c.front).toBe("![[heart.png]]");
      expect(c.breadcrumb).toBe("Heart");
      expect(c.tags).toContain("anatomy");
      expect(c.imagePath).toBe("heart.png");
    }
    expect(cards[0].maskId).toBe("m1");
    expect(cards[0].clozeText).toContain("Left **ventricle**");
    expect(cards[1].maskId).toBe("m2");
    expect(cards[1].clozeText).toBe("");
  });

  it("only parses a block inside a header at the configured level", () => {
    // V2_BLOCK's header is "## Heart" (H2). With headerLevel=3 it must not parse.
    const atH3 = FlashcardParser.parseFlashcardsFromContent(V2_BLOCK, 3, undefined, true);
    expect(atH3.filter((c) => c.type === "image-occlusion-v2")).toHaveLength(0);
    // The block is still stripped — no stray header/table card carries its YAML.
    for (const c of atH3) {
      expect(c.back).not.toContain("decks-occlusion");
      expect(c.back).not.toContain("masks:");
    }
    // At the matching level it parses.
    const atH2 = FlashcardParser.parseFlashcardsFromContent(V2_BLOCK, 2, undefined, true);
    expect(atH2.filter((c) => c.type === "image-occlusion-v2")).toHaveLength(2);
  });

  it("does not parse a block with no enclosing header (non-title mode)", () => {
    const noHeader = [
      "```decks-occlusion",
      'image: "[[h.png]]"',
      "masks:",
      "  - id: m1",
      "    x: 1",
      "    y: 1",
      "    w: 5",
      "    h: 5",
      "```",
    ].join("\n");
    const cards = FlashcardParser.parseFlashcardsFromContent(noHeader, 2, undefined, true);
    expect(cards.filter((c) => c.type === "image-occlusion-v2")).toHaveLength(0);
  });

  it("generates occlusion cards even when cloze is disabled", () => {
    const cards = FlashcardParser.parseFlashcardsFromContent(V2_BLOCK, 2, undefined, false);
    expect(cards.filter((c) => c.type === "image-occlusion-v2")).toHaveLength(2);
  });

  it("strips the codeblock so its YAML is never parsed as a header/table card", () => {
    const cards = FlashcardParser.parseFlashcardsFromContent(V2_BLOCK, 2, undefined, false);
    // With cloze off and no other content, the only header has no body — no
    // stray card should carry the YAML (e.g. the `|` block scalar or `# ...`).
    for (const c of cards) {
      expect(c.back).not.toContain("decks-occlusion");
      expect(c.back).not.toContain("masks:");
    }
  });

  it("does not break legacy numbered-list occlusion in the same file", () => {
    const mixed = [
      V2_BLOCK,
      "",
      "## Skeleton",
      "",
      "![[skeleton.png]]",
      "1. ==Femur==",
      "2. ==Tibia==",
    ].join("\n");
    const cards = FlashcardParser.parseFlashcardsFromContent(mixed, 2, undefined, true);
    const v2 = cards.filter((c) => c.type === "image-occlusion-v2");
    const legacy = cards.filter((c) => c.type === "image-occlusion");
    expect(v2).toHaveLength(2);
    expect(legacy).toHaveLength(2);
    expect(legacy[0].front).toBe("![[skeleton.png]]");
    expect(legacy.map((c) => c.clozeText)).toEqual(["Femur", "Tibia"]);
  });

  it("serializes the full mask set into each card's back", () => {
    const cards = FlashcardParser.parseFlashcardsFromContent(V2_BLOCK, 2, undefined, true);
    const doc = parseOcclusionBack(cards[0].back);
    expect(doc?.masks).toHaveLength(2);
    expect(cards[0].back).toBe(cards[1].back);
  });
});

describe("isOcclusionV2", () => {
  it("discriminates V2 from legacy occlusion", () => {
    expect(isOcclusionV2({ type: "image-occlusion-v2" })).toBe(true);
    expect(isOcclusionV2({ type: "image-occlusion" })).toBe(false);
    expect(isOcclusionV2({ type: "cloze" })).toBe(false);
  });
});
