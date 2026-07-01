// Simplified Svelte component types that work with TypeScript
import type { Deck, DeckStats } from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { StatisticsService } from "../services/StatisticsService";
import type { DeckSynchronizer } from "../services/DeckSynchronizer";
import type { DeckListSortMode } from "../settings";
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
  ankiDeckName: string;
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

export type ProfilesManagerComponent = Svelte5MountedComponent & {
  loadProfiles?(): Promise<void>;
};

export type SrMigrationComponent = Svelte5MountedComponent;

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
  // Patch a single custom deck's stats. Required because custom decks reference
  // cards in file decks — file-deck stat queries (countTotalCards etc.) always
  // return zero for a custom deck id and would otherwise shadow the real
  // counts.
  updateCustomDeckStatsById?(deckId: string, newStats: DeckStats): void;
  // Flips a non-blocking "background sync in flight" indicator in the
  // panel header (animates the existing refresh button). The deck list
  // stays populated throughout — only the icon reflects the state.
  setSyncing?(isSyncing: boolean): void;
  // Push fresh pinned ids in after a settings save / cross-device reload
  // so the panel resorts without remounting.
  updatePinnedIds?(ids: string[]): void;
  // Push a new sort mode in after a settings save / cross-device reload.
  updateSortMode?(mode: DeckListSortMode): void;
  // Push a new min-card-count threshold in after settings change.
  updateMinDeckCardCount?(value: number): void;
  // Push the AI-enabled toggle in after a settings change so the generate
  // button enables/disables without remounting.
  updateAiEnabled?(enabled: boolean): void;
  // Push the global daily review-cap status ({done, cap}) or null when disabled.
  updateGlobalReviewToday?(v: { done: number; cap: number } | null): void;
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
