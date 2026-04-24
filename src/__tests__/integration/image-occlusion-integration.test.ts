jest.unmock("sql.js");

import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import { generateDeckId } from "../../utils/hash";
import type { Deck, DeckProfile } from "../../database/types";

describe("Image Occlusion Integration Tests", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createClozeEnabledDeck(name: string): Promise<{ deck: Deck; profile: DeckProfile }> {
    const defaultProfile = await db.getDefaultProfile();
    await db.updateProfile(defaultProfile.id, {
      clozeEnabled: true,
      clozeShowContext: "hidden",
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

  describe("basic image occlusion sync", () => {
    it("should create image-occlusion cards from image + numbered list", async () => {
      const { deck, profile } = await createClozeEnabledDeck("img-occ-basic");

      const content = `## Anatomy\n\n![[skeleton.png]]\n1. ==Femur==\n2. ==Tibia==\n3. ==Fibula==`;

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
      expect(flashcards).toHaveLength(3);

      const sorted = flashcards.sort((a, b) => (a.clozeOrder ?? 0) - (b.clozeOrder ?? 0));

      sorted.forEach((card, i) => {
        expect(card.type).toBe("image-occlusion");
        expect(card.front).toBe("![[skeleton.png]]");
        expect(card.clozeOrder).toBe(i);
      });

      expect(sorted[0].clozeText).toBe("Femur");
      expect(sorted[1].clozeText).toBe("Tibia");
      expect(sorted[2].clozeText).toBe("Fibula");
    });

    it("should handle list items without cloze markers", async () => {
      const { deck, profile } = await createClozeEnabledDeck("img-occ-no-cloze");

      const content = `## Parts\n\n![[diagram.png]]\n1. Heart\n2. Lungs`;

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
      expect(flashcards.every((c) => c.type === "image-occlusion")).toBe(true);
    });

    it("should handle multiple clozes per list item as one card", async () => {
      const { deck, profile } = await createClozeEnabledDeck("img-occ-multi-cloze");

      const content = `## Anatomy\n\n![[body.png]]\n1. ==Left== and ==Right== arm\n2. ==Head==`;

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

      const sorted = flashcards.sort((a, b) => (a.clozeOrder ?? 0) - (b.clozeOrder ?? 0));
      expect(sorted[0].clozeText).toBe("Left and Right arm");
      expect(sorted[1].clozeText).toBe("Head");
    });
  });

  describe("re-sync stability", () => {
    it("should not create/delete cards when content is unchanged", async () => {
      const { deck, profile } = await createClozeEnabledDeck("img-occ-resync");

      const content = `## Anatomy\n\n![[skeleton.png]]\n1. ==Femur==\n2. ==Tibia==`;

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: true,
      });

      const firstSync = await db.getFlashcardsByDeck(deck.id);
      expect(firstSync).toHaveLength(2);

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
      expect(secondSync).toHaveLength(2);

      const firstIds = firstSync.map((c) => c.id).sort();
      const secondIds = secondSync.map((c) => c.id).sort();
      expect(secondIds).toEqual(firstIds);
    });

    it("should handle adding a new list item", async () => {
      const { deck, profile } = await createClozeEnabledDeck("img-occ-add");

      const content1 = `## Anatomy\n\n![[skeleton.png]]\n1. ==Femur==`;
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

      const content2 = `## Anatomy\n\n![[skeleton.png]]\n1. ==Femur==\n2. ==Tibia==`;
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

    it("should handle removing a list item", async () => {
      const { deck, profile } = await createClozeEnabledDeck("img-occ-remove");

      const content1 = `## Anatomy\n\n![[skeleton.png]]\n1. ==Femur==\n2. ==Tibia==`;
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content1,
        clozeEnabled: true,
      });

      expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(2);

      const content2 = `## Anatomy\n\n![[skeleton.png]]\n1. ==Femur==`;
      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content2,
        clozeEnabled: true,
      });

      expect(await db.getFlashcardsByDeck(deck.id)).toHaveLength(1);
    });
  });

  describe("reverse cards and image occlusion", () => {
    it("should NOT create reverse cards for image-occlusion type", async () => {
      const { deck, profile } = await createClozeEnabledDeck("img-occ-no-reverse");

      const content = `## Anatomy\n\n![[skeleton.png]]\n1. ==Femur==\n2. ==Tibia==`;

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
      expect(flashcards).toHaveLength(2);
      expect(flashcards.every((c) => c.type === "image-occlusion")).toBe(true);
    });
  });

  describe("coexistence with other card types", () => {
    it("should create image occlusion, cloze, and regular cards in the same deck", async () => {
      const { deck, profile } = await createClozeEnabledDeck("img-occ-mixed");

      const content = [
        "## Regular Question",
        "",
        "Plain answer",
        "",
        "## Cloze Question",
        "",
        "The capital is ==Paris==.",
        "",
        "## Anatomy",
        "",
        "![[skeleton.png]]",
        "1. ==Femur==",
        "2. ==Tibia==",
      ].join("\n");

      await db.syncFlashcardsForDeck({
        deckId: deck.id,
        deckName: deck.name,
        deckFilepath: deck.filepath,
        deckConfig: profile,
        fileContent: content,
        clozeEnabled: true,
      });

      const flashcards = await db.getFlashcardsByDeck(deck.id);

      const regular = flashcards.filter((c) => c.type === "header-paragraph");
      const cloze = flashcards.filter((c) => c.type === "cloze");
      const imageOcclusion = flashcards.filter((c) => c.type === "image-occlusion");

      expect(regular).toHaveLength(1);
      expect(cloze).toHaveLength(1);
      expect(imageOcclusion).toHaveLength(2);
    });
  });

  describe("cloze disabled", () => {
    it("should not generate image-occlusion cards when cloze is disabled", async () => {
      const { deck, profile } = await createClozeEnabledDeck("img-occ-disabled");

      const content = `## Anatomy\n\n![[skeleton.png]]\n1. ==Femur==\n2. ==Tibia==`;

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
    });
  });
});
