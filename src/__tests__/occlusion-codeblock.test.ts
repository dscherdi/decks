import {
  locateOcclusionBlock,
  replaceOcclusionBlock,
} from "../utils/occlusion-codeblock";

const NOTE = [
  "# Title",
  "",
  "```decks-occlusion",
  'image: "[[a.png]]"',
  "masks:",
  "  - id: m1",
  "    x: 1",
  "    y: 1",
  "    w: 5",
  "    h: 5",
  "```",
  "",
  "Some text.",
].join("\n");

describe("locateOcclusionBlock", () => {
  it("finds the single block by scanning", () => {
    const range = locateOcclusionBlock(NOTE);
    expect(range).toEqual({ start: 2, end: 10 });
  });

  it("honors a valid line hint", () => {
    const range = locateOcclusionBlock(NOTE, { hintStart: 2, hintEnd: 10 });
    expect(range).toEqual({ start: 2, end: 10 });
  });

  it("falls back to scanning when the hint is stale", () => {
    const range = locateOcclusionBlock(NOTE, { hintStart: 99, hintEnd: 120 });
    expect(range).toEqual({ start: 2, end: 10 });
  });

  it("disambiguates multiple blocks by image", () => {
    const two = [
      "```decks-occlusion",
      'image: "[[a.png]]"',
      "masks: []",
      "```",
      "",
      "```decks-occlusion",
      'image: "[[b.png]]"',
      "masks: []",
      "```",
    ].join("\n");
    const range = locateOcclusionBlock(two, { matchImage: "[[b.png]]" });
    expect(range).toEqual({ start: 5, end: 8 });
  });

  it("returns null for ambiguous multiple blocks without a matcher", () => {
    const two = [
      "```decks-occlusion",
      "masks: []",
      "```",
      "```decks-occlusion",
      "masks: []",
      "```",
    ].join("\n");
    expect(locateOcclusionBlock(two)).toBeNull();
  });
});

describe("replaceOcclusionBlock", () => {
  it("replaces the located block, preserving surrounding content", () => {
    const replacement = "```decks-occlusion\nimage: \"[[a.png]]\"\nmasks: []\n```";
    const out = replaceOcclusionBlock(NOTE, replacement);
    expect(out).not.toBeNull();
    expect(out).toContain("# Title");
    expect(out).toContain("Some text.");
    expect(out).toContain("masks: []");
    expect(out).not.toContain("id: m1");
  });

  it("returns null when no block can be located", () => {
    expect(replaceOcclusionBlock("# Just a note", "x")).toBeNull();
  });
});
