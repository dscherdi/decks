import type { TFile } from "obsidian";
import type { DecksSettings } from "../settings";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { DeckSynchronizer } from "./DeckSynchronizer";
import { generateDeckId } from "@decks/core";
import type { Logger } from "../utils/logging";

export interface CanvasFileEventDeps {
  settings: DecksSettings;
  db: IDatabaseService;
  deckSynchronizer: DeckSynchronizer;
  logger: Logger;
  // Hook the plugin's per-deck debounce. Mirrors how markdown change events
  // coalesce repeated autosaves into a single trailing-edge sync.
  scheduleDeckSync: (deckId: string) => void;
  refreshStats: () => Promise<void>;
}

/**
 * Helpers for routing Obsidian vault file events on `.canvas` files.
 *
 * The four entry points mirror the markdown-side `handleFile*` methods on
 * `DecksPlugin`, but specialize the logic for canvas's two important
 * differences:
 *
 *   1. Canvas files have no Obsidian markdown metadata (no frontmatter, no
 *      inline tags). The "is this a deck?" signal is purely **folder scope**:
 *      a canvas file is a deck iff it lives inside
 *      `settings.canvasDecks.folderPath`.
 *
 *   2. Empty `folderPath` disables canvas scanning entirely — events become
 *      no-ops in that case.
 *
 * `DecksPlugin` keeps owning the dispatch (extension branch on each vault
 * event) and forwards canvas events here.
 */

function trimTrailingSlash(p: string): string {
  return p.replace(/\/$/, "");
}

/**
 * Is `path` inside the configured canvas folder?
 *
 * Returns false when canvas scanning is disabled (empty folderPath) — the
 * caller treats that as "ignore the event entirely". Same string-prefix
 * semantics as `src/utils/fileFilter.ts` so canvas scope matches what the
 * vault scan considers in-scope.
 */
export function isInCanvasFolder(
  path: string,
  settings: DecksSettings,
): boolean {
  const folder = trimTrailingSlash(
    settings.canvasDecks?.folderPath?.trim() ?? "",
  );
  if (folder === "") return false;
  return path === folder || path.startsWith(folder + "/");
}

export class CanvasFileEventHandlers {
  constructor(private deps: CanvasFileEventDeps) {}

  /**
   * Obsidian "modify" fires when the .canvas file content changes — typically
   * the user editing nodes in canvas view, or vault sync delivering a remote
   * change. Schedule a debounced sync if a deck row already exists; otherwise
   * (first-time observation) create + sync inline so the deck appears now.
   */
  async onModified(file: TFile): Promise<void> {
    if (!isInCanvasFolder(file.path, this.deps.settings)) return;

    const existingDeck = await this.deps.db.getDeckByFilepath(file.path);
    if (existingDeck) {
      this.deps.scheduleDeckSync(existingDeck.id);
      return;
    }

    // No deck yet — happens when the user dropped a canvas into the folder
    // and the create event got missed (rare, but possible on plugin reload).
    // Mirror the markdown new-file path.
    const tag = this.canvasTag();
    await this.deps.deckSynchronizer.createDeckForFile(file.path, tag);
    const created = await this.deps.db.getDeckByFilepath(file.path);
    if (created) {
      await this.deps.deckSynchronizer.syncDeck(created.id);
    }
    await this.deps.refreshStats();
  }

  /**
   * Obsidian "create" fires when a brand-new .canvas file lands in the vault.
   * If it's inside the configured folder, run a full discovery sync — that
   * creates the deck row, parses cards, and refreshes the UI.
   */
  async onCreated(file: TFile): Promise<void> {
    if (!isInCanvasFolder(file.path, this.deps.settings)) return;
    this.deps.logger.debug(`New canvas file detected: ${file.path}`);
    try {
      await this.deps.deckSynchronizer.sync();
      await this.deps.refreshStats();
    } catch (error) {
      this.deps.logger.error(
        `Failed to sync newly-created canvas ${file.path}`,
        error as object,
      );
    }
  }

  /**
   * Obsidian "delete" fires when a .canvas file is removed. Always drop the
   * corresponding deck row by filepath — folder scope doesn't matter here
   * because the deck row only exists if the file was in scope when scanned.
   * `db.deleteDeckByFilepath` is a no-op if no row matches.
   */
  async onDeleted(filepath: string): Promise<void> {
    await this.deps.db.deleteDeckByFilepath(filepath);
    await this.deps.refreshStats();
  }

  /**
   * Obsidian "rename" fires for path changes (rename in place OR move across
   * folders). Four transitions matter:
   *
   *   - in-scope → in-scope:    rename the deck row, keep flashcards/history.
   *   - in-scope → out-of-scope: drop the deck row at oldPath.
   *   - out-of-scope → in-scope: create + sync a new deck for the new path.
   *   - out-of-scope → out-of-scope: nothing to do.
   */
  async onRenamed(file: TFile, oldPath: string): Promise<void> {
    const wasInScope = isInCanvasFolder(oldPath, this.deps.settings);
    const isInScope = isInCanvasFolder(file.path, this.deps.settings);

    if (!wasInScope && !isInScope) return;

    if (wasInScope && isInScope) {
      const oldDeck = await this.deps.db.getDeckByFilepath(oldPath);
      if (!oldDeck) {
        // Defensive: deck row missing, treat as a fresh create at the new path.
        const tag = this.canvasTag();
        await this.deps.deckSynchronizer.createDeckForFile(file.path, tag);
        const created = await this.deps.db.getDeckByFilepath(file.path);
        if (created) await this.deps.deckSynchronizer.syncDeck(created.id);
        await this.deps.refreshStats();
        return;
      }
      const oldDeckId = oldDeck.id;
      const newDeckId = generateDeckId(file.path);
      this.deps.logger.debug(
        `Canvas renamed from ${oldPath} to ${file.path} (${oldDeckId} → ${newDeckId})`,
      );
      await this.deps.db.renameDeck(
        oldDeckId,
        newDeckId,
        file.basename,
        file.path,
      );
      await this.deps.db.updateFlashcardDeckIds(oldDeckId, newDeckId);
      // Clear the mtime gate so the next sync re-parses the renamed file —
      // some filesystems preserve mtime across pure renames.
      await this.deps.db.setDeckLastSyncedMtime(newDeckId, 0);
      await this.deps.db.save();
      await this.deps.refreshStats();
      return;
    }

    if (wasInScope && !isInScope) {
      // Moved out of canvas scope — drop the deck row.
      await this.deps.db.deleteDeckByFilepath(oldPath);
      await this.deps.refreshStats();
      return;
    }

    // !wasInScope && isInScope — moved into scope, treat as a create.
    const tag = this.canvasTag();
    await this.deps.deckSynchronizer.createDeckForFile(file.path, tag);
    const created = await this.deps.db.getDeckByFilepath(file.path);
    if (created) await this.deps.deckSynchronizer.syncDeck(created.id);
    await this.deps.refreshStats();
  }

  private canvasTag(): string {
    const t = this.deps.settings.canvasDecks?.tagName?.trim();
    return t && t.length > 0 ? t : "#decks/canvas";
  }
}
