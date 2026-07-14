import { FlashcardParser, ParsedFlashcard } from "@decks/core";

describe("FlashcardParser", () => {
  describe("parseFlashcardsFromContent", () => {
    it("should parse table-based flashcards", () => {
      const content = `
## Study Topics

| Front | Back |
|-------|------|
| What is 2+2? | 4 |
| Capital of France | Paris |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        front: "What is 2+2?",
        back: "4",
        notes: "",
        type: "table",
        breadcrumb: "Study Topics",
        tags: [],
      });
      expect(result[1]).toMatchObject({
        front: "Capital of France",
        back: "Paris",
        notes: "",
        type: "table",
        breadcrumb: "Study Topics",
        tags: [],
      });
    });

    it("should parse header-paragraph flashcards with default H2 level", () => {
      const content = `
## What is TypeScript?

TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.

## What is React?

React is a JavaScript library for building user interfaces.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        front: "What is TypeScript?",
        back: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.",
        notes: "",
        type: "header-paragraph",
        breadcrumb: "",
        tags: [],
      });
      expect(result[1]).toEqual({
        front: "What is React?",
        back: "React is a JavaScript library for building user interfaces.",
        notes: "",
        type: "header-paragraph",
        breadcrumb: "",
        tags: [],
      });
    });

    it("should parse header-paragraph flashcards with custom header level", () => {
      const content = `
### Question 1

Answer 1

### Question 2

Answer 2

## This should be ignored

This content should be ignored since we're targeting H3.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        front: "Question 1",
        back: "Answer 1",
        notes: "",
        type: "header-paragraph",
        breadcrumb: "",
        tags: [],
      });
      expect(result[1]).toEqual({
        front: "Question 2",
        back: "Answer 2",
        notes: "",
        type: "header-paragraph",
        breadcrumb: "",
        tags: [],
      });
    });

    it("should handle mixed table and header-paragraph flashcards", () => {
      const content = `
## What is JavaScript?

JavaScript is a programming language.

| Front | Back |
|-------|------|
| What is HTML? | HyperText Markup Language |

## What is CSS?

Cascading Style Sheets for styling web pages.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(2);
      expect(result[0].front).toBe("What is JavaScript?");
      expect(result[0].back).toContain("JavaScript is a programming language.");
      expect(result[0].back).toContain(
        "| What is HTML? | HyperText Markup Language |"
      );
      expect(result[0].type).toBe("header-paragraph");
      expect(result[0].notes).toBe("");
      expect(result[1]).toEqual({
        front: "What is CSS?",
        back: "Cascading Style Sheets for styling web pages.",
        notes: "",
        type: "header-paragraph",
        breadcrumb: "",
        tags: [],
      });
    });

    it("should skip frontmatter", () => {
      const content = `---
tags: flashcards
title: Test File
---

## Question

Answer
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        front: "Question",
        back: "Answer",
        notes: "",
        type: "header-paragraph",
        breadcrumb: "",
        tags: [],
      });
    });

    it("should skip title headers containing 'flashcard'", () => {
      const content = `
# Flashcards Section

This should be skipped.

## Real Question

Real answer.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        front: "Real Question",
        back: "Real answer.",
        notes: "",
        type: "header-paragraph",
        breadcrumb: "Flashcards Section",
        tags: [],
      });
    });

    it("should handle empty content", () => {
      const result = FlashcardParser.parseFlashcardsFromContent("");
      expect(result).toHaveLength(0);
    });

    it("should handle content with no flashcards", () => {
      const content = `
# Just a regular document

This is just regular content without any flashcards.

Some more content here.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);
      expect(result).toHaveLength(0);
    });

    it("should ignore incomplete table rows", () => {
      const content = `
## Test Table

| Front | Back |
|-------|------|
| Complete question | Complete answer |
| Incomplete question |
|  | Missing front |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        front: "Complete question",
        back: "Complete answer",
        notes: "",
        type: "table",
        breadcrumb: "Test Table",
        tags: [],
      });
    });

    it("should handle multi-line header content", () => {
      const content = `
## What is Node.js?

Node.js is a JavaScript runtime built on Chrome's V8 JavaScript engine.

It allows you to run JavaScript on the server side.

Key features:
- Event-driven
- Non-blocking I/O
- Built on V8
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0].front).toBe("What is Node.js?");
      expect(result[0].back).toContain("Node.js is a JavaScript runtime");
      expect(result[0].back).toContain("Key features:");
      expect(result[0].back).toContain("- Event-driven");
      expect(result[0].type).toBe("header-paragraph");
      expect(result[0].notes).toBe("");
    });

    it("should trim whitespace from table cells", () => {
      const content = `
## Whitespace Test

| Front | Back |
|-------|------|
|   Whitespace question   |   Whitespace answer   |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        front: "Whitespace question",
        back: "Whitespace answer",
        notes: "",
        type: "table",
        breadcrumb: "Whitespace Test",
        tags: [],
      });
    });

    it("un-escapes \\| and <br> in table cells", () => {
      const content = `
## Escaped

| Front | Back | Notes |
|-------|------|-------|
| a\\|b | line1<br>line2 | n\\|o |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0].front).toBe("a|b");
      expect(result[0].back).toBe("line1\nline2");
      expect(result[0].notes).toBe("n|o");
    });

    it("should handle different header levels correctly", () => {
      const content = `
# H1 Header

H1 content

## H2 Header

H2 content

### H3 Header

H3 content

#### H4 Header

H4 content
      `;

      // Test H1 level
      const h1Result = FlashcardParser.parseFlashcardsFromContent(content, 1);
      expect(h1Result).toHaveLength(1);
      expect(h1Result[0].front).toBe("H1 Header");

      // Test H2 level
      const h2Result = FlashcardParser.parseFlashcardsFromContent(content, 2);
      expect(h2Result).toHaveLength(1);
      expect(h2Result[0].front).toBe("H2 Header");

      // Test H3 level
      const h3Result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(h3Result).toHaveLength(1);
      expect(h3Result[0].front).toBe("H3 Header");

      // Test H4 level
      const h4Result = FlashcardParser.parseFlashcardsFromContent(content, 4);
      expect(h4Result).toHaveLength(1);
      expect(h4Result[0].front).toBe("H4 Header");
    });

    it("should only parse tables under headers with correct level", () => {
      const content = `
# Main Title

## Level 2 Header

| Question | Answer |
| --- | --- |
| What is 2+2? | 4 |
| What is 3+3? | 6 |

### Level 3 Header

| Another Question | Another Answer |
| --- | --- |
| What is 5+5? | 10 |

#### Level 4 Header

Some regular content here.

| Ignored Question | Ignored Answer |
| --- | --- |
| This should be ignored | Because it's under H4 |
      `;

      // Test with headerLevel 2 - should only parse table under ## header
      const h2Result = FlashcardParser.parseFlashcardsFromContent(content, 2);
      expect(h2Result).toHaveLength(2);
      expect(h2Result[0]).toMatchObject({
        front: "What is 2+2?",
        back: "4",
        notes: "",
        type: "table",
        breadcrumb: "Main Title > Level 2 Header",
        tags: [],
      });
      expect(h2Result[1]).toMatchObject({
        front: "What is 3+3?",
        back: "6",
        notes: "",
        type: "table",
        breadcrumb: "Main Title > Level 2 Header",
        tags: [],
      });

      // Test with headerLevel 3 - should only parse table under ### header
      const h3Result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(h3Result).toHaveLength(1);
      expect(h3Result[0]).toMatchObject({
        front: "What is 5+5?",
        back: "10",
        notes: "",
        type: "table",
        breadcrumb: "Main Title > Level 2 Header > Level 3 Header",
        tags: [],
      });

      // Test with headerLevel 4 - table should be part of header-paragraph since there's other content
      const h4Result = FlashcardParser.parseFlashcardsFromContent(content, 4);
      expect(h4Result).toHaveLength(1);
      expect(h4Result[0].front).toBe("Level 4 Header");
      expect(h4Result[0].back).toContain("Some regular content here.");
      expect(h4Result[0].back).toContain(
        "| Ignored Question | Ignored Answer |"
      );
      expect(h4Result[0].back).toContain(
        "| This should be ignored | Because it's under H4 |"
      );
      expect(h4Result[0].type).toBe("header-paragraph");
      expect(h4Result[0].notes).toBe("");

      // Test with headerLevel 1 - should parse no flashcards
      const h1Result = FlashcardParser.parseFlashcardsFromContent(content, 1);
      expect(h1Result).toHaveLength(0);
    });

    it("should parse tables as separate flashcards when header has no paragraph content", () => {
      const content = `
## Pure Table Header

| Question | Answer |
| --- | --- |
| What is 5+5? | 10 |
| What is 6+6? | 12 |

## Mixed Header

Some paragraph content here.

| Question | Answer |
| --- | --- |
| What is 7+7? | 14 |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 2);

      // Should have 3 flashcards: 2 table flashcards from pure table header, 1 header-paragraph from mixed
      expect(result).toHaveLength(3);

      // First two should be table flashcards
      expect(result[0]).toMatchObject({
        front: "What is 5+5?",
        back: "10",
        notes: "",
        type: "table",
        breadcrumb: "Pure Table Header",
        tags: [],
      });
      expect(result[1]).toMatchObject({
        front: "What is 6+6?",
        back: "12",
        notes: "",
        type: "table",
        breadcrumb: "Pure Table Header",
        tags: [],
      });

      // Third should be header-paragraph with table content included
      expect(result[2].front).toBe("Mixed Header");
      expect(result[2].back).toContain("Some paragraph content here.");
      expect(result[2].back).toContain("| What is 7+7? | 14 |");
      expect(result[2].type).toBe("header-paragraph");
      expect(result[2].notes).toBe("");
      expect(result[2].breadcrumb).toBe("");
    });

    it("does not emit a header card for a table section followed by a --- separator (cloze on)", () => {
      const content = [
        "## Kanji vocabulary #vocab",
        "",
        "| Word | Reading | Meaning |",
        "| ---- | ------- | ------- |",
        "| 火 | ひ | fire |",
        "| 水 | みず | water |",
        "",
        "---",
        "",
      ].join("\n");

      const cards = FlashcardParser.parseFlashcardsFromContent(
        content,
        2,
        undefined,
        true
      );

      expect(cards).toHaveLength(2);
      expect(cards.map((c) => c.front).sort()).toEqual(["水", "火"].sort());
    });
  });

  describe("three-column table parsing", () => {
    it("should parse 3-column table with notes", () => {
      const content = `
## Study Topics

| Front | Back | Notes |
|-------|------|-------|
| What is 2+2? | 4 | Basic arithmetic |
| Capital of France | Paris | European geography |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        front: "What is 2+2?",
        back: "4",
        notes: "Basic arithmetic",
        type: "table",
        breadcrumb: "Study Topics",
        tags: [],
      });
      expect(result[1]).toMatchObject({
        front: "Capital of France",
        back: "Paris",
        notes: "European geography",
        type: "table",
        breadcrumb: "Study Topics",
        tags: [],
      });
    });

    it("should handle 3-column table with empty notes cells", () => {
      const content = `
## Test

| Front | Back | Notes |
|-------|------|-------|
| Q1 | A1 |  |
| Q2 | A2 | Some note |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(2);
      expect(result[0].notes).toBe("");
      expect(result[1].notes).toBe("Some note");
    });

    it("should handle mixed 2-column and 3-column tables in same file", () => {
      const content = `
## Two Columns

| Front | Back |
|-------|------|
| Q1 | A1 |

## Three Columns

| Front | Back | Notes |
|-------|------|-------|
| Q2 | A2 | Note here |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        front: "Q1",
        back: "A1",
        notes: "",
        type: "table",
        breadcrumb: "Two Columns",
        tags: [],
      });
      expect(result[1]).toMatchObject({
        front: "Q2",
        back: "A2",
        notes: "Note here",
        type: "table",
        breadcrumb: "Three Columns",
        tags: [],
      });
    });

    it("should return empty notes for header-paragraph flashcards", () => {
      const content = `
## Question

Answer content here.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe("");
      expect(result[0].type).toBe("header-paragraph");
    });

    it("should parse 3-column table with rich markdown content in notes", () => {
      const content = `
## Math Concepts

| Concept | Definition | Proof Sketch |
|---------|-----------|-------------|
| Vektorraum | Eine Menge $V$ über einem Körper | **Beispiele:** $\\mathbb{K}^n$ |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0].front).toBe("Vektorraum");
      expect(result[0].back).toBe("Eine Menge $V$ über einem Körper");
      expect(result[0].notes).toBe("**Beispiele:** $\\mathbb{K}^n$");
      expect(result[0].type).toBe("table");
    });

    it("should handle 3-column separator with varying dash lengths", () => {
      const content = `
## Test

| Front | Back | Notes |
| --- | --- | --- |
| Q1 | A1 | N1 |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe("N1");
    });

    it("should trim whitespace from notes cells", () => {
      const content = `
## Test

| Front | Back | Notes |
|-------|------|-------|
|   Q1   |   A1   |   Note with spaces   |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe("Note with spaces");
    });
  });

  describe("breadcrumb tracking", () => {
    it("should include parent header in breadcrumb for nested headers", () => {
      const content = `
## Chapter 1

### Section 1.1

This is the answer.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);

      expect(result).toHaveLength(1);
      expect(result[0].breadcrumb).toBe("Chapter 1");
    });

    it("should track deep header hierarchy", () => {
      const content = `
## Level 2

### Level 3

#### Level 4

Deep content here.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 4);

      expect(result).toHaveLength(1);
      expect(result[0].breadcrumb).toBe("Level 2 > Level 3");
    });

    it("should reset breadcrumb when same-level header encountered", () => {
      const content = `
## Section A

### Question A1

Answer A1

## Section B

### Question B1

Answer B1
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);

      expect(result).toHaveLength(2);
      expect(result[0].breadcrumb).toBe("Section A");
      expect(result[1].breadcrumb).toBe("Section B");
    });

    it("should include breadcrumb for table-based flashcards under nested headers", () => {
      const content = `
## Chapter

### Vocabulary

| Front | Back |
|-------|------|
| Hello | Bonjour |
| Goodbye | Au revoir |
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);

      expect(result).toHaveLength(2);
      expect(result[0].breadcrumb).toBe("Chapter > Vocabulary");
      expect(result[1].breadcrumb).toBe("Chapter > Vocabulary");
    });

    it("should have single header in breadcrumb for top-level flashcards", () => {
      const content = `
## Standalone Question

The answer is here.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 2);

      expect(result).toHaveLength(1);
      expect(result[0].breadcrumb).toBe("");
    });

    it("should maintain correct hierarchy when headers jump levels", () => {
      const content = `
## Chapter 1

#### Deep Section

This is content under an H4 directly after H2.
      `;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 4);

      expect(result).toHaveLength(1);
      expect(result[0].breadcrumb).toBe("Chapter 1");
    });
  });

  describe("title mode (headerLevel 0)", () => {
    it("should return a single card with fileTitle as front and full content as back", () => {
      const content = `This is the body of the note.

It has multiple paragraphs.`;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 0, "My Note");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        front: "My Note",
        back: "This is the body of the note.\n\nIt has multiple paragraphs.",
        notes: "",
        type: "header-paragraph",
        breadcrumb: "",
        tags: [],
      });
    });

    it("should strip YAML frontmatter from the back", () => {
      const content = `---
tags: flashcards
---
The actual content here.`;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 0, "Frontmatter File");

      expect(result).toHaveLength(1);
      expect(result[0].front).toBe("Frontmatter File");
      expect(result[0].back).toBe("The actual content here.");
    });

    it("should return empty array when headerLevel is 0 but no fileTitle provided", () => {
      const content = "Some content here.";

      const result = FlashcardParser.parseFlashcardsFromContent(content, 0);

      expect(result).toHaveLength(0);
    });

    it("should return a card with empty back for a file with only frontmatter", () => {
      const content = `---
tags: flashcards
---`;

      const result = FlashcardParser.parseFlashcardsFromContent(content, 0, "Empty File");

      expect(result).toHaveLength(1);
      expect(result[0].front).toBe("Empty File");
      expect(result[0].back).toBe("");
    });
  });

  describe("header tags extraction", () => {
    it("should extract tags from a header-paragraph card", () => {
      const content = `
## My Header #math #science

This is the answer.
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content);
      expect(result).toHaveLength(1);
      expect(result[0].front).toBe("My Header");
      expect(result[0].tags).toEqual(["math", "science"]);
      expect(result[0].breadcrumb).toBe("");
    });

    it("should propagate header tags to all table rows under that header", () => {
      const content = `
## Topic #important

| Front | Back |
|-------|------|
| Q1 | A1 |
| Q2 | A2 |
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content);
      expect(result).toHaveLength(2);
      expect(result[0].tags).toEqual(["important"]);
      expect(result[1].tags).toEqual(["important"]);
    });

    it("should give different cards different tags based on their containing header", () => {
      const content = `
## Math #science

| Front | Back |
|-------|------|
| Q1 | A1 |
| Q1b | A1b |

## History #social

| Front | Back |
|-------|------|
| Q2 | A2 |
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content);
      expect(result).toHaveLength(3);
      expect(result[0].tags).toEqual(["science"]);
      expect(result[1].tags).toEqual(["science"]);
      expect(result[2].tags).toEqual(["social"]);
    });

    it("should accept tags with slash and dash characters", () => {
      const content = `
## My Heading #math/algebra #high-priority #snake_case

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content);
      expect(result[0].tags).toEqual(["math/algebra", "high-priority", "snake_case"]);
    });

    it("should not treat pure-numeric '#123' as a tag", () => {
      const content = `
## Heading #123 #real

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content);
      expect(result[0].tags).toEqual(["real"]);
      expect(result[0].front).toContain("#123");
    });

    it("should not treat mid-word '#bar' as a tag", () => {
      const content = `
## foo#bar Heading #real

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content);
      expect(result[0].tags).toEqual(["real"]);
      expect(result[0].front).toContain("foo#bar");
    });

    it("should lowercase and deduplicate tags", () => {
      const content = `
## Heading #Math #math #MATH

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content);
      expect(result[0].tags).toEqual(["math"]);
    });

    it("should strip tags from breadcrumb when nested", () => {
      const content = `
## Parent #parent-tag

### Child #child-tag

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(result).toHaveLength(1);
      expect(result[0].front).toBe("Child");
      expect(result[0].tags.sort()).toEqual(["child-tag", "parent-tag"]);
      expect(result[0].breadcrumb).toBe("Parent");
    });

    it("should give cloze cards under a tagged header the parent's tags", () => {
      const content = `
## Topic #science

The ==capital== of France is ==Paris==.
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);
      expect(result.length).toBeGreaterThan(0);
      for (const card of result) {
        expect(card.tags).toEqual(["science"]);
      }
    });

    it("should default to empty tags for headers without tags", () => {
      const content = `
## Plain Header

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content);
      expect(result[0].tags).toEqual([]);
    });

    it("treats a cloze in a table's front cell as a front-only cloze carrying templateRow", () => {
      const content = `
## Deck #anki-tpl-cloze/basic

| Text | Extra |
| --- | --- |
| Du trinkst ==jeden Tag== Bier. | extra note |
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("cloze");
      expect(result[0].front).toBe("Du trinkst ==jeden Tag== Bier."); // cloze on the front
      expect(result[0].back).toBe(""); // front-only
      expect(result[0].templateRow?.headers).toEqual(["Text", "Extra"]);
      expect(result[0].templateRow?.cells).toEqual(["Du trinkst ==jeden Tag== Bier.", "extra note"]);
    });

    it("keeps a normal | Front | Back | table as front+back (no cloze in front)", () => {
      const content = `
## Deck

| Front | Back |
| --- | --- |
| Question | Answer |
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("table");
      expect(result[0].front).toBe("Question");
      expect(result[0].back).toBe("Answer");
    });
  });

  describe("parent header tag inheritance", () => {
    it("inherits tags from a single ancestor header", () => {
      const content = `
## Parent #math

### Child

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(result).toHaveLength(1);
      expect(result[0].front).toBe("Child");
      expect(result[0].tags).toEqual(["math"]);
      expect(result[0].breadcrumb).toBe("Parent");
    });

    it("inherits tags from every ancestor in the chain", () => {
      const content = `
## A #x

### B #y

#### C

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 4);
      expect(result).toHaveLength(1);
      expect(result[0].tags.sort()).toEqual(["x", "y"]);
      expect(result[0].breadcrumb).toBe("A > B");
    });

    it("merges own and ancestor tags, deduplicating overlaps", () => {
      const content = `
## Parent #math

### Child #math #science

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(result).toHaveLength(1);
      expect(result[0].tags.sort()).toEqual(["math", "science"]);
    });

    it("isolates sibling subtrees so tags don't leak across siblings", () => {
      const content = `
## A #x

### A1

Content A1

## B #y

### B1

Content B1
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(result).toHaveLength(2);
      const a1 = result.find((c) => c.front === "A1");
      const b1 = result.find((c) => c.front === "B1");
      expect(a1?.tags).toEqual(["x"]);
      expect(b1?.tags).toEqual(["y"]);
    });

    it("keeps breadcrumbs clean of tag syntax at every ancestor level", () => {
      const content = `
## P #pt

### Q #qt

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(result).toHaveLength(1);
      expect(result[0].breadcrumb).toBe("P");
      expect(result[0].breadcrumb).not.toContain("#");
      expect(result[0].tags.sort()).toEqual(["pt", "qt"]);
    });

    it("inherits ancestor tags into table rows", () => {
      const content = `
## Parent #parent

### Section #section

| Front | Back |
|-------|------|
| Q1 | A1 |
| Q2 | A2 |
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(result).toHaveLength(2);
      for (const card of result) {
        expect(card.tags.sort()).toEqual(["parent", "section"]);
      }
    });

    it("inherits ancestor tags into cloze cards", () => {
      const content = `
## Parent #science

### Q

The ==capital== of France is ==Paris==.
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 3, undefined, true);
      expect(result.length).toBeGreaterThan(0);
      for (const card of result) {
        expect(card.tags).toEqual(["science"]);
      }
    });

    it("does not pollute tags when an ancestor has no tags", () => {
      const content = `
## Plain

### Child #only

Content
`;
      const result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(result).toHaveLength(1);
      expect(result[0].tags).toEqual(["only"]);
    });
  });

  describe("header-paragraph notes", () => {
    const parse = (content: string, cloze = false) =>
      FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, cloze);

    it("extracts notes from a single-line %%comment%%", () => {
      const content = `
## What is X?

X is a thing. %%supplementary detail%%
`;
      const [card] = parse(content);
      expect(card.back).toBe("X is a thing.");
      expect(card.notes).toBe("supplementary detail");
    });

    it("extracts notes from a multi-line %%comment%%", () => {
      const content = `
## What is X?

X is a thing.
%%line one
line two%%
`;
      const [card] = parse(content);
      expect(card.back).toBe("X is a thing.");
      expect(card.notes).toBe("line one\nline two");
    });

    it("extracts notes after a trailing --- delimiter", () => {
      const content = `
## What is X?

X is a thing.

---

extra context here
`;
      const [card] = parse(content);
      expect(card.back).toBe("X is a thing.");
      expect(card.notes).toBe("extra context here");
    });

    it("supports *** and ___ as the delimiter", () => {
      const star = parse(`
## A

body

***

star note
`);
      expect(star[0].notes).toBe("star note");
      const under = parse(`
## A

body

___

under note
`);
      expect(under[0].notes).toBe("under note");
    });

    it("combines a comment and a trailing-HR note", () => {
      const content = `
## What is X?

Body text. %%comment note%%

---

hr note
`;
      const [card] = parse(content);
      expect(card.back).toBe("Body text.");
      expect(card.notes).toBe("comment note\n\nhr note");
    });

    it("leaves notes empty when there is no comment or delimiter", () => {
      const [card] = parse(`
## What is X?

Just a plain answer.
`);
      expect(card.back).toBe("Just a plain answer.");
      expect(card.notes).toBe("");
    });

    it("keeps a trailing --- in the back when nothing follows it", () => {
      const [card] = parse(`
## What is X?

Answer line.

---
`);
      expect(card.notes).toBe("");
      expect(card.back).toContain("---");
    });

    it("strips heading tags while still extracting notes", () => {
      const [card] = parse(`
## What is X? #biology

Answer.

---

a note
`);
      expect(card.front).toBe("What is X?");
      expect(card.tags).toEqual(["biology"]);
      expect(card.notes).toBe("a note");
    });

    it("carries notes through cloze expansion", () => {
      const cards = parse(
        `
## Capital

The capital of France is ==Paris==.

---

European city
`,
        true,
      );
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        type: "cloze",
        front: "Capital",
        notes: "European city",
      });
      expect(cards[0].back).toContain("==Paris==");
      expect(cards[0].back).not.toContain("European city");
    });
  });

  describe("anchor token stripping", () => {
    it("parses a tokened header card identically to the clean source", () => {
      const clean = `## What is the capital? #geo\n\nParis is the capital.\nIt lies on the Seine.`;
      const tokened = `## What is the capital? #geo\n\nParis is the capital.\nIt lies on the Seine. %%dk:h:x7f2%%`;

      const cleanCards = FlashcardParser.parseFlashcardsFromContent(clean, 2);
      const tokenedCards = FlashcardParser.parseFlashcardsFromContent(tokened, 2);

      expect(tokenedCards).toHaveLength(1);
      expect(tokenedCards[0].front).toBe(cleanCards[0].front);
      expect(tokenedCards[0].back).toBe(cleanCards[0].back);
      expect(tokenedCards[0].notes).toBe(cleanCards[0].notes);
      expect(tokenedCards[0].tags).toEqual(cleanCards[0].tags);
    });

    it("never turns anchor tokens into card notes, but keeps real comments as notes", () => {
      const content = `## Question\n\nAnswer text. %%dk:h:abc1%%\n%%a real note%%`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2);

      expect(cards).toHaveLength(1);
      expect(cards[0].notes).toBe("a real note");
      expect(cards[0].back).toBe("Answer text.");
    });

    it("parses a tokened cloze line with unchanged clozeOrder and clozeText", () => {
      const clean = `## Facts\n\nThe ==mitochondria== is the powerhouse.\nWater is ==H2O== of course.`;
      const tokened = `## Facts\n\nThe ==mitochondria== is the powerhouse. %%dk:c:aa11%%\nWater is ==H2O== of course. %%dk:c:bb22%%`;

      const cleanCards = FlashcardParser.parseFlashcardsFromContent(clean, 2, undefined, true);
      const tokenedCards = FlashcardParser.parseFlashcardsFromContent(tokened, 2, undefined, true);

      expect(tokenedCards).toHaveLength(cleanCards.length);
      for (let i = 0; i < cleanCards.length; i++) {
        expect(tokenedCards[i].clozeText).toBe(cleanCards[i].clozeText);
        expect(tokenedCards[i].clozeOrder).toBe(cleanCards[i].clozeOrder);
        expect(tokenedCards[i].back).toBe(cleanCards[i].back);
      }
    });

    it("strips tokens from table cells before fronts, backs and templateRow", () => {
      const clean = `## Vocab\n\n| Front | Back |\n|---|---|\n| chat | cat |`;
      const tokened = `## Vocab\n\n| Front | Back |\n|---|---|\n| chat %%dk:t:cc33%% | cat %%dk:t:dd44%% |`;

      const cleanCards = FlashcardParser.parseFlashcardsFromContent(clean, 2);
      const tokenedCards = FlashcardParser.parseFlashcardsFromContent(tokened, 2);

      expect(tokenedCards).toHaveLength(1);
      expect(tokenedCards[0].front).toBe(cleanCards[0].front);
      expect(tokenedCards[0].back).toBe(cleanCards[0].back);
      expect(tokenedCards[0].templateRow).toEqual(cleanCards[0].templateRow);
    });

    it("strips a stray token on the header line from front and breadcrumb", () => {
      const content = `## Question %%dk:h:ee55%%\n\nAnswer.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2);

      expect(cards).toHaveLength(1);
      expect(cards[0].front).toBe("Question");
    });

    it("strips tokens from title-mode bodies", () => {
      const content = `Body line one. %%dk:h:ff66%%\nBody line two.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 0, "Note title");

      expect(cards).toHaveLength(1);
      expect(cards[0].back).toBe("Body line one.\nBody line two.");
    });

    it("does not mint a card from a body that only contains a token", () => {
      const content = `## Question\n\n%%dk:h:aa77%%`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2);
      expect(cards).toHaveLength(0);
    });

    it("parses an own-line token after the body identically to the clean source", () => {
      const clean = `## Question\n\nFirst line.\nLast line.\n\n## Next\n\nOther.`;
      const tokened = `## Question\n\nFirst line.\nLast line.\n%%dk:h:gg88%%\n\n## Next\n\nOther.`;

      const cleanCards = FlashcardParser.parseFlashcardsFromContent(clean, 2);
      const tokenedCards = FlashcardParser.parseFlashcardsFromContent(tokened, 2);

      expect(tokenedCards).toHaveLength(cleanCards.length);
      expect(tokenedCards[0].front).toBe(cleanCards[0].front);
      expect(tokenedCards[0].back).toBe(cleanCards[0].back);
      expect(tokenedCards[0].notes).toBe(cleanCards[0].notes);
    });
  });
});
