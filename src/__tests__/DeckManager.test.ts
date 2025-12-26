import { generateFlashcardId } from "../utils/hash";

describe("DeckManager", () => {
  describe("flashcard ID generation", () => {
    it("should generate consistent IDs for same content", () => {
      const id1 = generateFlashcardId("What is 2+2?");
      const id2 = generateFlashcardId("What is 2+2?");

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^card_[a-z0-9]+$/);
    });

    it("should generate different IDs for different content", () => {
      const id1 = generateFlashcardId("Question 1");
      const id2 = generateFlashcardId("Question 2");

      expect(id1).not.toBe(id2);
    });

    it("should generate same IDs for same content across decks", () => {
      const question = "What is 2+2?";
      const id1 = generateFlashcardId(question);
      const id2 = generateFlashcardId(question);

      expect(id1).toBe(id2);
    });
  });
});
