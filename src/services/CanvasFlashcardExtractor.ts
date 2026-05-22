import { FlashcardParser, type ParsedFlashcard } from "./FlashcardParser";
import { CanvasParser } from "./CanvasParser";

/**
 * CanvasFlashcardExtractor - Glue between CanvasParser and FlashcardParser.
 *
 * For each text node in a canvas, runs the markdown FlashcardParser on the
 * node's content and stamps the resulting cards with `sourceNodeId = node.id`.
 * Returns a flat list of ParsedFlashcard across all nodes. The downstream
 * sync pipeline treats this identically to markdown parse output.
 */
export class CanvasFlashcardExtractor {
  /**
   * Extract flashcards from a raw .canvas JSON string.
   *
   * @param rawJson  Raw canvas JSON file content.
   * @param headerLevel  Header level for header-paragraph cards (1-6, or 0 for title mode).
   * @param fileTitle  Used only by FlashcardParser when headerLevel = 0.
   * @param clozeEnabled  Whether to expand ==highlight== into cloze cards.
   */
  static extract(
    rawJson: string,
    headerLevel = 2,
    fileTitle?: string,
    clozeEnabled = false,
  ): ParsedFlashcard[] {
    const canvas = CanvasParser.parseCanvas(rawJson);
    const out: ParsedFlashcard[] = [];
    for (const node of canvas.nodes) {
      const cards = FlashcardParser.parseFlashcardsFromContent(
        node.text,
        headerLevel,
        fileTitle,
        clozeEnabled,
      );
      for (const card of cards) {
        card.sourceNodeId = node.id;
        out.push(card);
      }
    }
    return out;
  }
}
