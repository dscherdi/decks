import { getTestDeckCanvasContent } from "../assets/TestDeckCanvasTemplate";

describe("getTestDeckCanvasContent", () => {
  it("returns valid JSON with the expected canvas shape", () => {
    const raw = getTestDeckCanvasContent("#decks/canvas");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
    expect(parsed.nodes).toHaveLength(4);
  });

  it("uses stable node ids that the synchronizer can rely on", () => {
    const parsed = JSON.parse(getTestDeckCanvasContent("#decks/canvas"));
    const ids = parsed.nodes.map((n: { id: string }) => n.id);
    expect(ids.sort()).toEqual(["cloze", "header-paragraph", "intro", "table"]);
  });

  it("every node is a text node with positional fields", () => {
    const parsed = JSON.parse(getTestDeckCanvasContent("#decks/canvas"));
    for (const node of parsed.nodes) {
      expect(node.type).toBe("text");
      expect(typeof node.text).toBe("string");
      expect(typeof node.x).toBe("number");
      expect(typeof node.y).toBe("number");
      expect(typeof node.width).toBe("number");
      expect(typeof node.height).toBe("number");
    }
  });

  it("includes the deck tag inside the intro node's text", () => {
    const parsed = JSON.parse(getTestDeckCanvasContent("#decks/canvas"));
    const intro = parsed.nodes.find((n: { id: string }) => n.id === "intro");
    expect(intro.text).toContain("#decks/canvas");
  });

  it("intro node uses h1 so it does not parse as a card at default header level 2", () => {
    const parsed = JSON.parse(getTestDeckCanvasContent("#decks/canvas"));
    const intro = parsed.nodes.find((n: { id: string }) => n.id === "intro");
    expect(intro.text).toMatch(/^# /);
    // Defensive: no level-2 heading that could accidentally become a card.
    expect(intro.text).not.toMatch(/^##\s/m);
  });

  it("cloze node contains three highlights and uses level-2 fronts", () => {
    const parsed = JSON.parse(getTestDeckCanvasContent("#decks/canvas"));
    const cloze = parsed.nodes.find((n: { id: string }) => n.id === "cloze");
    expect(cloze.text).toMatch(/^# /);
    expect(cloze.text).toMatch(/^## /m);
    const matches = cloze.text.match(/==((?:(?!==).)+)==/g);
    expect(matches).toHaveLength(3);
  });

  it("header-paragraph node has two cards (two H2 headings)", () => {
    const parsed = JSON.parse(getTestDeckCanvasContent("#decks/canvas"));
    const hp = parsed.nodes.find(
      (n: { id: string }) => n.id === "header-paragraph",
    );
    const h2Lines = hp.text.match(/^##\s.+$/gm) ?? [];
    expect(h2Lines).toHaveLength(2);
  });

  it("table node has a markdown table with a level-2 container header", () => {
    const parsed = JSON.parse(getTestDeckCanvasContent("#decks/canvas"));
    const tbl = parsed.nodes.find((n: { id: string }) => n.id === "table");
    expect(tbl.text).toMatch(/^##\s/m);
    expect(tbl.text).toMatch(/\| --- \| --- \| --- \|/);
  });
});
