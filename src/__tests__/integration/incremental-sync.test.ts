// Tests for the v18 mtime gate and profile-driven re-parse.
//
// Focused at the DB-accessor layer (getDeckLastSyncedMtime / setDeckLastSyncedMtime /
// clearLastSyncedMtimeForProfile) and the smart-reparse trigger in updateProfile.
// The DeckManager.syncFlashcardsForDeck mtime check is tested via assertions on
// DB state changes rather than vault mocking, which keeps the test fast and
// independent of Obsidian's vault/metadataCache APIs.

import { MainDatabaseService } from "../../database/MainDatabaseService";
import type { DeckProfile } from "../../database/types";
import { DEFAULT_PROFILE_ID } from "../../database/types";
import {
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";

describe("Incremental sync (v18 mtime gate)", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function makeDeck(id: string, profileId = DEFAULT_PROFILE_ID): Promise<void> {
    await db.createDeck({
      id,
      name: id,
      filepath: `/${id}.md`,
      tag: "#flashcards",
      lastReviewed: null,
      profileId,
    });
  }

  describe("mtime accessors", () => {
    it("returns 0 for a freshly-created deck", async () => {
      await makeDeck("deck_a");
      expect(await db.getDeckLastSyncedMtime("deck_a")).toBe(0);
    });

    it("returns 0 for an unknown deck (rather than throwing)", async () => {
      expect(await db.getDeckLastSyncedMtime("does_not_exist")).toBe(0);
    });

    it("set + get round-trips", async () => {
      await makeDeck("deck_a");
      await db.setDeckLastSyncedMtime("deck_a", 1_700_000_000_000);
      expect(await db.getDeckLastSyncedMtime("deck_a")).toBe(1_700_000_000_000);
    });

    it("setDeckLastSyncedMtime is per-deck (doesn't bleed across decks)", async () => {
      await makeDeck("deck_a");
      await makeDeck("deck_b");
      await db.setDeckLastSyncedMtime("deck_a", 111);
      await db.setDeckLastSyncedMtime("deck_b", 222);
      expect(await db.getDeckLastSyncedMtime("deck_a")).toBe(111);
      expect(await db.getDeckLastSyncedMtime("deck_b")).toBe(222);
    });
  });

  describe("clearLastSyncedMtimeForProfile", () => {
    it("zeroes mtime for every deck on the given profile, leaves others alone", async () => {
      const profileA: Omit<DeckProfile, "created" | "modified"> = {
        id: "profile_a",
        name: "A",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        learningSteps: "1m",
        relearningSteps: "10m",
        fsrs: { requestRetention: 0.9, profile: "STANDARD", useTrainedWeights: false },
        clozeEnabled: true,
        clozeShowContext: "hidden",
        isDefault: false,
      };
      await db.createProfile(profileA);

      await makeDeck("deck_on_a", "profile_a");
      await makeDeck("deck_on_default", DEFAULT_PROFILE_ID);
      await db.setDeckLastSyncedMtime("deck_on_a", 5000);
      await db.setDeckLastSyncedMtime("deck_on_default", 5000);

      await db.clearLastSyncedMtimeForProfile("profile_a");

      expect(await db.getDeckLastSyncedMtime("deck_on_a")).toBe(0);
      expect(await db.getDeckLastSyncedMtime("deck_on_default")).toBe(5000);
    });
  });

  describe("updateProfile clears mtime only when parsing fields change", () => {
    async function setupProfileWithDeck(): Promise<string> {
      await db.createProfile({
        id: "profile_x",
        name: "X",
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        learningSteps: "1m",
        relearningSteps: "10m",
        fsrs: { requestRetention: 0.9, profile: "STANDARD", useTrainedWeights: false },
        clozeEnabled: true,
        clozeShowContext: "hidden",
        isDefault: false,
      });
      await makeDeck("deck_x", "profile_x");
      await db.setDeckLastSyncedMtime("deck_x", 9999);
      return "deck_x";
    }

    it("does NOT clear mtime when only scheduling fields change", async () => {
      const deckId = await setupProfileWithDeck();

      await db.updateProfile("profile_x", { newCardsPerDay: 50 });
      expect(await db.getDeckLastSyncedMtime(deckId)).toBe(9999);

      await db.updateProfile("profile_x", { reviewOrder: "random" });
      expect(await db.getDeckLastSyncedMtime(deckId)).toBe(9999);

      await db.updateProfile("profile_x", { fsrs: { requestRetention: 0.85, profile: "STANDARD", useTrainedWeights: false } });
      expect(await db.getDeckLastSyncedMtime(deckId)).toBe(9999);

      await db.updateProfile("profile_x", { learningSteps: "5m 15m" });
      expect(await db.getDeckLastSyncedMtime(deckId)).toBe(9999);
    });

    it("clears mtime when headerLevel changes", async () => {
      const deckId = await setupProfileWithDeck();
      await db.updateProfile("profile_x", { headerLevel: 3 });
      expect(await db.getDeckLastSyncedMtime(deckId)).toBe(0);
    });

    it("clears mtime when clozeEnabled changes", async () => {
      const deckId = await setupProfileWithDeck();
      await db.updateProfile("profile_x", { clozeEnabled: false });
      expect(await db.getDeckLastSyncedMtime(deckId)).toBe(0);
    });

    it("does not clear mtime when headerLevel update is a no-op (same value)", async () => {
      const deckId = await setupProfileWithDeck();
      await db.updateProfile("profile_x", { headerLevel: 2 }); // same as before
      expect(await db.getDeckLastSyncedMtime(deckId)).toBe(9999);
    });
  });
});
