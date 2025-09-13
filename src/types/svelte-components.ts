// Simplified Svelte component types that work with TypeScript
import type { Deck, DeckConfig, DeckStats } from "../database/types";
import type { Flashcard } from "../database/types";
import type { RatingLabel } from "../algorithm/fsrs";

// Base Svelte component interface
export interface SvelteComponentInstance {
  $set(props: Record<string, any>): void;
  $on(event: string, callback: (event: CustomEvent<any>) => void): () => void;
  $destroy(): void;
}

// Event detail types
export interface ExportEventDetail {
  noteType: string;
  tags: string[];
  deckName: string;
  separator: string;
}

export interface CompleteEventDetail {
  reason: string;
  reviewed: number;
}

// Component-specific interfaces extending base
export interface AnkiExportComponent extends SvelteComponentInstance {
  // Typed event handlers
}

export interface DeckConfigComponent extends SvelteComponentInstance {
  // Typed event handlers
}

export interface DeckListPanelComponent extends SvelteComponentInstance {
  updateAll(
    updatedDecks?: Deck[],
    deckStats?: DeckStats[],
    singleDeckId?: string,
    singleDeckStats?: DeckStats,
  ): Promise<void>;
}

export interface FlashcardReviewComponent extends SvelteComponentInstance {
  // Typed event handlers
}

export interface StatisticsComponent extends SvelteComponentInstance {
  // Typed event handlers
}

// Component interfaces provide type safety without needing helper functions
// Direct casting with 'as ComponentType' is simpler and more transparent
