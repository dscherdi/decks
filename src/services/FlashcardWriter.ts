import { type App, TFile } from "obsidian";
import type { Flashcard } from "../database/types";
import { findFlashcardSegment } from "../utils/source-navigator";
import {
  escapeTableCell,
  splitTableLine,
  unescapeTableCell,
} from "../utils/markdown-table";

const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;
const TABLE_ROW_REGEX = /^\|.*\|$/;
const NUMBERED_LIST_REGEX = /^(\s*)(\d+\.\s+)(.+)$/;

export type FlashcardEdits =
  | { type: "header-paragraph"; front: string; back: string }
  | { type: "table"; front: string; back: string; notes: string }
  | { type: "cloze"; front: string; sentence: string }
  | { type: "image-occlusion"; listItem: string };

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

    try {
      const outcome: { value: InternalApply | null } = { value: null };
      await this.app.vault.process(file, (content) => {
        const result = applyEdit(content, card, edits);
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

  const replacement = buildReplacement(lines, segment, card, edits);
  if (replacement.ok === false) return replacement;

  const newLines = [
    ...lines.slice(0, segment.start),
    ...replacement.lines,
    ...lines.slice(segment.end),
  ];
  return { ok: true, newContent: newLines.join("\n") };
}

function checkStale(
  card: Flashcard,
  segLines: string[],
  segmentStart: number,
  allLines: string[],
): InternalApply | null {
  if (card.type === "header-paragraph") {
    const body = extractHeaderBlockBody(segLines).trim();
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
    const back = unescapeTableCell((cells[2] ?? "").trim());
    const notes = unescapeTableCell((cells[3] ?? "").trim());
    if (back !== card.back || notes !== (card.notes ?? "")) {
      return fail("file_changed", "Table row content has changed.");
    }
    return null;
  }

  if (card.type === "cloze") {
    const anchor = segLines[0];
    if (HEADER_REGEX.test(anchor)) {
      const body = extractHeaderBlockBody(segLines).trim();
      if (body !== card.back.trim()) {
        return fail("file_changed", "Cloze content has changed.");
      }
    } else {
      const cells = splitTableRow(anchor);
      if (!cells) return fail("file_changed", "Cloze host row no longer parseable");
      const back = unescapeTableCell((cells[2] ?? "").trim());
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
    const currentItemText = match[3];
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

function buildReplacement(
  allLines: string[],
  segment: { start: number; end: number },
  card: Flashcard,
  edits: FlashcardEdits,
): { ok: true; lines: string[] } | { ok: false; failure: EditFailure } {
  const segLines = allLines.slice(segment.start, segment.end);

  if (edits.type === "header-paragraph") {
    return buildHeaderParagraph(segLines, edits.front, edits.back);
  }
  if (edits.type === "table") {
    return buildTableRow(segLines[0], edits);
  }
  if (edits.type === "cloze") {
    if (HEADER_REGEX.test(segLines[0])) {
      // Cloze hosted in a header-paragraph block: edit both the header
      // (front) and the body (sentence) — same as a header-paragraph edit.
      return buildHeaderParagraph(segLines, edits.front, edits.sentence);
    }
    const cells = splitTableRow(segLines[0]);
    if (!cells) {
      return fail("invalid_edit", "Cloze host row is not a valid table row");
    }
    // Cloze hosted in a table row: edit the front cell and the back cell.
    return buildTableRow(segLines[0], {
      front: edits.front,
      back: edits.sentence,
      notes: unescapeTableCell((cells[3] ?? "").trim()),
    });
  }
  if (edits.type === "image-occlusion") {
    return buildImageOcclusionItem(segLines[0], edits.listItem);
  }
  return fail("invalid_edit", "Unsupported edit type");
}

function buildHeaderParagraph(
  segLines: string[],
  newFront: string,
  newBack: string,
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
  const result = [newHeader, ...bodyLines];
  if (endsWithBlank && result[result.length - 1].trim() !== "") {
    result.push("");
  }
  return { ok: true, lines: result };
}

function buildTableRow(
  rowLine: string,
  edits: { front: string; back: string; notes: string },
): { ok: true; lines: string[] } | { ok: false; failure: EditFailure } {
  const cells = splitTableRow(rowLine);
  if (!cells) return fail("invalid_edit", "Not a valid table row");
  // `cells` includes a leading and trailing empty entry from the surrounding
  // pipes; data columns are cells[1..cells.length-2]. A 2-column table has
  // length 4, a 3-column has length 5.
  const dataCount = Math.max(0, cells.length - 2);
  if (dataCount < 3 && edits.notes.trim() !== "") {
    return fail(
      "invalid_edit",
      "Cannot set Notes — this table has only Front and Back columns",
    );
  }

  // Escape pipes and newlines so the row stays single-line and structurally
  // valid. The parser un-escapes on read so the round-trip is clean.
  const next = [...cells];
  next[1] = ` ${escapeTableCell(edits.front.trim())} `;
  next[2] = ` ${escapeTableCell(edits.back.trim())} `;
  if (dataCount >= 3) {
    next[3] = ` ${escapeTableCell(edits.notes.trim())} `;
  }
  return { ok: true, lines: [next.join("|")] };
}

function buildImageOcclusionItem(
  itemLine: string,
  newItem: string,
): { ok: true; lines: string[] } | { ok: false; failure: EditFailure } {
  const m = NUMBERED_LIST_REGEX.exec(itemLine);
  if (!m) return fail("invalid_edit", "Selected line is not a numbered list item");
  const indent = m[1];
  const prefix = m[2];
  // A numbered list item must live on one line. Collapse newlines to spaces
  // so the structure isn't broken; the user's edit becomes a single-line item.
  const single = newItem.trim().replace(/\n+/g, " ");
  return { ok: true, lines: [`${indent}${prefix}${single}`] };
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
  if (edits.type === "image-occlusion") {
    if (edits.listItem.trim() === "") {
      return fail("invalid_edit", "List item cannot be empty");
    }
  }
  return null;
}

function fail(code: EditFailureCode, message: string): { ok: false; failure: EditFailure } {
  return { ok: false, failure: { code, message } };
}
