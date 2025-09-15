import { FlashcardParser, ParsedFlashcard } from "../services/FlashcardParser";

describe("FlashcardParser", () => {
  describe("parseFlashcardsFromContent", () => {
    it("should parse table-based flashcards", () => {
      const content = `
# Flashcards

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
      });
      expect(result[1]).toEqual({
        front: "Capital of France",
        back: "Paris",
        type: "table",
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
      });
      expect(result[1]).toEqual({
        front: "What is React?",
        back: "React is a JavaScript library for building user interfaces.",
        type: "header-paragraph",
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
      });
      expect(result[1]).toEqual({
        front: "Question 2",
        back: "Answer 2",
        type: "header-paragraph",
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

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        front: "What is HTML?",
        back: "HyperText Markup Language",
        type: "table",
      });
      expect(result[1]).toEqual({
        front: "What is JavaScript?",
        back: "JavaScript is a programming language.",
        type: "header-paragraph",
      });
      expect(result[2]).toEqual({
        front: "What is CSS?",
        back: "Cascading Style Sheets for styling web pages.",
        type: "header-paragraph",
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
  });
});
