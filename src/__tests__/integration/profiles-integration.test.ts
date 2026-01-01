/**
 * Comprehensive integration tests for profiles and decks with real SQL.js database
 *
 * Tests profile CRUD operations, tag mappings, profile assignment, fallback behavior,
 * and deck-profile interactions.
 */

import { MainDatabaseService } from "../../database/MainDatabaseService";
import type { DeckProfile } from "../../database/types";
import { DEFAULT_PROFILE_ID } from "../../database/types";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";

describe("Profiles Integration Tests", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  describe("Profile CRUD Operations", () => {
    it("should create and retrieve a profile", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_test",
        name: "Test Profile",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 15,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 75,
        headerLevel: 3,
        reviewOrder: "random",
        fsrs: {
          requestRetention: 0.92,
          profile: "INTENSIVE",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.save();

      const retrieved = await db.getProfileById("profile_test");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe("Test Profile");
      expect(retrieved?.newCardsPerDay).toBe(15);
      expect(retrieved?.fsrs.requestRetention).toBe(0.92);
    });

    it("should update profile settings", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_update",
        name: "Update Test",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.save();

      // Update profile
      await db.updateProfile("profile_update", {
        name: "Updated Name",
        newCardsPerDay: 25,
        hasNewCardsLimitEnabled: true,
        headerLevel: 4,
      });
      await db.save();

      const updated = await db.getProfileById("profile_update");
      expect(updated?.name).toBe("Updated Name");
      expect(updated?.newCardsPerDay).toBe(25);
      expect(updated?.hasNewCardsLimitEnabled).toBe(true);
      expect(updated?.headerLevel).toBe(4);
      // Unchanged fields should remain the same
      expect(updated?.reviewOrder).toBe("due-date");
    });

    it("should delete profile and reset affected decks to DEFAULT", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_delete",
        name: "Delete Test",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.save();

      // Create decks using this profile
      await db.createDeck({
        id: "deck1",
        name: "Deck 1",
        filepath: "deck1.md",
        tag: "#test",
        lastReviewed: null,
        profileId: "profile_delete",
      });

      await db.createDeck({
        id: "deck2",
        name: "Deck 2",
        filepath: "deck2.md",
        tag: "#test",
        lastReviewed: null,
        profileId: "profile_delete",
      });

      await db.save();

      // Verify decks are using the profile
      const deck1Before = await db.getDeckById("deck1");
      const deck2Before = await db.getDeckById("deck2");
      expect(deck1Before?.profileId).toBe("profile_delete");
      expect(deck2Before?.profileId).toBe("profile_delete");

      // Delete profile
      await db.deleteProfile("profile_delete");
      await db.save();

      // Verify profile is deleted
      const deletedProfile = await db.getProfileById("profile_delete");
      expect(deletedProfile).toBeNull();

      // Verify decks are reset to DEFAULT
      const deck1After = await db.getDeckById("deck1");
      const deck2After = await db.getDeckById("deck2");
      expect(deck1After?.profileId).toBe(DEFAULT_PROFILE_ID);
      expect(deck2After?.profileId).toBe(DEFAULT_PROFILE_ID);
    });

    it("should retrieve all profiles with DEFAULT first", async () => {
      const profile1: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_a",
        name: "Profile A",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      const profile2: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_b",
        name: "Profile B",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile1);
      await db.createProfile(profile2);
      await db.save();

      const allProfiles = await db.getAllProfiles();
      expect(allProfiles.length).toBeGreaterThanOrEqual(3); // DEFAULT + 2 created
      expect(allProfiles[0].isDefault).toBe(true);
      expect(allProfiles[0].id).toBe(DEFAULT_PROFILE_ID);
    });

    it("should not allow deleting DEFAULT profile", async () => {
      // Attempting to delete DEFAULT should not throw but should be handled
      await db.deleteProfile(DEFAULT_PROFILE_ID);
      await db.save();

      const defaultProfile = await db.getProfileById(DEFAULT_PROFILE_ID);
      expect(defaultProfile).not.toBeNull();
      expect(defaultProfile?.isDefault).toBe(true);
    });
  });

  describe("Tag Mapping Operations", () => {
    it("should create and retrieve tag mappings", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_tags",
        name: "Tag Test",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.createTagMapping("profile_tags", "#math");
      await db.createTagMapping("profile_tags", "#science");
      await db.save();

      const mappings = await db.getTagMappingsForProfile("profile_tags");
      expect(mappings.length).toBe(2);
      expect(mappings.some((m) => m.tag === "#math")).toBe(true);
      expect(mappings.some((m) => m.tag === "#science")).toBe(true);
    });

    it("should delete tag mappings when profile is deleted", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_tagdel",
        name: "Tag Delete Test",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.createTagMapping("profile_tagdel", "#test-tag");
      await db.save();

      const mappingsBefore = await db.getTagMappingsForProfile(
        "profile_tagdel"
      );
      expect(mappingsBefore.length).toBe(1);

      // Delete profile
      await db.deleteProfile("profile_tagdel");
      await db.save();

      // Tag mappings should be deleted
      const mappingsAfter = await db.getTagMappingsForProfile("profile_tagdel");
      expect(mappingsAfter.length).toBe(0);
    });

    it("should apply profile to all decks with matching tag", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_apply",
        name: "Apply Test",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.save();

      // Create decks with #apply tag
      await db.createDeck({
        id: "deck_apply1",
        name: "Apply Deck 1",
        filepath: "apply1.md",
        tag: "#apply",
        lastReviewed: null,
      });

      await db.createDeck({
        id: "deck_apply2",
        name: "Apply Deck 2",
        filepath: "apply2.md",
        tag: "#apply",
        lastReviewed: null,
      });

      await db.createDeck({
        id: "deck_other",
        name: "Other Deck",
        filepath: "other.md",
        tag: "#other",
        lastReviewed: null,
      });

      await db.save();

      // Apply profile to #apply tag
      const count = await db.applyProfileToTag("profile_apply", "#apply");
      await db.save();

      expect(count).toBe(2);

      // Verify decks with #apply now use the profile
      const deck1 = await db.getDeckById("deck_apply1");
      const deck2 = await db.getDeckById("deck_apply2");
      const deckOther = await db.getDeckById("deck_other");

      expect(deck1?.profileId).toBe("profile_apply");
      expect(deck2?.profileId).toBe("profile_apply");
      expect(deckOther?.profileId).toBe(DEFAULT_PROFILE_ID);
    });
  });

  describe("Deck-Profile Interactions", () => {
    it("should auto-assign profile based on tag when creating deck", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_auto",
        name: "Auto Assign",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 10,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 50,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.createTagMapping("profile_auto", "#auto-test");
      await db.save();

      // Create deck with matching tag (no profileId specified)
      await db.createDeck({
        id: "deck_auto",
        name: "Auto Deck",
        filepath: "auto.md",
        tag: "#auto-test",
        lastReviewed: null,
      });

      await db.save();

      const deck = await db.getDeckById("deck_auto");
      expect(deck?.profileId).toBe("profile_auto");
    });

    it("should use DEFAULT profile when no tag mapping exists", async () => {
      await db.createDeck({
        id: "deck_default",
        name: "Default Deck",
        filepath: "default.md",
        tag: "#no-mapping",
        lastReviewed: null,
      });

      await db.save();

      const deck = await db.getDeckById("deck_default");
      expect(deck?.profileId).toBe(DEFAULT_PROFILE_ID);
    });

    it("should get deck with resolved profile using getDeckWithProfile", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_resolve",
        name: "Resolve Test",
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
      };

      await db.createProfile(profile);
      await db.save();

      await db.createDeck({
        id: "deck_resolve",
        name: "Resolve Deck",
        filepath: "resolve.md",
        tag: "#resolve",
        lastReviewed: null,
        profileId: "profile_resolve",
      });

      await db.save();

      const deckWithProfile = await db.getDeckWithProfile("deck_resolve");
      expect(deckWithProfile).not.toBeNull();
      expect(deckWithProfile?.profile).toBeDefined();
      expect(deckWithProfile?.profile.id).toBe("profile_resolve");
      expect(deckWithProfile?.profile.name).toBe("Resolve Test");
      expect(deckWithProfile?.profile.newCardsPerDay).toBe(5);
    });

    it("should fall back to DEFAULT profile when profile is missing", async () => {
      // Create deck with non-existent profile
      await db.createDeck({
        id: "deck_missing",
        name: "Missing Profile Deck",
        filepath: "missing.md",
        tag: "#missing",
        lastReviewed: null,
        profileId: "non_existent_profile",
      });

      await db.save();

      // getDeckWithProfile should fall back to DEFAULT and update deck
      const deckWithProfile = await db.getDeckWithProfile("deck_missing");
      expect(deckWithProfile).not.toBeNull();
      expect(deckWithProfile?.profile.id).toBe(DEFAULT_PROFILE_ID);
      expect(deckWithProfile?.profile.isDefault).toBe(true);

      // Verify deck was updated
      const updatedDeck = await db.getDeckById("deck_missing");
      expect(updatedDeck?.profileId).toBe(DEFAULT_PROFILE_ID);
    });

    it("should get all decks with resolved profiles", async () => {
      const profile1: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_all1",
        name: "Profile 1",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      const profile2: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_all2",
        name: "Profile 2",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 15,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 75,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile1);
      await db.createProfile(profile2);
      await db.save();

      await db.createDeck({
        id: "deck_all1",
        name: "Deck 1",
        filepath: "deck1.md",
        tag: "#all1",
        lastReviewed: null,
        profileId: "profile_all1",
      });

      await db.createDeck({
        id: "deck_all2",
        name: "Deck 2",
        filepath: "deck2.md",
        tag: "#all2",
        lastReviewed: null,
        profileId: "profile_all2",
      });

      await db.createDeck({
        id: "deck_default",
        name: "Default Deck",
        filepath: "default.md",
        tag: "#default",
        lastReviewed: null,
      });

      await db.save();

      const decksWithProfiles = await db.getAllDecksWithProfiles();
      expect(decksWithProfiles.length).toBe(3);

      const deck1 = decksWithProfiles.find((d) => d.id === "deck_all1");
      const deck2 = decksWithProfiles.find((d) => d.id === "deck_all2");
      const deckDefault = decksWithProfiles.find((d) => d.id === "deck_default");

      expect(deck1?.profile.id).toBe("profile_all1");
      expect(deck2?.profile.id).toBe("profile_all2");
      expect(deckDefault?.profile.id).toBe(DEFAULT_PROFILE_ID);
    });

    it("should count decks using a profile", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_count",
        name: "Count Test",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.save();

      // Initially no decks
      let count = await db.getDeckCountForProfile("profile_count");
      expect(count).toBe(0);

      // Create 3 decks with this profile
      await db.createDeck({
        id: "deck_count1",
        name: "Count Deck 1",
        filepath: "count1.md",
        tag: "#count",
        lastReviewed: null,
        profileId: "profile_count",
      });

      await db.createDeck({
        id: "deck_count2",
        name: "Count Deck 2",
        filepath: "count2.md",
        tag: "#count",
        lastReviewed: null,
        profileId: "profile_count",
      });

      await db.createDeck({
        id: "deck_count3",
        name: "Count Deck 3",
        filepath: "count3.md",
        tag: "#count",
        lastReviewed: null,
        profileId: "profile_count",
      });

      await db.save();

      count = await db.getDeckCountForProfile("profile_count");
      expect(count).toBe(3);
    });

    it("should get all decks using a specific profile", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_getdecks",
        name: "Get Decks Test",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.save();

      await db.createDeck({
        id: "deck_prof1",
        name: "Profile Deck 1",
        filepath: "prof1.md",
        tag: "#prof",
        lastReviewed: null,
        profileId: "profile_getdecks",
      });

      await db.createDeck({
        id: "deck_prof2",
        name: "Profile Deck 2",
        filepath: "prof2.md",
        tag: "#prof",
        lastReviewed: null,
        profileId: "profile_getdecks",
      });

      await db.createDeck({
        id: "deck_other",
        name: "Other Deck",
        filepath: "other.md",
        tag: "#other",
        lastReviewed: null,
      });

      await db.save();

      const decks = await db.getDecksByProfile("profile_getdecks");
      expect(decks.length).toBe(2);
      expect(decks.some((d) => d.id === "deck_prof1")).toBe(true);
      expect(decks.some((d) => d.id === "deck_prof2")).toBe(true);
      expect(decks.some((d) => d.id === "deck_other")).toBe(false);
    });
  });

  describe("Tag Hierarchy", () => {
    it("should use most specific tag when multiple mappings match", async () => {
      const generalProfile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_general",
        name: "General",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      const specificProfile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_specific",
        name: "Specific",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 10,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 50,
        headerLevel: 3,
        reviewOrder: "random",
        fsrs: {
          requestRetention: 0.95,
          profile: "INTENSIVE",
        },
        isDefault: false,
      };

      await db.createProfile(generalProfile);
      await db.createProfile(specificProfile);
      await db.createTagMapping("profile_general", "#flashcards");
      await db.createTagMapping("profile_specific", "#flashcards/math");
      await db.save();

      // Create deck with specific tag
      await db.createDeck({
        id: "deck_math",
        name: "Math Deck",
        filepath: "math.md",
        tag: "#flashcards/math",
        lastReviewed: null,
      });

      // Create deck with general tag
      await db.createDeck({
        id: "deck_general",
        name: "General Deck",
        filepath: "general.md",
        tag: "#flashcards",
        lastReviewed: null,
      });

      // Create deck with child of specific tag
      await db.createDeck({
        id: "deck_algebra",
        name: "Algebra Deck",
        filepath: "algebra.md",
        tag: "#flashcards/math/algebra",
        lastReviewed: null,
      });

      await db.save();

      const mathDeck = await db.getDeckById("deck_math");
      const generalDeck = await db.getDeckById("deck_general");
      const algebraDeck = await db.getDeckById("deck_algebra");

      expect(mathDeck?.profileId).toBe("profile_specific");
      expect(generalDeck?.profileId).toBe("profile_general");
      expect(algebraDeck?.profileId).toBe("profile_specific"); // Uses most specific parent
    });
  });

  describe("Profile Settings Validation", () => {
    it("should persist all profile settings correctly", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_full",
        name: "Full Test Profile",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 12,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 87,
        headerLevel: 4,
        reviewOrder: "random",
        fsrs: {
          requestRetention: 0.87,
          profile: "INTENSIVE",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.save();

      const retrieved = await db.getProfileById("profile_full");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("profile_full");
      expect(retrieved?.name).toBe("Full Test Profile");
      expect(retrieved?.hasNewCardsLimitEnabled).toBe(true);
      expect(retrieved?.newCardsPerDay).toBe(12);
      expect(retrieved?.hasReviewCardsLimitEnabled).toBe(true);
      expect(retrieved?.reviewCardsPerDay).toBe(87);
      expect(retrieved?.headerLevel).toBe(4);
      expect(retrieved?.reviewOrder).toBe("random");
      expect(retrieved?.fsrs.requestRetention).toBe(0.87);
      expect(retrieved?.fsrs.profile).toBe("INTENSIVE");
      expect(retrieved?.isDefault).toBe(false);
      expect(retrieved?.created).toBeDefined();
      expect(retrieved?.modified).toBeDefined();
    });

    it("should handle profile with all limits disabled", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_unlimited",
        name: "Unlimited Profile",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 0, // Should be ignored
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 0, // Should be ignored
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.save();

      const retrieved = await db.getProfileById("profile_unlimited");
      expect(retrieved?.hasNewCardsLimitEnabled).toBe(false);
      expect(retrieved?.hasReviewCardsLimitEnabled).toBe(false);
    });

    it("should handle all header levels (1-6)", async () => {
      for (let level = 1; level <= 6; level++) {
        const profile: Omit<DeckProfile, "created" | "modified"> = {
          id: `profile_h${level}`,
          name: `H${level} Profile`,
          hasNewCardsLimitEnabled: false,
          newCardsPerDay: 20,
          hasReviewCardsLimitEnabled: false,
          reviewCardsPerDay: 100,
          headerLevel: level,
          reviewOrder: "due-date",
          fsrs: {
            requestRetention: 0.9,
            profile: "STANDARD",
          },
          isDefault: false,
        };

        await db.createProfile(profile);
      }

      await db.save();

      for (let level = 1; level <= 6; level++) {
        const retrieved = await db.getProfileById(`profile_h${level}`);
        expect(retrieved?.headerLevel).toBe(level);
      }
    });

    it("should handle both review order options", async () => {
      const profileDueDate: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_duedate",
        name: "Due Date Profile",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      const profileRandom: Omit<DeckProfile, "created" | "modified"> = {
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
      };

      await db.createProfile(profileDueDate);
      await db.createProfile(profileRandom);
      await db.save();

      const retrievedDueDate = await db.getProfileById("profile_duedate");
      const retrievedRandom = await db.getProfileById("profile_random");

      expect(retrievedDueDate?.reviewOrder).toBe("due-date");
      expect(retrievedRandom?.reviewOrder).toBe("random");
    });

    it("should handle both FSRS profile types", async () => {
      const profileStandard: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_standard",
        name: "Standard FSRS",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      const profileIntensive: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_intensive",
        name: "Intensive FSRS",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.95,
          profile: "INTENSIVE",
        },
        isDefault: false,
      };

      await db.createProfile(profileStandard);
      await db.createProfile(profileIntensive);
      await db.save();

      const retrievedStandard = await db.getProfileById("profile_standard");
      const retrievedIntensive = await db.getProfileById("profile_intensive");

      expect(retrievedStandard?.fsrs.profile).toBe("STANDARD");
      expect(retrievedIntensive?.fsrs.profile).toBe("INTENSIVE");
    });
  });

  describe("Tag Hierarchy", () => {
    it("should use most specific tag when multiple tag mappings match", async () => {
      const generalProfile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_general",
        name: "General Profile",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      const specificProfile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_specific",
        name: "Math Profile",
        hasNewCardsLimitEnabled: true,
        newCardsPerDay: 10,
        hasReviewCardsLimitEnabled: true,
        reviewCardsPerDay: 50,
        headerLevel: 3,
        reviewOrder: "random",
        fsrs: {
          requestRetention: 0.95,
          profile: "INTENSIVE",
        },
        isDefault: false,
      };

      await db.createProfile(generalProfile);
      await db.createProfile(specificProfile);
      await db.createTagMapping("profile_general", "#flashcards");
      await db.createTagMapping("profile_specific", "#flashcards/math");
      await db.save();

      const generalProfileId = await db.getProfileIdForTag("#flashcards");
      expect(generalProfileId).toBe("profile_general");

      const specificProfileId = await db.getProfileIdForTag("#flashcards/math");
      expect(specificProfileId).toBe("profile_specific");

      const algebraProfileId = await db.getProfileIdForTag(
        "#flashcards/math/algebra"
      );
      expect(algebraProfileId).toBe("profile_specific");

      const scienceProfileId = await db.getProfileIdForTag(
        "#flashcards/science"
      );
      expect(scienceProfileId).toBe("profile_general");
    });

    it("should handle exact tag matches", async () => {
      const profile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_exact",
        name: "Exact Profile",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(profile);
      await db.createTagMapping("profile_exact", "#exact-match");
      await db.save();

      const profileId = await db.getProfileIdForTag("#exact-match");
      expect(profileId).toBe("profile_exact");

      const childProfileId = await db.getProfileIdForTag("#exact-match/child");
      expect(childProfileId).toBe("profile_exact");
    });

    it("should return null when no tag mappings match", async () => {
      const profileId = await db.getProfileIdForTag("#no-match");
      expect(profileId).toBeNull();
    });

    it("should prefer longer tags when multiple mappings match", async () => {
      const level1: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_level1",
        name: "Level 1",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      const level2: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_level2",
        name: "Level 2",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 15,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 75,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      const level3: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_level3",
        name: "Level 3",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 10,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 50,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      await db.createProfile(level1);
      await db.createProfile(level2);
      await db.createProfile(level3);
      await db.createTagMapping("profile_level1", "#studies");
      await db.createTagMapping("profile_level2", "#studies/university");
      await db.createTagMapping(
        "profile_level3",
        "#studies/university/computer-science"
      );
      await db.save();

      const deepProfileId = await db.getProfileIdForTag(
        "#studies/university/computer-science/algorithms"
      );
      expect(deepProfileId).toBe("profile_level3");

      const midProfileId = await db.getProfileIdForTag(
        "#studies/university/biology"
      );
      expect(midProfileId).toBe("profile_level2");

      const topProfileId = await db.getProfileIdForTag("#studies/highschool");
      expect(topProfileId).toBe("profile_level1");
    });

    it("should use specific tag profile when creating deck", async () => {
      const generalProfile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_general_create",
        name: "General",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
        isDefault: false,
      };

      const mathProfile: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_math_create",
        name: "Math",
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
      };

      await db.createProfile(generalProfile);
      await db.createProfile(mathProfile);
      await db.createTagMapping("profile_general_create", "#flashcards");
      await db.createTagMapping("profile_math_create", "#flashcards/math");
      await db.save();

      const deckId = await db.createDeck({
        id: "deck_math_hierarchy",
        name: "Math Deck",
        filepath: "math.md",
        tag: "#flashcards/math",
        lastReviewed: null,
      });

      const deck = await db.getDeckById(deckId);
      expect(deck?.profileId).toBe("profile_math_create");

      const generalDeckId = await db.createDeck({
        id: "deck_general_hierarchy",
        name: "General Deck",
        filepath: "general.md",
        tag: "#flashcards",
        lastReviewed: null,
      });

      const generalDeck = await db.getDeckById(generalDeckId);
      expect(generalDeck?.profileId).toBe("profile_general_create");
    });
  });
});
