import { type App, TFile, normalizePath } from "obsidian";
import {
  buildHeaderParagraphCard,
  buildHeaderParagraphContent,
  buildTableContent,
  escapeTableCell,
  headingHashes,
  type GeneratedCard,
} from "@decks/core";

export type SaveFormat = "header-paragraph" | "table" | "canvas";

/** A canvas text node (the only node type that carries flashcards). */
interface CanvasTextNode {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasJson {
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export type SaveOptions = { level: number } & (
  | {
      kind: "new-file";
      format: SaveFormat;
      folder: string;
      name: string;
      /** Tag written into frontmatter for markdown decks (ignored for canvas). */
      tag: string;
    }
  | { kind: "append"; format: SaveFormat; filePath: string }
);

// Canvas grid layout constants.
const NODE_W = 400;
const NODE_H = 220;
const GAP = 60;
const COLS = 3;

// The pure card->markdown builders live in core so the mobile app renders a
// saved card exactly the same way; re-exported here for existing callers.
export {
  buildHeaderParagraphCard,
  buildHeaderParagraphContent,
  buildTableContent,
  headingHashes,
};

/**
 * Build canvas text nodes (one per card, header+paragraph markdown inside),
 * laid out in a grid starting at (originX, originY). `makeId` is injectable so
 * tests get deterministic ids; production uses random ids persisted in the file.
 */
export function buildCanvasNodes(
  cards: GeneratedCard[],
  level: number,
  opts: {
    originX?: number;
    originY?: number;
    makeId?: (index: number) => string;
  } = {},
): CanvasTextNode[] {
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const makeId = opts.makeId ?? (() => `gen-${randomId()}`);
  return cards.map((c, i) => ({
    id: makeId(i),
    type: "text",
    text: buildHeaderParagraphCard(c, level),
    x: originX + (i % COLS) * (NODE_W + GAP),
    y: originY + Math.floor(i / COLS) * (NODE_H + GAP),
    width: NODE_W,
    height: NODE_H,
  }));
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.abs(hashString(String(Date.now()))).toString(36);
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Frontmatter block carrying the deck tag (tag written without its leading #). */
function frontmatter(tag: string): string {
  const clean = tag.replace(/^#/, "");
  return `---\ntags:\n  - ${clean}\n---\n\n`;
}

/**
 * Write generated cards to disk: either create a new markdown/canvas file or
 * append to an existing deck file. Returns the target path. Deck registration
 * and sync are the caller's responsibility (see main.ts).
 */
export class FlashcardComposer {
  constructor(private readonly app: App) {}

  async saveGenerated(
    cards: GeneratedCard[],
    options: SaveOptions,
  ): Promise<{ filePath: string }> {
    if (options.kind === "new-file") {
      return options.format === "canvas"
        ? this.createCanvasFile(cards, options)
        : this.createMarkdownFile(cards, options);
    }
    return options.format === "canvas"
      ? this.appendCanvas(cards, options)
      : this.appendMarkdown(cards, options);
  }

  private async ensureFolder(folder: string): Promise<void> {
    const norm = normalizePath(folder);
    if (norm && norm !== "/" && !(await this.app.vault.adapter.exists(norm))) {
      await this.app.vault.adapter.mkdir(norm);
    }
  }

  private async createMarkdownFile(
    cards: GeneratedCard[],
    options: Extract<SaveOptions, { kind: "new-file" }>,
  ): Promise<{ filePath: string }> {
    await this.ensureFolder(options.folder);
    const filePath = normalizePath(
      `${options.folder ? `${options.folder}/` : ""}${options.name}.md`,
    );
    const body =
      options.format === "table"
        ? buildTableContent(cards, options.level, options.name)
        : buildHeaderParagraphContent(cards, options.level);
    await this.app.vault.create(filePath, frontmatter(options.tag) + body + "\n");
    return { filePath };
  }

  private async createCanvasFile(
    cards: GeneratedCard[],
    options: Extract<SaveOptions, { kind: "new-file" }>,
  ): Promise<{ filePath: string }> {
    await this.ensureFolder(options.folder);
    const filePath = normalizePath(
      `${options.folder ? `${options.folder}/` : ""}${options.name}.canvas`,
    );
    const canvas = {
      nodes: buildCanvasNodes(cards, options.level),
      edges: [] as unknown[],
    };
    await this.app.vault.create(filePath, JSON.stringify(canvas, null, "\t"));
    return { filePath };
  }

  private async appendMarkdown(
    cards: GeneratedCard[],
    options: Extract<SaveOptions, { kind: "append" }>,
  ): Promise<{ filePath: string }> {
    const file = this.app.vault.getAbstractFileByPath(options.filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Target file not found: ${options.filePath}`);
    }
    const title = file.basename;
    const body =
      options.format === "table"
        ? buildTableContent(cards, options.level, title)
        : buildHeaderParagraphContent(cards, options.level);
    await this.app.vault.process(file, (content) => {
      const sep = content.endsWith("\n") ? "\n" : "\n\n";
      return `${content}${sep}${body}\n`;
    });
    return { filePath: options.filePath };
  }

  private async appendCanvas(
    cards: GeneratedCard[],
    options: Extract<SaveOptions, { kind: "append" }>,
  ): Promise<{ filePath: string }> {
    const file = this.app.vault.getAbstractFileByPath(options.filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Target file not found: ${options.filePath}`);
    }
    await this.app.vault.process(file, (raw) => {
      let canvas: CanvasJson;
      try {
        canvas = JSON.parse(raw) as CanvasJson;
      } catch {
        throw new Error("Target canvas file is not valid JSON");
      }
      const nodes: unknown[] = Array.isArray(canvas.nodes) ? canvas.nodes : [];
      // Place new nodes below the existing content's bounding box.
      let maxY = 0;
      for (const n of nodes) {
        const node = n as { y?: unknown; height?: unknown };
        const y = typeof node.y === "number" ? node.y : 0;
        const h = typeof node.height === "number" ? node.height : 0;
        maxY = Math.max(maxY, y + h);
      }
      const newNodes = buildCanvasNodes(cards, options.level, {
        originY: nodes.length ? maxY + GAP : 0,
      });
      canvas.nodes = [...nodes, ...newNodes] as Array<Record<string, unknown>>;
      if (!Array.isArray(canvas.edges)) canvas.edges = [];
      return JSON.stringify(canvas, null, "\t");
    });
    return { filePath: options.filePath };
  }
}
