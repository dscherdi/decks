import type { Flashcard } from "../database/types";

interface FuzzyResult {
  match: boolean;
  score: number;
}

/**
 * Subsequence-based fuzzy match. Checks if all characters of the query
 * appear in order within the target string (case-insensitive).
 * Returns a score based on consecutive character matches and match position.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  if (!query) return { match: true, score: 0 };
  if (!target) return { match: false, score: 0 };

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  let queryIdx = 0;
  let score = 0;
  let lastMatchIdx = -2;
  let firstMatchIdx = -1;

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      if (firstMatchIdx === -1) firstMatchIdx = i;

      // Bonus for consecutive matches
      if (i === lastMatchIdx + 1) {
        score += 3;
      } else {
        score += 1;
      }

      // Bonus for matching at word boundaries
      if (i === 0 || targetLower[i - 1] === ' ' || targetLower[i - 1] === '/' || targetLower[i - 1] === '>') {
        score += 2;
      }

      lastMatchIdx = i;
      queryIdx++;
    }
  }

  if (queryIdx < queryLower.length) {
    return { match: false, score: 0 };
  }

  // Bonus for early first match
  if (firstMatchIdx >= 0) {
    score += Math.max(0, 10 - firstMatchIdx);
  }

  return { match: true, score };
}

/**
 * Compute the best fuzzy match score across multiple fields of a flashcard.
 */
function scoreFlashcard(query: string, card: Flashcard, deckTag: string): number {
  const fields = [card.front, card.back, card.sourceFile, card.breadcrumb, deckTag];
  let bestScore = 0;

  for (const field of fields) {
    const result = fuzzyMatch(query, field);
    if (result.match && result.score > bestScore) {
      bestScore = result.score;
    }
  }

  return bestScore;
}

/**
 * Filter and sort flashcards by fuzzy search query.
 * Searches across: front, back, sourceFile, breadcrumb, and deck tag.
 * Returns matched cards sorted by best match score (descending).
 */
export function fuzzySearchFlashcards(
  query: string,
  cards: Flashcard[],
  deckTagMap: Map<string, string>
): Flashcard[] {
  if (!query.trim()) return cards;

  const scored: Array<{ card: Flashcard; score: number }> = [];

  for (const card of cards) {
    const deckTag = deckTagMap.get(card.deckId) ?? "";
    const score = scoreFlashcard(query, card, deckTag);
    if (score > 0) {
      scored.push({ card, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.card);
}
