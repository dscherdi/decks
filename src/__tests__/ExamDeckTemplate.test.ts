import { getExamDeckContent } from "../assets/ExamDeckTemplate";
import {
  FlashcardParser,
  buildExamPool,
  classifyExamBody,
  type Flashcard,
} from "@decks/core";

describe("Demo exam deck template", () => {
  const content = getExamDeckContent("#decks");
  // Exams preset settings: headerLevel 2, cloze on, exam on.
  const cards = FlashcardParser.parseFlashcardsFromContent(
    content,
    2,
    undefined,
    true,
    true
  );

  it("tags the note into the exams subtree", () => {
    expect(content).toContain("tags:\n  - decks/exams");
  });

  it("parses to questions only — every H2 is a card, prose lives under the H1", () => {
    expect(cards).toHaveLength(8);
  });

  it("parses exactly the demo question set", () => {
    const byType = (type: string) => cards.filter((c) => c.type === type);
    expect(byType("multiple-choice")).toHaveLength(3);
    expect(byType("header-paragraph").map((c) => c.front)).toEqual([
      "What is the powerhouse of the cell?",
    ]);
    expect(byType("table")).toHaveLength(2);
    expect(byType("table").map((c) => c.back)).toEqual(["Au", "Fe"]);
    expect(byType("cloze").map((c) => c.clozeText).sort()).toEqual([
      "hydrogen",
      "oxygen",
    ]);
  });

  it("classifies the three question kinds correctly", () => {
    const questions = cards.filter((c) => c.type === "multiple-choice");
    const single = classifyExamBody(questions[0].back);
    if (single.kind === "mcq") {
      expect(single.options.filter((o) => o.correct)).toHaveLength(1);
    } else {
      throw new Error("expected mcq");
    }
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

  it("is fully exam-eligible under the preset's tolerant grading", () => {
    const withDeck = cards.map(
      (c, i) => ({ ...c, id: `demo_${i}`, deckId: "demo_deck" }) as Flashcard
    );
    const pool = buildExamPool(
      withDeck,
      new Map([["demo_deck", true]]),
      "tolerant"
    );
    expect(pool.skipped).toHaveLength(0);
    expect(pool.eligible).toHaveLength(8);
  });
});
