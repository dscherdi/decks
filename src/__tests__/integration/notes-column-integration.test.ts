jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import type { Deck, DeckProfile } from "../../database/types";

describe("Notes Column Integration Tests", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createTestDeck(name: string): Promise<{ deck: Deck; profile: DeckProfile }> {
    const profile = await db.getDefaultProfile();
    const filepath = `/test/${name}.md`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name,
      filepath,
      tag: "flashcards/test",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    return { deck, profile };
  }

  describe("3-column table sync", () => {
    it("should store and retrieve notes from 3-column table flashcards", async () => {
      const { deck, profile } = await createTestDeck("notes-test");

      const content = `## Study Topics

| Front | Back | Notes |
|-------|------|-------|
| Term 1 | Definition 1 | Example usage of term 1 |
| Term 2 | Definition 2 | Proof sketch for term 2 |
`;

      const syncResult = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.parsedCount).toBe(2);

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);

      const term1 = flashcards.find(c => c.front === "Term 1");
      const term2 = flashcards.find(c => c.front === "Term 2");

      expect(term1).toBeDefined();
      expect(term1!.notes).toBe("Example usage of term 1");
      expect(term1!.back).toBe("Definition 1");

      expect(term2).toBeDefined();
      expect(term2!.notes).toBe("Proof sketch for term 2");
    });

    it("should store empty notes for 2-column table flashcards", async () => {
      const { deck, profile } = await createTestDeck("two-col-test");

      const content = `## Vocabulary

| Front | Back |
|-------|------|
| Hello | Bonjour |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(1);
      expect(flashcards[0].notes).toBe("");
    });

    it("should detect and sync notes changes", async () => {
      const { deck, profile } = await createTestDeck("notes-update");

      const contentV1 = `## Test

| Front | Back | Notes |
|-------|------|-------|
| Q1 | A1 | Original note |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: contentV1,
      });

      let flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards[0].notes).toBe("Original note");

      // Update just the notes
      const contentV2 = `## Test

| Front | Back | Notes |
|-------|------|-------|
| Q1 | A1 | Updated note |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: contentV2,
      });

      flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards[0].notes).toBe("Updated note");
    });

    it("should handle mixed 2-column and 3-column tables across headers", async () => {
      const { deck, profile } = await createTestDeck("mixed-columns");

      const content = `## Two Column Section

| Front | Back |
|-------|------|
| Q1 | A1 |

## Three Column Section

| Concept | Definition | Examples |
|---------|-----------|----------|
| Q2 | A2 | Some examples |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);

      const q1 = flashcards.find(c => c.front === "Q1");
      const q2 = flashcards.find(c => c.front === "Q2");

      expect(q1!.notes).toBe("");
      expect(q2!.notes).toBe("Some examples");
    });

    it("should handle 3-column table with empty notes cells", async () => {
      const { deck, profile } = await createTestDeck("empty-notes");

      const content = `## Test

| Front | Back | Notes |
|-------|------|-------|
| Q1 | A1 |  |
| Q2 | A2 | Has a note |
| Q3 | A3 |  |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(3);

      const q1 = flashcards.find(c => c.front === "Q1");
      const q2 = flashcards.find(c => c.front === "Q2");
      const q3 = flashcards.find(c => c.front === "Q3");

      expect(q1!.notes).toBe("");
      expect(q2!.notes).toBe("Has a note");
      expect(q3!.notes).toBe("");
    });
  });

  describe("notes with createFlashcard", () => {
    it("should persist notes field when creating flashcard directly", async () => {
      const { deck } = await createTestDeck("direct-create");

      const flashcard = DatabaseTestUtils.createTestFlashcard(deck.id, {
        notes: "Test note content",
      });

      await db.createFlashcard(flashcard);

      const retrieved = await db.getFlashcardById(flashcard.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.notes).toBe("Test note content");
    });

    it("should default notes to empty string", async () => {
      const { deck } = await createTestDeck("default-notes");

      const flashcard = DatabaseTestUtils.createTestFlashcard(deck.id);
      await db.createFlashcard(flashcard);

      const retrieved = await db.getFlashcardById(flashcard.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.notes).toBe("");
    });
  });
});
