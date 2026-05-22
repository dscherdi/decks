/**
 * CanvasParser - Parse Obsidian Canvas (.canvas) JSON into text-node entries.
 *
 * An Obsidian canvas is a JSON document conforming to the JSON Canvas spec.
 * Top-level shape: { nodes: Node[], edges: Edge[] }. We only care about
 * text-type nodes (type === "text"), which carry markdown content in their
 * `text` field. Other node types (file, link, group) are ignored.
 */

export interface CanvasTextNode {
  id: string;
  text: string;
}

export interface CanvasContent {
  nodes: CanvasTextNode[];
}

export class CanvasParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasParseError";
  }
}

interface RawCanvasNode {
  id?: unknown;
  type?: unknown;
  text?: unknown;
}

interface RawCanvas {
  nodes?: unknown;
}

export class CanvasParser {
  /**
   * Parse a .canvas JSON string and return only the text-type nodes.
   * Throws CanvasParseError on malformed JSON or unexpected top-level shape.
   * An empty canvas (no nodes / no text nodes) yields nodes: [].
   */
  static parseCanvas(rawJson: string): CanvasContent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (e) {
      throw new CanvasParseError(
        `Invalid canvas JSON: ${(e as Error).message}`,
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new CanvasParseError("Canvas root is not an object");
    }

    const canvas = parsed as RawCanvas;
    const rawNodes = canvas.nodes;

    if (rawNodes === undefined || rawNodes === null) {
      return { nodes: [] };
    }
    if (!Array.isArray(rawNodes)) {
      throw new CanvasParseError("Canvas.nodes is not an array");
    }

    const nodes: CanvasTextNode[] = [];
    for (const rawNode of rawNodes) {
      if (!rawNode || typeof rawNode !== "object") continue;
      const node = rawNode as RawCanvasNode;
      if (node.type !== "text") continue;
      if (typeof node.id !== "string" || typeof node.text !== "string") continue;
      nodes.push({ id: node.id, text: node.text });
    }

    return { nodes };
  }
}
