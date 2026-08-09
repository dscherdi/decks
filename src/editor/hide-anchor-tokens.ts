import { editorLivePreviewField } from "obsidian";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
    Decoration,
    ViewPlugin,
    type DecorationSet,
    type ViewUpdate,
} from "@codemirror/view";
import { planAnchorLine } from "./anchor-token-plan";

const HIDDEN_TOKEN = Decoration.replace({});

interface LineSpan {
    from: number;
    to: number;
}

/**
 * Minimal shape of what the builder reads from a view, so it stays free of the
 * DOM and can be driven from a bare EditorState in tests.
 */
export interface AnchorDecorationSource {
    state: EditorState;
    visibleRanges: readonly { from: number; to: number }[];
}

/**
 * Line numbers the selection touches, as spans so that select-all costs one
 * entry per cursor rather than one per line.
 */
function selectionLineSpans(state: EditorState): LineSpan[] {
    return state.selection.ranges.map((range) => ({
        from: state.doc.lineAt(range.from).number,
        to: state.doc.lineAt(range.to).number,
    }));
}

function touchesLine(spans: readonly LineSpan[], lineNumber: number): boolean {
    return spans.some((span) => span.from <= lineNumber && span.to >= lineNumber);
}

function selectionKey(spans: readonly LineSpan[]): string {
    return spans.map((span) => `${span.from}:${span.to}`).join(",");
}

function isLivePreview(state: EditorState): boolean {
    // Two-arg form: returns undefined instead of throwing where the field is
    // absent, e.g. non-markdown and embedded editors.
    return state.field(editorLivePreviewField, false) === true;
}

export function buildAnchorDecorations(view: AnchorDecorationSource): DecorationSet {
    const { state } = view;
    if (!isLivePreview(state)) return Decoration.none;

    const revealed = selectionLineSpans(state);
    const ranges: Range<Decoration>[] = [];

    for (const visible of view.visibleRanges) {
        let pos = visible.from;
        while (pos <= visible.to) {
            const line = state.doc.lineAt(pos);
            pos = line.to + 1;

            const plan = planAnchorLine(line.text);
            if (!plan || touchesLine(revealed, line.number)) continue;

            if (plan.markerOnly) {
                // Blank the line rather than collapsing it. A collapsed line
                // would spring back open as the caret arrives, shifting
                // everything below it on every pass.
                ranges.push(HIDDEN_TOKEN.range(line.from, line.to));
                continue;
            }
            for (const span of plan.spans) {
                ranges.push(
                    HIDDEN_TOKEN.range(line.from + span.start, line.from + span.end),
                );
            }
        }
    }

    return Decoration.set(ranges, true);
}

/**
 * Hides card identity markers while editing in Live Preview, revealing the line
 * the cursor is on. Decorations only — the document is never modified.
 */
export const decksHideAnchorTokens: Extension = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        private key: string;

        constructor(view: AnchorDecorationSource) {
            this.decorations = buildAnchorDecorations(view);
            this.key = selectionKey(selectionLineSpans(view.state));
        }

        update(update: ViewUpdate) {
            const key = selectionKey(selectionLineSpans(update.state));
            const modeChanged =
                isLivePreview(update.startState) !== isLivePreview(update.state);
            if (
                update.docChanged ||
                update.viewportChanged ||
                modeChanged ||
                key !== this.key
            ) {
                this.decorations = buildAnchorDecorations(update.view);
                this.key = key;
            }
        }
    },
    { decorations: (plugin) => plugin.decorations },
);
