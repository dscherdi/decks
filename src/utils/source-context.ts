import { type App, TFile } from "obsidian";
import type { Flashcard } from "../database/types";
import { findFlashcardSegment } from "./source-navigator";

interface CanvasNode {
  id?: unknown;
  type?: unknown;
  text?: unknown;
}
interface CanvasEdge {
  id?: unknown;
  fromNode?: unknown;
  toNode?: unknown;
}
interface CanvasShape {
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
}

/**
 * Extract a clipped window of the source note around where a flashcard was
 * parsed, to give the AI extra context. Markdown notes return numbered lines
 * within ±`radius` of the card's segment; canvas cards return the source text
 * node(s). Returns null when the file/segment can't be located.
 */
export async function extractSourceContext(
  app: App,
  card: Flashcard,
  radius = 8,
): Promise<string | null> {
  const file = app.vault.getAbstractFileByPath(card.sourceFile);
  if (!(file instanceof TFile)) return null;

  if (file.extension === "canvas") {
    try {
      return extractCanvasContext(await app.vault.cachedRead(file), card);
    } catch {
      return null;
    }
  }

  const content = await app.vault.cachedRead(file);
  const lines = content.split("\n");
  const segment = findFlashcardSegment(lines, card);
  if (!segment) return null;

  const start = Math.max(0, segment.start - radius);
  const end = Math.min(lines.length, segment.end + radius);
  return lines
    .slice(start, end)
    .map((line, i) => `${start + i + 1}: ${line}`)
    .join("\n");
}

function extractCanvasContext(content: string, card: Flashcard): string | null {
  let parsed: CanvasShape;
  try {
    parsed = JSON.parse(content) as CanvasShape;
  } catch {
    return null;
  }
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const textOf = (id: unknown): string | null => {
    const node = nodes.find((n) => n && n.type === "text" && n.id === id);
    return node && typeof node.text === "string" ? node.text : null;
  };

  if (card.type === "spatial" && card.edgeId) {
    const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
    const edge = edges.find((e) => e && e.id === card.edgeId);
    if (!edge) return null;
    const from = textOf(edge.fromNode);
    const to = textOf(edge.toNode);
    if (from === null && to === null) return null;
    return `From node:\n${from ?? ""}\n\nTo node:\n${to ?? ""}`;
  }

  if (card.sourceNodeId) return textOf(card.sourceNodeId);
  return null;
}
