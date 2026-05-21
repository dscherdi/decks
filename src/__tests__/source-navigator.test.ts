import {
  findBreadcrumbSection,
  findFlashcardLine,
  findFlashcardLineInRange,
  findFlashcardSegment,
} from "../utils/source-navigator";

const split = (s: string) => s.split("\n");

describe("source-navigator", () => {
  describe("findBreadcrumbSection", () => {
    it("returns the whole file for an empty breadcrumb", () => {
      const lines = split("# A\nbody\n## B\nmore");
      expect(findBreadcrumbSection(lines, "")).toEqual({
        start: 0,
        end: lines.length,
      });
    });

    it("narrows to a single top-level section", () => {
      const lines = split(
        "# Chapter 1\nintro\n## A\ncontent\n# Chapter 2\nother",
      );
      const range = findBreadcrumbSection(lines, "Chapter 1");
      expect(range).toEqual({ start: 1, end: 4 });
    });

    it("narrows to a nested section via multi-segment breadcrumb", () => {
      const lines = split(
        "# Chapter 1\nintro\n## Section A\ncontent A\n## Section B\ncontent B\n# Chapter 2\nelse",
      );
      const range = findBreadcrumbSection(lines, "Chapter 1 > Section A");
      expect(range).toEqual({ start: 3, end: 4 });
    });

    it("section closes at next header of same level, not just deeper", () => {
      const lines = split(
        "# Top\nintro\n## Sub\nsub content\n## Sibling\nsibling content\n# Next\n",
      );
      const range = findBreadcrumbSection(lines, "Top > Sub");
      expect(range).toEqual({ start: 3, end: 4 });
    });

    it("matches tag-stripped header text", () => {
      const lines = split(
        "# Chapter 1 #book\nintro\n## Section A #review #important\nA content\n## Section B\nB content",
      );
      const range = findBreadcrumbSection(lines, "Chapter 1 > Section A");
      expect(range).toEqual({ start: 3, end: 4 });
    });

    it("disambiguates same-named segments by walking parent chain", () => {
      const lines = split(
        "# Foo\nintro\n## Bar\nfoo-bar\n# Baz\nintro2\n## Bar\nbaz-bar",
      );
      const fooBar = findBreadcrumbSection(lines, "Foo > Bar");
      const bazBar = findBreadcrumbSection(lines, "Baz > Bar");
      expect(fooBar).toEqual({ start: 3, end: 4 });
      expect(bazBar).toEqual({ start: 7, end: lines.length });
    });

    it("returns null when a segment can't be found", () => {
      const lines = split("# A\n## B\n# C\n");
      expect(findBreadcrumbSection(lines, "A > Missing")).toBeNull();
      expect(findBreadcrumbSection(lines, "Nope")).toBeNull();
    });

    it("trims breadcrumb segments before comparing", () => {
      const lines = split("# Chapter 1\nintro\n## Section A\ncontent");
      const range = findBreadcrumbSection(
        lines,
        "  Chapter 1   >    Section A  ",
      );
      expect(range).toEqual({ start: 3, end: lines.length });
    });

    it("handles breadcrumb made of only whitespace as empty", () => {
      const lines = split("# A\nbody");
      expect(findBreadcrumbSection(lines, "   ")).toEqual({
        start: 0,
        end: lines.length,
      });
    });
  });

  describe("findFlashcardLineInRange", () => {
    it("matches a plain header-paragraph card", () => {
      const lines = split(
        "# Chapter 1\nintro\n## What is X?\nthe answer\n## Other\n",
      );
      const hit = findFlashcardLineInRange(lines, 0, lines.length, {
        type: "header-paragraph",
        front: "What is X?",
      });
      expect(hit).toBe(2);
    });

    it("matches a tagged header-paragraph card", () => {
      const lines = split("## Q? #review #important\nanswer");
      const hit = findFlashcardLineInRange(lines, 0, lines.length, {
        type: "header-paragraph",
        front: "Q?",
      });
      expect(hit).toBe(0);
    });

    it("matches a 2-column table row by cells[0]", () => {
      const lines = split(
        "## Section\n\n| Q | A |\n| --- | --- |\n| What is 2+2? | 4 |\n| Capital? | Paris |",
      );
      const hit = findFlashcardLineInRange(lines, 0, lines.length, {
        type: "table",
        front: "Capital?",
      });
      expect(hit).toBe(5);
    });

    it("matches a 3-column table row (with notes column)", () => {
      const lines = split(
        "## Section\n\n| Q | A | Notes |\n| --- | --- | --- |\n| Two plus two? | 4 | basic |\n",
      );
      const hit = findFlashcardLineInRange(lines, 0, lines.length, {
        type: "table",
        front: "Two plus two?",
      });
      expect(hit).toBe(4);
    });

    it("ignores lines outside the given range", () => {
      const lines = split(
        "## Section A\n| Q | A |\n| --- | --- |\n| Question | Answer |\n## Section B\n| Q | A |\n| --- | --- |\n| Question | Different |",
      );
      const hitInA = findFlashcardLineInRange(lines, 0, 4, {
        type: "table",
        front: "Question",
      });
      expect(hitInA).toBe(3);
      const hitInB = findFlashcardLineInRange(lines, 4, lines.length, {
        type: "table",
        front: "Question",
      });
      expect(hitInB).toBe(7);
    });

    it("returns null when no match is found", () => {
      const lines = split("## Heading\nbody\n");
      const hit = findFlashcardLineInRange(lines, 0, lines.length, {
        type: "header-paragraph",
        front: "Nothing matches",
      });
      expect(hit).toBeNull();
    });

    it("cloze card finds a header match first", () => {
      const lines = split("## Cloze Q\nThe ==answer==");
      const hit = findFlashcardLineInRange(lines, 0, lines.length, {
        type: "cloze",
        front: "Cloze Q",
      });
      expect(hit).toBe(0);
    });

    it("cloze card falls through to table row when no header matches", () => {
      const lines = split(
        "## Section\n| Q | A |\n| --- | --- |\n| Cell Q | with ==highlight== |",
      );
      const hit = findFlashcardLineInRange(lines, 0, lines.length, {
        type: "cloze",
        front: "Cell Q",
      });
      expect(hit).toBe(3);
    });

    it("clamps out-of-bounds ranges defensively", () => {
      const lines = split("## A\nbody");
      const hit = findFlashcardLineInRange(lines, -5, 999, {
        type: "header-paragraph",
        front: "A",
      });
      expect(hit).toBe(0);
    });
  });

  describe("findFlashcardLine", () => {
    it("resolves via breadcrumb when valid (happy path)", () => {
      const lines = split(
        "# Chapter 1\nintro\n## Section A\n| Q | A |\n| --- | --- |\n| Foo | bar |\n## Section B\n| Q | A |\n| --- | --- |\n| Foo | baz |",
      );
      const hit = findFlashcardLine(lines, {
        type: "table",
        front: "Foo",
        breadcrumb: "Chapter 1 > Section B",
      });
      expect(hit).toBe(9);
    });

    it("falls back to whole-file search if breadcrumb walk fails", () => {
      const lines = split(
        "# Chapter 1\nintro\n## Real Section\n| Q | A |\n| --- | --- |\n| Only Q | Only A |",
      );
      const hit = findFlashcardLine(lines, {
        type: "table",
        front: "Only Q",
        breadcrumb: "Missing Chapter > Missing Section",
      });
      expect(hit).toBe(5);
    });

    it("empty breadcrumb searches whole file", () => {
      const lines = split("## First\nbody\n## Second\nbody2");
      const hit = findFlashcardLine(lines, {
        type: "header-paragraph",
        front: "Second",
        breadcrumb: "",
      });
      expect(hit).toBe(2);
    });

    it("image-occlusion lands on the last breadcrumb segment's header", () => {
      const lines = split(
        "# Chapter 1\nintro\n## Section A\nbody A\n## Section B #tag\nbody B",
      );
      const hit = findFlashcardLine(lines, {
        type: "image-occlusion",
        front: "ignored.png",
        breadcrumb: "Chapter 1 > Section B",
      });
      expect(hit).toBe(4);
    });

    it("image-occlusion returns null when target header doesn't exist", () => {
      const lines = split("# Chapter 1\nintro\n");
      const hit = findFlashcardLine(lines, {
        type: "image-occlusion",
        front: "ignored.png",
        breadcrumb: "Chapter 1 > Nonexistent",
      });
      expect(hit).toBeNull();
    });

    it("disambiguates duplicate first-cell text across tables via breadcrumb", () => {
      const lines = split(
        "# Top\n## A\n| Q | A |\n| --- | --- |\n| Same Q | answer A |\n## B\n| Q | A |\n| --- | --- |\n| Same Q | answer B |",
      );
      const hitA = findFlashcardLine(lines, {
        type: "table",
        front: "Same Q",
        breadcrumb: "Top > A",
      });
      const hitB = findFlashcardLine(lines, {
        type: "table",
        front: "Same Q",
        breadcrumb: "Top > B",
      });
      expect(hitA).toBe(4);
      expect(hitB).toBe(8);
    });

    it("cloze from table row inside a breadcrumb section", () => {
      const lines = split(
        "# Top\n## Section\n| Q | A |\n| --- | --- |\n| Cell Q | with ==highlight== |",
      );
      const hit = findFlashcardLine(lines, {
        type: "cloze",
        front: "Cell Q",
        breadcrumb: "Top > Section",
      });
      expect(hit).toBe(4);
    });

    it("returns null when the source line has been deleted", () => {
      const lines = split("# Top\n## Section\nthe table is gone");
      const hit = findFlashcardLine(lines, {
        type: "table",
        front: "Removed Q",
        breadcrumb: "Top > Section",
      });
      expect(hit).toBeNull();
    });

    it("file-root header card (empty breadcrumb)", () => {
      const lines = split("## Question?\nanswer body");
      const hit = findFlashcardLine(lines, {
        type: "header-paragraph",
        front: "Question?",
        breadcrumb: "",
      });
      expect(hit).toBe(0);
    });
  });

  describe("findFlashcardSegment", () => {
    it("header-paragraph: returns block ending at next equal-level header", () => {
      const lines = split(
        "# Top\n## What?\nthe answer\nmore body\n## Next\nbody",
      );
      const seg = findFlashcardSegment(lines, {
        type: "header-paragraph",
        front: "What?",
        breadcrumb: "Top",
        clozeOrder: null,
      });
      expect(seg).toEqual({ start: 1, end: 4 });
    });

    it("header-paragraph: block extends to EOF when no closing header", () => {
      const lines = split("## Q\nbody1\nbody2");
      const seg = findFlashcardSegment(lines, {
        type: "header-paragraph",
        front: "Q",
        breadcrumb: "",
        clozeOrder: null,
      });
      expect(seg).toEqual({ start: 0, end: 3 });
    });

    it("table: returns the single table-row line", () => {
      const lines = split(
        "## Vocab\n| Front | Back |\n|---|---|\n| Q1 | A1 |\n| Q2 | A2 |",
      );
      const seg = findFlashcardSegment(lines, {
        type: "table",
        front: "Q2",
        breadcrumb: "Vocab",
        clozeOrder: null,
      });
      expect(seg).toEqual({ start: 4, end: 5 });
    });

    it("cloze: header host returns the full block", () => {
      const lines = split(
        "## Pacific?\nThe ==Pacific== is the largest ocean.\n## Next\nx",
      );
      const seg = findFlashcardSegment(lines, {
        type: "cloze",
        front: "Pacific?",
        breadcrumb: "",
        clozeOrder: 0,
      });
      expect(seg).toEqual({ start: 0, end: 2 });
    });

    it("cloze: table host returns single row", () => {
      const lines = split(
        "## Vocab\n| Front | Back |\n|---|---|\n| Q1 | ==A1== |\n",
      );
      const seg = findFlashcardSegment(lines, {
        type: "cloze",
        front: "Q1",
        breadcrumb: "Vocab",
        clozeOrder: 0,
      });
      expect(seg).toEqual({ start: 3, end: 4 });
    });

    it("image-occlusion: returns the Nth numbered-list item", () => {
      const lines = split(
        "## Diagram\n![[brain.png]]\n1. ==Hippocampus==\n2. ==Amygdala==\n3. ==Thalamus==",
      );
      const seg = findFlashcardSegment(lines, {
        type: "image-occlusion",
        front: "![[brain.png]]",
        breadcrumb: "Diagram",
        clozeOrder: 1,
      });
      expect(seg).toEqual({ start: 3, end: 4 });
    });

    it("returns null when the card cannot be located", () => {
      const lines = split("## A\nbody");
      const seg = findFlashcardSegment(lines, {
        type: "header-paragraph",
        front: "Missing",
        breadcrumb: "",
        clozeOrder: null,
      });
      expect(seg).toBeNull();
    });
  });
});
