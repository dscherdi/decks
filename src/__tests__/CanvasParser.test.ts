import { CanvasParser, CanvasParseError } from "@decks/core";

describe("CanvasParser", () => {
  describe("parseCanvas", () => {
    it("parses a canvas with one text node", () => {
      const json = JSON.stringify({
        nodes: [
          { id: "n1", type: "text", text: "## Q\nA", x: 0, y: 0, width: 200, height: 100 },
        ],
        edges: [],
      });
      const result = CanvasParser.parseCanvas(json);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({ id: "n1", text: "## Q\nA" });
    });

    it("returns empty nodes for an empty canvas", () => {
      const json = JSON.stringify({ nodes: [], edges: [] });
      const result = CanvasParser.parseCanvas(json);
      expect(result.nodes).toEqual([]);
    });

    it("returns empty nodes when nodes key is missing", () => {
      const json = JSON.stringify({});
      const result = CanvasParser.parseCanvas(json);
      expect(result.nodes).toEqual([]);
    });

    it("filters out non-text nodes", () => {
      const json = JSON.stringify({
        nodes: [
          { id: "t1", type: "text", text: "hello" },
          { id: "f1", type: "file", file: "Other.md" },
          { id: "l1", type: "link", url: "https://example.com" },
          { id: "g1", type: "group", label: "Section" },
          { id: "t2", type: "text", text: "world" },
        ],
      });
      const result = CanvasParser.parseCanvas(json);
      expect(result.nodes.map((n) => n.id)).toEqual(["t1", "t2"]);
    });

    it("skips text nodes missing id or text fields", () => {
      const json = JSON.stringify({
        nodes: [
          { type: "text", text: "no id" },
          { id: 42, type: "text", text: "non-string id" },
          { id: "t1", type: "text" }, // no text
          { id: "t2", type: "text", text: 123 }, // non-string text
          { id: "t3", type: "text", text: "valid" },
        ],
      });
      const result = CanvasParser.parseCanvas(json);
      expect(result.nodes).toEqual([{ id: "t3", text: "valid" }]);
    });

    it("throws CanvasParseError on malformed JSON", () => {
      expect(() => CanvasParser.parseCanvas("{ not json")).toThrow(
        CanvasParseError,
      );
    });

    it("throws CanvasParseError when root is not an object", () => {
      expect(() => CanvasParser.parseCanvas(JSON.stringify(["nope"]))).toThrow(
        CanvasParseError,
      );
    });

    it("throws CanvasParseError when nodes is not an array", () => {
      const json = JSON.stringify({ nodes: { not: "array" } });
      expect(() => CanvasParser.parseCanvas(json)).toThrow(CanvasParseError);
    });
  });
});
