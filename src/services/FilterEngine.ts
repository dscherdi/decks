import type { FilterDefinition, FilterRule } from "../database/types";
import type { SqlJsValue } from "../database/sql-types";

export interface CompiledFilter {
  whereClause: string;
  params: SqlJsValue[];
  requiresDeckJoin: boolean;
}

const FIELD_TO_COLUMN: Record<string, string> = {
  deckId: "f.deck_id",
  deckTag: "d.tag",
  type: "f.type",
  sourceFile: "f.source_file",
  breadcrumb: "f.breadcrumb",
  state: "f.state",
  dueDate: "f.due_date",
  difficulty: "f.difficulty",
  stability: "f.stability",
  interval: "f.interval",
  repetitions: "f.repetitions",
  lapses: "f.lapses",
  lastReviewed: "f.last_reviewed",
  created: "f.created",
};

const NUMERIC_FIELDS = new Set([
  "difficulty", "stability", "interval", "repetitions", "lapses",
]);

function compileRule(rule: FilterRule, params: SqlJsValue[]): string {
  const column = FIELD_TO_COLUMN[rule.field];
  if (!column) {
    throw new Error(`Unknown filter field: ${rule.field}`);
  }

  switch (rule.operator) {
    case "is_due": {
      const now = new Date().toISOString();
      params.push("review", now);
      return `(f.state = ? AND f.due_date <= ?)`;
    }
    case "is_new":
      params.push("new");
      return `(f.state = ?)`;
    case "equals":
      if (NUMERIC_FIELDS.has(rule.field)) {
        params.push(parseFloat(rule.value));
      } else {
        params.push(rule.value);
      }
      return `(${column} = ?)`;
    case "not_equals":
      if (NUMERIC_FIELDS.has(rule.field)) {
        params.push(parseFloat(rule.value));
      } else {
        params.push(rule.value);
      }
      return `(${column} != ?)`;
    case "contains":
      params.push(`%${rule.value}%`);
      return `(${column} LIKE ?)`;
    case "not_contains":
      params.push(`%${rule.value}%`);
      return `(${column} NOT LIKE ?)`;
    case "greater_than":
      params.push(NUMERIC_FIELDS.has(rule.field) ? parseFloat(rule.value) : rule.value);
      return `(${column} > ?)`;
    case "less_than":
      params.push(NUMERIC_FIELDS.has(rule.field) ? parseFloat(rule.value) : rule.value);
      return `(${column} < ?)`;
    case "before":
      params.push(rule.value);
      return `(${column} < ?)`;
    case "after":
      params.push(rule.value);
      return `(${column} > ?)`;
    case "in": {
      const values = rule.value.split(",").map(v => v.trim()).filter(v => v.length > 0);
      if (values.length === 0) {
        return "(1 = 0)";
      }
      const placeholders = values.map(() => "?").join(", ");
      for (const v of values) {
        params.push(v);
      }
      return `(${column} IN (${placeholders}))`;
    }
    default:
      throw new Error(`Unknown filter operator: ${String(rule.operator)}`);
  }
}

export function compileFilter(definition: FilterDefinition): CompiledFilter {
  const params: SqlJsValue[] = [];
  const requiresDeckJoin = definition.rules.some(r => r.field === "deckTag");

  if (definition.rules.length === 0) {
    return { whereClause: "1 = 1", params, requiresDeckJoin };
  }

  const joiner = definition.logic === "OR" ? " OR " : " AND ";
  const clauses = definition.rules.map(rule => compileRule(rule, params));
  const whereClause = clauses.join(joiner);

  return { whereClause, params, requiresDeckJoin };
}
