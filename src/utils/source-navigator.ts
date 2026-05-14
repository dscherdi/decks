import type { Flashcard } from "../database/types";
import { FlashcardParser } from "../services/FlashcardParser";

const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;
const TABLE_ROW_REGEX = /^\|.*\|$/;
const BREADCRUMB_SEPARATOR = " > ";

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
  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
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
