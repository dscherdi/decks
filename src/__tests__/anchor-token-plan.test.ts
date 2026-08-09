import { planAnchorLine } from "../editor/anchor-token-plan";

describe("planAnchorLine", () => {
    it("ignores lines without a marker", () => {
        expect(planAnchorLine("plain text")).toBeNull();
        expect(planAnchorLine("")).toBeNull();
        expect(planAnchorLine("## Immanence")).toBeNull();
    });

    // demo_vault/theology.md:37 and demo_vault/Decks Exam test.md:11
    it("treats a marker-only line as whole-line", () => {
        expect(planAnchorLine("%%dk:h:n8wvab%%")).toEqual({
            markerOnly: true,
            spans: [],
        });
        expect(planAnchorLine("%%dk:q:apxd7p%%")?.markerOnly).toBe(true);
        expect(planAnchorLine("   %%dk:h:x1%%  ")?.markerOnly).toBe(true);
    });

    // demo_vault/theology.md:28 — the same role as above, but inline.
    it("hides spans when the marker shares the line with prose", () => {
        const plan = planAnchorLine(
            "Often contrasted with transcendence, which emphasizes God's existence beyond the physical universe. %%dk:h:8hyz1h%%",
        );
        expect(plan?.markerOnly).toBe(false);
        expect(plan?.spans.map((s) => s.id)).toEqual(["8hyz1h"]);
    });

    // demo_vault/theology.md:59
    it("hides a cloze marker without touching the list bullet", () => {
        const plan = planAnchorLine(
            "- General revelation refers to ==knowledge of God== available to all people through ==nature and reason==;  %%dk:c:jzwdyb%%",
        );
        expect(plan?.markerOnly).toBe(false);
        expect(plan?.spans).toHaveLength(1);
    });

    // demo_vault/Decks — Demo exam.md:60
    it("hides a table marker without collapsing the row", () => {
        const plan = planAnchorLine(
            "| Symbol for gold? %%dk:t:mz7nog%% | Au   | From Latin aurum.  |",
        );
        expect(plan?.markerOnly).toBe(false);
        expect(plan?.spans).toHaveLength(1);
    });

    it("keeps block markers alive by taking the inline path", () => {
        expect(planAnchorLine("> %%dk:h:x1%%")?.markerOnly).toBe(false);
        expect(planAnchorLine("- %%dk:o:ab12%%")?.markerOnly).toBe(false);
        expect(planAnchorLine("1. foo %%dk:o:ab12%%")?.markerOnly).toBe(false);
    });
});
