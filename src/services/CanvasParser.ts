/**
 * CanvasParser - Parse Obsidian Canvas (.canvas) JSON into text-node entries
 * and text-to-text edges.
 *
 * An Obsidian canvas is a JSON document conforming to the JSON Canvas spec.
 * Top-level shape: { nodes: Node[], edges: Edge[] }. We only care about
 * text-type nodes (type === "text"), which carry markdown content in their
 * `text` field. Other node types (file, link, group) are ignored.
 *
 * Edges are kept only when both endpoints reference a text node we extracted,
 * so downstream code never has to worry about dangling references or edges
 * that touch file/link/group nodes.
 */

export interface CanvasTextNode {
  id: string;
  text: string;
}

export interface CanvasTextEdge {
  id: string;
  fromNode: string;
  toNode: string;
  label: string;
}

export interface CanvasContent {
  nodes: CanvasTextNode[];
  edges: CanvasTextEdge[];
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

interface RawCanvasEdge {
  id?: unknown;
  fromNode?: unknown;
  toNode?: unknown;
  label?: unknown;
}

interface RawCanvas {
  nodes?: unknown;
  edges?: unknown;
}

export class CanvasParser {
  /**
   * Parse a .canvas JSON string and return text-type nodes plus the subset of
   * edges that connect two text nodes.
   * Throws CanvasParseError on malformed JSON or unexpected top-level shape.
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
    const nodes = CanvasParser.parseNodes(canvas.nodes);
    const edges = CanvasParser.parseEdges(canvas.edges, nodes);

    return { nodes, edges };
  }

  private static parseNodes(rawNodes: unknown): CanvasTextNode[] {
    if (rawNodes === undefined || rawNodes === null) return [];
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
    return nodes;
  }

  private static parseEdges(
    rawEdges: unknown,
    textNodes: CanvasTextNode[],
  ): CanvasTextEdge[] {
    if (rawEdges === undefined || rawEdges === null) return [];
    if (!Array.isArray(rawEdges)) return [];

    const textNodeIds = new Set(textNodes.map((n) => n.id));
    const edges: CanvasTextEdge[] = [];
    for (const rawEdge of rawEdges) {
      if (!rawEdge || typeof rawEdge !== "object") continue;
      const edge = rawEdge as RawCanvasEdge;
      if (typeof edge.id !== "string") continue;
      if (typeof edge.fromNode !== "string" || typeof edge.toNode !== "string") continue;
      // Drop edges that touch non-text endpoints (ignore them entirely).
      if (!textNodeIds.has(edge.fromNode) || !textNodeIds.has(edge.toNode)) continue;
      const label = typeof edge.label === "string" ? edge.label : "";
      edges.push({
        id: edge.id,
        fromNode: edge.fromNode,
        toNode: edge.toNode,
        label,
      });
    }
    return edges;
  }
}
