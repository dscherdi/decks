import { FlashcardParser, ParsedFlashcard } from "../services/FlashcardParser";

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
      expect(result[0]).toEqual({
        front: "What is 2+2?",
        back: "4",
        type: "table",
        breadcrumb: "Study Topics",
      });
      expect(result[1]).toEqual({
        front: "Capital of France",
        back: "Paris",
        type: "table",
        breadcrumb: "Study Topics",
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
        type: "header-paragraph",
        breadcrumb: "",
      });
      expect(result[1]).toEqual({
        front: "What is React?",
        back: "React is a JavaScript library for building user interfaces.",
        type: "header-paragraph",
        breadcrumb: "",
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
        type: "header-paragraph",
        breadcrumb: "",
      });
      expect(result[1]).toEqual({
        front: "Question 2",
        back: "Answer 2",
        type: "header-paragraph",
        breadcrumb: "",
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
      expect(result[1]).toEqual({
        front: "What is CSS?",
        back: "Cascading Style Sheets for styling web pages.",
        type: "header-paragraph",
        breadcrumb: "",
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
        type: "header-paragraph",
        breadcrumb: "",
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
        type: "header-paragraph",
        breadcrumb: "Flashcards Section",
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
      expect(result[0]).toEqual({
        front: "Complete question",
        back: "Complete answer",
        type: "table",
        breadcrumb: "Test Table",
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
      expect(result[0]).toEqual({
        front: "Whitespace question",
        back: "Whitespace answer",
        type: "table",
        breadcrumb: "Whitespace Test",
      });
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
      expect(h2Result[0]).toEqual({
        front: "What is 2+2?",
        back: "4",
        type: "table",
        breadcrumb: "Main Title > Level 2 Header",
      });
      expect(h2Result[1]).toEqual({
        front: "What is 3+3?",
        back: "6",
        type: "table",
        breadcrumb: "Main Title > Level 2 Header",
      });

      // Test with headerLevel 3 - should only parse table under ### header
      const h3Result = FlashcardParser.parseFlashcardsFromContent(content, 3);
      expect(h3Result).toHaveLength(1);
      expect(h3Result[0]).toEqual({
        front: "What is 5+5?",
        back: "10",
        type: "table",
        breadcrumb: "Main Title > Level 2 Header > Level 3 Header",
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
      expect(result[0]).toEqual({
        front: "What is 5+5?",
        back: "10",
        type: "table",
        breadcrumb: "Pure Table Header",
      });
      expect(result[1]).toEqual({
        front: "What is 6+6?",
        back: "12",
        type: "table",
        breadcrumb: "Pure Table Header",
      });

      // Third should be header-paragraph with table content included
      expect(result[2].front).toBe("Mixed Header");
      expect(result[2].back).toContain("Some paragraph content here.");
      expect(result[2].back).toContain("| What is 7+7? | 14 |");
      expect(result[2].type).toBe("header-paragraph");
      expect(result[2].breadcrumb).toBe("");
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
});
