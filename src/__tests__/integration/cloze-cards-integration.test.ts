jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import type { Deck, DeckProfile } from "../../database/types";

describe("Cloze Cards Integration Tests", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createClozeEnabledDeck(name: string): Promise<{ deck: Deck; profile: DeckProfile }> {
    const defaultProfile = await db.getDefaultProfile();
    // Enable cloze on the profile
    await db.updateProfile(defaultProfile.id, {
      clozeEnabled: true,
      clozeShowContext: "open",
    });
    await db.save();
    const profile = await db.getProfileById(defaultProfile.id);

    const filepath = `/test/${name}.md`;
    const deck: Deck = {
      id: generateDeckId(filepath),
      name,
      filepath,
      tag: "decks/test",
      lastReviewed: null,
      profileId: profile!.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    return { deck, profile: profile! };
  }

  async function createNonClozeDeck(name: string): Promise<{ deck: Deck; profile: DeckProfile }> {
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

  describe("header-paragraph cloze sync", () => {
    it("should create cloze cards from header-paragraph content", async () => {
      const { deck, profile } = await createClozeEnabledDeck("cloze-hp");

      const content = `## Question\nThe capital of ==France== is ==Paris==.`;

      const result = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: true,
      });

      expect(result.success).toBe(true);

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);

      const sorted = flashcards.sort((a, b) => (a.clozeOrder ?? 0) - (b.clozeOrder ?? 0));
      expect(sorted[0].type).toBe("cloze");
      expect(sorted[0].clozeText).toBe("France");
      expect(sorted[0].clozeOrder).toBe(0);
      expect(sorted[0].front).toBe("Question");

      expect(sorted[1].type).toBe("cloze");
      expect(sorted[1].clozeText).toBe("Paris");
      expect(sorted[1].clozeOrder).toBe(1);
    });

    it("should create normal cards when no highlights exist (cloze enabled)", async () => {
      const { deck, profile } = await createClozeEnabledDeck("cloze-no-hl");

      const content = `## Question\nNo highlights here.`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(1);
      expect(flashcards[0].type).toBe("header-paragraph");
    });
  });

  describe("table cloze sync", () => {
    it("should create cloze cards from table back column", async () => {
      const { deck, profile } = await createClozeEnabledDeck("cloze-table");

      const content = `## Vocab\n\n| Front | Back |\n|-------|------|\n| Word | The ==definition== of it |`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(1);
      expect(flashcards[0].type).toBe("cloze");
      expect(flashcards[0].front).toBe("Word");
      expect(flashcards[0].clozeText).toBe("definition");
    });

    it("should handle mixed cloze and non-cloze table rows", async () => {
      const { deck, profile } = await createClozeEnabledDeck("cloze-mixed-table");

      const content = `## Vocab\n\n| Front | Back |\n|-------|------|\n| A | ==cloze== text |\n| B | plain text |`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);

      const clozeCard = flashcards.find((c) => c.type === "cloze");
      const tableCard = flashcards.find((c) => c.type === "table");
      expect(clozeCard).toBeDefined();
      expect(clozeCard!.front).toBe("A");
      expect(tableCard).toBeDefined();
      expect(tableCard!.front).toBe("B");
    });
  });

  describe("re-sync stability", () => {
    it("should not create/delete cards when content is unchanged", async () => {
      const { deck, profile } = await createClozeEnabledDeck("cloze-resync");

      const content = `## Question\nAnswer is ==Paris==.`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: true,
      });

      const firstSync = await db.getFlashcardsByDeck(deck.id);
      expect(firstSync).toHaveLength(1);

      // Sync again with same content
      const result = await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: true,
      });

      expect(result.success).toBe(true);
      const secondSync = await db.getFlashcardsByDeck(deck.id);
      expect(secondSync).toHaveLength(1);
      expect(secondSync[0].id).toBe(firstSync[0].id);
    });

    it("should handle adding a new cloze to existing content", async () => {
      const { deck, profile } = await createClozeEnabledDeck("cloze-add");

      const content1 = `## Question\nThe capital is ==Paris==.`;
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content1,
        clozeEnabled: true,
      });

      const first = await db.getFlashcardsByDeck(deck.id);
      expect(first).toHaveLength(1);

      const content2 = `## Question\nThe capital of ==France== is ==Paris==.`;
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content2,
        clozeEnabled: true,
      });

      const second = await db.getFlashcardsByDeck(deck.id);
      expect(second).toHaveLength(2);
    });
  });

  describe("reverse cards and cloze", () => {
    it("should NOT create reverse cards for cloze type", async () => {
      const { deck, profile } = await createClozeEnabledDeck("cloze-no-reverse");

      const content = `## Question\nAnswer is ==Paris==.`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        reverseCards: true,
        clozeEnabled: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      // Should be 1 cloze card, no reverse
      expect(flashcards).toHaveLength(1);
      expect(flashcards[0].type).toBe("cloze");
    });
  });

  describe("cloze disabled", () => {
    it("should not generate cloze cards when cloze is disabled", async () => {
      const { deck, profile } = await createNonClozeDeck("no-cloze");

      const content = `## Question\nAnswer is ==Paris==.`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: false,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(1);
      expect(flashcards[0].type).toBe("header-paragraph");
      expect(flashcards[0].back).toContain("==Paris==");
    });
  });

  describe("cloze + non-cloze headers in same file", () => {
    it("should generate both cloze and regular cards", async () => {
      const { deck, profile } = await createClozeEnabledDeck("cloze-mixed");

      const content = `## Cloze Question\nAnswer is ==Paris==.\n\n## Regular Question\nPlain answer here.`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);
      expect(flashcards).toHaveLength(2);

      const clozeCard = flashcards.find((c) => c.type === "cloze");
      const regularCard = flashcards.find((c) => c.type === "header-paragraph");
      expect(clozeCard).toBeDefined();
      expect(clozeCard!.front).toBe("Cloze Question");
      expect(regularCard).toBeDefined();
      expect(regularCard!.front).toBe("Regular Question");
    });
  });
});
