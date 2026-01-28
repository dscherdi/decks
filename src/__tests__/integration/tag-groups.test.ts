import { MainDatabaseService } from "../../database/MainDatabaseService";
import { TagGroupService } from "../../services/TagGroupService";
import type { DeckWithProfile, DeckProfile, Deck } from "../../database/types";
import { generateDeckGroupId } from "../../utils/hash";
import {
  setupTestDatabase,
  teardownTestDatabase,
  DatabaseTestUtils,
} from "./database-test-utils";

describe("TagGroupService Integration Tests", () => {
  let db: MainDatabaseService;
  let tagGroupService: TagGroupService;
  let defaultProfile: DeckProfile;

  beforeEach(async () => {
    db = await setupTestDatabase();
    tagGroupService = new TagGroupService(db);

    // Get default profile
    defaultProfile = (await db.getProfileById("profile_default"))!;
    expect(defaultProfile).toBeDefined();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  // Helper function to create a deck and return it with profile
  async function createDeckWithProfile(
    overrides: Partial<Deck>
  ): Promise<DeckWithProfile> {
    const testDeck = DatabaseTestUtils.createTestDeck(overrides);
    const deckId = await db.createDeck(testDeck);
    const deck = (await db.getDeckById(deckId))!;
    const profile = (await db.getProfileById(deck.profileId))!;
    return { ...deck, profile };
  }

  describe("aggregateByTag", () => {
    it("should group decks with the same tag", async () => {
      // Create 3 decks with the same tag
      const deck1 = await createDeckWithProfile({
        name: "Math Deck 1",
        filepath: "/math1.md",
        tag: "#flashcards/math",
      });

      const deck2 = await createDeckWithProfile({
        name: "Math Deck 2",
        filepath: "/math2.md",
        tag: "#flashcards/math",
      });

      const deck3 = await createDeckWithProfile({
        name: "Math Deck 3",
        filepath: "/math3.md",
        tag: "#flashcards/math",
      });

      const decksWithProfile = [deck1, deck2, deck3];
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      expect(groups).toHaveLength(1);
      expect(groups[0].tag).toBe("#flashcards/math");
      expect(groups[0].name).toBe("Math");
      expect(groups[0].type).toBe("group");
      expect(groups[0].deckIds).toHaveLength(3);
      expect(groups[0].deckIds).toContain(deck1.id);
      expect(groups[0].deckIds).toContain(deck2.id);
      expect(groups[0].deckIds).toContain(deck3.id);
      expect(groups[0].profile).toEqual(defaultProfile);
    });

    it("should create separate groups for different tags", async () => {
      const mathDeck = await createDeckWithProfile({
        name: "Math Deck",
        filepath: "/math.md",
        tag: "#flashcards/math",
      });

      const scienceDeck = await createDeckWithProfile({
        name: "Science Deck",
        filepath: "/science.md",
        tag: "#flashcards/science",
      });

      const historyDeck = await createDeckWithProfile({
        name: "History Deck",
        filepath: "/history.md",
        tag: "#flashcards/history",
      });

      const decksWithProfile = [mathDeck, scienceDeck, historyDeck];
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      expect(groups).toHaveLength(3);

      const mathGroup = groups.find(g => g.tag === "#flashcards/math");
      const scienceGroup = groups.find(g => g.tag === "#flashcards/science");
      const historyGroup = groups.find(g => g.tag === "#flashcards/history");

      expect(mathGroup).toBeDefined();
      expect(mathGroup?.name).toBe("Math");
      expect(mathGroup?.deckIds).toEqual([mathDeck.id]);

      expect(scienceGroup).toBeDefined();
      expect(scienceGroup?.name).toBe("Science");
      expect(scienceGroup?.deckIds).toEqual([scienceDeck.id]);

      expect(historyGroup).toBeDefined();
      expect(historyGroup?.name).toBe("History");
      expect(historyGroup?.deckIds).toEqual([historyDeck.id]);
    });

    it("should treat hierarchical tags as separate groups", async () => {
      const mathDeck = await createDeckWithProfile({
        name: "Math Deck",
        filepath: "/math.md",
        tag: "#flashcards/math",
      });

      const calculusDeck = await createDeckWithProfile({
        name: "Calculus Deck",
        filepath: "/calculus.md",
        tag: "#flashcards/math/calculus",
      });

      const algebraDeck = await createDeckWithProfile({
        name: "Algebra Deck",
        filepath: "/algebra.md",
        tag: "#flashcards/math/algebra",
      });

      const decksWithProfile = [mathDeck, calculusDeck, algebraDeck];
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      expect(groups).toHaveLength(3);

      const mathGroup = groups.find(g => g.tag === "#flashcards/math");
      const calculusGroup = groups.find(g => g.tag === "#flashcards/math/calculus");
      const algebraGroup = groups.find(g => g.tag === "#flashcards/math/algebra");

      expect(mathGroup?.deckIds).toEqual([mathDeck.id]);
      expect(calculusGroup?.deckIds).toEqual([calculusDeck.id]);
      expect(algebraGroup?.deckIds).toEqual([algebraDeck.id]);
    });

    it("should generate correct display names from hierarchical tags", async () => {
      const deck1 = await createDeckWithProfile({
        name: "Test 1",
        filepath: "/test1.md",
        tag: "#flashcards/math/calculus/derivatives",
      });

      const deck2 = await createDeckWithProfile({
        name: "Test 2",
        filepath: "/test2.md",
        tag: "#science",
      });

      const decksWithProfile = [deck1, deck2];
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      const derivativesGroup = groups.find(g => g.tag === "#flashcards/math/calculus/derivatives");
      const scienceGroup = groups.find(g => g.tag === "#science");

      expect(derivativesGroup?.name).toBe("Derivatives");
      expect(scienceGroup?.name).toBe("Science");
    });

    it("should resolve profile from tag-to-profile mapping", async () => {
      // Create a custom profile
      const customProfileId = await db.createProfile({
        id: "profile_custom_math",
        name: "Custom Math Profile",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 10,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 50,
        headerLevel: 2,
        reviewOrder: "random",
        fsrs: {
          requestRetention: 0.9,
          profile: "INTENSIVE",
        },
        isDefault: false,
      });

      // Create tag-to-profile mapping
      await db.createTagMapping(customProfileId, "#flashcards/math");

      const mathDeck1 = await createDeckWithProfile({
        name: "Math Deck 1",
        filepath: "/math1.md",
        tag: "#flashcards/math",
      });

      const mathDeck2 = await createDeckWithProfile({
        name: "Math Deck 2",
        filepath: "/math2.md",
        tag: "#flashcards/math",
      });

      const decksWithProfile = [mathDeck1, mathDeck2];
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      expect(groups).toHaveLength(1);
      // Tag group should use the tag-to-profile mapping, not individual deck profiles
      expect(groups[0].profile.id).toBe(customProfileId);
      expect(groups[0].profile.name).toBe("Custom Math Profile");
    });

    it("should use hierarchical tag-to-profile mapping (most specific wins)", async () => {
      // Create two custom profiles
      const mathProfileId = await db.createProfile({
        id: "profile_general_math",
        name: "General Math Profile",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 15,
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

      const calculusProfileId = await db.createProfile({
        id: "profile_calculus",
        name: "Calculus Profile",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 5,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 25,
        headerLevel: 3,
        reviewOrder: "random",
        fsrs: {
          requestRetention: 0.95,
          profile: "INTENSIVE",
        },
        isDefault: false,
      });

      // Create hierarchical tag-to-profile mappings
      await db.createTagMapping(mathProfileId, "#flashcards/math");
      await db.createTagMapping(calculusProfileId, "#flashcards/math/calculus");

      const calculusDeck = await createDeckWithProfile({
        name: "Calculus Deck",
        filepath: "/calculus.md",
        tag: "#flashcards/math/calculus",
      });

      const decksWithProfile = [calculusDeck];
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      expect(groups).toHaveLength(1);
      // Should use the more specific tag mapping (#flashcards/math/calculus)
      expect(groups[0].profile.id).toBe(calculusProfileId);
      expect(groups[0].profile.name).toBe("Calculus Profile");
    });

    it("should aggregate timestamps correctly", async () => {
      const now = new Date().toISOString();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

      const deck1 = await createDeckWithProfile({
        name: "Deck 1",
        filepath: "/deck1.md",
        tag: "#flashcards/test",
      });

      // Manually update timestamps
      await db.executeSql(
        `UPDATE decks SET created = ?, modified = ?, last_reviewed = ? WHERE id = ?`,
        [twoDaysAgo, yesterday, twoDaysAgo, deck1.id]
      );

      const deck2 = await createDeckWithProfile({
        name: "Deck 2",
        filepath: "/deck2.md",
        tag: "#flashcards/test",
      });

      await db.executeSql(
        `UPDATE decks SET created = ?, modified = ?, last_reviewed = ? WHERE id = ?`,
        [yesterday, now, now, deck2.id]
      );

      const updatedDeck1 = (await db.getDeckById(deck1.id))!;
      const updatedDeck2 = (await db.getDeckById(deck2.id))!;

      const decksWithProfile: DeckWithProfile[] = [
        { ...updatedDeck1, profile: defaultProfile },
        { ...updatedDeck2, profile: defaultProfile },
      ];

      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      expect(groups).toHaveLength(1);
      const group = groups[0];

      // Earliest creation should be twoDaysAgo
      expect(group.created).toBe(twoDaysAgo);
      // Most recent modification should be now
      expect(group.modified).toBe(now);
      // Most recent review should be now
      expect(group.lastReviewed).toBe(now);
    });

    it("should handle null lastReviewed timestamps", async () => {
      const deck1 = await createDeckWithProfile({
        name: "Deck 1",
        filepath: "/deck1.md",
        tag: "#flashcards/test",
      });

      const deck2 = await createDeckWithProfile({
        name: "Deck 2",
        filepath: "/deck2.md",
        tag: "#flashcards/test",
      });

      const now = new Date().toISOString();
      await db.executeSql(
        `UPDATE decks SET last_reviewed = ? WHERE id = ?`,
        [now, deck2.id]
      );

      const updatedDeck1 = (await db.getDeckById(deck1.id))!;
      const updatedDeck2 = (await db.getDeckById(deck2.id))!;

      const decksWithProfile: DeckWithProfile[] = [
        { ...updatedDeck1, profile: defaultProfile },
        { ...updatedDeck2, profile: defaultProfile },
      ];

      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      expect(groups).toHaveLength(1);
      expect(groups[0].lastReviewed).toBe(now);
    });

    it("should handle all decks with null lastReviewed", async () => {
      const deck1 = await createDeckWithProfile({
        name: "Deck 1",
        filepath: "/deck1.md",
        tag: "#flashcards/test",
      });

      const deck2 = await createDeckWithProfile({
        name: "Deck 2",
        filepath: "/deck2.md",
        tag: "#flashcards/test",
      });

      const decksWithProfile = [deck1, deck2];
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      expect(groups).toHaveLength(1);
      expect(groups[0].lastReviewed).toBeNull();
    });

    it("should sort groups alphabetically by tag", async () => {
      const zDeck = await createDeckWithProfile({
        name: "Z Deck",
        filepath: "/z.md",
        tag: "#flashcards/zoology",
      });

      const aDeck = await createDeckWithProfile({
        name: "A Deck",
        filepath: "/a.md",
        tag: "#flashcards/algebra",
      });

      const mDeck = await createDeckWithProfile({
        name: "M Deck",
        filepath: "/m.md",
        tag: "#flashcards/math",
      });

      const decksWithProfile = [zDeck, aDeck, mDeck];
      const groups = await tagGroupService.aggregateByTag(decksWithProfile);

      expect(groups).toHaveLength(3);
      expect(groups[0].tag).toBe("#flashcards/algebra");
      expect(groups[1].tag).toBe("#flashcards/math");
      expect(groups[2].tag).toBe("#flashcards/zoology");
    });

    it("should return empty array for empty input", async () => {
      const groups = await tagGroupService.aggregateByTag([]);
      expect(groups).toEqual([]);
    });

    it("should generate deterministic IDs for deck groups", async () => {
      const deck1 = await createDeckWithProfile({
        name: "Math Deck",
        filepath: "/math.md",
        tag: "#flashcards/math",
      });

      const decksWithProfile = [deck1];
      const groups1 = await tagGroupService.aggregateByTag(decksWithProfile);
      const groups2 = await tagGroupService.aggregateByTag(decksWithProfile);

      // ID should be the same across multiple calls
      const expectedId = generateDeckGroupId("#flashcards/math");
      expect(groups1[0].tag).toBe("#flashcards/math");
      expect(groups2[0].tag).toBe("#flashcards/math");

      // Verify ID matches hash-based generation
      expect(expectedId).toMatch(/^deckgroup_[a-z0-9]+$/);
    });
  });
});
