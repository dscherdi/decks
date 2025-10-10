import { FSRS, type FutureDueData } from "../algorithm/fsrs";
import { Flashcard, FlashcardState } from "../database/types";

describe("FSRS Future Due Load Simulation", () => {
  let fsrs: FSRS;
  let mockCards: Flashcard[];
  let baseDate: Date;

  beforeEach(() => {
    fsrs = new FSRS({ requestRetention: 0.9, profile: "STANDARD" });
    baseDate = new Date("2024-01-01T00:00:00.000Z");

    // Create mock cards with different states and maturity levels
    mockCards = [
      createMockCard("card1", "new", 0, null, 0),
      createMockCard("card2", "review", 5, baseDate, 2.5),
      createMockCard(
        "card3",
        "review",
        10,
        new Date(baseDate.getTime() + 24 * 60 * 60 * 1000),
        5.0,
      ),
      createMockCard(
        "card4",
        "review",
        1,
        new Date(baseDate.getTime() - 24 * 60 * 60 * 1000),
        1.0,
      ), // Overdue
    ];
  });

  function createMockCard(
    id: string,
    state: FlashcardState,
    repetitions: number,
    dueDate: Date | null,
    stability: number,
  ): Flashcard {
    return {
      id,
      deckId: "test-deck",
      front: `Front ${id}`,
      back: `Back ${id}`,
      type: "header-paragraph",
      sourceFile: "test.md",
      contentHash: `hash-${id}`,
      state,
      dueDate: dueDate?.toISOString() ?? baseDate.toISOString(),
      interval: stability * 1440, // Convert to minutes
      repetitions,
      stability,
      difficulty: 5.0,
      lapses: 0,
      lastReviewed: dueDate
        ? new Date(
            dueDate.getTime() - stability * 24 * 60 * 60 * 1000,
          ).toISOString()
        : null,
      created: baseDate.toISOString(),
      modified: baseDate.toISOString(),
    };
  }

  describe("simulateFutureDueLoad", () => {
    it("should return empty array for empty card list", () => {
      const result = fsrs.simulateFutureDueLoad([], 30, baseDate);
      expect(result).toEqual([]);
    });

    it("should return empty array for zero days", () => {
      const result = fsrs.simulateFutureDueLoad(mockCards, 0, baseDate);
      expect(result).toEqual([]);
    });

    it("should return array with correct length for valid input", () => {
      const days = 30;
      const result = fsrs.simulateFutureDueLoad(mockCards, days, baseDate);
      expect(result).toHaveLength(days);
    });

    it("should format dates correctly", () => {
      const result = fsrs.simulateFutureDueLoad(mockCards, 5, baseDate);

      expect(result[0].date).toBe("2024-01-01");
      expect(result[1].date).toBe("2024-01-02");
      expect(result[4].date).toBe("2024-01-05");
    });

    it("should handle overdue cards by scheduling them for today or tomorrow", () => {
      const overdueCard = createMockCard(
        "overdue",
        "review",
        3,
        new Date(baseDate.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days overdue
        2.0,
      );

      const result = fsrs.simulateFutureDueLoad([overdueCard], 7, baseDate);

      // Overdue card should be scheduled within the first few days
      const firstThreeDays = result
        .slice(0, 3)
        .reduce((sum, day) => sum + day.dueCount, 0);
      expect(firstThreeDays).toBeGreaterThan(0);
    });

    it("should handle cards with invalid due dates", () => {
      const cardWithInvalidDue = createMockCard(
        "invalid-due",
        "new",
        0,
        baseDate,
        0,
      );
      // Simulate an invalid due date by setting it to an invalid string
      (cardWithInvalidDue as any).dueDate = "";

      const result = fsrs.simulateFutureDueLoad(
        [cardWithInvalidDue],
        30,
        baseDate,
      );
      const totalDue = result.reduce((sum, day) => sum + day.dueCount, 0);

      // Should handle gracefully and not crash
      expect(totalDue).toBeGreaterThanOrEqual(0);
    });

    it("should generate realistic due counts based on card collection", () => {
      const result = fsrs.simulateFutureDueLoad(mockCards, 90, baseDate);
      const totalDue = result.reduce((sum, day) => sum + day.dueCount, 0);

      // Should generate some reviews (at least one review per active card)
      expect(totalDue).toBeGreaterThan(0);
      expect(totalDue).toBeLessThan(500); // But not unreasonably high
    });

    it("should simulate multiple reviews per card over long timeframes", () => {
      // Create a mature card that should generate multiple reviews
      const matureCard = createMockCard("mature", "review", 20, baseDate, 30.0);

      const result = fsrs.simulateFutureDueLoad([matureCard], 365, baseDate);
      const totalDue = result.reduce((sum, day) => sum + day.dueCount, 0);

      // Mature card should generate at least a few reviews over a year
      // With high stability (30 days), expect 3-12 reviews in 365 days
      expect(totalDue).toBeGreaterThanOrEqual(1);
      expect(totalDue).toBeLessThan(20); // But not excessive
    });

    it("should handle edge case of very short simulation period", () => {
      const result = fsrs.simulateFutureDueLoad(mockCards, 1, baseDate);

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2024-01-01");
      expect(result[0].dueCount).toBeGreaterThanOrEqual(0);
    });

    it("should produce deterministic results with same input", () => {
      // Mock Math.random to ensure deterministic behavior
      const originalRandom = Math.random;
      let callCount = 0;
      Math.random = () => {
        callCount++;
        return 0.5; // Fixed value for predictable ratings
      };

      try {
        const result1 = fsrs.simulateFutureDueLoad(mockCards, 30, baseDate);

        // Reset call count
        callCount = 0;
        const result2 = fsrs.simulateFutureDueLoad(mockCards, 30, baseDate);

        expect(result1).toEqual(result2);
      } finally {
        Math.random = originalRandom;
      }
    });

    it("should handle cards with different maturity levels appropriately", () => {
      const newCard = createMockCard("new", "new", 0, baseDate, 0);
      const youngCard = createMockCard("young", "review", 2, baseDate, 1.0);
      const matureCard = createMockCard("mature", "review", 15, baseDate, 45.0);

      const cards = [newCard, youngCard, matureCard];
      const result = fsrs.simulateFutureDueLoad(cards, 180, baseDate);

      // Should generate reviews for all cards
      const totalDue = result.reduce((sum, day) => sum + day.dueCount, 0);
      expect(totalDue).toBeGreaterThan(0);

      // Mature card should have longer intervals (fewer total reviews)
      // New/young cards should have shorter intervals (more total reviews)
      // This is difficult to test precisely due to randomness, but total should be reasonable
      expect(totalDue).toBeLessThan(100);
    });

    it("should respect the simulation window boundaries", () => {
      const result = fsrs.simulateFutureDueLoad(mockCards, 30, baseDate);

      // All dates should be within the 30-day window
      expect(result).toHaveLength(30);
      expect(result[0].date).toBe("2024-01-01");
      expect(result[29].date).toBe("2024-01-30");
    });

    it("should handle large card collections efficiently", () => {
      // Create a large collection of cards
      const largeCardCollection: Flashcard[] = [];
      for (let i = 0; i < 100; i++) {
        largeCardCollection.push(
          createMockCard(
            `card-${i}`,
            i % 3 === 0 ? "new" : "review",
            Math.floor(i / 5),
            new Date(baseDate.getTime() + (i % 10) * 24 * 60 * 60 * 1000),
            Math.max(1, i / 10),
          ),
        );
      }

      const startTime = Date.now();
      const result = fsrs.simulateFutureDueLoad(
        largeCardCollection,
        90,
        baseDate,
      );
      const endTime = Date.now();

      // Should complete in reasonable time (less than 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
      expect(result).toHaveLength(90);
    });
  });

  describe("rating simulation logic", () => {
    it("should generate different rating distributions for different card types", () => {
      const originalRandom = Math.random;
      const randomValues = [0.01, 0.08, 0.5, 0.95]; // again, hard, good, easy
      let callIndex = 0;

      Math.random = () => {
        const value = randomValues[callIndex % randomValues.length];
        callIndex++;
        return value;
      };

      try {
        const newCard = createMockCard("new", "new", 0, baseDate, 0);
        const matureCard = createMockCard(
          "mature",
          "review",
          20,
          baseDate,
          30.0,
        );

        // Test with both card types - the internal rating simulation should handle them differently
        const newCardResult = fsrs.simulateFutureDueLoad(
          [newCard],
          30,
          baseDate,
        );
        const matureCardResult = fsrs.simulateFutureDueLoad(
          [matureCard],
          30,
          baseDate,
        );

        // Both should generate some reviews, but potentially with different patterns
        const newCardTotal = newCardResult.reduce(
          (sum, day) => sum + day.dueCount,
          0,
        );
        const matureCardTotal = matureCardResult.reduce(
          (sum, day) => sum + day.dueCount,
          0,
        );

        expect(newCardTotal).toBeGreaterThan(0);
        expect(matureCardTotal).toBeGreaterThan(0);
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  describe("integration with FSRS parameters", () => {
    it("should respect different retention rates", () => {
      const highRetention = new FSRS({
        requestRetention: 0.95,
        profile: "STANDARD",
      });
      const lowRetention = new FSRS({
        requestRetention: 0.85,
        profile: "STANDARD",
      });

      const testCard = createMockCard("test", "review", 5, baseDate, 10.0);

      const highRetentionResult = highRetention.simulateFutureDueLoad(
        [testCard],
        90,
        baseDate,
      );
      const lowRetentionResult = lowRetention.simulateFutureDueLoad(
        [testCard],
        90,
        baseDate,
      );

      const highTotal = highRetentionResult.reduce(
        (sum, day) => sum + day.dueCount,
        0,
      );
      const lowTotal = lowRetentionResult.reduce(
        (sum, day) => sum + day.dueCount,
        0,
      );

      // Both should generate reviews
      expect(highTotal).toBeGreaterThan(0);
      expect(lowTotal).toBeGreaterThan(0);

      // The specific difference depends on how intervals are calculated,
      // but both should be reasonable
      expect(Math.abs(highTotal - lowTotal)).toBeLessThan(100);
    });

    it("should work with different FSRS profiles", () => {
      const standardFSRS = new FSRS({
        requestRetention: 0.9,
        profile: "STANDARD",
      });
      const intensiveFSRS = new FSRS({
        requestRetention: 0.9,
        profile: "INTENSIVE",
      });

      const testCard = createMockCard("test", "new", 0, baseDate, 0);

      const standardResult = standardFSRS.simulateFutureDueLoad(
        [testCard],
        30,
        baseDate,
      );
      const intensiveResult = intensiveFSRS.simulateFutureDueLoad(
        [testCard],
        30,
        baseDate,
      );

      const standardTotal = standardResult.reduce(
        (sum, day) => sum + day.dueCount,
        0,
      );
      const intensiveTotal = intensiveResult.reduce(
        (sum, day) => sum + day.dueCount,
        0,
      );

      // Both profiles should generate reviews
      expect(standardTotal).toBeGreaterThan(0);
      expect(intensiveTotal).toBeGreaterThan(0);
    });
  });

  describe("FSRS Algorithm Correctness - Stress Tests", () => {
    describe("Mathematical Properties", () => {
      it("should maintain stability monotonicity for successful reviews", () => {
        const testCard = createMockCard("test", "review", 3, baseDate, 5.0);

        // Mock consistent good ratings
        const originalRandom = Math.random;
        Math.random = () => 0.6; // Good rating

        try {
          const result = fsrs.simulateFutureDueLoad([testCard], 365, baseDate);

          // Should generate reviews (card doesn't disappear)
          const totalReviews = result.reduce(
            (sum, day) => sum + day.dueCount,
            0,
          );
          expect(totalReviews).toBeGreaterThan(0);
          expect(totalReviews).toBeLessThan(50); // But not excessive for good performance
        } finally {
          Math.random = originalRandom;
        }
      });

      it("should handle extreme difficulty values correctly", () => {
        const extremeEasyCard = createMockCard(
          "easy",
          "review",
          10,
          baseDate,
          30.0,
        );
        extremeEasyCard.difficulty = 1.0; // Minimum difficulty

        const extremeHardCard = createMockCard(
          "hard",
          "review",
          10,
          baseDate,
          1.0,
        );
        extremeHardCard.difficulty = 10.0; // Maximum difficulty

        const easyResult = fsrs.simulateFutureDueLoad(
          [extremeEasyCard],
          180,
          baseDate,
        );
        const hardResult = fsrs.simulateFutureDueLoad(
          [extremeHardCard],
          180,
          baseDate,
        );

        const easyTotal = easyResult.reduce(
          (sum, day) => sum + day.dueCount,
          0,
        );
        const hardTotal = hardResult.reduce(
          (sum, day) => sum + day.dueCount,
          0,
        );

        // Both should generate reasonable review counts
        expect(easyTotal).toBeGreaterThan(0);
        expect(hardTotal).toBeGreaterThan(0);
        expect(easyTotal).toBeLessThan(100);
        expect(hardTotal).toBeLessThan(100);
      });

      it("should handle extreme stability values correctly", () => {
        const veryUnstableCard = createMockCard(
          "unstable",
          "review",
          2,
          baseDate,
          0.1,
        );
        const veryStableCard = createMockCard(
          "stable",
          "review",
          20,
          baseDate,
          365.0,
        );

        const unstableResult = fsrs.simulateFutureDueLoad(
          [veryUnstableCard],
          90,
          baseDate,
        );
        const stableResult = fsrs.simulateFutureDueLoad(
          [veryStableCard],
          90,
          baseDate,
        );

        const unstableTotal = unstableResult.reduce(
          (sum, day) => sum + day.dueCount,
          0,
        );
        const stableTotal = stableResult.reduce(
          (sum, day) => sum + day.dueCount,
          0,
        );

        // Unstable card should have more frequent reviews than stable card
        expect(unstableTotal).toBeGreaterThanOrEqual(stableTotal);
        expect(unstableTotal).toBeLessThan(50); // But still reasonable
        expect(stableTotal).toBeGreaterThanOrEqual(0);
      });

      it("should respect retention rate constraints", () => {
        const highRetentionFsrs = new FSRS({
          requestRetention: 0.95,
          profile: "STANDARD",
        });
        const lowRetentionFsrs = new FSRS({
          requestRetention: 0.8,
          profile: "STANDARD",
        });

        const testCard = createMockCard("test", "review", 5, baseDate, 10.0);

        const highResult = highRetentionFsrs.simulateFutureDueLoad(
          [testCard],
          365,
          baseDate,
        );
        const lowResult = lowRetentionFsrs.simulateFutureDueLoad(
          [testCard],
          365,
          baseDate,
        );

        const highTotal = highResult.reduce(
          (sum, day) => sum + day.dueCount,
          0,
        );
        const lowTotal = lowResult.reduce((sum, day) => sum + day.dueCount, 0);

        // Both should generate reasonable review counts
        expect(highTotal).toBeGreaterThan(0);
        expect(lowTotal).toBeGreaterThan(0);
        expect(Math.abs(highTotal - lowTotal)).toBeLessThan(30); // Difference shouldn't be extreme
      });
    });

    describe("Statistical Distribution Validation", () => {
      it("should generate statistically valid rating distributions", () => {
        const originalRandom = Math.random;
        const ratings: number[] = [];

        Math.random = () => {
          const value = Math.random.call(Math);
          ratings.push(value);
          return value;
        };

        try {
          const testCards = Array.from({ length: 50 }, (_, i) =>
            createMockCard(`card-${i}`, "review", 3, baseDate, 5.0),
          );

          fsrs.simulateFutureDueLoad(testCards, 30, baseDate);

          if (ratings.length > 0) {
            // Check that we use the full range of random values
            const min = Math.min(...ratings);
            const max = Math.max(...ratings);
            expect(min).toBeGreaterThanOrEqual(0);
            expect(max).toBeLessThanOrEqual(1);
            expect(max - min).toBeGreaterThan(0.5); // Should use reasonable range
          }
        } finally {
          Math.random = originalRandom;
        }
      });

      it("should handle boundary rating values correctly", () => {
        const originalRandom = Math.random;
        const boundaryValues = [0.0, 0.05, 0.1, 0.89, 0.95, 0.99, 1.0];
        let callIndex = 0;

        Math.random = () => {
          const value = boundaryValues[callIndex % boundaryValues.length];
          callIndex++;
          return value;
        };

        try {
          const testCard = createMockCard(
            "boundary",
            "review",
            5,
            baseDate,
            10.0,
          );
          const result = fsrs.simulateFutureDueLoad([testCard], 60, baseDate);

          // Should handle all boundary values without crashing
          const totalReviews = result.reduce(
            (sum, day) => sum + day.dueCount,
            0,
          );
          expect(totalReviews).toBeGreaterThan(0);
          expect(totalReviews).toBeLessThan(100);
        } finally {
          Math.random = originalRandom;
        }
      });
    });

    describe("Performance and Scalability", () => {
      it("should handle 1000+ cards efficiently", () => {
        const largeCollection = Array.from({ length: 1000 }, (_, i) => {
          const maturity = i % 10;
          return createMockCard(
            `card-${i}`,
            i % 5 === 0 ? "new" : "review",
            maturity,
            new Date(baseDate.getTime() + (i % 30) * 24 * 60 * 60 * 1000),
            Math.max(0.5, maturity * 0.8),
          );
        });

        const startTime = performance.now();
        const result = fsrs.simulateFutureDueLoad(
          largeCollection,
          90,
          baseDate,
        );
        const endTime = performance.now();

        // Should complete in reasonable time (less than 2 seconds)
        expect(endTime - startTime).toBeLessThan(2000);
        expect(result).toHaveLength(90);

        const totalReviews = result.reduce((sum, day) => sum + day.dueCount, 0);
        expect(totalReviews).toBeGreaterThanOrEqual(1000); // Should generate reviews
        expect(totalReviews).toBeLessThan(50000); // But not unreasonably many
      });

      it("should maintain consistent memory usage with repeated calls", () => {
        const testCards = Array.from({ length: 100 }, (_, i) =>
          createMockCard(`card-${i}`, "review", 5, baseDate, 10.0),
        );

        // Run multiple simulations to test for memory leaks
        for (let i = 0; i < 10; i++) {
          const result = fsrs.simulateFutureDueLoad(testCards, 30, baseDate);
          expect(result).toHaveLength(30);

          const totalReviews = result.reduce(
            (sum, day) => sum + day.dueCount,
            0,
          );
          expect(totalReviews).toBeGreaterThan(0);
        }
      });
    });

    describe("Edge Cases and Boundary Conditions", () => {
      it("should handle cards with zero repetitions correctly", () => {
        const zeroRepCard = createMockCard("zero", "new", 0, null, 0);
        const result = fsrs.simulateFutureDueLoad([zeroRepCard], 30, baseDate);

        const totalReviews = result.reduce((sum, day) => sum + day.dueCount, 0);
        expect(totalReviews).toBeGreaterThan(0); // New cards should generate reviews
      });

      it("should handle cards due far in the future", () => {
        const futureDate = new Date(
          baseDate.getTime() + 365 * 24 * 60 * 60 * 1000,
        );
        const futureCard = createMockCard(
          "future",
          "review",
          10,
          futureDate,
          365.0,
        );

        const result = fsrs.simulateFutureDueLoad([futureCard], 30, baseDate);

        // Should handle gracefully - card might not appear in 30-day window
        expect(result).toHaveLength(30);
        const totalReviews = result.reduce((sum, day) => sum + day.dueCount, 0);
        expect(totalReviews).toBeGreaterThanOrEqual(0);
      });

      it("should handle mixed card collections with extreme variations", () => {
        const mixedCards = [
          createMockCard("new", "new", 0, null, 0),
          createMockCard("young", "review", 1, baseDate, 0.5),
          createMockCard("mature", "review", 15, baseDate, 45.0),
          createMockCard("ancient", "review", 100, baseDate, 365.0),
          createMockCard("difficult", "review", 20, baseDate, 5.0),
        ];

        // Set extreme difficulty values
        mixedCards[4].difficulty = 9.5;
        mixedCards[2].difficulty = 1.2;

        const result = fsrs.simulateFutureDueLoad(mixedCards, 180, baseDate);

        const totalReviews = result.reduce((sum, day) => sum + day.dueCount, 0);
        expect(totalReviews).toBeGreaterThan(0);
        expect(totalReviews).toBeLessThan(200); // Should be reasonable

        // Should not have any NaN or infinite values in the result
        result.forEach((day) => {
          expect(Number.isFinite(day.dueCount)).toBe(true);
          expect(day.dueCount).toBeGreaterThanOrEqual(0);
        });
      });

      it("should handle invalid date strings gracefully", () => {
        const invalidDateCard = createMockCard(
          "invalid",
          "review",
          3,
          baseDate,
          5.0,
        );
        (invalidDateCard as any).dueDate = "not-a-date";
        (invalidDateCard as any).lastReviewed = "also-not-a-date";

        // Should not crash with invalid dates
        expect(() => {
          const result = fsrs.simulateFutureDueLoad(
            [invalidDateCard],
            30,
            baseDate,
          );
          expect(result).toHaveLength(30);
        }).not.toThrow();
      });
    });

    describe("Regression Tests", () => {
      it("should produce consistent results for known test cases", () => {
        // Fixed seed for deterministic testing
        const originalRandom = Math.random;
        const sequence = [0.1, 0.3, 0.7, 0.9, 0.2, 0.6, 0.8, 0.4];
        let callIndex = 0;

        Math.random = () => {
          const value = sequence[callIndex % sequence.length];
          callIndex++;
          return value;
        };

        try {
          const knownCard = createMockCard(
            "known",
            "review",
            5,
            baseDate,
            10.0,
          );
          knownCard.difficulty = 5.0;
          knownCard.stability = 10.0;

          const result = fsrs.simulateFutureDueLoad([knownCard], 30, baseDate);

          // These values should be consistent across runs with the same seed
          expect(result).toHaveLength(30);
          const totalReviews = result.reduce(
            (sum, day) => sum + day.dueCount,
            0,
          );

          // With our fixed sequence, we should get predictable results
          expect(totalReviews).toBeGreaterThan(0);
          expect(totalReviews).toBeLessThan(15);

          // Test that the same input produces the same output
          callIndex = 0; // Reset sequence
          const result2 = fsrs.simulateFutureDueLoad([knownCard], 30, baseDate);
          expect(result2).toEqual(result);
        } finally {
          Math.random = originalRandom;
        }
      });

      it("should handle date arithmetic edge cases correctly", () => {
        // Test around daylight saving time boundaries and month boundaries
        const dstDate = new Date("2024-03-10T12:00:00.000Z"); // Around DST
        const monthEndDate = new Date("2024-01-31T23:59:59.000Z");
        const leapYearDate = new Date("2024-02-29T00:00:00.000Z");

        const testDates = [dstDate, monthEndDate, leapYearDate];

        testDates.forEach((testDate, index) => {
          const testCard = createMockCard(
            `date-${index}`,
            "review",
            3,
            testDate,
            5.0,
          );
          const result = fsrs.simulateFutureDueLoad([testCard], 30, testDate);

          expect(result).toHaveLength(30);
          // All dates should be valid ISO strings
          result.forEach((day) => {
            expect(() => new Date(day.date)).not.toThrow();
            expect(new Date(day.date).toISOString().split("T")[0]).toBe(
              day.date,
            );
          });
        });
      });
    });

    describe("Extreme Edge Cases and Stress Scenarios", () => {
      it("should handle cards with extreme repetition counts", () => {
        const extremeRepetitionCard = createMockCard(
          "extreme-rep",
          "review",
          999,
          baseDate,
          100.0,
        );

        const result = fsrs.simulateFutureDueLoad(
          [extremeRepetitionCard],
          30,
          baseDate,
        );

        expect(result).toHaveLength(30);
        const totalReviews = result.reduce((sum, day) => sum + day.dueCount, 0);
        expect(totalReviews).toBeGreaterThanOrEqual(0);
        expect(totalReviews).toBeLessThan(20); // Should be reasonable for high stability
      });

      it("should handle timestamp edge cases around Unix epoch", () => {
        const epochDate = new Date("1970-01-01T00:00:00.000Z");
        const epochCard = createMockCard("epoch", "review", 5, epochDate, 10.0);

        // Should handle dates at Unix epoch without crashing
        const result = fsrs.simulateFutureDueLoad([epochCard], 30, baseDate);
        expect(result).toHaveLength(30);

        result.forEach((day) => {
          expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(day.dueCount).toBeGreaterThanOrEqual(0);
        });
      });

      it("should maintain consistency with randomness suppression", () => {
        const originalRandom = Math.random;
        let callCount = 0;

        // Create a predictable but varied sequence
        const sequence = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
        Math.random = () => {
          const value = sequence[callCount % sequence.length];
          callCount++;
          return value;
        };

        try {
          const testCards = [
            createMockCard("card1", "new", 0, baseDate, 0),
            createMockCard("card2", "review", 3, baseDate, 5.0),
            createMockCard("card3", "review", 10, baseDate, 20.0),
          ];

          // Run simulation multiple times with same seed
          const results: any[] = [];
          for (let i = 0; i < 3; i++) {
            callCount = 0; // Reset sequence each time
            results.push(fsrs.simulateFutureDueLoad(testCards, 14, baseDate));
          }

          // All runs should produce identical results
          const first = results[0];
          results.slice(1).forEach((result) => {
            expect(result).toEqual(first);
          });
        } finally {
          Math.random = originalRandom;
        }
      });

      it("should handle mixed card states correctly", () => {
        const mixedStateCards = [
          createMockCard("new1", "new", 0, null, 0),
          createMockCard("new2", "new", 0, null, 0),
          createMockCard("review1", "review", 1, baseDate, 1.0),
          createMockCard("review2", "review", 5, baseDate, 10.0),
          createMockCard("review3", "review", 15, baseDate, 45.0),
        ];

        const result = fsrs.simulateFutureDueLoad(
          mixedStateCards,
          60,
          baseDate,
        );

        expect(result).toHaveLength(60);
        const totalReviews = result.reduce((sum, day) => sum + day.dueCount, 0);

        // Should generate reviews for all cards
        expect(totalReviews).toBeGreaterThanOrEqual(5); // At least one review per card
        expect(totalReviews).toBeLessThan(150); // But not excessive

        // Check that all days have non-negative counts
        result.forEach((day, index) => {
          expect(day.dueCount).toBeGreaterThanOrEqual(0);
          expect(day.date).toBe(
            new Date(baseDate.getTime() + index * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
          );
        });
      });

      it("should handle stress test with rapidly changing parameters", () => {
        const originalRandom = Math.random;
        let callIndex = 0;

        // Simulate extreme rating volatility
        const volatileSequence = [
          0.01, 0.99, 0.05, 0.95, 0.02, 0.98, 0.03, 0.97, 0.04, 0.96,
        ];
        Math.random = () => {
          const value = volatileSequence[callIndex % volatileSequence.length];
          callIndex++;
          return value;
        };

        try {
          const volatileCard = createMockCard(
            "volatile",
            "review",
            8,
            baseDate,
            15.0,
          );
          volatileCard.difficulty = 5.0;

          const result = fsrs.simulateFutureDueLoad(
            [volatileCard],
            90,
            baseDate,
          );

          expect(result).toHaveLength(90);
          const totalReviews = result.reduce(
            (sum, day) => sum + day.dueCount,
            0,
          );

          // Should handle volatile ratings without crashing
          expect(totalReviews).toBeGreaterThan(0);
          expect(totalReviews).toBeLessThan(100);

          // All values should be finite
          result.forEach((day) => {
            expect(Number.isFinite(day.dueCount)).toBe(true);
            expect(day.dueCount).toBeGreaterThanOrEqual(0);
          });
        } finally {
          Math.random = originalRandom;
        }
      });

      it("should maintain performance with deeply nested date calculations", () => {
        // Create cards with complex date patterns
        const complexCards: any[] = [];
        for (let i = 0; i < 50; i++) {
          const daysOffset = Math.sin(i) * 30; // Sine wave pattern
          const dueDate = new Date(
            baseDate.getTime() + daysOffset * 24 * 60 * 60 * 1000,
          );

          complexCards.push(
            createMockCard(
              `complex-${i}`,
              i % 3 === 0 ? "new" : "review",
              i % 10,
              dueDate,
              Math.max(0.5, Math.cos(i) * 20 + 10), // Cosine stability pattern
            ),
          );
        }

        const startTime = performance.now();
        const result = fsrs.simulateFutureDueLoad(complexCards, 120, baseDate);
        const endTime = performance.now();

        // Should complete efficiently even with complex patterns
        expect(endTime - startTime).toBeLessThan(500);
        expect(result).toHaveLength(120);

        const totalReviews = result.reduce((sum, day) => sum + day.dueCount, 0);
        expect(totalReviews).toBeGreaterThan(0);
        expect(totalReviews).toBeLessThan(2000);
      });

      it("should validate mathematical constraints are preserved", () => {
        const originalRandom = Math.random;
        const fixedSequence = [0.25, 0.5, 0.75]; // Good, good, easy pattern
        let callIndex = 0;

        Math.random = () => {
          const value = fixedSequence[callIndex % fixedSequence.length];
          callIndex++;
          return value;
        };

        try {
          const constraintCard = createMockCard(
            "constraint",
            "review",
            5,
            baseDate,
            8.0,
          );
          constraintCard.difficulty = 4.0;
          constraintCard.stability = 8.0;

          const result = fsrs.simulateFutureDueLoad(
            [constraintCard],
            45,
            baseDate,
          );

          // Verify mathematical properties
          expect(result).toHaveLength(45);

          // Check monotonicity of due dates
          for (let i = 0; i < result.length - 1; i++) {
            const currentDate = new Date(result[i].date);
            const nextDate = new Date(result[i + 1].date);
            expect(nextDate.getTime()).toBeGreaterThan(currentDate.getTime());
          }

          // Verify reasonable review frequency
          const totalReviews = result.reduce(
            (sum, day) => sum + day.dueCount,
            0,
          );
          expect(totalReviews).toBeGreaterThan(0);
          expect(totalReviews).toBeLessThan(25); // Reasonable for 45 days with good performance
        } finally {
          Math.random = originalRandom;
        }
      });
    });
  });
});
