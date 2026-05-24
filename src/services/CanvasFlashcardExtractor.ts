import { FlashcardParser, type ParsedFlashcard } from "./FlashcardParser";
import { CanvasParser, type CanvasTextEdge, type CanvasTextNode } from "./CanvasParser";

/**
 * CanvasFlashcardExtractor - Turns a .canvas file into ParsedFlashcards.
 *
 * Two extraction paths:
 *
 * 1. **Spatial cards**: any text node that participates in a text-to-text edge
 *    is treated as a pure graph endpoint. For each such edge we emit a card
 *    whose front = from-node text (with #tags stripped into card tags), back =
 *    to-node text, hint = edge label. When the back contains ==cloze== markup
 *    and cloze is enabled, the spatial card is expanded into N cloze cards
 *    (one per highlight) so the existing cloze rendering applies.
 *
 * 2. **Standalone cards**: text nodes with no edges fall through to the regular
 *    FlashcardParser (header-paragraph / table / cloze / image-occlusion).
 *
 * Cards are sorted in a deterministic order so re-syncing is a no-op.
 */
export class CanvasFlashcardExtractor {
  private static readonly CLOZE_DETECT = /==((?:(?!==).)+)==/;

  static extract(
    rawJson: string,
    headerLevel = 2,
    fileTitle?: string,
    clozeEnabled = false,
  ): ParsedFlashcard[] {
    const canvas = CanvasParser.parseCanvas(rawJson);
    const nodeText = new Map<string, string>();
    for (const n of canvas.nodes) nodeText.set(n.id, n.text);

    const connectedNodeIds = new Set<string>();
    for (const e of canvas.edges) {
      connectedNodeIds.add(e.fromNode);
      connectedNodeIds.add(e.toNode);
    }

    const sortedEdges = [...canvas.edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const out: ParsedFlashcard[] = [];

    for (const edge of sortedEdges) {
      const cards = CanvasFlashcardExtractor.expandEdge(edge, nodeText, clozeEnabled);
      out.push(...cards);
    }

    const sortedStandaloneNodes: CanvasTextNode[] = canvas.nodes
      .filter((n) => !connectedNodeIds.has(n.id));
    for (const node of sortedStandaloneNodes) {
      const standaloneCards = FlashcardParser.parseFlashcardsFromContent(
        node.text,
        headerLevel,
        fileTitle,
        clozeEnabled,
      );
      for (const card of standaloneCards) {
        card.sourceNodeId = node.id;
        out.push(card);
      }
    }

    return out;
  }

  /**
   * Expand a single edge into one or more ParsedFlashcards.
   * - Non-cloze back  -> 1 spatial card.
   * - Cloze back + clozeEnabled -> N cloze cards.
   * - Cloze back + clozeEnabled=false -> 1 spatial card with literal back text.
   */
  private static expandEdge(
    edge: CanvasTextEdge,
    nodeText: Map<string, string>,
    clozeEnabled: boolean,
  ): ParsedFlashcard[] {
    const fromText = nodeText.get(edge.fromNode) ?? "";
    const toText = nodeText.get(edge.toNode) ?? "";

    const { cleaned: front, tags } = FlashcardParser.extractAndStripTags(fromText);
    const back = toText;
    const hint = edge.label;

    if (clozeEnabled && CanvasFlashcardExtractor.CLOZE_DETECT.test(back)) {
      const clozeMatches: { text: string; order: number }[] = [];
      const re = /==((?:(?!==).)+)==/g;
      let m: RegExpExecArray | null;
      let order = 0;
      while ((m = re.exec(back)) !== null) {
        clozeMatches.push({ text: m[1], order });
        order++;
      }
      return clozeMatches.map((cm) => ({
        front,
        back,
        notes: "",
        type: "cloze" as const,
        breadcrumb: "",
        tags: [...tags],
        clozeText: cm.text,
        clozeOrder: cm.order,
        sourceNodeId: edge.fromNode,
        edgeId: edge.id,
        hint,
      }));
    }

    return [
      {
        front,
        back,
        notes: "",
        type: "spatial",
        breadcrumb: "",
        tags,
        sourceNodeId: edge.fromNode,
        edgeId: edge.id,
        hint,
      },
    ];
  }
}
