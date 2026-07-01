import { MainDatabaseService } from "../../database/MainDatabaseService";
import { DeckManager } from "../../services/DeckManager";
import { TagGroupService, generateDeckGroupId } from "@decks/core";
import type { DeckStats } from "../../database/types";
import {
  setupTestDatabase,
  teardownTestDatabase,
  DatabaseTestUtils,
} from "./database-test-utils";

// The batched getAllDeckStatsMap (few GROUP BY queries) must return exactly the
// same per-deck and per-group stats as the per-deck path (getDeckStats /
// getDeckGroupStats), across every card state, per-deck limits, and the cap.
describe("Deck-stats batch parity", () => {
  let db: MainDatabaseService;
  let deckManager: DeckManager;

  const settings = {
    review: {
      nextDayStartsAt: 4,
      hasGlobalReviewCap: false,
      globalReviewCapAmount: 100,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 24 * 3600_000).toISOString();
  const now = () => new Date().toISOString();

  async function addCard(
    deckId: string,
    id: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    overrides: Record<string, any>
  ): Promise<void> {
    await db.createFlashcard(
      DatabaseTestUtils.createTestFlashcard(deckId, { id, ...overrides })
    );
  }

  beforeEach(async () => {
    db = await setupTestDatabase();
    deckManager = new DeckManager({} as never, {} as never, db, { settings });

    // Three decks under one tag (a group) + one standalone deck.
    for (const [id, name, tag] of [
      ["deck_a", "A", "#flashcards/math"],
      ["deck_b", "B", "#flashcards/math"],
      ["deck_c", "C", "#flashcards/math"], // stays empty → missing from GROUP BY
      ["deck_d", "D", "#flashcards/other"],
    ] as const) {
      await db.createDeck(
        DatabaseTestUtils.createTestDeck({ id, name, filepath: `/${id}.md`, tag })
      );
    }

    // Deck A: cover every state the counts care about.
    await addCard("deck_a", "a_new1", { state: "new" });
    await addCard("deck_a", "a_new2", { state: "new" });
    await addCard("deck_a", "a_new_suspended", { state: "new", suspendedAt: past });
    await addCard("deck_a", "a_due1", { state: "review", dueDate: past, interval: 1440 });
    await addCard("deck_a", "a_due2", { state: "review", dueDate: past, interval: 1440 });
    await addCard("deck_a", "a_notdue", { state: "review", dueDate: future, interval: 1440 });
    await addCard("deck_a", "a_mature", { state: "review", dueDate: past, interval: 40000 });
    await addCard("deck_a", "a_due_buried_future", {
      state: "review", dueDate: past, interval: 1440, buriedUntil: future,
    });
    await addCard("deck_a", "a_due_buried_past", {
      state: "review", dueDate: past, interval: 1440, buriedUntil: past,
    });

    // Deck B: a few cards.
    await addCard("deck_b", "b_new", { state: "new" });
    await addCard("deck_b", "b_due", { state: "review", dueDate: past, interval: 1440 });

    // Deck D: standalone.
    await addCard("deck_d", "d_due", { state: "review", dueDate: past, interval: 1440 });

    // Studied today (deck A): 1 new-graduation + 1 review, distinct cards.
    await db.createReviewLog(
      DatabaseTestUtils.createTestReviewLog("a_new1", { oldState: "new", reviewedAt: now() })
    );
    await db.createReviewLog(
      DatabaseTestUtils.createTestReviewLog("a_due1", { oldState: "review", reviewedAt: now() })
    );
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function referenceMap(remaining: number): Promise<Map<string, DeckStats>> {
    const decks = await db.getAllDecksWithProfiles();
    const groups = await new TagGroupService(db).aggregateByTag(decks);
    const ref = new Map<string, DeckStats>();
    for (const d of decks) {
      ref.set(d.id, await deckManager.getDeckStats(d.id, true, remaining));
    }
    for (const g of groups) {
      ref.set(generateDeckGroupId(g.tag), await deckManager.getDeckGroupStats(g, remaining));
    }
    return ref;
  }

  it("matches the per-deck path with no cap (raw counts, limits, groups)", async () => {
    // Enable per-deck limits so applyPerDeckLimits is exercised on both paths.
    await db.updateProfile("profile_default", {
      hasReviewCardsLimitEnabled: true,
      reviewCardsPerDay: 2,
      hasNewCardsLimitEnabled: true,
      newCardsPerDay: 1,
    });

    const batched = await deckManager.getAllDeckStatsMap();
    const ref = await referenceMap(Infinity);

    expect(batched.size).toBe(ref.size);
    for (const [key, expected] of ref) {
      expect(batched.get(key)).toEqual(expected);
    }

    // Spot-check deck A raw semantics (limits off would be: new=2, due=4 [2 due
    // + mature + buried_past], mature=1). Here new limit 1 minus 1 studied = 0.
    const a = batched.get("deck_a")!;
    expect(a.totalCount).toBe(9);
    expect(a.matureCount).toBe(1);
  });

  it("matches the per-deck path with the global cap on", async () => {
    settings.review.hasGlobalReviewCap = true;
    settings.review.globalReviewCapAmount = 3;
    const done = await db.countCardsStudiedTodayAllDecks(4); // 2 studied today
    const remaining = Math.max(0, 3 - done);

    const batched = await deckManager.getAllDeckStatsMap();
    const ref = await referenceMap(remaining);

    expect(batched.size).toBe(ref.size);
    for (const [key, expected] of ref) {
      expect(batched.get(key)).toEqual(expected);
    }
  });
});
