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
 * Generate unique flashcard ID using hash of front text
 * @param frontText The front text of the flashcard
 * @returns A deterministic ID in format "card_HASH"
 */
export function generateFlashcardId(frontText: string): string {
    return `card_${simpleHash(frontText).toString(36)}`;
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
