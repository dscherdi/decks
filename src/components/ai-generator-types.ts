import type { GeneratedCard } from "@decks/core";
import type { ChapterNode, PdfDoc } from "../utils/pdf";

/** A generated card plus the batch-review UI's keep/saved state. */
export interface GenRow {
  id: string;
  card: GeneratedCard;
  keep: boolean;
  saved: boolean;
}

/** An attached PDF and its chapter selection. The parse path (OCR vs text) is
 * derived from the active provider at resolve time, not stored per attachment. */
export interface PdfAttachment {
  /** Matches the composer pill's ContextItem id (`pdf:<hash>`). */
  contextId: string;
  label: string;
  doc: PdfDoc;
  hash: string;
  chapters: ChapterNode[];
  selectedIds: Set<string>;
}

/** A tab entry for the chapter panel — one per attached PDF. */
export interface PdfTab {
  id: string;
  label: string;
}

/** A vault note reference offered in the composer's @-mention autocomplete. */
export interface MentionItem {
  path: string;
  label: string;
}
