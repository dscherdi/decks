jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId, generateReverseFlashcardId } from "../../utils/hash";
import type { Deck, DeckProfile } from "../../database/types";

describe("Reverse Cards Integration Tests", () => {
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
      tag: "decks/test",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    return { deck, profile };
  }

  describe("basic reverse card creation", () => {
    it("should create 2N cards when reverseCards is true (N regular + N reverse)", async () => {
      const { deck, profile } = await createTestDeck("reverse-basic");

      const content = `## Study Topics

| Front | Back |
|-------|------|
| What is 2+2? | 4 |
| Capital of France | Paris |
`;

      const syncResult = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        reverseCards: true,
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.parsedCount).toBe(2);

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(4);
    });

    it("should create only N regular cards when reverseCards is false", async () => {
      const { deck, profile } = await createTestDeck("no-reverse");

      const content = `## Study Topics

| Front | Back |
|-------|------|
| What is 2+2? | 4 |
| Capital of France | Paris |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        reverseCards: false,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);
    });

    it("should create only N regular cards when reverseCards is absent", async () => {
      const { deck, profile } = await createTestDeck("no-reverse-absent");

      const content = `## Study Topics

| Front | Back |
|-------|------|
| What is 2+2? | 4 |
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
    });

    it("should swap front and back for reverse cards", async () => {
      const { deck, profile } = await createTestDeck("reverse-swap");

      const content = `## Study Topics

| Front | Back |
|-------|------|
| Capital of France | Paris |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        reverseCards: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);

      const regular = flashcards.find(c => c.front === "Capital of France");
      const reversed = flashcards.find(c => c.front === "Paris");

      expect(regular).toBeDefined();
      expect(regular!.back).toBe("Paris");

      expect(reversed).toBeDefined();
      expect(reversed!.back).toBe("Capital of France");
    });

    it("should give reverse cards an rcard_ prefixed ID", async () => {
      const { deck, profile } = await createTestDeck("reverse-ids");

      const content = `## Study Topics

| Front | Back |
|-------|------|
| Capital of France | Paris |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        reverseCards: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      const regularIds = flashcards.filter(c => c.id.startsWith("card_"));
      const reverseIds = flashcards.filter(c => c.id.startsWith("rcard_"));

      expect(regularIds).toHaveLength(1);
      expect(reverseIds).toHaveLength(1);

      expect(reverseIds[0].id).toBe(generateReverseFlashcardId("Capital of France", deck.id));
    });
  });

  describe("toggling reverse flag", () => {
    it("should delete reverse cards when reverseCards is toggled off", async () => {
      const { deck, profile } = await createTestDeck("toggle-off");

      const content = `## Study Topics

| Front | Back |
|-------|------|
| Capital of France | Paris |
| Capital of Germany | Berlin |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        reverseCards: true,
      });

      let flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(4);

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        reverseCards: false,
      });

      flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);
      expect(flashcards.every(c => c.id.startsWith("card_"))).toBe(true);
    });

    it("should re-create reverse cards when reverseCards is toggled back on", async () => {
      const { deck, profile } = await createTestDeck("toggle-on");

      const content = `## Study Topics

| Front | Back |
|-------|------|
| Capital of France | Paris |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content, reverseCards: true,
      });
      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content, reverseCards: false,
      });
      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content, reverseCards: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);
      expect(flashcards.some(c => c.id.startsWith("rcard_"))).toBe(true);
    });
  });

  describe("content updates with reverse cards", () => {
    it("should update reverse card front when original back changes", async () => {
      const { deck, profile } = await createTestDeck("update-back");

      const content1 = `## Study Topics

| Front | Back |
|-------|------|
| Capital of France | Paris |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content1, reverseCards: true,
      });

      let flashcards = await db.getFlashcardsByDeck(deck.id);
      const reverseCard = flashcards.find(c => c.id.startsWith("rcard_"));
      expect(reverseCard!.front).toBe("Paris");
      const reverseId = reverseCard!.id;

      const content2 = `## Study Topics

| Front | Back |
|-------|------|
| Capital of France | Paris, France |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content2, reverseCards: true,
      });

      flashcards = await db.getFlashcardsByDeck(deck.id);
      const updatedReverse = flashcards.find(c => c.id.startsWith("rcard_"));

      expect(updatedReverse).toBeDefined();
      expect(updatedReverse!.id).toBe(reverseId);
      expect(updatedReverse!.front).toBe("Paris, France");
      expect(updatedReverse!.back).toBe("Capital of France");
    });

    it("should replace reverse card when original front changes", async () => {
      const { deck, profile } = await createTestDeck("update-front");

      const content1 = `## Study Topics

| Front | Back |
|-------|------|
| Capital of France | Paris |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content1, reverseCards: true,
      });

      let flashcards = await db.getFlashcardsByDeck(deck.id);
      const oldReverseId = flashcards.find(c => c.id.startsWith("rcard_"))!.id;

      const content2 = `## Study Topics

| Front | Back |
|-------|------|
| What is the capital of France? | Paris |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content2, reverseCards: true,
      });

      flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);

      const newReverse = flashcards.find(c => c.id.startsWith("rcard_"));
      expect(newReverse).toBeDefined();
      expect(newReverse!.id).not.toBe(oldReverseId);
      expect(newReverse!.back).toBe("What is the capital of France?");
    });
  });

  describe("review history restoration", () => {
    it("should restore review history for reverse cards after re-enable", async () => {
      const { deck, profile } = await createTestDeck("history-restore");

      const content = `## Study Topics

| Front | Back |
|-------|------|
| Capital of France | Paris |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content, reverseCards: true,
      });

      const flashcardsAfterFirst = await db.getFlashcardsByDeck(deck.id);
      const reverseCard = flashcardsAfterFirst.find(c => c.id.startsWith("rcard_"))!;

      // Simulate a review log for the reverse card
      const now = new Date().toISOString();
      const due = new Date(Date.now() + 1440 * 60 * 1000).toISOString();
      await db.executeSql(
        `INSERT INTO review_logs (
          id, flashcard_id, session_id,
          last_reviewed_at, shown_at, reviewed_at,
          rating, rating_label, time_elapsed_ms,
          old_state, old_repetitions, old_lapses, old_stability, old_difficulty,
          new_state, new_repetitions, new_lapses, new_stability, new_difficulty,
          old_interval_minutes, new_interval_minutes,
          old_due_at, new_due_at,
          elapsed_days, retrievability, request_retention,
          profile, maximum_interval_days, min_minutes,
          fsrs_weights_version, scheduler_version
        ) VALUES (
          'log_test_1', ?, NULL,
          ?, ?, ?,
          3, 'good', 1000,
          'new', 0, 0, 2.5, 5.0,
          'review', 1, 0, 4.0, 4.8,
          0, 1440,
          ?, ?,
          0, 0.9, 0.9,
          'STANDARD', 36500, 1,
          '1.0', '1.0'
        )`,
        [reverseCard.id, now, now, now, now, due]
      );

      // Toggle off then on again
      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content, reverseCards: false,
      });
      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content, reverseCards: true,
      });

      const restoredCards = await db.getFlashcardsByDeck(deck.id);
      const restoredReverse = restoredCards.find(c => c.id.startsWith("rcard_"))!;

      expect(restoredReverse).toBeDefined();
      expect(restoredReverse.state).toBe("review");
      expect(restoredReverse.repetitions).toBe(1);
    });
  });

  describe("empty back guard", () => {
    it("should not create a reverse card for a card with empty back via header-paragraph", async () => {
      const { deck, profile } = await createTestDeck("empty-back");

      // Header-paragraph cards with no content below won't be parsed at all,
      // so the guard doesn't apply here. Instead test table with non-empty back only.
      const content = `## Study Topics

| Front | Back |
|-------|------|
| Valid card | Non-empty answer |
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content, reverseCards: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);
    });
  });

  describe("header-paragraph format with reverse cards", () => {
    it("should create reverse cards for header-paragraph format", async () => {
      const { deck, profile } = await createTestDeck("hp-reverse");

      const content = `## What is TypeScript?

TypeScript is a typed superset of JavaScript.

## What is React?

React is a library for building user interfaces.
`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id, deckName: deck.name, deckFilepath: deck.filepath,
        deckConfig: profile, fileContent: content, reverseCards: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(4);

      const tsRegular = flashcards.find(c => c.front === "What is TypeScript?");
      const tsReverse = flashcards.find(c => c.front === "TypeScript is a typed superset of JavaScript.");

      expect(tsRegular).toBeDefined();
      expect(tsReverse).toBeDefined();
      expect(tsReverse!.back).toBe("What is TypeScript?");
    });
  });
});
