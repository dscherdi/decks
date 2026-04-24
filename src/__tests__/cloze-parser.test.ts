import { FlashcardParser } from "../services/FlashcardParser";

describe("Cloze Parser", () => {
  describe("header-paragraph cloze cards", () => {
    it("should generate a single cloze card from one highlight", () => {
      const content = `## Question\nThe capital of France is ==Paris==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("cloze");
      expect(cards[0].front).toBe("Question");
      expect(cards[0].clozeText).toBe("Paris");
      expect(cards[0].clozeOrder).toBe(0);
      expect(cards[0].back).toContain("==Paris==");
    });

    it("should generate N cloze cards from N highlights", () => {
      const content = `## Question\n==Paris== is the capital of ==France==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(2);
      expect(cards[0].type).toBe("cloze");
      expect(cards[0].clozeText).toBe("Paris");
      expect(cards[0].clozeOrder).toBe(0);
      expect(cards[1].type).toBe("cloze");
      expect(cards[1].clozeText).toBe("France");
      expect(cards[1].clozeOrder).toBe(1);
    });

    it("should preserve full back content on all cloze cards", () => {
      const content = `## Question\n==Paris== is the capital of ==France==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      for (const card of cards) {
        expect(card.back).toBe("==Paris== is the capital of ==France==.");
      }
    });

    it("should generate clozes across multiple paragraphs", () => {
      const content = `## Question\nFirst paragraph with ==cloze1==.\n\nSecond paragraph with ==cloze2==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(2);
      expect(cards[0].clozeText).toBe("cloze1");
      expect(cards[1].clozeText).toBe("cloze2");
    });

    it("should produce a normal card when no highlights exist (cloze enabled)", () => {
      const content = `## Question\nNo highlights here.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("header-paragraph");
      expect(cards[0].clozeText).toBeUndefined();
    });

    it("should pass highlights through when cloze is disabled", () => {
      const content = `## Question\nThe answer is ==Paris==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, false);

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("header-paragraph");
      expect(cards[0].back).toContain("==Paris==");
    });

    it("should have sequential clozeOrder values", () => {
      const content = `## Question\n==a== ==b== ==c==`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(3);
      expect(cards[0].clozeOrder).toBe(0);
      expect(cards[1].clozeOrder).toBe(1);
      expect(cards[2].clozeOrder).toBe(2);
    });

    it("should strip == delimiters from clozeText", () => {
      const content = `## Question\nAnswer is ==some text==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards[0].clozeText).toBe("some text");
      expect(cards[0].clozeText).not.toContain("==");
    });

    it("should produce no regular card when clozes exist", () => {
      const content = `## Question\nThe answer is ==Paris==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      const regularCards = cards.filter((c) => c.type === "header-paragraph");
      const clozeCards = cards.filter((c) => c.type === "cloze");

      expect(regularCards).toHaveLength(0);
      expect(clozeCards).toHaveLength(1);
    });

    it("should preserve breadcrumbs on cloze cards", () => {
      const content = `# Chapter\n## Question\nAnswer is ==Paris==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(1);
      expect(cards[0].breadcrumb).toBe("Chapter");
    });
  });

  describe("table cloze cards", () => {
    it("should generate cloze cards from table back column", () => {
      const content = `## Vocab\n\n| Front | Back |\n|-------|------|\n| Word | ==Definition== here |`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("cloze");
      expect(cards[0].front).toBe("Word");
      expect(cards[0].clozeText).toBe("Definition");
      expect(cards[0].clozeOrder).toBe(0);
    });

    it("should generate multiple cloze cards from one table row", () => {
      const content = `## Vocab\n\n| Front | Back |\n|-------|------|\n| Word | ==A== and ==B== |`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(2);
      expect(cards[0].clozeText).toBe("A");
      expect(cards[1].clozeText).toBe("B");
    });

    it("should produce normal table card when no cloze in back column", () => {
      const content = `## Vocab\n\n| Front | Back |\n|-------|------|\n| Word | No highlights |`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("table");
    });

    it("should handle mixed cloze and non-cloze rows", () => {
      const content = `## Vocab\n\n| Front | Back |\n|-------|------|\n| Word1 | ==cloze== text |\n| Word2 | plain text |`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(2);
      expect(cards[0].type).toBe("cloze");
      expect(cards[0].front).toBe("Word1");
      expect(cards[1].type).toBe("table");
      expect(cards[1].front).toBe("Word2");
    });

    it("should preserve notes column on cloze cards from table", () => {
      const content = `## Vocab\n\n| Front | Back | Notes |\n|-------|------|-------|\n| Word | ==Def== here | A note |`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("cloze");
      expect(cards[0].notes).toBe("A note");
    });
  });

  describe("title mode cloze", () => {
    it("should generate cloze cards in title mode (headerLevel=0)", () => {
      const content = `The answer is ==Paris==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 0, "My Title", true);

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("cloze");
      expect(cards[0].front).toBe("My Title");
      expect(cards[0].clozeText).toBe("Paris");
    });

    it("should return normal card in title mode when no cloze", () => {
      const content = `No highlights here.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 0, "My Title", true);

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("header-paragraph");
    });
  });

  describe("edge cases", () => {
    it("should handle adjacent clozes", () => {
      const content = `## Question\n==a====b==`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(2);
      expect(cards[0].clozeText).toBe("a");
      expect(cards[1].clozeText).toBe("b");
    });

    it("should not match empty highlight ====", () => {
      const content = `## Question\nSome ==== text`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("header-paragraph");
    });

    it("should handle cloze with special characters", () => {
      const content = `## Question\nThe formula is ==E=mc²==.`;
      const cards = FlashcardParser.parseFlashcardsFromContent(content, 2, undefined, true);

      expect(cards).toHaveLength(1);
      expect(cards[0].clozeText).toBe("E=mc²");
    });
  });
});
