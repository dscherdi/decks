// Simplified Svelte component types that work with TypeScript
import type { Deck, DeckStats } from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { StatisticsService } from "../services/StatisticsService";
import type { DeckSynchronizer } from "../services/DeckSynchronizer";
import type { App } from "obsidian";

// Base Svelte component interface (Svelte 4 style)
export interface SvelteComponentInstance {
  $set(props: Record<string, string | number | boolean | null>): void;
  $on(
    event: string,
    callback: (event: CustomEvent<string | number | boolean | object>) => void
  ): () => void;
  $destroy(): void;
}

// Svelte 5 mount() returns a Record with exported functions as properties
// Properties are accessed directly, no $destroy needed (automatic cleanup)
export type Svelte5MountedComponent = Record<string, unknown>;

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

// Svelte 5 compatible types
export type AnkiExportComponent = Svelte5MountedComponent & {
  exportData?(): void;
};

export type DeckConfigComponent = Svelte5MountedComponent & {
  saveConfig?(): void;
};

// DeckListPanel component - supports both Svelte 4 and Svelte 5 APIs
export type DeckListPanelComponent = (
  | SvelteComponentInstance
  | Svelte5MountedComponent
) & {
  updateAll?(
    updatedDecks?: Deck[],
    deckStats?: Map<string, DeckStats>,
    singleDeckId?: string,
    singleDeckStats?: DeckStats
  ): Promise<void>;
};

// Constructor interface for DeckListPanel
export interface DeckListPanelConstructor {
  new (options: {
    target: Element;
    props?: {
      statisticsService: StatisticsService;
      deckSynchronizer: DeckSynchronizer;
      db: IDatabaseService;
      app: App;
      onDeckClick: (deck: Deck) => void;
      onRefresh: () => Promise<void>;
      onForceRefreshDeck: (deckId: string) => Promise<void>;
      openStatisticsModal: () => void;
    };
  }): DeckListPanelComponent;
}

export interface FlashcardReviewComponent extends SvelteComponentInstance {
  completeReview(): void;
}

export interface StatisticsComponent extends SvelteComponentInstance {
  refreshData(): void;
}
