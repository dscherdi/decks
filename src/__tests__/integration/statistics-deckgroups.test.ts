import { MainDatabaseService } from "../../database/MainDatabaseService";
import { DeckManager } from "../../services/DeckManager";
import { TagGroupService } from "../../services/TagGroupService";
import type { DeckGroup, DeckWithProfile } from "../../database/types";
import {
  setupTestDatabase,
  teardownTestDatabase,
  DatabaseTestUtils,
} from "./database-test-utils";

describe("DeckManager Deck Group Stats Integration Tests", () => {
  let db: MainDatabaseService;
  let deckManager: DeckManager;
  let tagGroupService: TagGroupService;
  let deckGroup: DeckGroup;

  beforeEach(async () => {
    db = await setupTestDatabase();

    const mockVault = {} as any;
    const mockMetadataCache = {} as any;

    deckManager = new DeckManager(mockVault, mockMetadataCache, db, undefined);
    tagGroupService = new TagGroupService(db);

    // Create 3 decks with the same tag
    const testDeck1 = DatabaseTestUtils.createTestDeck({
      name: "Math Deck 1",
      filepath: "/math1.md",
      tag: "#flashcards/math",
    });
    const deck1Id = await db.createDeck(testDeck1);
    const deck1 = (await db.getDeckById(deck1Id))!;

    const testDeck2 = DatabaseTestUtils.createTestDeck({
      name: "Math Deck 2",
      filepath: "/math2.md",
      tag: "#flashcards/math",
    });
    const deck2Id = await db.createDeck(testDeck2);
    const deck2 = (await db.getDeckById(deck2Id))!;

    const testDeck3 = DatabaseTestUtils.createTestDeck({
      name: "Math Deck 3",
      filepath: "/math3.md",
      tag: "#flashcards/math",
    });
    const deck3Id = await db.createDeck(testDeck3);
    const deck3 = (await db.getDeckById(deck3Id))!;

    // Create deck group
    const profile = (await db.getProfileById("profile_default"))!;
    const decksWithProfile: DeckWithProfile[] = [
      { ...deck1, profile },
      { ...deck2, profile },
      { ...deck3, profile },
    ];
    const groups = await tagGroupService.aggregateByTag(decksWithProfile);
    deckGroup = groups[0];

    expect(deckGroup).toBeDefined();
    expect(deckGroup.deckIds).toHaveLength(3);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  describe("getDeckGroupStats", () => {
    it("should return empty stats when no cards exist", async () => {
      const stats = await deckManager.getDeckGroupStats(deckGroup);

      expect(stats).toBeDefined();
      expect(stats.newCount).toBe(0);
      expect(stats.dueCount).toBe(0);
      expect(stats.totalCount).toBe(0);
      expect(stats.matureCount).toBe(0);
    });

    it("should aggregate new cards count across all decks", async () => {
      // Add 2 new cards to first deck
      for (let i = 0; i < 2; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
          front: `New Q ${i} Deck 1`,
          back: `New A ${i} Deck 1`,
          state: "new",
        });
        await db.createFlashcard(card);
      }

      // Add 3 new cards to second deck
      for (let i = 0; i < 3; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
          front: `New Q ${i} Deck 2`,
          back: `New A ${i} Deck 2`,
          state: "new",
        });
        await db.createFlashcard(card);
      }

      // Add 1 new card to third deck
      const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[2], {
        front: "New Q Deck 3",
        back: "New A Deck 3",
        state: "new",
      });
      await db.createFlashcard(card);

      const stats = await deckManager.getDeckGroupStats(deckGroup);

      expect(stats.newCount).toBe(6);
      expect(stats.totalCount).toBe(6);
    });

    it("should aggregate due cards count across all decks", async () => {
      const dueDate = new Date(Date.now() - 1000).toISOString();

      // Add 2 due cards to first deck
      for (let i = 0; i < 2; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
          front: `Due Q ${i} Deck 1`,
          back: `Due A ${i} Deck 1`,
          state: "review",
          dueDate: dueDate,
          interval: 1440,
          stability: 1.5,
          difficulty: 5.0,
        });
        await db.createFlashcard(card);
      }

      // Add 1 due card to second deck
      const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
        front: "Due Q Deck 2",
        back: "Due A Deck 2",
        state: "review",
        dueDate: dueDate,
        interval: 1440,
        stability: 1.5,
        difficulty: 5.0,
      });
      await db.createFlashcard(card);

      const stats = await deckManager.getDeckGroupStats(deckGroup);

      expect(stats.dueCount).toBe(3);
      expect(stats.totalCount).toBe(3);
    });

    it("should aggregate mature cards count across all decks", async () => {
      const dueDate = new Date().toISOString();
      const MATURE_THRESHOLD_MINUTES = 21 * 24 * 60; // 21 days

      // Add 1 mature card to first deck
      const matureCard1 = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
        front: "Mature Q Deck 1",
        back: "Mature A Deck 1",
        state: "review",
        dueDate: dueDate,
        interval: MATURE_THRESHOLD_MINUTES + 1000,
        stability: 20.0,
        difficulty: 5.0,
      });
      await db.createFlashcard(matureCard1);

      // Add 2 mature cards to second deck
      for (let i = 0; i < 2; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
          front: `Mature Q ${i} Deck 2`,
          back: `Mature A ${i} Deck 2`,
          state: "review",
          dueDate: dueDate,
          interval: MATURE_THRESHOLD_MINUTES + 5000,
          stability: 25.0,
          difficulty: 5.0,
        });
        await db.createFlashcard(card);
      }

      // Add 1 non-mature review card to third deck
      const youngCard = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[2], {
        front: "Young Review Q",
        back: "Young Review A",
        state: "review",
        dueDate: dueDate,
        interval: 1440, // 1 day (< 21 days)
        stability: 1.5,
        difficulty: 5.0,
      });
      await db.createFlashcard(youngCard);

      const stats = await deckManager.getDeckGroupStats(deckGroup);

      expect(stats.matureCount).toBe(3);
      expect(stats.totalCount).toBe(4);
    });

    it("should aggregate mixed card types across all decks", async () => {
      const dueDate = new Date(Date.now() - 1000).toISOString();
      const MATURE_THRESHOLD_MINUTES = 21 * 24 * 60;

      // Deck 1: 2 new, 1 due (not mature)
      for (let i = 0; i < 2; i++) {
        const newCard = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
          front: `New Q ${i} Deck 1`,
          back: `New A ${i} Deck 1`,
          state: "new",
        });
        await db.createFlashcard(newCard);
      }

      const dueCard1 = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
        front: "Due Q Deck 1",
        back: "Due A Deck 1",
        state: "review",
        dueDate: dueDate,
        interval: 1440,
        stability: 1.5,
        difficulty: 5.0,
      });
      await db.createFlashcard(dueCard1);

      // Deck 2: 1 new, 2 mature
      const newCard2 = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
        front: "New Q Deck 2",
        back: "New A Deck 2",
        state: "new",
      });
      await db.createFlashcard(newCard2);

      for (let i = 0; i < 2; i++) {
        const matureCard = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
          front: `Mature Q ${i} Deck 2`,
          back: `Mature A ${i} Deck 2`,
          state: "review",
          dueDate: dueDate,
          interval: MATURE_THRESHOLD_MINUTES + 1000,
          stability: 20.0,
          difficulty: 5.0,
        });
        await db.createFlashcard(matureCard);
      }

      // Deck 3: 1 due (not mature), 1 not due review card
      const dueCard3 = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[2], {
        front: "Due Q Deck 3",
        back: "Due A Deck 3",
        state: "review",
        dueDate: dueDate,
        interval: 2880, // 2 days
        stability: 2.0,
        difficulty: 5.0,
      });
      await db.createFlashcard(dueCard3);

      const notDueCard = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[2], {
        front: "Not Due Q",
        back: "Not Due A",
        state: "review",
        dueDate: new Date(Date.now() + 10000).toISOString(),
        interval: 1440,
        stability: 1.5,
        difficulty: 5.0,
      });
      await db.createFlashcard(notDueCard);

      const stats = await deckManager.getDeckGroupStats(deckGroup);

      expect(stats.newCount).toBe(3);
      expect(stats.dueCount).toBe(4); // 1 due from deck1, 2 mature due from deck2, 1 due from deck3
      expect(stats.matureCount).toBe(2);
      expect(stats.totalCount).toBe(8);
    });

    it("should return correct deckId for the group", async () => {
      const stats = await deckManager.getDeckGroupStats(deckGroup);

      // Verify the deckId matches the hash-based ID
      expect(stats.deckId).toBeDefined();
      expect(stats.deckId).toMatch(/^deckgroup_[a-z0-9]+$/);
    });

    it("should handle empty deck group", async () => {
      // Create a deck group with no decks
      const emptyGroup: DeckGroup = {
        type: "group",
        tag: "#flashcards/empty",
        name: "Empty",
        deckIds: [],
        profile: (await db.getProfileById("profile_default"))!,
        lastReviewed: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const stats = await deckManager.getDeckGroupStats(emptyGroup);

      expect(stats.newCount).toBe(0);
      expect(stats.dueCount).toBe(0);
      expect(stats.totalCount).toBe(0);
      expect(stats.matureCount).toBe(0);
    });

    it("should aggregate stats from decks with varying card counts", async () => {
      // Deck 1: 10 cards
      for (let i = 0; i < 10; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
          front: `Q ${i} Deck 1`,
          back: `A ${i} Deck 1`,
          state: "new",
        });
        await db.createFlashcard(card);
      }

      // Deck 2: 0 cards (empty)

      // Deck 3: 5 cards
      for (let i = 0; i < 5; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[2], {
          front: `Q ${i} Deck 3`,
          back: `A ${i} Deck 3`,
          state: "new",
        });
        await db.createFlashcard(card);
      }

      const stats = await deckManager.getDeckGroupStats(deckGroup);

      expect(stats.newCount).toBe(15);
      expect(stats.totalCount).toBe(15);
    });
  });
});
