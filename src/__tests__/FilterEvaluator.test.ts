import { evaluateFilter } from "../services/FilterEvaluator";
import type { Flashcard, FilterDefinition } from "../database/types";

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: "card_1",
    deckId: "deck_1",
    front: "What is 2+2?",
    back: "4",
    type: "header-paragraph",
    sourceFile: "math.md",
    contentHash: "h",
    breadcrumb: "Math > Basics",
    notes: "",
    tags: ["math", "basic"],
    clozeText: null,
    clozeOrder: null,
    state: "review",
    dueDate: "2026-01-01T00:00:00.000Z",
    interval: 1440,
    repetitions: 3,
    difficulty: 5,
    stability: 10,
    lapses: 2,
    lastReviewed: "2025-12-25T00:00:00.000Z",
    created: "2025-01-01T00:00:00.000Z",
    modified: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ctx = {
  deckTagMap: new Map([["deck_1", "math"]]),
};

describe("FilterEvaluator", () => {
  it("returns true for empty rules (matches all)", () => {
    const def: FilterDefinition = { version: 1, logic: "AND", rules: [] };
    expect(evaluateFilter(makeCard(), def, ctx)).toBe(true);
  });

  it("evaluates is_new", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "state", operator: "is_new", value: "" }],
    };
    expect(evaluateFilter(makeCard({ state: "new" }), def, ctx)).toBe(true);
    expect(evaluateFilter(makeCard({ state: "review" }), def, ctx)).toBe(false);
  });

  it("evaluates equals on string field", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "sourceFile", operator: "equals", value: "math.md" }],
    };
    expect(evaluateFilter(makeCard(), def, ctx)).toBe(true);
    expect(evaluateFilter(makeCard({ sourceFile: "other.md" }), def, ctx)).toBe(
      false
    );
  });

  it("evaluates equals on numeric field", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "lapses", operator: "equals", value: "2" }],
    };
    expect(evaluateFilter(makeCard(), def, ctx)).toBe(true);
    expect(evaluateFilter(makeCard({ lapses: 3 }), def, ctx)).toBe(false);
  });

  it("evaluates greater_than on numeric field", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "difficulty", operator: "greater_than", value: "4" }],
    };
    expect(evaluateFilter(makeCard({ difficulty: 5 }), def, ctx)).toBe(true);
    expect(evaluateFilter(makeCard({ difficulty: 3 }), def, ctx)).toBe(false);
  });

  it("evaluates contains on breadcrumb", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "breadcrumb", operator: "contains", value: "math" }],
    };
    expect(evaluateFilter(makeCard(), def, ctx)).toBe(true);
  });

  it("evaluates equals on tags as membership", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "tags", operator: "equals", value: "math" }],
    };
    expect(evaluateFilter(makeCard(), def, ctx)).toBe(true);
    expect(evaluateFilter(makeCard({ tags: ["other"] }), def, ctx)).toBe(false);
  });

  it("evaluates deckTag via deckTagMap", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "deckTag", operator: "equals", value: "math" }],
    };
    expect(evaluateFilter(makeCard(), def, ctx)).toBe(true);
  });

  it("evaluates AND logic across rules", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [
        { field: "state", operator: "is_new", value: "" },
        { field: "lapses", operator: "equals", value: "2" },
      ],
    };
    expect(evaluateFilter(makeCard({ state: "new", lapses: 2 }), def, ctx)).toBe(
      true
    );
    expect(evaluateFilter(makeCard({ state: "new", lapses: 3 }), def, ctx)).toBe(
      false
    );
  });

  it("evaluates OR logic across rules", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "OR",
      rules: [
        { field: "state", operator: "is_new", value: "" },
        { field: "lapses", operator: "equals", value: "2" },
      ],
    };
    expect(evaluateFilter(makeCard({ state: "review", lapses: 2 }), def, ctx)).toBe(
      true
    );
    expect(evaluateFilter(makeCard({ state: "new", lapses: 5 }), def, ctx)).toBe(
      true
    );
    expect(
      evaluateFilter(makeCard({ state: "review", lapses: 5 }), def, ctx)
    ).toBe(false);
  });

  it("evaluates isLeech with default threshold", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "isLeech", operator: "equals", value: "true" }],
    };
    expect(evaluateFilter(makeCard({ lapses: 8 }), def, ctx)).toBe(true);
    expect(evaluateFilter(makeCard({ lapses: 7 }), def, ctx)).toBe(false);
  });

  it("evaluates isLeech with custom threshold", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "isLeech", operator: "equals", value: "true" }],
    };
    const customCtx = {
      ...ctx,
      thresholds: { leechThreshold: 3, denseCardCharThreshold: 500 },
    };
    expect(evaluateFilter(makeCard({ lapses: 3 }), def, customCtx)).toBe(true);
    expect(evaluateFilter(makeCard({ lapses: 2 }), def, customCtx)).toBe(false);
  });

  it("evaluates isLeech=false (inverted)", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "isLeech", operator: "equals", value: "false" }],
    };
    expect(evaluateFilter(makeCard({ lapses: 8 }), def, ctx)).toBe(false);
    expect(evaluateFilter(makeCard({ lapses: 0 }), def, ctx)).toBe(true);
  });

  it("evaluates isDense with default threshold", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "isDense", operator: "equals", value: "true" }],
    };
    expect(evaluateFilter(makeCard({ back: "a".repeat(500) }), def, ctx)).toBe(
      true
    );
    expect(evaluateFilter(makeCard({ back: "short" }), def, ctx)).toBe(false);
  });

  it("evaluates isDense with custom threshold", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "isDense", operator: "equals", value: "true" }],
    };
    const customCtx = {
      ...ctx,
      thresholds: { leechThreshold: 8, denseCardCharThreshold: 50 },
    };
    expect(
      evaluateFilter(makeCard({ back: "a".repeat(60) }), def, customCtx)
    ).toBe(true);
    expect(
      evaluateFilter(makeCard({ back: "a".repeat(40) }), def, customCtx)
    ).toBe(false);
  });

  it("rejects non-equals operator on virtual field", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "isLeech", operator: "greater_than", value: "true" }],
    };
    expect(() => evaluateFilter(makeCard(), def, ctx)).toThrow(
      /only supports equals/
    );
  });

  it("evaluates 'in' operator for non-tag field", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "deckId", operator: "in", value: "deck_1, deck_2" }],
    };
    expect(evaluateFilter(makeCard(), def, ctx)).toBe(true);
    expect(evaluateFilter(makeCard({ deckId: "deck_3" }), def, ctx)).toBe(false);
  });

  it("evaluates 'in' operator for tag field", () => {
    const def: FilterDefinition = {
      version: 1,
      logic: "AND",
      rules: [{ field: "tags", operator: "in", value: "physics, math" }],
    };
    expect(evaluateFilter(makeCard(), def, ctx)).toBe(true);
  });
});
