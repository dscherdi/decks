import { MainDatabaseService } from "../../database/MainDatabaseService";
import { Scheduler } from "../../services/Scheduler";
import {
  DatabaseTestUtils,
  setupTestDatabase,
  teardownTestDatabase,
} from "./database-test-utils";
import type { Deck, Flashcard } from "../../database/types";

describe("Learning Steps Integration Tests", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;

  const mockSettings = {
    review: { nextDayStartsAt: 4, showProgress: true, enableKeyboardShortcuts: true, sessionDuration: 25 },
    backup: { enableAutoBackup: false, maxBackups: 3 },
    debug: { enableLogging: false, performanceLogs: false },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const mockBackupService = {
    createBackup: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  beforeEach(async () => {
    db = await setupTestDatabase();
    scheduler = new Scheduler(db, mockSettings, mockBackupService);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function createDeckWithSteps(
    learningSteps: string,
    relearningSteps: string,
    fsrsProfile: "STANDARD" | "INTENSIVE" = "STANDARD"
  ): Promise<Deck> {
    const profileId = `profile_steps_${Date.now()}`;
    await db.createProfile({
      id: profileId,
      name: `Steps Profile ${Date.now()}`,
      hasNewCardsLimitEnabled: false,
      newCardsPerDay: 20,
      hasReviewCardsLimitEnabled: false,
      reviewCardsPerDay: 100,
      headerLevel: 2,
      reviewOrder: "due-date",
      learningSteps,
      relearningSteps,
      fsrs: {
        requestRetention: 0.9,
        profile: fsrsProfile,
      },
      isDefault: false,
    });

    const deck = DatabaseTestUtils.createTestDeck({
      profileId,
    });
    await db.createDeck(deck);
    return deck;
  }

  async function createNewCard(deckId: string): Promise<Flashcard> {
    const card = DatabaseTestUtils.createTestFlashcard(deckId, {
      state: "new",
      stability: 0,
      difficulty: 5.0,
      interval: 0,
      repetitions: 0,
    });
    await db.createFlashcard(card);
    return card;
  }

  async function createReviewCard(deckId: string): Promise<Flashcard> {
    const card = DatabaseTestUtils.createTestFlashcard(deckId, {
      state: "review",
      stability: 10.0,
      difficulty: 5.0,
      interval: 1440 * 7,
      repetitions: 3,
      lastReviewed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      dueDate: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    await db.createFlashcard(card);
    return card;
  }

  describe("Again interval overrides on new cards for both profiles", () => {
    it("should override Again interval on new card for INTENSIVE", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "INTENSIVE");
      const card = await createNewCard(deck.id);

      const preview = await scheduler.preview(card.id);
      expect(preview).not.toBeNull();

      expect(preview!.again.interval).toBe(1);

      // Hard/Good/Easy all use pure FSRS
      expect(preview!.hard.interval).toBeGreaterThan(0);
      expect(preview!.good.interval).toBeGreaterThan(0);
      expect(preview!.easy.interval).toBeGreaterThan(0);
    });

    it("should override Again interval on new card for STANDARD", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const card = await createNewCard(deck.id);

      const preview = await scheduler.preview(card.id);
      expect(preview).not.toBeNull();

      expect(preview!.again.interval).toBe(1);

      // Hard/Good/Easy all use pure FSRS
      expect(preview!.hard.interval).toBeGreaterThan(0);
      expect(preview!.good.interval).toBeGreaterThan(0);
      expect(preview!.easy.interval).toBeGreaterThan(0);
    });

    it("should use custom Again interval", async () => {
      const deck = await createDeckWithSteps("5m", "10m", "STANDARD");
      const card = await createNewCard(deck.id);

      const preview = await scheduler.preview(card.id);
      expect(preview).not.toBeNull();

      expect(preview!.again.interval).toBe(5);
    });
  });

  describe("FSRS state initialized correctly with again interval", () => {
    it("should preserve FSRS stability/difficulty even with interval override", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const card = await createNewCard(deck.id);

      const rated = await scheduler.rate(card.id, "again");

      expect(rated.interval).toBe(1);

      expect(rated.stability).toBeGreaterThan(0);
      expect(rated.difficulty).toBeGreaterThanOrEqual(1);
      expect(rated.difficulty).toBeLessThanOrEqual(10);
      expect(rated.repetitions).toBe(1);
      expect(rated.state).toBe("review");
    });
  });

  describe("Lapse uses relearning again interval", () => {
    it("should override interval with relearning value on Again", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const reviewCard = await createReviewCard(deck.id);

      const rated = await scheduler.rate(reviewCard.id, "again");

      expect(rated.interval).toBe(10);
      expect(rated.state).toBe("review");
    });

    it("should preserve FSRS forgetting stability on lapse", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "INTENSIVE");
      const reviewCard = await createReviewCard(deck.id);
      const originalStability = reviewCard.stability;

      const rated = await scheduler.rate(reviewCard.id, "again");

      expect(rated.stability).toBeLessThan(originalStability);
      expect(rated.stability).toBeGreaterThan(0);
      expect(rated.interval).toBe(10);
    });

    it("should respect custom relearning again interval", async () => {
      const deck = await createDeckWithSteps("1m", "30m", "STANDARD");
      const reviewCard = await createReviewCard(deck.id);

      const rated = await scheduler.rate(reviewCard.id, "again");
      expect(rated.interval).toBe(30);
    });
  });

  describe("Review card Hard/Good/Easy unaffected", () => {
    it("should use pure FSRS for Hard on review cards", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const reviewCard = await createReviewCard(deck.id);

      const rated = await scheduler.rate(reviewCard.id, "hard");

      expect(rated.interval).toBeGreaterThan(0);
    });

    it("should use pure FSRS for Good on review cards", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const reviewCard = await createReviewCard(deck.id);

      const rated = await scheduler.rate(reviewCard.id, "good");

      expect(rated.interval).toBeGreaterThan(0);
    });

    it("should use pure FSRS for Easy on review cards", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const reviewCard = await createReviewCard(deck.id);

      const rated = await scheduler.rate(reviewCard.id, "easy");

      expect(rated.interval).toBeGreaterThan(0);
    });
  });

  describe("Empty intervals (backward compatibility)", () => {
    it("should use pure FSRS when learning interval is empty", async () => {
      const deck = await createDeckWithSteps("", "", "STANDARD");
      const card = await createNewCard(deck.id);

      const preview = await scheduler.preview(card.id);
      expect(preview).not.toBeNull();

      expect(preview!.again.interval).toBeGreaterThan(0);
      expect(preview!.hard.interval).toBeGreaterThan(0);
      expect(preview!.good.interval).toBeGreaterThan(0);
      expect(preview!.easy.interval).toBeGreaterThan(0);
    });

    it("should use pure FSRS for Again on review cards when relearning empty", async () => {
      const deck = await createDeckWithSteps("", "", "INTENSIVE");
      const reviewCard = await createReviewCard(deck.id);

      const deckWithProfile = await db.getDeckWithProfile(deck.id);
      expect(deckWithProfile!.profile.fsrs.profile).toBe("INTENSIVE");
      expect(deckWithProfile!.profile.relearningSteps).toBe("");

      const rated = await scheduler.rate(reviewCard.id, "again");

      expect(rated.interval).toBeGreaterThan(0);
      expect(rated.state).toBe("review");
    });

    it("should use pure FSRS for Again on new cards when learning interval empty", async () => {
      const deck = await createDeckWithSteps("", "10m", "STANDARD");
      const card = await createNewCard(deck.id);

      const preview = await scheduler.preview(card.id);
      expect(preview).not.toBeNull();

      expect(preview!.again.interval).toBeGreaterThan(0);
    });
  });

  describe("Profile defaults", () => {
    it("should store custom again intervals on profile", async () => {
      const profileId = `profile_custom_${Date.now()}`;
      await db.createProfile({
        id: profileId,
        name: `Custom ${Date.now()}`,
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        learningSteps: "5m",
        relearningSteps: "15m",
        fsrs: { requestRetention: 0.9, profile: "STANDARD" },
        isDefault: false,
      });

      const profile = await db.getProfileById(profileId);
      expect(profile!.learningSteps).toBe("5m");
      expect(profile!.relearningSteps).toBe("15m");
    });

    it("should use correct defaults for DEFAULT profile", async () => {
      const defaultProfile = await db.getDefaultProfile();
      expect(defaultProfile.learningSteps).toBe("1m");
      expect(defaultProfile.relearningSteps).toBe("10m");
    });
  });

  describe("Preview shows again interval", () => {
    it("should show again interval for new cards", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const card = await createNewCard(deck.id);

      const preview = await scheduler.preview(card.id);
      expect(preview).not.toBeNull();

      expect(preview!.again.interval).toBe(1);
      expect(preview!.hard.interval).toBeGreaterThan(1);
      expect(preview!.good.interval).toBeGreaterThan(1);
      expect(preview!.easy.interval).toBeGreaterThan(1);
    });

    it("should show correct Again due date timing", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const card = await createNewCard(deck.id);

      const preview = await scheduler.preview(card.id);
      expect(preview).not.toBeNull();

      const now = Date.now();
      const againDue = new Date(preview!.again.dueDate).getTime();

      // Again due in ~1 minute
      expect(againDue - now).toBeLessThan(2 * 60 * 1000);
      expect(againDue - now).toBeGreaterThan(0);
    });
  });

  describe("Subsequent review uses FSRS", () => {
    it("should use FSRS intervals after first review", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const card = await createNewCard(deck.id);

      // First review: Again → 1m (interval override)
      const firstReview = await scheduler.rate(card.id, "again");
      expect(firstReview.interval).toBe(1);
      expect(firstReview.state).toBe("review");

      // Make card due again
      await db.updateFlashcard(card.id, {
        dueDate: new Date(Date.now() - 60 * 1000).toISOString(),
      });

      // Second review: Good → FSRS interval (card is now review state)
      const secondReview = await scheduler.rate(card.id, "good");

      expect(secondReview.state).toBe("review");
      expect(secondReview.interval).not.toBe(1);
      expect(secondReview.interval).toBeGreaterThan(0);
    });
  });

  describe("Review log captures correct intervals", () => {
    it("should log overridden interval in review log", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const card = await createNewCard(deck.id);

      await scheduler.rate(card.id, "again");

      const logs = await db.getAllReviewLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].newIntervalMinutes).toBe(1);
      expect(logs[0].oldState).toBe("new");
      expect(logs[0].newState).toBe("review");
    });

    it("should log FSRS interval for non-Again ratings", async () => {
      const deck = await createDeckWithSteps("1m", "10m", "STANDARD");
      const card = await createNewCard(deck.id);

      await scheduler.rate(card.id, "good");

      const logs = await db.getAllReviewLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].newIntervalMinutes).not.toBe(1);
      expect(logs[0].newIntervalMinutes).toBeGreaterThan(0);
    });
  });
});
