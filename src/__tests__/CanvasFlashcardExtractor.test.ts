import { CanvasFlashcardExtractor } from "@decks/core";

describe("CanvasFlashcardExtractor", () => {
  it("extracts header-paragraph cards from a single text node", () => {
    const canvas = JSON.stringify({
      nodes: [
        {
          id: "node-a",
          type: "text",
          text: "## Capital of France?\nParis is the capital of France.",
        },
      ],
    });
    const result = CanvasFlashcardExtractor.extract(canvas);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("header-paragraph");
    expect(result[0].front).toBe("Capital of France?");
    expect(result[0].sourceNodeId).toBe("node-a");
  });

  it("extracts table cards from a text node", () => {
    const canvas = JSON.stringify({
      nodes: [
        {
          id: "node-tbl",
          type: "text",
          text:
            "## Capitals\n\n| Country | Capital |\n| --- | --- |\n| France | Paris |\n| Spain | Madrid |\n",
        },
      ],
    });
    const result = CanvasFlashcardExtractor.extract(canvas);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.type === "table")).toBe(true);
    expect(result.every((c) => c.sourceNodeId === "node-tbl")).toBe(true);
    expect(result.map((c) => c.front).sort()).toEqual(["France", "Spain"]);
  });

  it("extracts cloze cards from a text node when cloze is enabled", () => {
    const canvas = JSON.stringify({
      nodes: [
        {
          id: "node-cz",
          type: "text",
          text:
            "## Solar System\nThe ==Sun== is at the center; the largest planet is ==Jupiter==.",
        },
      ],
    });
    const result = CanvasFlashcardExtractor.extract(canvas, 2, undefined, true);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.type === "cloze")).toBe(true);
    expect(result.every((c) => c.sourceNodeId === "node-cz")).toBe(true);
    expect(result.map((c) => c.clozeText)).toEqual(["Sun", "Jupiter"]);
  });

  it("aggregates cards across multiple text nodes", () => {
    const canvas = JSON.stringify({
      nodes: [
        { id: "a", type: "text", text: "## Q1\nA1" },
        { id: "b", type: "text", text: "## Q2\nA2" },
        { id: "c", type: "text", text: "## Q3\nA3" },
      ],
    });
    const result = CanvasFlashcardExtractor.extract(canvas);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.sourceNodeId)).toEqual(["a", "b", "c"]);
    expect(result.map((c) => c.front)).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("stamps every card with the correct sourceNodeId across mixed formats", () => {
    const canvas = JSON.stringify({
      nodes: [
        {
          id: "header-node",
          type: "text",
          text: "## Header Q\nHeader A",
        },
        {
          id: "table-node",
          type: "text",
          text:
            "## Table\n\n| Front | Back |\n| --- | --- |\n| Apple | Fruit |\n",
        },
      ],
    });
    const result = CanvasFlashcardExtractor.extract(canvas);
    const byNode = new Map<string, typeof result>();
    for (const card of result) {
      const k = card.sourceNodeId!;
      if (!byNode.has(k)) byNode.set(k, []);
      byNode.get(k)!.push(card);
    }
    expect(byNode.get("header-node")?.map((c) => c.type)).toEqual([
      "header-paragraph",
    ]);
    expect(byNode.get("table-node")?.map((c) => c.type)).toEqual(["table"]);
  });

  it("returns empty when canvas has no text nodes", () => {
    const canvas = JSON.stringify({
      nodes: [{ id: "f1", type: "file", file: "X.md" }],
    });
    expect(CanvasFlashcardExtractor.extract(canvas)).toEqual([]);
  });
});
