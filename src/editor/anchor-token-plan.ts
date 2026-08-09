import { findAnchorSpans, stripAnchorTokens, type AnchorSpan } from "@decks/core";

export interface AnchorLinePlan {
    /** Nothing on the line but markers, so the whole line can be hidden. */
    markerOnly: boolean;
    /** Ranges to hide when the markers share the line with content. */
    spans: AnchorSpan[];
}

/**
 * Decide how a single editor line should hide its identity markers, or `null`
 * when it has none. The test is what the parser sees, not the marker role: the
 * same role appears both inline and on its own line, while `>` and `-` prefixes
 * must keep their block markers and stay on the inline path.
 */
export function planAnchorLine(text: string): AnchorLinePlan | null {
    const spans = findAnchorSpans(text);
    if (spans.length === 0) return null;
    if (stripAnchorTokens(text).trim() === "") {
        return { markerOnly: true, spans: [] };
    }
    return { markerOnly: false, spans };
}
