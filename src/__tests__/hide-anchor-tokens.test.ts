import { EditorState, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";

// The shared obsidian mock has no editor fields; supply a real StateField so
// the mode guard can be exercised against a genuine EditorState. The value is
// read off a global so a test can produce the real source-mode state — field
// present and false — rather than only the field-absent case.
declare global {
    // eslint-disable-next-line no-var
    var __decksLivePreview: boolean | undefined;
}

jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../__mocks__/obsidian"),
    editorLivePreviewField: jest
        .requireActual<typeof import("@codemirror/state")>("@codemirror/state")
        .StateField.define({
            create: () => globalThis.__decksLivePreview !== false,
            update: (value: boolean) => value,
        }),
}));

import { editorLivePreviewField } from "obsidian";
import { buildAnchorDecorations } from "../editor/hide-anchor-tokens";

const livePreview = editorLivePreviewField as unknown as StateField<boolean>;

type Mode = "live-preview" | "source" | "no-field";

function sourceFor(doc: string, mode: Mode = "live-preview", selectionAt = 0) {
    globalThis.__decksLivePreview = mode === "live-preview";
    const state = EditorState.create({
        doc,
        selection: { anchor: selectionAt },
        extensions: mode === "no-field" ? [] : [livePreview],
    });
    return { state, visibleRanges: [{ from: 0, to: state.doc.length }] };
}

afterEach(() => {
    globalThis.__decksLivePreview = undefined;
});

function ranges(set: DecorationSet): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = [];
    const iter = set.iter();
    while (iter.value) {
        out.push({ from: iter.from, to: iter.to });
        iter.next();
    }
    return out;
}

describe("buildAnchorDecorations", () => {
    it("hides an inline marker at the right offsets", () => {
        const doc = "Cursor is elsewhere.\nText %%dk:c:ab12%%";
        const decorations = buildAnchorDecorations(sourceFor(doc));
        // Line 2 starts at 21; the span covers the preceding space through `%%`.
        expect(ranges(decorations)).toEqual([{ from: 25, to: 39 }]);
        expect(doc.slice(25, 39)).toBe(" %%dk:c:ab12%%");
    });

    it("blanks a line that is only a marker, without collapsing it", () => {
        const doc = "Answer body.\n%%dk:h:n8wvab%%";
        const decorations = buildAnchorDecorations(sourceFor(doc));
        // One replace spanning the line's text and nothing else: no line
        // decoration, so the line keeps its height and revealing it never
        // shifts the content below.
        expect(ranges(decorations)).toEqual([{ from: 13, to: 28 }]);
        expect(doc.slice(13, 28)).toBe("%%dk:h:n8wvab%%");
    });

    it("reveals the line the cursor is on", () => {
        const doc = "Answer body.\n%%dk:h:n8wvab%%";
        const onTokenLine = sourceFor(doc, "live-preview", 20);
        expect(ranges(buildAnchorDecorations(onTokenLine))).toEqual([]);
    });

    it("produces nothing in source mode", () => {
        const doc = "Text %%dk:c:ab12%%";
        expect(ranges(buildAnchorDecorations(sourceFor(doc, "source")))).toEqual([]);
    });

    it("survives an editor without the Live Preview field", () => {
        const doc = "Text %%dk:c:ab12%%";
        expect(ranges(buildAnchorDecorations(sourceFor(doc, "no-field")))).toEqual([]);
    });

    it("hides every marker on a multi-marker line", () => {
        const doc = "x\na %%dk:c:aa%% b %%dk:c:bb%%";
        expect(ranges(buildAnchorDecorations(sourceFor(doc)))).toHaveLength(2);
    });

    it("leaves an untokenized document alone", () => {
        expect(ranges(buildAnchorDecorations(sourceFor("nothing here\nat all")))).toEqual(
            [],
        );
    });
});
