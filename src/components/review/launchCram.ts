import { App, Notice } from "obsidian";
import { I18n, type Scheduler } from "@decks/core";
import type { DeckOrGroup, Flashcard } from "@/database/types";
import type { DecksSettings } from "@/settings";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import type { DeckSynchronizer } from "@/services/DeckSynchronizer";
import { FlashcardReviewModalWrapper } from "./FlashcardReviewModalWrapper";

export interface CramLaunchContext {
  app: App;
  scheduler: Scheduler;
  settings: DecksSettings;
  db: IDatabaseService;
  deckSynchronizer: DeckSynchronizer;
  refreshStats: () => Promise<void>;
  refreshStatsById: (deckId: string) => Promise<void>;
}

/**
 * Shared cram-launch flow used by both deck-list hosts (the leaf view and the
 * modal). The host supplies how cards are gathered for the selection. Cram
 * always opens the focused review modal (no tab-mode variant) — it's a short
 * drill isolated from real scheduling.
 */
export async function launchCramForSelection(
  ctx: CramLaunchContext,
  selection: DeckOrGroup,
  gatherCards: (selection: DeckOrGroup) => Promise<Flashcard[]>,
): Promise<void> {
  const notify = (message: string) => {
    if (ctx.settings?.ui?.enableNotices !== false) new Notice(message);
  };
  try {
    const cards = await gatherCards(selection);
    if (cards.length === 0) {
      notify(
        selection.type === "file"
          ? I18n.format(I18n.t.notices.noCardsFoundInDeck, {
              deckName: selection.name,
            })
          : I18n.format(I18n.t.notices.noCardsFoundInGroup, {
              name: selection.name,
            }),
      );
      return;
    }
    new FlashcardReviewModalWrapper(
      ctx.app,
      selection,
      cards,
      ctx.scheduler,
      ctx.settings,
      ctx.db,
      ctx.deckSynchronizer,
      ctx.refreshStats,
      ctx.refreshStatsById,
      false, // browseMode
      true, // cramMode
    ).open();
  } catch (error) {
    console.error("Error starting cram:", error);
    notify(I18n.t.notices.errorStartingCram);
  }
}
