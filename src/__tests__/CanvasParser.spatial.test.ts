import { CanvasParser } from "@decks/core";

describe("CanvasParser edge extraction", () => {
  function canvas(nodes: object[], edges: object[] = []): string {
    return JSON.stringify({ nodes, edges });
  }

  it("returns edges between two text nodes", () => {
    const json = canvas(
      [
        { id: "a", type: "text", text: "A" },
        { id: "b", type: "text", text: "B" },
      ],
      [{ id: "e1", fromNode: "a", toNode: "b", label: "knows" }],
    );
    const result = CanvasParser.parseCanvas(json);
    expect(result.edges).toEqual([
      { id: "e1", fromNode: "a", toNode: "b", label: "knows" },
    ]);
  });

  it("drops edges that touch a file/link/group node (non-text endpoints)", () => {
    const json = canvas(
      [
        { id: "txt", type: "text", text: "T" },
        { id: "file", type: "file", file: "X.md" },
        { id: "grp", type: "group", label: "Section" },
        { id: "ln", type: "link", url: "https://x" },
      ],
      [
        { id: "e-to-file", fromNode: "txt", toNode: "file" },
        { id: "e-from-file", fromNode: "file", toNode: "txt" },
        { id: "e-to-grp", fromNode: "txt", toNode: "grp" },
        { id: "e-from-link", fromNode: "ln", toNode: "txt" },
      ],
    );
    const result = CanvasParser.parseCanvas(json);
    expect(result.edges).toEqual([]);
  });

  it("drops edges that reference a missing node id", () => {
    const json = canvas(
      [{ id: "a", type: "text", text: "A" }],
      [{ id: "e-orphan", fromNode: "a", toNode: "nope", label: "x" }],
    );
    const result = CanvasParser.parseCanvas(json);
    expect(result.edges).toEqual([]);
  });

  it("treats a missing label as empty string", () => {
    const json = canvas(
      [
        { id: "a", type: "text", text: "A" },
        { id: "b", type: "text", text: "B" },
      ],
      [{ id: "e1", fromNode: "a", toNode: "b" }],
    );
    const result = CanvasParser.parseCanvas(json);
    expect(result.edges[0].label).toBe("");
  });

  it("returns empty edges array when the edges key is missing", () => {
    const json = JSON.stringify({
      nodes: [{ id: "a", type: "text", text: "A" }],
    });
    const result = CanvasParser.parseCanvas(json);
    expect(result.edges).toEqual([]);
  });

  it("drops malformed edges (missing id/fromNode/toNode)", () => {
    const json = canvas(
      [
        { id: "a", type: "text", text: "A" },
        { id: "b", type: "text", text: "B" },
      ],
      [
        { fromNode: "a", toNode: "b" }, // no id
        { id: "e2", toNode: "b" }, // no fromNode
        { id: "e3", fromNode: "a" }, // no toNode
        { id: "ok", fromNode: "a", toNode: "b" },
      ],
    );
    const result = CanvasParser.parseCanvas(json);
    expect(result.edges.map((e) => e.id)).toEqual(["ok"]);
  });

  it("returns empty array when edges is malformed (not an array)", () => {
    const json = JSON.stringify({
      nodes: [{ id: "a", type: "text", text: "A" }],
      edges: { not: "array" },
    });
    // Edges parsing is lenient: malformed -> empty, but nodes still come back.
    const result = CanvasParser.parseCanvas(json);
    expect(result.edges).toEqual([]);
    expect(result.nodes).toHaveLength(1);
  });
});
