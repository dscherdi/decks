import { type App, TFile } from "obsidian";
import type { Flashcard } from "../database/types";
import { FlashcardParser } from "@decks/core";
import { findFlashcardSegment } from "../utils/source-navigator";
import {
  escapeTableCell,
  extractAnchorTokens,
  formatAnchorToken,
  splitTableLine,
  stripAnchorTokens,
  unescapeTableCell,
  type AnchorToken,
} from "@decks/core";

const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;
const TABLE_ROW_REGEX = /^\|.*\|$/;
const NUMBERED_LIST_REGEX = /^(\s*)(\d+\.\s+)(.+)$/;
const TRAILING_TAGS_REGEX = /(\s+#[\w/-]+(?:\s+#[\w/-]+)*)\s*$/;

export type FlashcardEdits =
  | { type: "header-paragraph"; front: string; back: string }
  | { type: "table"; front: string; back: string; notes: string; columns?: string[] }
  | { type: "cloze"; front: string; sentence: string }
  | { type: "image-occlusion"; listItem: string }
  | { type: "spatial"; front: string; back: string; hint: string };

export type EditFailureCode =
  | "card_not_found"
  | "file_missing"
  | "file_changed"
  | "invalid_edit"
  | "write_failed";

export interface EditFailure {
  code: EditFailureCode;
  message: string;
}

export type EditResult = { ok: true } | { ok: false; failure: EditFailure };

export class FlashcardWriter {
  constructor(private app: App) {}

  async editFlashcard(
    card: Flashcard,
    edits: FlashcardEdits,
  ): Promise<EditResult> {
    if (edits.type !== card.type) {
      return fail("invalid_edit", `Edit type ${edits.type} does not match card type ${card.type}`);
    }

    const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
    if (!(file instanceof TFile)) {
      return fail("file_missing", `File not found: ${card.sourceFile}`);
    }

    const validation = validateEdits(edits);
    if (validation) return validation;

    const isCanvas = file.extension === "canvas";

    try {
      const outcome: { value: InternalApply | null } = { value: null };
      await this.app.vault.process(file, (content) => {
        const result = isCanvas
          ? applyCanvasEdit(content, card, edits)
          : applyEdit(content, card, edits);
        outcome.value = result;
        return result.ok ? result.newContent : content;
      });
      const settled = outcome.value;
      if (settled === null) {
        return fail("write_failed", "Vault process did not run");
      }
      if (!settled.ok) return settled;
      return { ok: true };
    } catch (e) {
      return fail("write_failed", e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Replace one card with multiple cards of the same type in its source file.
   * Markdown text cards only (header-paragraph, table, cloze). The new cards are
   * re-parsed into separate flashcards on the next sync.
   */
  async splitFlashcard(
    card: Flashcard,
    edits: FlashcardEdits[],
  ): Promise<EditResult> {
    if (edits.length === 0) {
      return fail("invalid_edit", "No cards to split into");
    }
    if (
      card.type !== "header-paragraph" &&
      card.type !== "table" &&
      card.type !== "cloze"
    ) {
      return fail("invalid_edit", `Split is not supported for ${card.type} cards`);
    }
    for (const e of edits) {
      if (e.type !== card.type) {
        return fail("invalid_edit", "Split produced a card of a different type");
      }
      const validation = validateEdits(e);
      if (validation) return validation;
    }

    const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
    if (!(file instanceof TFile)) {
      return fail("file_missing", `File not found: ${card.sourceFile}`);
    }
    if (file.extension === "canvas") {
      return fail("invalid_edit", "Split is only supported for markdown cards");
    }

    try {
      const outcome: { value: InternalApply | null } = { value: null };
      await this.app.vault.process(file, (content) => {
        const result = applySplit(content, card, edits);
        outcome.value = result;
        return result.ok ? result.newContent : content;
      });
      const settled = outcome.value;
      if (settled === null) {
        return fail("write_failed", "Vault process did not run");
      }
      if (!settled.ok) return settled;
      return { ok: true };
    } catch (e) {
      return fail("write_failed", e instanceof Error ? e.message : String(e));
    }
  }
}

interface CanvasJsonShape {
  nodes?: Array<{ id?: unknown; type?: unknown; text?: unknown } & Record<string, unknown>>;
  edges?: Array<{ id?: unknown; fromNode?: unknown; toNode?: unknown; label?: unknown } & Record<string, unknown>>;
  [key: string]: unknown;
}

function applyCanvasEdit(
  content: string,
  card: Flashcard,
  edits: FlashcardEdits,
): InternalApply {
  let parsed: CanvasJsonShape;
  try {
    parsed = JSON.parse(content) as CanvasJsonShape;
  } catch (e) {
    return fail("write_failed", `Canvas file is not valid JSON: ${(e as Error).message}`);
  }

  if (!Array.isArray(parsed.nodes)) {
    return fail("card_not_found", "Canvas has no nodes array");
  }

  if (edits.type === "spatial") {
    return applySpatialCanvasEdit(parsed, card, edits);
  }

  if (!card.sourceNodeId) {
    return fail("card_not_found", "Canvas card is missing sourceNodeId");
  }

  const node = parsed.nodes.find(
    (n) => n && n.type === "text" && n.id === card.sourceNodeId,
  );
  if (!node) {
    return fail("card_not_found", `Canvas node ${card.sourceNodeId} not found`);
  }
  if (typeof node.text !== "string") {
    return fail("card_not_found", "Canvas node has no text content");
  }

  // Delegate to the same per-card edit logic used for markdown — the node's
  // text is markdown content, just stored as a JSON string value.
  const inner = applyEdit(node.text, card, edits);
  if (!inner.ok) return inner;
  node.text = inner.newContent;

  // Tabs match Obsidian's own canvas serialization style.
  const newContent = JSON.stringify(parsed, null, "\t");
  return { ok: true, newContent };
}

function applySpatialCanvasEdit(
  parsed: CanvasJsonShape,
  card: Flashcard,
  edits: { type: "spatial"; front: string; back: string; hint: string },
): InternalApply {
  if (!card.edgeId) {
    return fail("card_not_found", "Spatial card is missing edgeId");
  }
  if (!Array.isArray(parsed.edges)) {
    return fail("card_not_found", "Canvas has no edges array");
  }

  const edge = parsed.edges.find((e) => e && e.id === card.edgeId);
  if (!edge) {
    return fail("card_not_found", `Canvas edge ${card.edgeId} no longer exists`);
  }
  if (typeof edge.fromNode !== "string" || typeof edge.toNode !== "string") {
    return fail("card_not_found", "Canvas edge is missing fromNode/toNode");
  }

  const nodes = parsed.nodes!;
  const fromNode = nodes.find(
    (n) => n && n.type === "text" && n.id === edge.fromNode,
  );
  const toNode = nodes.find(
    (n) => n && n.type === "text" && n.id === edge.toNode,
  );
  if (!fromNode || typeof fromNode.text !== "string") {
    return fail("card_not_found", "Spatial edge's from-node not found");
  }
  if (!toNode || typeof toNode.text !== "string") {
    return fail("card_not_found", "Spatial edge's to-node not found");
  }

  // Stale checks. Card values are what the manager loaded; canvas values are
  // current. Mismatch means the canvas drifted under us — refuse to clobber.
  const fromText = fromNode.text;
  const { cleaned: fromCleaned } = FlashcardParser.extractAndStripTags(fromText);
  if (fromCleaned !== card.front) {
    return fail("file_changed", "Front node has changed since the manager loaded. Refresh and try again.");
  }
  if (toNode.text !== card.back) {
    return fail("file_changed", "Back node has changed since the manager loaded. Refresh and try again.");
  }
  const currentLabel = typeof edge.label === "string" ? edge.label : "";
  if (currentLabel !== (card.hint ?? "")) {
    return fail("file_changed", "Edge label has changed since the manager loaded. Refresh and try again.");
  }

  // Preserve any trailing `#tag #tag2` suffix the user typed onto the from-node
  // so editing the front text doesn't strip their tags. The parser strips them
  // for `card.front`, so they're not in the modal — we re-attach them here.
  const tailMatch = TRAILING_TAGS_REGEX.exec(fromText);
  const tagsSuffix = tailMatch ? tailMatch[1] : "";
  fromNode.text = `${edits.front.trim()}${tagsSuffix}`;
  toNode.text = edits.back;

  // Edge label semantics: keep the field absent when the hint is empty AND the
  // edge previously had no label, otherwise write the hint (even if empty —
  // that round-trips as a labelled edge with empty label, which the parser
  // treats as no hint anyway).
  if (edits.hint === "" && typeof edge.label !== "string") {
    // leave as-is
  } else {
    edge.label = edits.hint;
  }

  // Tabs match Obsidian's own canvas serialization style.
  const newContent = JSON.stringify(parsed, null, "\t");
  return { ok: true, newContent };
}

type InternalApply =
  | { ok: true; newContent: string }
  | { ok: false; failure: EditFailure };

function applyEdit(
  content: string,
  card: Flashcard,
  edits: FlashcardEdits,
): InternalApply {
  const lines = content.split("\n");
  const segment = findFlashcardSegment(lines, card);
  if (!segment) {
    return fail("card_not_found", "Could not locate card in source markdown");
  }

  const segLines = lines.slice(segment.start, segment.end);
  const staleCheck = checkStale(card, segLines, segment.start, lines);
  if (staleCheck) return staleCheck;

  // Setting Notes on a table that only has Front/Back columns requires adding a
  // Notes column to the whole table, not just this row.
  if (
    card.type === "table" &&
    edits.type === "table" &&
    !edits.columns &&
    edits.notes.trim() !== "" &&
    dataColumnCount(segLines[0]) < 3
  ) {
    return addNotesColumn(lines, segment.start, card, edits);
  }

  const replacement = buildReplacement(lines, segment, card, edits);
  if (replacement.ok === false) return replacement;

  const newLines = [
    ...lines.slice(0, segment.start),
    ...replacement.lines,
    ...lines.slice(segment.end),
  ];
  return { ok: true, newContent: newLines.join("\n") };
}

const TABLE_SEPARATOR_REGEX = /^\|[\s-]+\|(?:[\s-]+\|)+$/;

/** Number of data columns in a table row (excludes the surrounding pipes). */
function dataColumnCount(rowLine: string): number {
  const cells = splitTableRow(rowLine);
  return cells ? Math.max(0, cells.length - 2) : 0;
}

/** The trimmed data cells of a table row (drops the surrounding empties). */
function tableDataCells(rowLine: string): string[] {
  const cells = splitTableRow(rowLine);
  if (!cells) return [];
  return cells.slice(1, -1).map((c) => c.trim());
}

function tableRowFromCells(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function tableSeparatorRow(columns: number): string {
  return `| ${Array(columns).fill("---").join(" | ")} |`;
}

/**
 * Add a "Notes" column to the whole table that hosts `card`'s row, setting the
 * target row's notes to the edited value and leaving every other row's notes
 * empty. Rewrites the header, separator, and all data rows.
 */
function addNotesColumn(
  lines: string[],
  rowIndex: number,
  card: Flashcard,
  edits: { front: string; back: string; notes: string },
): InternalApply {
  // Walk up to the first contiguous table line (the header), down to the last.
  let headerIndex = rowIndex;
  while (
    headerIndex - 1 >= 0 &&
    TABLE_ROW_REGEX.test(lines[headerIndex - 1].trim())
  ) {
    headerIndex--;
  }
  const separatorIndex = headerIndex + 1;
  if (
    separatorIndex >= lines.length ||
    !TABLE_SEPARATOR_REGEX.test(lines[separatorIndex].trim())
  ) {
    return fail(
      "invalid_edit",
      "Could not find the table separator row to add a Notes column",
    );
  }
  const dataStart = separatorIndex + 1;
  let dataEnd = rowIndex;
  while (
    dataEnd + 1 < lines.length &&
    TABLE_ROW_REGEX.test(lines[dataEnd + 1].trim())
  ) {
    dataEnd++;
  }

  const headerCells = tableDataCells(lines[headerIndex]);
  const newBlock: string[] = [
    tableRowFromCells([...headerCells, "Notes"]),
    tableSeparatorRow(headerCells.length + 1),
  ];
  for (let i = dataStart; i <= dataEnd; i++) {
    if (i === rowIndex) {
      const token = extractAnchorTokens(lines[i]).tokens.find(
        (t) => t.role === "t",
      );
      const tokenSuffix = token ? ` ${formatAnchorToken("t", token.id)}` : "";
      newBlock.push(
        tableRowFromCells([
          escapeTableCell(edits.front.trim()) + tokenSuffix,
          escapeTableCell(edits.back.trim()),
          escapeTableCell(edits.notes.trim()),
        ]),
      );
    } else {
      // Preserve the existing (already-escaped) front/back; add an empty note.
      newBlock.push(tableRowFromCells([...tableDataCells(lines[i]), ""]));
    }
  }

  const newLines = [
    ...lines.slice(0, headerIndex),
    ...newBlock,
    ...lines.slice(dataEnd + 1),
  ];
  return { ok: true, newContent: newLines.join("\n") };
}

function checkStale(
  card: Flashcard,
  segLines: string[],
  segmentStart: number,
  allLines: string[],
): InternalApply | null {
  // Anchor tokens are identity markers, not content: strip them everywhere
  // before comparing to the card's stored (clean) values, mirroring the parser.
  if (card.type === "header-paragraph") {
    const body = stripAnchorTokens(extractHeaderBlockBody(segLines)).trim();
    if (body !== card.back.trim()) {
      return fail(
        "file_changed",
        "Card content has changed since the manager loaded. Refresh and try again.",
      );
    }
    return null;
  }

  if (card.type === "table") {
    const cells = splitTableRow(segLines[0]);
    if (!cells) return fail("file_changed", "Table row no longer parseable");
    // The cell values on disk are escape-encoded (\| and <br>). Un-escape
    // before comparing to the card's stored (clean) values.
    const back = unescapeTableCell(stripAnchorTokens(cells[2] ?? "").trim());
    const notes = unescapeTableCell(stripAnchorTokens(cells[3] ?? "").trim());
    if (back !== card.back || notes !== (card.notes ?? "")) {
      return fail("file_changed", "Table row content has changed.");
    }
    return null;
  }

  if (card.type === "cloze") {
    const anchor = segLines[0];
    if (HEADER_REGEX.test(anchor)) {
      const body = stripAnchorTokens(extractHeaderBlockBody(segLines)).trim();
      if (body !== card.back.trim()) {
        return fail("file_changed", "Cloze content has changed.");
      }
    } else {
      const cells = splitTableRow(anchor);
      if (!cells) return fail("file_changed", "Cloze host row no longer parseable");
      const back = unescapeTableCell(stripAnchorTokens(cells[2] ?? "").trim());
      if (back !== card.back) {
        return fail("file_changed", "Cloze content has changed.");
      }
    }
    return null;
  }

  if (card.type === "image-occlusion") {
    const itemLine = segLines[0];
    const match = NUMBERED_LIST_REGEX.exec(itemLine);
    if (!match) return fail("file_changed", "Image-occlusion item is no longer a numbered list line");
    const currentItemText = stripAnchorTokens(match[3]).trim();
    const currentCloze = currentItemText.replace(/==((?:(?!==).)+)==/g, "$1");
    if (currentCloze !== (card.clozeText ?? "")) {
      return fail(
        "file_changed",
        "Image-occlusion item content has changed.",
      );
    }
    // Use allLines/segmentStart so unused parameters keep their meaning if future
    // checks need broader context.
    void allLines;
    void segmentStart;
    return null;
  }

  return null;
}

function applySplit(
  content: string,
  card: Flashcard,
  edits: FlashcardEdits[],
): InternalApply {
  const lines = content.split("\n");
  const segment = findFlashcardSegment(lines, card);
  if (!segment) {
    return fail("card_not_found", "Could not locate card in source markdown");
  }

  const segLines = lines.slice(segment.start, segment.end);
  const staleCheck = checkStale(card, segLines, segment.start, lines);
  if (staleCheck) return staleCheck;

  // Table rows (and table-hosted cloze) stack directly under the existing table
  // header above the segment; header blocks are separated by a blank line.
  const isRowType =
    card.type === "table" ||
    (card.type === "cloze" && !HEADER_REGEX.test(segLines[0]));

  // Only the first split keeps the original card's anchor token — copying it
  // into every group would duplicate the identity.
  const groups: string[][] = [];
  for (let i = 0; i < edits.length; i++) {
    const built = buildReplacement(lines, segment, card, edits[i], i === 0);
    if (built.ok === false) return built;
    groups.push(built.lines);
  }

  let replacement: string[];
  if (isRowType) {
    replacement = groups.flat();
  } else {
    replacement = [];
    groups.forEach((group, i) => {
      const trimmed = [...group];
      while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") {
        trimmed.pop();
      }
      if (i > 0) replacement.push("");
      replacement.push(...trimmed);
    });
    // Preserve a trailing blank line if the original block had one.
    if (segLines.length > 0 && segLines[segLines.length - 1].trim() === "") {
      replacement.push("");
    }
  }

  const newLines = [
    ...lines.slice(0, segment.start),
    ...replacement,
    ...lines.slice(segment.end),
  ];
  return { ok: true, newContent: newLines.join("\n") };
}

function buildReplacement(
  allLines: string[],
  segment: { start: number; end: number },
  card: Flashcard,
  edits: FlashcardEdits,
  preserveAnchors = true,
): { ok: true; lines: string[] } | { ok: false; failure: EditFailure } {
  const segLines = allLines.slice(segment.start, segment.end);

  if (edits.type === "header-paragraph") {
    return buildHeaderParagraph(segLines, edits.front, edits.back, preserveAnchors);
  }
  if (edits.type === "table") {
    return buildTableRow(segLines[0], edits, preserveAnchors);
  }
  if (edits.type === "cloze") {
    if (HEADER_REGEX.test(segLines[0])) {
      // Cloze hosted in a header-paragraph block: edit both the header
      // (front) and the body (sentence) — same as a header-paragraph edit.
      return buildHeaderParagraph(segLines, edits.front, edits.sentence, preserveAnchors);
    }
    const cells = splitTableRow(segLines[0]);
    if (!cells) {
      return fail("invalid_edit", "Cloze host row is not a valid table row");
    }
    // Cloze hosted in a table row: edit the front cell and the back cell.
    return buildTableRow(
      segLines[0],
      {
        front: edits.front,
        back: edits.sentence,
        notes: unescapeTableCell(stripAnchorTokens(cells[3] ?? "").trim()),
      },
      preserveAnchors,
    );
  }
  if (edits.type === "image-occlusion") {
    return buildImageOcclusionItem(segLines[0], edits.listItem, preserveAnchors);
  }
  return fail("invalid_edit", "Unsupported edit type");
}

function buildHeaderParagraph(
  segLines: string[],
  newFront: string,
  newBack: string,
  preserveAnchors = true,
): { ok: true; lines: string[] } | { ok: false; failure: EditFailure } {
  if (segLines.length === 0) {
    return fail("card_not_found", "Empty header segment");
  }
  const headerLine = segLines[0];
  const m = HEADER_REGEX.exec(headerLine);
  if (!m) return fail("card_not_found", "Header line is not a header");

  const hashes = m[1];
  const original = m[2];
  // Preserve trailing inline tags (e.g. "Question? #review")
  const trailingTagsMatch = original.match(/(\s+#[\w/-]+(?:\s+#[\w/-]+)*)\s*$/);
  const trailingTags = trailingTagsMatch ? trailingTagsMatch[1] : "";
  const cleanedFront = newFront.trim().replace(/\n/g, " ");
  const newHeader = `${hashes} ${cleanedFront}${trailingTags}`;

  const endsWithBlank = segLines.length > 1 && segLines[segLines.length - 1].trim() === "";
  const bodyLines = newBack.split("\n");
  if (preserveAnchors) {
    carryBodyAnchors(segLines.slice(1), bodyLines);
  }
  const result = [newHeader, ...bodyLines];
  if (endsWithBlank && result[result.length - 1].trim() !== "") {
    result.push("");
  }
  return { ok: true, lines: result };
}

/**
 * Carry anchor tokens from the old body into the rebuilt one: line-scoped
 * tokens re-attach to the first identical new line; the card's own `h` token
 * keeps its own line after the new body. Tokens on lines the user rewrote are
 * dropped (their card follows intended-reset semantics).
 */
function carryBodyAnchors(oldBody: string[], bodyLines: string[]): void {
  const headerTokens: AnchorToken[] = [];
  const lineTokens: { cleaned: string; token: AnchorToken }[] = [];
  for (const line of oldBody) {
    const { cleaned, tokens } = extractAnchorTokens(line);
    for (const token of tokens) {
      if (token.role === "h") headerTokens.push(token);
      else lineTokens.push({ cleaned: cleaned.trim(), token });
    }
  }
  const claimed = new Set<number>();
  for (const { cleaned, token } of lineTokens) {
    for (let i = 0; i < bodyLines.length; i++) {
      if (claimed.has(i)) continue;
      if (bodyLines[i].trim() === cleaned) {
        bodyLines[i] = `${bodyLines[i]} ${formatAnchorToken(token.role, token.id)}`;
        claimed.add(i);
        break;
      }
    }
  }
  if (headerTokens.length > 0) {
    let last = -1;
    for (let i = bodyLines.length - 1; i >= 0; i--) {
      if (bodyLines[i].trim() !== "") {
        last = i;
        break;
      }
    }
    bodyLines.splice(last + 1, 0, formatAnchorToken("h", headerTokens[0].id));
  }
}

function buildTableRow(
  rowLine: string,
  edits: { front: string; back: string; notes: string; columns?: string[] },
  preserveAnchors = true,
): { ok: true; lines: string[] } | { ok: false; failure: EditFailure } {
  const cells = splitTableRow(rowLine);
  if (!cells) return fail("invalid_edit", "Not a valid table row");
  // `cells` includes a leading and trailing empty entry from the surrounding
  // pipes; data columns are cells[1..cells.length-2]. A 2-column table has
  // length 4, a 3-column has length 5.
  const dataCount = Math.max(0, cells.length - 2);

  // The row's identity token is carried into the rebuilt first cell.
  let tokenSuffix = "";
  if (preserveAnchors) {
    for (const cell of cells) {
      const token = extractAnchorTokens(cell).tokens.find((t) => t.role === "t");
      if (token) {
        tokenSuffix = ` ${formatAnchorToken("t", token.id)}`;
        break;
      }
    }
  }

  // Template cards edit the whole row: write each existing data cell from the
  // matching `columns[i]` (extra columns beyond the row's width are ignored).
  if (edits.columns) {
    const next = [...cells];
    for (let i = 0; i < dataCount; i++) {
      const suffix = i === 0 ? tokenSuffix : "";
      next[i + 1] = ` ${escapeTableCell((edits.columns[i] ?? "").trim())}${suffix} `;
    }
    return { ok: true, lines: [next.join("|")] };
  }

  if (dataCount < 3 && edits.notes.trim() !== "") {
    return fail(
      "invalid_edit",
      "Cannot set Notes — this table has only Front and Back columns",
    );
  }

  // Escape pipes and newlines so the row stays single-line and structurally
  // valid. The parser un-escapes on read so the round-trip is clean.
  const next = [...cells];
  next[1] = ` ${escapeTableCell(edits.front.trim())}${tokenSuffix} `;
  next[2] = ` ${escapeTableCell(edits.back.trim())} `;
  if (dataCount >= 3) {
    next[3] = ` ${escapeTableCell(edits.notes.trim())} `;
  }
  return { ok: true, lines: [next.join("|")] };
}

function buildImageOcclusionItem(
  itemLine: string,
  newItem: string,
  preserveAnchors = true,
): { ok: true; lines: string[] } | { ok: false; failure: EditFailure } {
  const m = NUMBERED_LIST_REGEX.exec(itemLine);
  if (!m) return fail("invalid_edit", "Selected line is not a numbered list item");
  const indent = m[1];
  const prefix = m[2];
  const token = preserveAnchors
    ? extractAnchorTokens(itemLine).tokens.find((t) => t.role === "o")
    : undefined;
  const tokenSuffix = token ? ` ${formatAnchorToken("o", token.id)}` : "";
  // A numbered list item must live on one line. Collapse newlines to spaces
  // so the structure isn't broken; the user's edit becomes a single-line item.
  const single = newItem.trim().replace(/\n+/g, " ");
  return { ok: true, lines: [`${indent}${prefix}${single}${tokenSuffix}`] };
}

function extractHeaderBlockBody(segLines: string[]): string {
  // segLines[0] is the header line; body is the rest, with trailing blank lines stripped.
  const body = segLines.slice(1);
  while (body.length > 0 && body[body.length - 1].trim() === "") {
    body.pop();
  }
  return body.join("\n");
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!TABLE_ROW_REGEX.test(trimmed)) return null;
  // Respect escaped pipes (`\|`) so the column count is correct when cells
  // contain literal pipes.
  return splitTableLine(trimmed);
}

function validateEdits(edits: FlashcardEdits): InternalApply | null {
  if (edits.type === "cloze") {
    if (edits.front.trim() === "") {
      return fail("invalid_edit", "Front text cannot be empty");
    }
    if (!/==((?:(?!==).)+)==/.test(edits.sentence)) {
      return fail("invalid_edit", "Cloze must contain at least one ==span==");
    }
  }
  if (edits.type === "header-paragraph") {
    if (edits.front.trim() === "") {
      return fail("invalid_edit", "Header text cannot be empty");
    }
    // Newlines in the header are silently collapsed to spaces by
    // buildHeaderParagraph — a header line must be single-line in markdown.
  }
  if (edits.type === "table" && edits.columns) {
    if ((edits.columns[0] ?? "").trim() === "") {
      return fail("invalid_edit", "The first column cannot be empty");
    }
  }
  if (edits.type === "image-occlusion") {
    if (edits.listItem.trim() === "") {
      return fail("invalid_edit", "List item cannot be empty");
    }
  }
  if (edits.type === "spatial") {
    if (edits.front.trim() === "") {
      return fail("invalid_edit", "Front text cannot be empty");
    }
    if (edits.back.trim() === "") {
      return fail("invalid_edit", "Back text cannot be empty");
    }
  }
  return null;
}

function fail(code: EditFailureCode, message: string): { ok: false; failure: EditFailure } {
  return { ok: false, failure: { code, message } };
}
