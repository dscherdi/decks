import type { Flashcard } from "../database/types";
import { FlashcardParser } from "../services/FlashcardParser";
import { splitTableLine, unescapeTableCell } from "@decks/core";

const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;
const TABLE_ROW_REGEX = /^\|.*\|$/;
const BREADCRUMB_SEPARATOR = " > ";
const IMAGE_EMBED_REGEX =
  /^!\[\[[^\]]+\.(png|jpe?g|gif|svg|bmp|webp|avif|heic|heif|tiff?)(\|[^\]]*)?\]\]$|^!\[[^\]]*\]\([^)]+\.(png|jpe?g|gif|svg|bmp|webp|avif|heic|heif|tiff?)(\s+[^)]+)?\)$/i;
const NUMBERED_LIST_REGEX = /^\d+\.\s+(.+)$/;

interface HeaderInfo {
  level: number;
  text: string;
}

function matchHeader(line: string): HeaderInfo | null {
  const m = line.match(HEADER_REGEX);
  if (!m) return null;
  return {
    level: m[1].length,
    text: FlashcardParser.extractAndStripTags(m[2]).cleaned,
  };
}

function matchTableRowFront(line: string, target: string): boolean {
  const trimmed = line.trim();
  if (!TABLE_ROW_REGEX.test(trimmed)) return false;
  // Respect escaped pipes and un-escape so we compare against the same
  // un-escaped value the parser stored in card.front.
  const cells = splitTableLine(trimmed.slice(1, -1)).map(
    (c) => unescapeTableCell(c.trim()),
  );
  return cells.length >= 1 && cells[0] === target;
}

/**
 * Resolve a breadcrumb to a line range [start, end). Empty breadcrumb
 * returns the whole file. Returns null if any segment cannot be found —
 * the caller can fall back to a whole-file search.
 *
 * The section closes at the next header at a level less than or equal to
 * the deepest matched segment's level, or EOF.
 */
