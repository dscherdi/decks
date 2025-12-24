// Simplified Svelte component types that work with TypeScript
import type { Deck, DeckStats } from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { StatisticsService } from "../services/StatisticsService";
import type { DeckSynchronizer } from "../services/DeckSynchronizer";
import type { App } from "obsidian";

// Base Svelte component interface
export interface SvelteComponentInstance {
  $set(props: Record<string, string | number | boolean | null>): void;
  $on(
    event: string,
    callback: (event: CustomEvent<string | number | boolean | object>) => void,
  ): () => void;
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

export interface AnkiExportComponent extends SvelteComponentInstance {
  exportData(): void;
}

export interface DeckConfigComponent extends SvelteComponentInstance {
  saveConfig(): void;
}

export interface DeckListPanelComponent extends SvelteComponentInstance {
  updateAll(
    updatedDecks?: Deck[],
    deckStats?: Map<string, DeckStats>,
    singleDeckId?: string,
    singleDeckStats?: DeckStats,
  ): Promise<void>;
}

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
