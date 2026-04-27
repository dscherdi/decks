import { compileFilter } from "../services/FilterEngine";
import type { FilterDefinition } from "../database/types";

describe("FilterEngine", () => {
  describe("compileFilter", () => {
    it("should return 1=1 for empty rules", () => {
      const def: FilterDefinition = { version: 1, logic: "AND", rules: [] };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("1 = 1");
      expect(result.params).toEqual([]);
      expect(result.requiresDeckJoin).toBe(false);
    });

    it("should compile is_new operator", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "is_new", value: "" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.state = ?)");
      expect(result.params).toEqual(["new"]);
    });

    it("should compile is_due operator", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "dueDate", operator: "is_due", value: "" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.state = ? AND f.due_date <= ?)");
      expect(result.params).toHaveLength(2);
      expect(result.params[0]).toBe("review");
    });

    it("should compile equals operator for string field", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "sourceFile", operator: "equals", value: "Biology.md" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.source_file = ?)");
      expect(result.params).toEqual(["Biology.md"]);
    });

    it("should compile equals operator for numeric field", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "difficulty", operator: "equals", value: "7.5" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.difficulty = ?)");
      expect(result.params).toEqual([7.5]);
    });

    it("should compile not_equals operator", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "not_equals", value: "new" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.state != ?)");
      expect(result.params).toEqual(["new"]);
    });

    it("should compile contains operator", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "breadcrumb", operator: "contains", value: "Chapter 1" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.breadcrumb LIKE ?)");
      expect(result.params).toEqual(["%Chapter 1%"]);
    });

    it("should compile not_contains operator", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "sourceFile", operator: "not_contains", value: "draft" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.source_file NOT LIKE ?)");
      expect(result.params).toEqual(["%draft%"]);
    });

    it("should compile greater_than for numeric field", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "difficulty", operator: "greater_than", value: "7" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.difficulty > ?)");
      expect(result.params).toEqual([7]);
    });

    it("should compile less_than for numeric field", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "lapses", operator: "less_than", value: "3" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.lapses < ?)");
      expect(result.params).toEqual([3]);
    });

    it("should compile before operator", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "dueDate", operator: "before", value: "2026-01-01T00:00:00.000Z" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.due_date < ?)");
      expect(result.params).toEqual(["2026-01-01T00:00:00.000Z"]);
    });

    it("should compile after operator", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "created", operator: "after", value: "2025-06-01T00:00:00.000Z" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.created > ?)");
      expect(result.params).toEqual(["2025-06-01T00:00:00.000Z"]);
    });

    it("should compile in operator", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "deckId", operator: "in", value: "deck_abc,deck_def,deck_ghi" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.deck_id IN (?, ?, ?))");
      expect(result.params).toEqual(["deck_abc", "deck_def", "deck_ghi"]);
    });

    it("should handle in operator with empty value", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "deckId", operator: "in", value: "" }],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(1 = 0)");
      expect(result.params).toEqual([]);
    });

    it("should join rules with AND logic", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [
          { field: "state", operator: "is_new", value: "" },
          { field: "sourceFile", operator: "contains", value: "Biology" },
        ],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toBe("(f.state = ?) AND (f.source_file LIKE ?)");
      expect(result.params).toEqual(["new", "%Biology%"]);
    });

    it("should join rules with OR logic", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "OR",
        rules: [
          { field: "state", operator: "is_new", value: "" },
          { field: "dueDate", operator: "is_due", value: "" },
        ],
      };
      const result = compileFilter(def);
      expect(result.whereClause).toContain(" OR ");
    });

    it("should detect deckTag field requires deck join", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "deckTag", operator: "contains", value: "math" }],
      };
      const result = compileFilter(def);
      expect(result.requiresDeckJoin).toBe(true);
      expect(result.whereClause).toBe("(d.tag LIKE ?)");
    });

    it("should not require deck join for non-deckTag fields", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "is_new", value: "" }],
      };
      const result = compileFilter(def);
      expect(result.requiresDeckJoin).toBe(false);
    });

    it("should throw for unknown field", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "unknown" as never, operator: "equals", value: "x" }],
      };
      expect(() => compileFilter(def)).toThrow("Unknown filter field");
    });

    it("should throw for unknown operator", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [{ field: "state", operator: "unknown" as never, value: "x" }],
      };
      expect(() => compileFilter(def)).toThrow("Unknown filter operator");
    });

    it("should handle multiple rules with mixed fields", () => {
      const def: FilterDefinition = {
        version: 1,
        logic: "AND",
        rules: [
          { field: "deckTag", operator: "contains", value: "science" },
          { field: "difficulty", operator: "greater_than", value: "5" },
          { field: "state", operator: "is_new", value: "" },
        ],
      };
      const result = compileFilter(def);
      expect(result.requiresDeckJoin).toBe(true);
      expect(result.whereClause).toBe(
        "(d.tag LIKE ?) AND (f.difficulty > ?) AND (f.state = ?)"
      );
      expect(result.params).toEqual(["%science%", 5, "new"]);
    });
  });
});