export function findBreadcrumbSection(
  lines: string[],
  breadcrumb: string,
): { start: number; end: number } | null {
  const trimmed = breadcrumb.trim();
  if (trimmed === "") {
    return { start: 0, end: lines.length };
  }

  const segments = trimmed
    .split(BREADCRUMB_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) {
    return { start: 0, end: lines.length };
  }

  let cursor = 0;
  let deepestLevel = 0;

  for (const segment of segments) {
    let found = false;
    for (let i = cursor; i < lines.length; i++) {
      const h = matchHeader(lines[i]);
      if (h && h.text === segment) {
        cursor = i + 1;
        deepestLevel = h.level;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }

  let end = lines.length;
  for (let i = cursor; i < lines.length; i++) {
    const h = matchHeader(lines[i]);
    if (h && h.level <= deepestLevel) {
      end = i;
      break;
    }
  }

  return { start: cursor, end };
}

/**
 * Find the source line for the flashcard within a line range. Uses a
 * front-only match — header text (tag-stripped) for header-paragraph /
 * cloze, table-row cells[0] for table / cloze. Returns null if no match.
 */
export function findFlashcardLineInRange(
  lines: string[],
  start: number,
  end: number,
  flashcard: Pick<Flashcard, "type" | "front">,
): number | null {
  const front = flashcard.front.trim();
  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(lines.length, end);

  if (
    flashcard.type === "header-paragraph" ||
    flashcard.type === "cloze"
  ) {
    for (let i = clampedStart; i < clampedEnd; i++) {
      const h = matchHeader(lines[i]);
      if (h && h.text === front) return i;
    }
  }

  if (flashcard.type === "table" || flashcard.type === "cloze") {
    for (let i = clampedStart; i < clampedEnd; i++) {
      if (matchTableRowFront(lines[i], front)) return i;
    }
  }

  return null;
}

/**
 * Find the source line for a flashcard. First tries to narrow the search
 * to the section described by `flashcard.breadcrumb`; if that fails (e.g.
 * the file has been edited and the breadcrumb path no longer resolves),
 * falls back to a whole-file front match.
 *
 * Image-occlusion cards anchor on the parent header named by the last
 * breadcrumb segment — the card itself doesn't appear as a header or
 * table row, so the parent header is the best we can do.
 */
export function findFlashcardLine(
  lines: string[],
  flashcard: Pick<Flashcard, "type" | "front" | "breadcrumb">,
): number | null {
  if (flashcard.type === "image-occlusion") {
    return findImageOcclusionLine(lines, flashcard.breadcrumb);
  }

  const section = findBreadcrumbSection(lines, flashcard.breadcrumb);
  if (section) {
    const hit = findFlashcardLineInRange(
      lines,
      section.start,
      section.end,
      flashcard,
    );
    if (hit !== null) return hit;
  }

  return findFlashcardLineInRange(lines, 0, lines.length, flashcard);
}

/**
 * Find the markdown line range [start, end) that a flashcard occupies in
 * the file. The writer replaces this range with a fresh segment built from
 * user edits.
 *
 * - header-paragraph: full block, header line to (but not including) the
 *   next header at level <= host level (or EOF).
 * - table: the single table-row line.
 * - cloze: same as the host block (header if the anchor is a header line,
 *   table row otherwise).
 * - image-occlusion: the single numbered-list line at `clozeOrder` under
 *   the parent header.
 */
export function findFlashcardSegment(
  lines: string[],
  flashcard: Pick<Flashcard, "type" | "front" | "breadcrumb" | "clozeOrder">,
): { start: number; end: number } | null {
  if (flashcard.type === "image-occlusion") {
    return findImageOcclusionItemSegment(
      lines,
      flashcard.breadcrumb,
      flashcard.front,
      flashcard.clozeOrder ?? 0,
    );
  }

  const anchor = findFlashcardLine(lines, flashcard);
  if (anchor === null) return null;

  const headerHit = matchHeader(lines[anchor]);
  if (headerHit) {
    const end = findHeaderBlockEnd(lines, anchor, headerHit.level);
    return { start: anchor, end };
  }

  return { start: anchor, end: anchor + 1 };
}

function findHeaderBlockEnd(
  lines: string[],
  headerIndex: number,
  headerLevel: number,
): number {
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const h = matchHeader(lines[i]);
    if (h && h.level <= headerLevel) return i;
  }
  return lines.length;
}

function findImageOcclusionItemSegment(
  lines: string[],
  breadcrumb: string,
  imageEmbed: string,
  clozeOrder: number,
): { start: number; end: number } | null {
  const parentHeaderIndex = findImageOcclusionLine(lines, breadcrumb);
  if (parentHeaderIndex === null) return null;

  const headerHit = matchHeader(lines[parentHeaderIndex]);
  if (!headerHit) return null;
  const blockEnd = findHeaderBlockEnd(
    lines,
    parentHeaderIndex,
    headerHit.level,
  );

  const targetEmbed = imageEmbed.trim();
  let imageLineIndex = -1;
  for (let i = parentHeaderIndex + 1; i < blockEnd; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === targetEmbed || IMAGE_EMBED_REGEX.test(trimmed)) {
      imageLineIndex = i;
      break;
    }
  }
  if (imageLineIndex === -1) return null;

  let itemIndex = 0;
  for (let i = imageLineIndex + 1; i < blockEnd; i++) {
    const trimmed = lines[i].trim();
    if (NUMBERED_LIST_REGEX.test(trimmed)) {
      if (itemIndex === clozeOrder) {
        return { start: i, end: i + 1 };
      }
      itemIndex++;
    }
  }
  return null;
}

function findImageOcclusionLine(
  lines: string[],
  breadcrumb: string,
): number | null {
  const segments = breadcrumb
    .trim()
    .split(BREADCRUMB_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) return null;

  const target = segments[segments.length - 1];
  const parentBreadcrumb = segments.slice(0, -1).join(BREADCRUMB_SEPARATOR);
  const section =
    findBreadcrumbSection(lines, parentBreadcrumb) ?? {
      start: 0,
      end: lines.length,
    };

  for (let i = section.start; i < section.end; i++) {
    const h = matchHeader(lines[i]);
    if (h && h.text === target) return i;
  }

  for (let i = 0; i < lines.length; i++) {
    const h = matchHeader(lines[i]);
    if (h && h.text === target) return i;
  }

  return null;
}
