import { getExamDeckContent } from "../assets/ExamDeckTemplate";
import { FlashcardParser, classifyExamBody } from "@decks/core";

describe("Demo exam deck template", () => {
  const content = getExamDeckContent("#decks");

  it("tags the note into the exams subtree", () => {
    expect(content).toContain("tags:\n  - decks/exams");
  });

  it("parses into the four demo questions under the Exams preset settings", () => {
    // Exams preset: headerLevel 2, cloze off, exam on.
    const cards = FlashcardParser.parseFlashcardsFromContent(
      content,
      2,
      undefined,
      false,
      true
    );
    const questions = cards.filter((c) => c.type === "multiple-choice");
    const typeIns = cards.filter((c) => c.type === "header-paragraph");

    expect(questions).toHaveLength(3);
    expect(typeIns.map((c) => c.front)).toContain(
      "What is the powerhouse of the cell?"
    );

    const single = classifyExamBody(questions[0].back);
    expect(single.kind).toBe("mcq");
    if (single.kind === "mcq") {
      expect(single.options.filter((o) => o.correct)).toHaveLength(1);
    }
    // The explanation comment became notes, not body content.
    expect(questions[0].notes).toContain("Group 18");

    const multi = classifyExamBody(questions[1].back);
    if (multi.kind === "mcq") {
      expect(multi.options.filter((o) => o.correct)).toHaveLength(3);
    }
    const trueFalse = classifyExamBody(questions[2].back);
    if (trueFalse.kind === "mcq") {
      expect(trueFalse.options).toHaveLength(2);
    }
  });
});
