import type {
  Flashcard,
  FilterDefinition,
  FilterRule,
} from "../database/types";
import {
  DEFAULT_LEECH_THRESHOLD,
  DEFAULT_DENSE_CHAR_THRESHOLD,
  type FilterCompileOptions,
} from "./FilterEngine";

export interface FilterEvaluationContext {
  /** Map of deckId -> deckTag (e.g. "biology") */
  deckTagMap: Map<string, string>;
  thresholds?: FilterCompileOptions;
}

function parseBool(value: string): boolean {
  return value === "true" || value === "1";
}

function fieldValue(card: Flashcard, field: string, ctx: FilterEvaluationContext): unknown {
  switch (field) {
    case "deckId":
      return card.deckId;
    case "deckTag":
      return ctx.deckTagMap.get(card.deckId) ?? "";
    case "type":
      return card.type;
    case "sourceFile":
      return card.sourceFile;
    case "breadcrumb":
      return card.breadcrumb;
    case "tags":
      return card.tags;
    case "state":
      return card.state;
    case "dueDate":
      return card.dueDate;
    case "difficulty":
      return card.difficulty;
    case "stability":
      return card.stability;
    case "interval":
      return card.interval;
    case "repetitions":
      return card.repetitions;
    case "lapses":
      return card.lapses;
    case "lastReviewed":
      return card.lastReviewed ?? "";
    case "created":
      return card.created;
    default:
      throw new Error(`Unknown filter field: ${field}`);
  }
}

function evaluateRule(
  card: Flashcard,
  rule: FilterRule,
  ctx: FilterEvaluationContext
): boolean {
  const leechThreshold =
    ctx.thresholds?.leechThreshold ?? DEFAULT_LEECH_THRESHOLD;
  const denseCharThreshold =
    ctx.thresholds?.denseCardCharThreshold ?? DEFAULT_DENSE_CHAR_THRESHOLD;

  if (rule.field === "isLeech" || rule.field === "isDense") {
    if (rule.operator !== "equals" && rule.operator !== "not_equals") {
      throw new Error(
        `Field "${rule.field}" only supports equals/not_equals operators`
      );
    }
    const expected = parseBool(rule.value);
    const actual =
      rule.field === "isLeech"
        ? card.lapses >= leechThreshold
        : (card.back?.length ?? 0) >= denseCharThreshold;
    return rule.operator === "equals" ? actual === expected : actual !== expected;
  }

  switch (rule.operator) {
    case "is_due": {
      if (card.state !== "review") return false;
      return new Date(card.dueDate).getTime() <= Date.now();
    }
    case "is_new":
      return card.state === "new";
    case "equals": {
      const v = fieldValue(card, rule.field, ctx);
      if (rule.field === "tags") {
        return (v as string[]).includes(rule.value);
      }
      if (typeof v === "number") {
        return v === parseFloat(rule.value);
      }
      return String(v) === rule.value;
    }
    case "not_equals": {
      const v = fieldValue(card, rule.field, ctx);
      if (rule.field === "tags") {
        return !(v as string[]).includes(rule.value);
      }
      if (typeof v === "number") {
        return v !== parseFloat(rule.value);
      }
      return String(v) !== rule.value;
    }
    case "contains": {
      const v = fieldValue(card, rule.field, ctx);
      if (rule.field === "tags") {
        return (v as string[]).includes(rule.value);
      }
      return String(v).toLowerCase().includes(rule.value.toLowerCase());
    }
    case "not_contains": {
      const v = fieldValue(card, rule.field, ctx);
      if (rule.field === "tags") {
        return !(v as string[]).includes(rule.value);
      }
      return !String(v).toLowerCase().includes(rule.value.toLowerCase());
    }
    case "greater_than": {
      const v = fieldValue(card, rule.field, ctx);
      if (typeof v === "number") {
        return v > parseFloat(rule.value);
      }
      return String(v) > rule.value;
    }
    case "less_than": {
      const v = fieldValue(card, rule.field, ctx);
      if (typeof v === "number") {
        return v < parseFloat(rule.value);
      }
      return String(v) < rule.value;
    }
    case "before": {
      const v = String(fieldValue(card, rule.field, ctx));
      return v < rule.value;
    }
    case "after": {
      const v = String(fieldValue(card, rule.field, ctx));
      return v > rule.value;
    }
    case "in": {
      const values = rule.value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (values.length === 0) return false;
      if (rule.field === "tags") {
        const tags = fieldValue(card, rule.field, ctx) as string[];
        return values.some((v) => tags.includes(v));
      }
      const v = String(fieldValue(card, rule.field, ctx));
      return values.includes(v);
    }
    default:
      throw new Error(`Unknown filter operator: ${String(rule.operator)}`);
  }
}

export function evaluateFilter(
  card: Flashcard,
  definition: FilterDefinition,
  ctx: FilterEvaluationContext
): boolean {
  if (definition.rules.length === 0) return true;
  if (definition.logic === "OR") {
    return definition.rules.some((rule) => evaluateRule(card, rule, ctx));
  }
  return definition.rules.every((rule) => evaluateRule(card, rule, ctx));
}
