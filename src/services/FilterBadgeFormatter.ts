import type { FilterRule } from "../database/types";

const FIELD_LABELS: Record<string, string> = {
  state: "State",
  dueDate: "Due",
  deckId: "Deck",
  deckTag: "Deck tag",
  tags: "Tag",
  sourceFile: "File",
  breadcrumb: "Breadcrumb",
  type: "Type",
  difficulty: "Difficulty",
  stability: "Stability",
  interval: "Interval",
  repetitions: "Reps",
  lapses: "Lapses",
  lastReviewed: "Reviewed",
  created: "Created",
  isLeech: "Leech",
  isDense: "Dense",
};

export interface DeckLookup {
  id: string;
  name: string;
}

export interface BadgeParts {
  /** Field label, e.g. "State", "Tag". Null for valueless tokens like "Leech". */
  key: string | null;
  /** The operator+value rendering, e.g. "New", "> 5", "≠ math". */
  value: string;
}

export function formatBadgeParts(
  rule: FilterRule,
  availableDecks: DeckLookup[] = []
): BadgeParts {
  const label = FIELD_LABELS[rule.field] ?? rule.field;

  if (rule.field === "isLeech" || rule.field === "isDense") {
    const positive =
      (rule.operator === "equals" && rule.value === "true") ||
      (rule.operator === "not_equals" && rule.value === "false");
    return {
      key: null,
      value: positive ? label : `Not ${label.toLowerCase()}`,
    };
  }

  if (rule.field === "deckId") {
    const ids = rule.value.split(",").filter((v) => v.length > 0);
    if (ids.length === 0) return { key: label, value: "—" };
    const names = ids.map(
      (id) => availableDecks.find((d) => d.id === id)?.name ?? id
    );
    const summary =
      names.length <= 2 ? names.join(", ") : `${names[0]} +${names.length - 1}`;
    return { key: label, value: summary };
  }

  if (rule.field === "state" && rule.operator === "equals") {
    return {
      key: "State",
      value: rule.value === "new" ? "New" : "Review",
    };
  }

  switch (rule.operator) {
    case "is_new":
      return { key: "State", value: "New" };
    case "is_due":
      return { key: "State", value: "Due" };
    case "equals":
      return { key: label, value: rule.value };
    case "not_equals":
      return { key: label, value: `≠ ${rule.value}` };
    case "contains":
      return { key: label, value: `"${rule.value}"` };
    case "not_contains":
      return { key: label, value: `not "${rule.value}"` };
    case "greater_than":
      return { key: label, value: `> ${rule.value}` };
    case "less_than":
      return { key: label, value: `< ${rule.value}` };
    case "before":
      return { key: label, value: `before ${rule.value}` };
    case "after":
      return { key: label, value: `after ${rule.value}` };
    case "in":
      return { key: label, value: rule.value };
    default:
      return { key: label, value: rule.value || label };
  }
}

export function formatBadgeLabel(
  rule: FilterRule,
  availableDecks: DeckLookup[] = []
): string {
  const label = FIELD_LABELS[rule.field] ?? rule.field;

  if (rule.field === "isLeech" || rule.field === "isDense") {
    const positive =
      (rule.operator === "equals" && rule.value === "true") ||
      (rule.operator === "not_equals" && rule.value === "false");
    return positive ? label : `Not ${label.toLowerCase()}`;
  }

  if (rule.field === "deckId") {
    const ids = rule.value.split(",").filter((v) => v.length > 0);
    if (ids.length === 0) return `${label}: —`;
    const names = ids.map(
      (id) => availableDecks.find((d) => d.id === id)?.name ?? id
    );
    const summary =
      names.length <= 2 ? names.join(", ") : `${names[0]} +${names.length - 1}`;
    return `${label}: ${summary}`;
  }

  if (rule.field === "state" && rule.operator === "equals") {
    return `State: ${rule.value === "new" ? "New" : "Review"}`;
  }

  switch (rule.operator) {
    case "is_new":
      return "State: New";
    case "is_due":
      return "State: Due";
    case "equals":
      return `${label}: ${rule.value}`;
    case "not_equals":
      return `${label} ≠ ${rule.value}`;
    case "contains":
      return `${label}: "${rule.value}"`;
    case "not_contains":
      return `${label} not "${rule.value}"`;
    case "greater_than":
      return `${label} > ${rule.value}`;
    case "less_than":
      return `${label} < ${rule.value}`;
    case "before":
      return `${label} before ${rule.value}`;
    case "after":
      return `${label} after ${rule.value}`;
    case "in":
      return `${label}: ${rule.value}`;
    default:
      return rule.value || label;
  }
}
