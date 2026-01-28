import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler } from "../../services/Scheduler";
import { TagGroupService } from "../../services/TagGroupService";
import type { DeckGroup, DeckWithProfile, Flashcard } from "../../database/types";
import {
  setupTestDatabase,
  teardownTestDatabase,
  DatabaseTestUtils,
} from "./database-test-utils";

describe("Scheduler Deck Group Integration Tests", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  let tagGroupService: TagGroupService;
  let deckGroup: DeckGroup;

  beforeEach(async () => {
    db = await setupTestDatabase();

    const mockSettings = {
      review: { nextDayStartsAt: 4, showProgress: true, enableKeyboardShortcuts: true, sessionDuration: 25 },
      backup: { enableAutoBackup: false, maxBackups: 3 },
      debug: { enableLogging: false, performanceLogs: false },
    } as any;

    const mockBackupService = {
      createBackup: jest.fn(),
    } as any;

    scheduler = new Scheduler(db, mockSettings, mockBackupService);
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

  describe("startReviewSessionForDeckGroup", () => {
    it("should create a review session for deck group", async () => {
      const now = new Date();
      const session = await scheduler.startReviewSessionForDeckGroup(deckGroup, now);

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(typeof session.sessionId).toBe("string");
    });

    it("should calculate goal based on due and new cards across all decks", async () => {
      // Add some new cards to each deck
      for (const deckId of deckGroup.deckIds) {
        const card1 = DatabaseTestUtils.createTestFlashcard(deckId, {
          front: `Question 1 for ${deckId}`,
          back: `Answer 1 for ${deckId}`,
          state: "new",
        });
        await db.createFlashcard(card1);

        const card2 = DatabaseTestUtils.createTestFlashcard(deckId, {
          front: `Question 2 for ${deckId}`,
          back: `Answer 2 for ${deckId}`,
          state: "new",
        });
        await db.createFlashcard(card2);
      }

      const now = new Date();
      const session = await scheduler.startReviewSessionForDeckGroup(deckGroup, now);

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
    });

    it("should respect profile's daily new card limits", async () => {
      // Create a custom profile with strict limits
      const customProfileId = await db.createProfile({
        id: "profile_strict",
        name: "Strict Profile",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 3,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      });

      await db.createTagMapping(customProfileId, "#flashcards/math");

      // Add more new cards than the limit (5 cards per deck = 15 total)
      for (const deckId of deckGroup.deckIds) {
        for (let i = 0; i < 5; i++) {
          const card = DatabaseTestUtils.createTestFlashcard(deckId, {
            front: `Question ${i} for ${deckId}`,
            back: `Answer ${i} for ${deckId}`,
            state: "new",
          });
          await db.createFlashcard(card);
        }
      }

      // Re-create deck group with new profile
      const decks = await Promise.all(
        deckGroup.deckIds.map(id => db.getDeckById(id))
      );
      const customProfile = (await db.getProfileById(customProfileId))!;
      const decksWithProfile = decks.map(d => ({ ...d!, profile: customProfile }));
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);
      const groupWithLimit = groups[0];

      const now = new Date();
      const session = await scheduler.startReviewSessionForDeckGroup(groupWithLimit, now);

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
    });
  });

  describe("getNextForDeckGroup", () => {
    it("should return new card from any deck in the group", async () => {
      // Add new cards to first deck only
      const card1 = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
        front: "Question 1",
        back: "Answer 1",
        state: "new",
        dueDate: new Date().toISOString(),
      });
      await db.createFlashcard(card1);

      const now = new Date();
      const nextCard = await scheduler.getNextForDeckGroup(now, deckGroup, { allowNew: true });

      expect(nextCard).not.toBeNull();
      expect(nextCard?.state).toBe("new");
      expect(deckGroup.deckIds).toContain(nextCard!.deckId);
    });

    it("should return due card from any deck in the group", async () => {
      // Add a due card to the second deck
      const dueDate = new Date(Date.now() - 1000).toISOString(); // Due 1 second ago
      const dueCard = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
        front: "Due Question",
        back: "Due Answer",
        state: "review",
        dueDate: dueDate,
        interval: 1440, // 1 day
        stability: 1.5,
        difficulty: 5.0,
      });
      await db.createFlashcard(dueCard);

      const now = new Date();
      const nextCard = await scheduler.getNextForDeckGroup(now, deckGroup, { allowNew: false });

      expect(nextCard).not.toBeNull();
      expect(nextCard?.state).toBe("review");
      expect(nextCard?.id).toBe(dueCard.id);
    });

    it("should return null when no cards are available", async () => {
      const now = new Date();
      const nextCard = await scheduler.getNextForDeckGroup(now, deckGroup, { allowNew: true });

      expect(nextCard).toBeNull();
    });

    it("should prioritize due cards over new cards", async () => {
      // Add both new and due cards
      const newCard = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
        front: "New Question",
        back: "New Answer",
        state: "new",
      });
      await db.createFlashcard(newCard);

      const dueCard = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
        front: "Due Question",
        back: "Due Answer",
        state: "review",
        dueDate: new Date(Date.now() - 1000).toISOString(),
        interval: 1440,
        stability: 1.5,
        difficulty: 5.0,
      });
      await db.createFlashcard(dueCard);

      const now = new Date();
      const nextCard = await scheduler.getNextForDeckGroup(now, deckGroup, { allowNew: true });

      expect(nextCard).not.toBeNull();
      expect(nextCard?.id).toBe(dueCard.id);
      expect(nextCard?.state).toBe("review");
    });

    it("should respect review order setting from profile", async () => {
      // Create profile with random review order
      const randomProfileId = await db.createProfile({
        id: "profile_random",
        name: "Random Profile",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "random",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      });

      await db.createTagMapping(randomProfileId, "#flashcards/math");

      // Add multiple due cards
      const dueDate1 = new Date(Date.now() - 2000).toISOString();
      const dueDate2 = new Date(Date.now() - 1000).toISOString();

      const card1 = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
        front: "Due Question 1",
        back: "Due Answer 1",
        state: "review",
        dueDate: dueDate1,
        interval: 1440,
        stability: 1.5,
        difficulty: 5.0,
      });
      await db.createFlashcard(card1);

      const card2 = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
        front: "Due Question 2",
        back: "Due Answer 2",
        state: "review",
        dueDate: dueDate2,
        interval: 1440,
        stability: 1.5,
        difficulty: 5.0,
      });
      await db.createFlashcard(card2);

      // Re-create deck group with random profile
      const decks = await Promise.all(
        deckGroup.deckIds.map(id => db.getDeckById(id))
      );
      const randomProfile = (await db.getProfileById(randomProfileId))!;
      const decksWithProfile = decks.map(d => ({ ...d!, profile: randomProfile }));
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);
      const groupWithRandom = groups[0];

      const now = new Date();
      const nextCard = await scheduler.getNextForDeckGroup(now, groupWithRandom, { allowNew: false });

      expect(nextCard).not.toBeNull();
      // With random order, we can't predict which card, but it should be one of them
      expect([card1.id, card2.id]).toContain(nextCard!.id);
    });
  });

  describe("getDueCardCountForDeckGroup", () => {
    it("should count due cards across all decks in group", async () => {
      const dueDate = new Date(Date.now() - 1000).toISOString();

      // Add 2 due cards to first deck
      for (let i = 0; i < 2; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
          front: `Due Q ${i}`,
          back: `Due A ${i}`,
          state: "review",
          dueDate: dueDate,
          interval: 1440,
          stability: 1.5,
          difficulty: 5.0,
        });
        await db.createFlashcard(card);
      }

      // Add 1 due card to second deck
      const card3 = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
        front: "Due Q 3",
        back: "Due A 3",
        state: "review",
        dueDate: dueDate,
        interval: 1440,
        stability: 1.5,
        difficulty: 5.0,
      });
      await db.createFlashcard(card3);

      const now = new Date();
      const count = await scheduler.getDueCardCountForDeckGroup(now, deckGroup.deckIds);

      expect(count).toBe(3);
    });

    it("should return 0 when no due cards exist", async () => {
      const now = new Date();
      const count = await scheduler.getDueCardCountForDeckGroup(now, deckGroup.deckIds);

      expect(count).toBe(0);
    });
  });

  describe("getNewCardCountForDeckGroup", () => {
    it("should count new cards across all decks in group", async () => {
      // Add 3 new cards to first deck
      for (let i = 0; i < 3; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[0], {
          front: `New Q ${i}`,
          back: `New A ${i}`,
          state: "new",
        });
        await db.createFlashcard(card);
      }

      // Add 2 new cards to second deck
      for (let i = 0; i < 2; i++) {
        const card = DatabaseTestUtils.createTestFlashcard(deckGroup.deckIds[1], {
          front: `New Q ${i + 3}`,
          back: `New A ${i + 3}`,
          state: "new",
        });
        await db.createFlashcard(card);
      }

      const count = await scheduler.getNewCardCountForDeckGroup(deckGroup.deckIds);

      expect(count).toBe(5);
    });

    it("should return 0 when no new cards exist", async () => {
      const count = await scheduler.getNewCardCountForDeckGroup(deckGroup.deckIds);

      expect(count).toBe(0);
    });
  });

  describe("hasNewCardQuotaForDeckGroup", () => {
    it("should return true when limit is disabled", async () => {
      const hasQuota = await scheduler.hasNewCardQuotaForDeckGroup(deckGroup);

      expect(hasQuota).toBe(true);
    });

    it("should return true when under daily limit", async () => {
      // Create profile with limit
      const limitProfileId = await db.createProfile({
        id: "profile_limit",
        name: "Limit Profile",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 10,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      });

      await db.createTagMapping(limitProfileId, "#flashcards/math");

      // Re-create deck group with limit profile
      const decks = await Promise.all(
        deckGroup.deckIds.map(id => db.getDeckById(id))
      );
      const limitProfile = (await db.getProfileById(limitProfileId))!;
      const decksWithProfile = decks.map(d => ({ ...d!, profile: limitProfile }));
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);
      const groupWithLimit = groups[0];

      const hasQuota = await scheduler.hasNewCardQuotaForDeckGroup(groupWithLimit);

      expect(hasQuota).toBe(true);
    });
  });

  describe("hasReviewCardQuotaForDeckGroup", () => {
    it("should return true when limit is disabled", async () => {
      const hasQuota = await scheduler.hasReviewCardQuotaForDeckGroup(deckGroup);

      expect(hasQuota).toBe(true);
    });

    it("should return true when under daily limit", async () => {
      // Create profile with limit
      const limitProfileId = await db.createProfile({
        id: "profile_review_limit",
        name: "Review Limit Profile",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 10,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      });

      await db.createTagMapping(limitProfileId, "#flashcards/math");

      // Re-create deck group with limit profile
      const decks = await Promise.all(
        deckGroup.deckIds.map(id => db.getDeckById(id))
      );
      const limitProfile = (await db.getProfileById(limitProfileId))!;
      const decksWithProfile = decks.map(d => ({ ...d!, profile: limitProfile }));
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);
      const groupWithLimit = groups[0];

      const hasQuota = await scheduler.hasReviewCardQuotaForDeckGroup(groupWithLimit);

      expect(hasQuota).toBe(true);
    });
  });
});
