import { FSRS } from "../algorithm/fsrs";
import { Flashcard } from "../database/types";

describe("FSRS Progression & Explosion Safety", () => {
  let fsrs: FSRS;
  let intensiveFsrs: FSRS;

  beforeEach(() => {
    fsrs = new FSRS({
      requestRetention: 0.9,
      profile: "STANDARD", // Using STANDARD makes days easier to verify manually
    });

    intensiveFsrs = new FSRS({
      requestRetention: 0.9,
      profile: "INTENSIVE",
    });
  });

  const createNewCard = (): Flashcard => ({
    id: "prog-test",
    deckId: "test",
    front: "Q",
    back: "A",
    type: "header-paragraph",
    sourceFile: "test.md",
    contentHash: "hash",
    state: "new",
    dueDate: new Date().toISOString(),
    interval: 0,
    repetitions: 0,
    difficulty: 0,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  });

  it("should maintain sane growth factors for continuous 'Good' ratings", () => {
    let card = createNewCard();
    const history: { rep: number; intervalDays: number; factor: number }[] = [];

    // Simulate 20 reviews (approx 5-10 years of scheduling)
    const MAX_REVIEWS = 20;

    for (let i = 1; i <= MAX_REVIEWS; i++) {
      const prevInterval = card.interval; // in minutes

      // CRITICAL: Simulate time passing!
      // We must mock the review time to be exactly when the card became due.
      // If we review immediately (elapsed=0), FSRS treats it as "cramming" which alters growth.
      let reviewTime = new Date();
      if (card.lastReviewed) {
        // Add previous interval to last reviewed time
        const lastReviewTime = new Date(card.lastReviewed).getTime();
        reviewTime = new Date(lastReviewTime + prevInterval * 60 * 1000);
      }

      // Perform the update
      card = fsrs.updateCard(card, "good", reviewTime);

      // Calculate Growth Factor (New Interval / Old Interval)
      // We use days for easier reading
      const intervalDays = card.interval / 1440;
      let factor = 0;

      if (i > 1 && prevInterval > 0) {
        factor = card.interval / prevInterval;
      }

      history.push({
        rep: i,
        intervalDays: parseFloat(intervalDays.toFixed(2)),
        factor: parseFloat(factor.toFixed(2)),
      });

      // --- SAFETY ASSERTIONS ---

      if (i > 1) {
        // 1. Explosion Check: Interval shouldn't grow more than 5x in a single step for "Good"
        // Standard FSRS usually hovers between 2.0x and 3.0x
        expect(factor).toBeLessThan(5.0);

        // 2. Stagnation Check: Interval should generally grow (factor > 1.0)
        // (Unless max interval reached)
        if (card.interval < 36500 * 1440) {
          expect(factor).toBeGreaterThan(1.1);
        }
      }

      // 3. Finite Check: All values should remain finite
      expect(Number.isFinite(card.interval)).toBe(true);
      expect(Number.isFinite(card.stability)).toBe(true);
      expect(Number.isFinite(card.difficulty)).toBe(true);

      // 4. Reasonableness Check: Intervals shouldn't exceed maximum
      expect(card.interval).toBeLessThanOrEqual(36500 * 1440);
    }

    // Console table helps you manually verify the curve looks smooth
    // console.table(history);
  });

  it("should maintain reasonable growth factors for 'Easy' ratings", () => {
    let card = createNewCard();
    const history: { rep: number; intervalDays: number; factor: number }[] = [];

    const MAX_REVIEWS = 15;

    for (let i = 1; i <= MAX_REVIEWS; i++) {
      const prevInterval = card.interval;

      let reviewTime = new Date();
      if (card.lastReviewed) {
        const lastReviewTime = new Date(card.lastReviewed).getTime();
        reviewTime = new Date(lastReviewTime + prevInterval * 60 * 1000);
      }

      card = fsrs.updateCard(card, "easy", reviewTime);

      const intervalDays = card.interval / 1440;
      let factor = 0;

      if (i > 1 && prevInterval > 0) {
        factor = card.interval / prevInterval;
      }

      history.push({
        rep: i,
        intervalDays: parseFloat(intervalDays.toFixed(2)),
        factor: parseFloat(factor.toFixed(2)),
      });

      if (i > 1) {
        // Easy should grow faster than Good, but not explosively
        expect(factor).toBeLessThan(8.0); // Allow higher growth for Easy
        if (card.interval < 36500 * 1440) {
          expect(factor).toBeGreaterThan(1.2);
        }
      }

      expect(Number.isFinite(card.interval)).toBe(true);
      expect(Number.isFinite(card.stability)).toBe(true);
      expect(Number.isFinite(card.difficulty)).toBe(true);
    }

    // console.table(history);
  });

  it("should not explode stability after a lapse", () => {
    // Scenario: User learns card well, then forgets it.
    // The next interval should be short, but future growth shouldn't be infinite.
    let card = createNewCard();

    // 1. Train to maturity (5 'Good' reviews)
    for (let i = 0; i < 5; i++) {
      const nextTime = card.lastReviewed
        ? new Date(
            new Date(card.lastReviewed).getTime() + card.interval * 60000
          )
        : new Date();
      card = fsrs.updateCard(card, "good", nextTime);
    }

    const preLapseStability = card.stability;
    const preLapseInterval = card.interval;

    // 2. Lapse (Press 'Again')
    const lapseTime = new Date(
      new Date(card.lastReviewed!).getTime() + card.interval * 60000
    );
    card = fsrs.updateCard(card, "again", lapseTime);

    // Check: Stability should drop significantly (using Forgetting Stability formula)
    expect(card.stability).toBeLessThan(preLapseStability);

    // Check: Stability shouldn't be NaN or Infinity
    expect(Number.isFinite(card.stability)).toBe(true);
    expect(card.stability).toBeGreaterThan(0);

    // Check: Lapses counter increments
    expect(card.lapses).toBe(1);

    // 3. Re-learn (Press 'Good')
    // Ensure the post-lapse stability doesn't cause next interval to explode
    const relearnTime = new Date(
      new Date(card.lastReviewed!).getTime() + card.interval * 60000
    );
    const preRelearnInterval = card.interval;
    card = fsrs.updateCard(card, "good", relearnTime);

    // The factor after a lapse recovery should be reasonable
    const postLapseFactor = card.interval / preRelearnInterval;
    expect(postLapseFactor).toBeLessThan(20); // Allow some recovery boost, but not explosive
    expect(postLapseFactor).toBeGreaterThan(1.1);

    // Ensure values remain finite
    expect(Number.isFinite(card.stability)).toBe(true);
    expect(Number.isFinite(card.interval)).toBe(true);
  });

  it("should handle multiple lapses without exploding", () => {
    let card = createNewCard();

    // Train card to maturity
    for (let i = 0; i < 3; i++) {
      const nextTime = card.lastReviewed
        ? new Date(
            new Date(card.lastReviewed).getTime() + card.interval * 60000
          )
        : new Date();
      card = fsrs.updateCard(card, "good", nextTime);
    }

    // Multiple lapse cycle
    for (let lapse = 1; lapse <= 3; lapse++) {
      // Lapse
      const lapseTime = new Date(
        new Date(card.lastReviewed!).getTime() + card.interval * 60000
      );
      card = fsrs.updateCard(card, "again", lapseTime);

      expect(card.lapses).toBe(lapse);
      expect(Number.isFinite(card.stability)).toBe(true);
      expect(card.stability).toBeGreaterThan(0);

      // Recover
      const recoverTime = new Date(
        new Date(card.lastReviewed!).getTime() + card.interval * 60000
      );
      card = fsrs.updateCard(card, "good", recoverTime);

      expect(Number.isFinite(card.stability)).toBe(true);
      expect(Number.isFinite(card.interval)).toBe(true);
      expect(card.interval).toBeGreaterThanOrEqual(1440); // STANDARD profile minimum
    }
  });

  it("should maintain sane growth with mixed ratings", () => {
    let card = createNewCard();
    const ratings = [
      "good",
      "hard",
      "good",
      "easy",
      "again",
      "good",
      "good",
      "hard",
      "easy",
    ] as const;
    const history: {
      rep: number;
      rating: string;
      intervalDays: number;
      stability: number;
    }[] = [];

    for (let i = 0; i < ratings.length; i++) {
      const rating = ratings[i];

      let reviewTime = new Date();
      if (card.lastReviewed) {
        const lastReviewTime = new Date(card.lastReviewed).getTime();
        reviewTime = new Date(lastReviewTime + card.interval * 60 * 1000);
      }

      card = fsrs.updateCard(card, rating, reviewTime);

      const intervalDays = card.interval / 1440;
      history.push({
        rep: i + 1,
        rating,
        intervalDays: parseFloat(intervalDays.toFixed(2)),
        stability: parseFloat(card.stability.toFixed(3)),
      });

      // All values should remain finite and positive
      expect(Number.isFinite(card.stability)).toBe(true);
      expect(Number.isFinite(card.difficulty)).toBe(true);
      expect(Number.isFinite(card.interval)).toBe(true);
      expect(card.stability).toBeGreaterThan(0);
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
      expect(card.interval).toBeGreaterThanOrEqual(1440); // STANDARD minimum
    }

    // console.table(history);
  });

  it("should handle INTENSIVE profile progression without explosions", () => {
    let card = createNewCard();
    const history: { rep: number; intervalMinutes: number; factor: number }[] =
      [];

    const MAX_REVIEWS = 15;

    for (let i = 1; i <= MAX_REVIEWS; i++) {
      const prevInterval = card.interval;

      let reviewTime = new Date();
      if (card.lastReviewed) {
        const lastReviewTime = new Date(card.lastReviewed).getTime();
        reviewTime = new Date(lastReviewTime + prevInterval * 60 * 1000);
      }

      card = intensiveFsrs.updateCard(card, "good", reviewTime);

      let factor = 0;
      if (i > 1 && prevInterval > 0) {
        factor = card.interval / prevInterval;
      }

      history.push({
        rep: i,
        intervalMinutes: parseFloat(card.interval.toFixed(2)),
        factor: parseFloat(factor.toFixed(2)),
      });

      if (i > 1) {
        // INTENSIVE allows sub-day intervals, so growth factors can be different
        expect(factor).toBeLessThan(10.0); // Allow higher growth for small intervals
        if (card.interval < 36500 * 1440) {
          expect(factor).toBeGreaterThan(1.05);
        }
      }

      expect(Number.isFinite(card.interval)).toBe(true);
      expect(Number.isFinite(card.stability)).toBe(true);
      expect(card.interval).toBeGreaterThanOrEqual(1); // INTENSIVE minimum
    }

    // console.table(history);
  });

  it("should maintain consistent retrievability calculations", () => {
    let card = createNewCard();

    // Train card through several reviews
    for (let i = 0; i < 10; i++) {
      const nextTime = card.lastReviewed
        ? new Date(
            new Date(card.lastReviewed).getTime() + card.interval * 60000
          )
        : new Date();
      card = fsrs.updateCard(card, "good", nextTime);

      // Test retrievability at various time points
      const currentTime = new Date(card.lastReviewed!);
      const halfwayTime = new Date(
        currentTime.getTime() + (card.interval * 60000) / 2
      );
      const dueTime = new Date(currentTime.getTime() + card.interval * 60000);

      const retrievabilityNow = fsrs.getRetrievability(card, currentTime);
      const retrievabilityHalfway = fsrs.getRetrievability(card, halfwayTime);
      const retrievabilityDue = fsrs.getRetrievability(card, dueTime);

      // Retrievability should decrease over time
      expect(retrievabilityNow).toBeGreaterThanOrEqual(retrievabilityHalfway);
      expect(retrievabilityHalfway).toBeGreaterThanOrEqual(retrievabilityDue);

      // All values should be finite and in [0,1] range
      expect(Number.isFinite(retrievabilityNow)).toBe(true);
      expect(Number.isFinite(retrievabilityHalfway)).toBe(true);
      expect(Number.isFinite(retrievabilityDue)).toBe(true);
      expect(retrievabilityNow).toBeGreaterThanOrEqual(0);
      expect(retrievabilityNow).toBeLessThanOrEqual(1);
      expect(retrievabilityDue).toBeGreaterThanOrEqual(0);
      expect(retrievabilityDue).toBeLessThanOrEqual(1);
    }
  });

  it("should prevent difficulty explosion", () => {
    let card = createNewCard();

    // Simulate extreme difficulty scenario (many 'again' ratings)
    for (let i = 0; i < 10; i++) {
      const nextTime = card.lastReviewed
        ? new Date(
            new Date(card.lastReviewed).getTime() + card.interval * 60000
          )
        : new Date();
      card = fsrs.updateCard(card, "again", nextTime);

      // Difficulty should be clamped to [1, 10] range
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
      expect(Number.isFinite(card.difficulty)).toBe(true);

      // Lapses should increment properly
      expect(card.lapses).toBe(i + 1);
    }
  });

  it("should handle edge case: reviewing card long after it was due", () => {
    let card = createNewCard();

    // Train card to moderate maturity
    for (let i = 0; i < 3; i++) {
      const nextTime = card.lastReviewed
        ? new Date(
            new Date(card.lastReviewed).getTime() + card.interval * 60000
          )
        : new Date();
      card = fsrs.updateCard(card, "good", nextTime);
    }

    // Review the card way after it was due (10x the interval)
    const veryLateTime = new Date(
      new Date(card.lastReviewed!).getTime() + card.interval * 60000 * 10
    );
    const preReviewStability = card.stability;

    card = fsrs.updateCard(card, "good", veryLateTime);

    // Stability should be affected by the long delay, but remain finite
    expect(Number.isFinite(card.stability)).toBe(true);
    expect(card.stability).toBeGreaterThan(0);

    // The update should handle the extreme elapsed time gracefully
    expect(Number.isFinite(card.interval)).toBe(true);
    expect(card.interval).toBeGreaterThanOrEqual(1440); // STANDARD minimum
  });

  it("should maintain growth rate consistency across retention values", () => {
    const retentionValues = [0.7, 0.8, 0.9, 0.95];
    const growthResults: { retention: number; avgFactor: number }[] = [];

    retentionValues.forEach((retention) => {
      const testFsrs = new FSRS({
        requestRetention: retention,
        profile: "STANDARD",
      });

      let card = createNewCard();
      const factors: number[] = [];

      // Simulate 5 reviews with good ratings
      for (let i = 1; i <= 5; i++) {
        const prevInterval = card.interval;

        let reviewTime = new Date();
        if (card.lastReviewed) {
          const lastReviewTime = new Date(card.lastReviewed).getTime();
          reviewTime = new Date(lastReviewTime + prevInterval * 60 * 1000);
        }

        card = testFsrs.updateCard(card, "good", reviewTime);

        if (i > 1 && prevInterval > 0) {
          const factor = card.interval / prevInterval;
          factors.push(factor);

          // Each factor should be reasonable
          expect(factor).toBeLessThan(10.0);
          expect(factor).toBeGreaterThan(1.0);
        }
      }

      const avgFactor = factors.reduce((a, b) => a + b, 0) / factors.length;
      growthResults.push({ retention: retention, avgFactor: avgFactor });
    });

    // Lower retention should generally result in higher growth factors
    // (because intervals need to be longer to achieve lower retention)
    for (let i = 1; i < growthResults.length; i++) {
      const prev = growthResults[i - 1];
      const curr = growthResults[i];

      // Higher retention (curr) should have lower or similar growth factor
      expect(curr.avgFactor).toBeLessThanOrEqual(prev.avgFactor * 1.5); // Allow some variance
    }

    // console.table(growthResults);
  });
});
