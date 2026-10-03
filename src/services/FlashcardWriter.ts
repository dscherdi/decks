import { type App, TFile } from "obsidian";
import type { Flashcard } from "../database/types";
import { FlashcardParser } from "@decks/core";
import { findFlashcardSegment } from "../utils/source-navigator";
import { forwardCard, isReverseCard } from "../utils/reverse-card";
import {
  carryBodyAnchors,
  carryRowToken,
  escapeTableCell,
  extractAnchorTokens,
  formatAnchorToken,
  isAnchorCommentBody,
  splitTableLine,
  stripAnchorTokens,
  unescapeTableCell,
  I18n,
} from "@decks/core";

/** Resolved per call, so a failure is worded in the language in force now. */
const e = (): typeof I18n.t.cardEdit => I18n.t.cardEdit;

const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;
const TABLE_ROW_REGEX = /^\|.*\|$/;
const NUMBERED_LIST_REGEX = /^(\s*)(\d+\.\s+)(.+)$/;
const TRAILING_TAGS_REGEX = /(\s+#[\w/-]+(?:\s+#[\w/-]+)*)\s*$/;

export type FlashcardEdits =
  | { type: "header-paragraph"; front: string; back: string }
  | { type: "multiple-choice"; front: string; back: string }
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
      return fail(
        "invalid_edit",
        I18n.format(e().typeMismatch, { edit: edits.type, card: card.type }),
      );
    }

    const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
    if (!(file instanceof TFile)) {
      return fail("file_missing", `File not found: ${card.sourceFile}`);
    }

    // Found by its front, a reverse card would land on its note's answer: edit its note's card.
    const host = forwardCard(card);
    const hostEdits = isReverseCard(card) ? forwardEdits(edits) : edits;
    const validation = validateEdits(hostEdits);
    if (validation) return validation;

    const isCanvas = file.extension === "canvas";

    try {
      const outcome: { value: InternalApply | null } = { value: null };
      await this.app.vault.process(file, (content) => {
        const result = isCanvas
          ? applyCanvasEdit(content, host, hostEdits)
          : applyEdit(content, host, hostEdits);
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
    if (isReverseCard(card)) {
      return fail("invalid_edit", e().splitUnsupported);
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
    return fail("card_not_found", e().cardNotFound);
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
    return fail("invalid_edit", e().separatorNotFound);
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
      const token = carryRowToken(lines[i], cleanedDataCells(lines[i]), [
        edits.front.trim(),
        edits.back.trim(),
      ]);
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
  if (card.type === "header-paragraph" || card.type === "multiple-choice") {
    if (!headerMatches(card, segLines)) return fail("file_changed", e().noteChanged);
    return null;
  }

  if (card.type === "table") {
    const cells = splitTableRow(segLines[0]);
    if (!cells) return fail("file_changed", e().tableRowUnparseable);
    // The cell values on disk are escape-encoded (\| and <br>). Un-escape
    // before comparing to the card's stored (clean) values.
    const back = unescapeTableCell(stripAnchorTokens(cells[2] ?? "").trim());
    const notes = unescapeTableCell(stripAnchorTokens(cells[3] ?? "").trim());
    if (back !== card.back || notes !== (card.notes ?? "")) {
      return fail("file_changed", e().tableRowChanged);
    }
    return null;
  }

  if (card.type === "cloze") {
    const anchor = segLines[0];
    if (HEADER_REGEX.test(anchor)) {
      if (!headerMatches(card, segLines)) return fail("file_changed", e().clozeChanged);
    } else {
      const cells = splitTableRow(anchor);
      if (!cells) return fail("file_changed", e().clozeRowUnparseable);
      const back = unescapeTableCell(stripAnchorTokens(cells[2] ?? "").trim());
      if (back !== card.back) {
        return fail("file_changed", e().clozeChanged);
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
    return fail("card_not_found", e().cardNotFound);
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

  if (edits.type === "header-paragraph" || edits.type === "multiple-choice") {
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
      return fail("invalid_edit", e().clozeRowInvalid);
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
    return fail("card_not_found", e().emptyHeaderSegment);
  }
  const headerLine = segLines[0];
  const m = HEADER_REGEX.exec(headerLine);
  if (!m) return fail("card_not_found", e().anchorNotHeader);

  const hashes = m[1];
  const original = m[2];
  // Preserve trailing inline tags (e.g. "Question? #review")
  const trailingTagsMatch = original.match(/(\s+#[\w/-]+(?:\s+#[\w/-]+)*)\s*$/);
  const trailingTags = trailingTagsMatch ? trailingTagsMatch[1] : "";
  const cleanedFront = newFront.trim().replace(/\n/g, " ");
  const newHeader = `${hashes} ${cleanedFront}${trailingTags}`;

  const endsWithBlank = segLines.length > 1 && segLines[segLines.length - 1].trim() === "";
  const opensWithBlank = segLines.length > 1 && segLines[1].trim() === "";
  // The edit carries only the back, so the card's existing notes go back in as
  // written; on a split they stay with the card that keeps the original's identity.
  const notes = preserveAnchors ? carriedNotes(segLines.slice(1)) : "";
  const back = opensWithBlank ? newBack.replace(/^\s*\n/, "") : newBack;
  const bodyLines = (notes ? `${back.trimEnd()}\n\n${notes}` : back).split("\n");
  if (preserveAnchors) {
    carryBodyAnchors(segLines.slice(1), bodyLines);
  }
  const result = opensWithBlank ? [newHeader, "", ...bodyLines] : [newHeader, ...bodyLines];
  if (endsWithBlank && result[result.length - 1].trim() !== "") {
    result.push("");
  }
  return { ok: true, lines: result };
}

/** A row's data cells as the parser reads them: tokens stripped, unescaped. */
function cleanedDataCells(rowLine: string): string[] {
  const cells = splitTableRow(rowLine) ?? [];
  return cells.slice(1, -1).map((c) => unescapeTableCell(stripAnchorTokens(c).trim()));
}

function buildTableRow(
  rowLine: string,
  edits: { front: string; back: string; notes: string; columns?: string[] },
  preserveAnchors = true,
): { ok: true; lines: string[] } | { ok: false; failure: EditFailure } {
  const cells = splitTableRow(rowLine);
  if (!cells) return fail("invalid_edit", e().notATableRow);
  // `cells` includes a leading and trailing empty entry from the surrounding
  // pipes; data columns are cells[1..cells.length-2]. A 2-column table has
  // length 4, a 3-column has length 5.
  const dataCount = Math.max(0, cells.length - 2);

  // The row's identity token is carried into the rebuilt first cell.
  let tokenSuffix = "";
  if (preserveAnchors) {
    const newCells = edits.columns
      ? edits.columns.map((c) => c.trim())
      : [edits.front.trim(), edits.back.trim()];
    const token = carryRowToken(rowLine, cleanedDataCells(rowLine), newCells);
    if (token) tokenSuffix = ` ${formatAnchorToken("t", token.id)}`;
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

/** Whether a header block still matches its card, splitting back from notes the parser's way. */
function headerMatches(card: Flashcard, segLines: string[]): boolean {
  const { back, notes } = FlashcardParser.extractHeaderParagraphNotes(
    stripAnchorTokens(extractHeaderBlockBody(segLines)),
  );
  return back.trim() === card.back.trim() && notes.trim() === (card.notes ?? "").trim();
}

/** A header body's notes, verbatim: non-anchor `%%comments%%` and a section after the last break. */
function carriedNotes(oldBody: string[]): string {
  const text = oldBody.join("\n");
  const parts: string[] = [];
  for (const match of text.matchAll(/%%([\s\S]*?)%%/g)) {
    const inner = match[1].trim();
    if (inner && !isAnchorCommentBody(inner)) parts.push(match[0].trim());
  }
  const lines = text.replace(/%%[\s\S]*?%%/g, "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
      const after = lines.slice(i + 1).join("\n").trim();
      if (after) parts.push(`${lines[i].trim()}\n${after}`);
      // Only the last break can divide body from notes, as in the parser.
      break;
    }
  }
  return parts.join("\n\n");
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

/** A reverse card's edit, put the way round its note holds it. */
function forwardEdits(edits: FlashcardEdits): FlashcardEdits {
  if (edits.type === "header-paragraph" || edits.type === "table") {
    return { ...edits, front: edits.back, back: edits.front };
  }
  return edits;
}

function validateEdits(edits: FlashcardEdits): InternalApply | null {
  if (edits.type === "cloze") {
    if (edits.front.trim() === "") {
      return fail("invalid_edit", e().frontEmpty);
    }
    if (!/==((?:(?!==).)+)==/.test(edits.sentence)) {
      return fail("invalid_edit", e().clozeNeedsSpan);
    }
  }
  if (edits.type === "header-paragraph") {
    if (edits.front.trim() === "") {
      return fail("invalid_edit", e().headerEmpty);
    }
    // Newlines in the header are silently collapsed to spaces by
    // buildHeaderParagraph — a header line must be single-line in markdown.
  }
  if (edits.type === "table" && edits.columns) {
    if ((edits.columns[0] ?? "").trim() === "") {
      return fail("invalid_edit", "The first column cannot be empty");
    }
  }
  // The parser skips a row with an empty first or second cell, so the card would be deleted.
  if (edits.type === "table") {
    const [front, back] = edits.columns ?? [edits.front, edits.back];
    if ((front ?? "").trim() === "") return fail("invalid_edit", e().frontEmpty);
    if ((back ?? "").trim() === "") return fail("invalid_edit", e().backEmpty);
  }
  if (edits.type === "image-occlusion") {
    if (edits.listItem.trim() === "") {
      return fail("invalid_edit", "List item cannot be empty");
    }
  }
  if (edits.type === "spatial") {
    if (edits.front.trim() === "") {
      return fail("invalid_edit", e().frontEmpty);
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
