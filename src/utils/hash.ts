/**
 * Hash utility functions for generating deterministic IDs
 */

/**
 * Generate a simple hash from a string
 * Uses a basic hash algorithm for deterministic ID generation
 */
function simpleHash(text: string): number {
  if (!text) {
    return 0;
  }
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Generate unique flashcard ID using hash of deck ID and front text
 * @param frontText The front text of the flashcard
 * @param deckId The ID of the deck this card belongs to
 * @returns A deterministic ID in format "card_HASH"
 */
export function generateFlashcardId(frontText: string, deckId: string): string {
  return `card_${simpleHash(deckId + "::" + frontText).toString(36)}`;
}

/**
 * Generate content hash for flashcard back content
 * @param backText The back text of the flashcard
 * @returns A hex string hash
 */
export function generateContentHash(backText: string): string {
  return simpleHash(backText).toString(16);
}

/**
 * Generate deck ID using hash of filepath
 * @param filepath The filepath of the deck
 * @returns A deterministic ID in format "deck_HASH"
 */
export function generateDeckId(filepath: string): string {
  return `deck_${simpleHash(filepath).toString(36)}`;
}

/**
 * Generate deck group ID using hash of tag
 * @param tag The tag of the deck group
 * @returns A deterministic ID in format "deckgroup_HASH"
 */
export function generateDeckGroupId(tag: string): string {
  return `deckgroup_${simpleHash(tag).toString(36)}`;
}

/**
 * Generate unique reverse flashcard ID using hash of deck ID and the original card's front text
 * The ID is based on the original front text (= reverse card's back) so it stays
 * stable when the original card's back content changes.
 * @param originalFrontText The front text of the original (non-reversed) flashcard
 * @param deckId The ID of the deck this card belongs to
 * @returns A deterministic ID in format "rcard_HASH"
 */
export function generateReverseFlashcardId(originalFrontText: string, deckId: string): string {
  return `rcard_${simpleHash("reverse:" + deckId + "::" + originalFrontText).toString(36)}`;
}

/**
 * Generate custom deck ID using hash of name
 * @param name The name of the custom deck
 * @returns A deterministic ID in format "cdeck_HASH"
 */
export function generateCustomDeckId(name: string): string {
  return `cdeck_${simpleHash(name).toString(36)}`;
}

/**
 * Generate custom deck card membership ID using hash of custom deck ID and flashcard ID
 * @param customDeckId The ID of the custom deck
 * @param flashcardId The ID of the flashcard
 * @returns A deterministic ID in format "cdc_HASH"
 */
export function generateCustomDeckCardId(customDeckId: string, flashcardId: string): string {
  return `cdc_${simpleHash(customDeckId + "::" + flashcardId).toString(36)}`;
}

/**
 * Generate unique cloze flashcard ID using hash of deck ID, front text, cloze order, and cloze text
 * @param frontText The front text of the flashcard (header or table Front column)
 * @param clozeText The specific cloze text (without == delimiters)
 * @param clozeOrder The ordinal position of this cloze within the back content
 * @param deckId The ID of the deck this card belongs to
 * @returns A deterministic ID in format "ccard_HASH"
 */
export function generateClozeFlashcardId(
  frontText: string,
  clozeText: string,
  clozeOrder: number,
  deckId: string
): string {
  return `ccard_${simpleHash("cloze:" + deckId + "::" + frontText + "::" + clozeOrder + "::" + clozeText).toString(36)}`;
}
