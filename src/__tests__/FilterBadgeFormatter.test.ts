import {
  formatBadgeLabel,
  formatBadgeParts,
} from "../services/FilterBadgeFormatter";
import type { FilterRule } from "../database/types";

describe("formatBadgeLabel", () => {
  it("formats state is_new", () => {
    const rule: FilterRule = { field: "state", operator: "is_new", value: "" };
    expect(formatBadgeLabel(rule)).toBe("State: New");
  });

  it("formats state is_due", () => {
    const rule: FilterRule = { field: "state", operator: "is_due", value: "" };
    expect(formatBadgeLabel(rule)).toBe("State: Due");
  });

  it("formats state equals new and review", () => {
    expect(
      formatBadgeLabel({ field: "state", operator: "equals", value: "new" })
    ).toBe("State: New");
    expect(
      formatBadgeLabel({ field: "state", operator: "equals", value: "review" })
    ).toBe("State: Review");
  });

  it("formats isLeech equals true as Leech", () => {
    const rule: FilterRule = {
      field: "isLeech",
      operator: "equals",
      value: "true",
    };
    expect(formatBadgeLabel(rule)).toBe("Leech");
  });

  it("formats isLeech equals false as Not leech", () => {
    const rule: FilterRule = {
      field: "isLeech",
      operator: "equals",
      value: "false",
    };
    expect(formatBadgeLabel(rule)).toBe("Not leech");
  });

  it("formats isDense not_equals true as Not dense", () => {
    const rule: FilterRule = {
      field: "isDense",
      operator: "not_equals",
      value: "true",
    };
    expect(formatBadgeLabel(rule)).toBe("Not dense");
  });

  it("formats deckTag contains", () => {
    const rule: FilterRule = {
      field: "deckTag",
      operator: "contains",
      value: "german",
    };
    expect(formatBadgeLabel(rule)).toBe('Deck tag: "german"');
  });

  it("formats numeric greater_than", () => {
    const rule: FilterRule = {
      field: "lapses",
      operator: "greater_than",
      value: "5",
    };
    expect(formatBadgeLabel(rule)).toBe("Lapses > 5");
  });

  it("formats deckId with one selected deck", () => {
    const rule: FilterRule = {
      field: "deckId",
      operator: "in",
      value: "d1",
    };
    expect(
      formatBadgeLabel(rule, [
        { id: "d1", name: "Mathematics" },
        { id: "d2", name: "Biology" },
      ])
    ).toBe("Deck: Mathematics");
  });

  it("formats deckId with three selected decks (truncates)", () => {
    const rule: FilterRule = {
      field: "deckId",
      operator: "in",
      value: "d1,d2,d3",
    };
    expect(
      formatBadgeLabel(rule, [
        { id: "d1", name: "Math" },
        { id: "d2", name: "Bio" },
        { id: "d3", name: "Chem" },
      ])
    ).toBe("Deck: Math +2");
  });

  it("falls back to raw id when deck not found", () => {
    const rule: FilterRule = {
      field: "deckId",
      operator: "equals",
      value: "missing",
    };
    expect(formatBadgeLabel(rule, [])).toBe("Deck: missing");
  });

  it("formats not_contains for tag", () => {
    const rule: FilterRule = {
      field: "tags",
      operator: "not_contains",
      value: "math",
    };
    expect(formatBadgeLabel(rule)).toBe('Tag not "math"');
  });

  it("formats date before/after", () => {
    expect(
      formatBadgeLabel({
        field: "dueDate",
        operator: "before",
        value: "2026-01-01",
      })
    ).toBe("Due before 2026-01-01");
    expect(
      formatBadgeLabel({
        field: "lastReviewed",
        operator: "after",
        value: "2026-01-01",
      })
    ).toBe("Reviewed after 2026-01-01");
  });
});

describe("formatBadgeParts", () => {
  it("returns null key for valueless badges (Leech, Dense)", () => {
    expect(
      formatBadgeParts({
        field: "isLeech",
        operator: "equals",
        value: "true",
      })
    ).toEqual({ key: null, value: "Leech" });
    expect(
      formatBadgeParts({
        field: "isDense",
        operator: "equals",
        value: "true",
      })
    ).toEqual({ key: null, value: "Dense" });
  });

  it("returns null key for negated boolean badges", () => {
    expect(
      formatBadgeParts({
        field: "isLeech",
        operator: "not_equals",
        value: "true",
      })
    ).toEqual({ key: null, value: "Not leech" });
  });

  it("splits state is_new into key/value", () => {
    expect(
      formatBadgeParts({ field: "state", operator: "is_new", value: "" })
    ).toEqual({ key: "State", value: "New" });
  });

  it("splits state equals into key/value", () => {
    expect(
      formatBadgeParts({ field: "state", operator: "equals", value: "review" })
    ).toEqual({ key: "State", value: "Review" });
  });

  it("encodes operator into the value for numeric comparisons", () => {
    expect(
      formatBadgeParts({
        field: "lapses",
        operator: "greater_than",
        value: "5",
      })
    ).toEqual({ key: "Lapses", value: "> 5" });
    expect(
      formatBadgeParts({
        field: "difficulty",
        operator: "less_than",
        value: "3",
      })
    ).toEqual({ key: "Difficulty", value: "< 3" });
  });

  it("encodes not_equals operator into the value", () => {
    expect(
      formatBadgeParts({
        field: "tags",
        operator: "not_equals",
        value: "math",
      })
    ).toEqual({ key: "Tag", value: "≠ math" });
  });

  it("wraps contains values in quotes", () => {
    expect(
      formatBadgeParts({
        field: "breadcrumb",
        operator: "contains",
        value: "Chapter 1",
      })
    ).toEqual({ key: "Breadcrumb", value: '"Chapter 1"' });
  });

  it("formats deckId selection", () => {
    expect(
      formatBadgeParts(
        { field: "deckId", operator: "in", value: "d1,d2,d3" },
        [
          { id: "d1", name: "Math" },
          { id: "d2", name: "Bio" },
          { id: "d3", name: "Chem" },
        ]
      )
    ).toEqual({ key: "Deck", value: "Math +2" });
  });
});
