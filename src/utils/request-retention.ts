import { validateRequestRetention } from "@decks/core";

/** A typed retention target, read with either decimal mark; null unless the scheduler accepts it. */
export function parseRequestRetention(text: string): number | null {
  const trimmed = text.trim();
  const value = Number(trimmed.replace(",", "."));
  return trimmed !== "" && validateRequestRetention(value) ? value : null;
}
