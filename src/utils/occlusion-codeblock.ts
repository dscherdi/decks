import { OcclusionV2Parser } from "@decks/core";

const FENCE_OPEN = /^(`{3,}|~{3,})\s*decks-occlusion\s*$/;
const FENCE_ANY = /^(`{3,}|~{3,})/;

export interface BlockRange {
  start: number;
  end: number;
}

export interface LocateOptions {
  /** Opening fence line from getSectionInfo, if known. */
  hintStart?: number;
  /** Closing fence line from getSectionInfo, if known. */
  hintEnd?: number;
  /** Disambiguate multiple blocks by matching the block's image reference. */
  matchImage?: string;
}

/**
 * Locate a `decks-occlusion` codeblock in file content. Prefers the hinted line
 * range (from the rendered block) but re-validates it, since the file may have
 * changed since render. Falls back to matching by image, then to the only block
 * in the file. Returns null when no unambiguous block can be found.
 */
export function locateOcclusionBlock(
  content: string,
  opts: LocateOptions = {},
): BlockRange | null {
  const lines = content.split("\n");
  const { hintStart, hintEnd, matchImage } = opts;

  const closingFrom = (open: number): number => {
    for (let j = open + 1; j < lines.length; j++) {
      if (FENCE_ANY.test(lines[j].trim())) return j;
    }
    return -1;
  };

  if (
    hintStart !== undefined &&
    hintStart >= 0 &&
    hintStart < lines.length &&
    FENCE_OPEN.test(lines[hintStart].trim())
  ) {
    const end =
      hintEnd !== undefined &&
      hintEnd < lines.length &&
      FENCE_ANY.test(lines[hintEnd].trim()) &&
      hintEnd > hintStart
        ? hintEnd
        : closingFrom(hintStart);
    if (end !== -1) return { start: hintStart, end };
  }

  // Collect every occlusion block.
  const blocks: BlockRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_OPEN.test(lines[i].trim())) {
      const end = closingFrom(i);
      if (end !== -1) {
        blocks.push({ start: i, end });
        i = end;
      }
    }
  }

  if (blocks.length === 1) return blocks[0];
  if (blocks.length === 0) return null;

  // Multiple blocks: disambiguate by image reference.
  if (matchImage) {
    const matches = blocks.filter((b) => {
      const body = lines.slice(b.start + 1, b.end).join("\n");
      const parsed = OcclusionV2Parser.parseOcclusionBlock(body);
      return parsed.ok && parsed.doc.image === matchImage;
    });
    if (matches.length === 1) return matches[0];
  }
  return null;
}

/**
 * Replace a located `decks-occlusion` block with a new fenced block. Returns the
 * updated content, or null when the block can't be located.
 */
export function replaceOcclusionBlock(
  content: string,
  fencedBlock: string,
  opts: LocateOptions = {},
): string | null {
  const range = locateOcclusionBlock(content, opts);
  if (!range) return null;
  const lines = content.split("\n");
  const before = lines.slice(0, range.start);
  const after = lines.slice(range.end + 1);
  return [...before, ...fencedBlock.split("\n"), ...after].join("\n");
}
