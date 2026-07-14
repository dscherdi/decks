import { App, Notice, TFile } from "obsidian";
import type { Flashcard, IDatabaseService } from "@decks/core";
import { parseHeaderLevels, yieldToUI } from "@decks/core";
import type { AnchorStamper } from "./AnchorStamper";
import type { Logger } from "../utils/logging";

export interface MigrationResult {
  stamped: number;
  skipped: number;
}

/**
 * One-time pass anchoring every reviewed, unanchored card. Idempotent — cards
 * it cannot stamp (missing files, ambiguous fronts, unsupported formats) fall
 * through to lazy stamping at their next review.
 */
export class AnchorMigrator {
  constructor(
    private app: App,
    private db: IDatabaseService,
    private stamper: AnchorStamper,
    private logger?: Logger
  ) {}

  async run(showNotice: boolean): Promise<MigrationResult> {
    const candidates = await this.db.getReviewedUnanchoredCards();
    let stamped = 0;
    let skipped = 0;
    if (candidates.length === 0) return { stamped, skipped };

    const titleModeByDeck = new Map<string, boolean>();
    const markdownByFile = new Map<string, Flashcard[]>();

    for (const card of candidates) {
      if (card.type === "image-occlusion-v2") {
        // Occlusion v2 identity is already stable via its mask ids.
        skipped++;
        continue;
      }
      if (card.edgeId || card.sourceNodeId) {
        const outcome = await this.stamper.ensureAnchored(card);
        if (outcome.ok) stamped++;
        else skipped++;
        continue;
      }
      let isTitleMode = titleModeByDeck.get(card.deckId);
      if (isTitleMode === undefined) {
        const deck = await this.db.getDeckWithProfile(card.deckId);
        isTitleMode = deck
          ? parseHeaderLevels(deck.profile).includes(0)
          : false;
        titleModeByDeck.set(card.deckId, isTitleMode);
      }
      if (isTitleMode) {
        const outcome = await this.stamper.ensureAnchored(card);
        if (outcome.ok) stamped++;
        else skipped++;
        continue;
      }
      const list = markdownByFile.get(card.sourceFile);
      if (list) list.push(card);
      else markdownByFile.set(card.sourceFile, [card]);
    }

    for (const [path, cards] of markdownByFile) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        skipped += cards.length;
        continue;
      }
      const result = await this.stamper.stampFileBatch(file, cards);
      stamped += result.stamped;
      skipped += result.skipped;
      await yieldToUI();
    }

    this.logger?.debug(
      `Anchor migration: ${stamped} cards anchored, ${skipped} left to lazy stamping`
    );
    if (showNotice && stamped > 0) {
      new Notice(`Decks: anchored ${stamped} reviewed cards`);
    }
    return { stamped, skipped };
  }
}
