import { isDirectoryDeckPath, resolveCardTemplate, type ResolvedRender } from "@decks/core";
import type { DeckTemplate, Flashcard } from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";

/**
 * Snapshot of the template cache + per-deck file tags, loaded once before a
 * review session so each card can resolve its tag-bound template at render time.
 * Shared by both the modal wrapper and the tab view so they behave identically.
 */
export interface TemplateCache {
  templates: DeckTemplate[];
  fileTagsByDeck: Map<string, string[]>;
  /** A directory deck's own templates; they bind only within that deck. */
  directoryTemplatesByDeck: Map<string, DeckTemplate[]>;
}

export async function loadTemplateCache(
  db: IDatabaseService
): Promise<TemplateCache> {
  try {
    const [templates, decks, directoryDecks] = await Promise.all([
      db.getAllDeckTemplates(),
      db.getAllDecks(),
      db.listDirectoryDecks(),
    ]);
    const directoryTemplatesByDeck = new Map<string, DeckTemplate[]>();
    for (const deck of directoryDecks) {
      directoryTemplatesByDeck.set(deck.id, await db.getDirectoryTemplates(deck.id));
    }
    return {
      templates,
      fileTagsByDeck: new Map(decks.map((d) => [d.id, d.fileTags ?? []])),
      directoryTemplatesByDeck,
    };
  } catch (error) {
    console.error("Failed to load template cache:", error);
    return { templates: [], fileTagsByDeck: new Map(), directoryTemplatesByDeck: new Map() };
  }
}

/** Build a per-card resolver bound to a loaded cache. */
export function makeTemplateResolver(
  cache: TemplateCache
): (card: Flashcard) => ResolvedRender | null {
  return (card: Flashcard) => {
    const templates = isDirectoryDeckPath(card.sourceFile)
      ? cache.directoryTemplatesByDeck.get(card.deckId) ?? []
      : cache.templates;
    if (templates.length === 0) return null;
    return resolveCardTemplate(
      card.tags,
      cache.fileTagsByDeck.get(card.deckId) ?? [],
      card.templateRow ?? null,
      templates
    );
  };
}
