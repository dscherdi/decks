import { resolveCardTemplate, type ResolvedRender } from "@decks/core";
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
}

export async function loadTemplateCache(
  db: IDatabaseService
): Promise<TemplateCache> {
  try {
    const [templates, decks] = await Promise.all([
      db.getAllDeckTemplates(),
      db.getAllDecks(),
    ]);
    console.debug(
      `[decks-templates] cache loaded: ${templates.length} template(s)`,
      templates.map((t) => ({ src: t.sourceFile, tags: t.tags }))
    );
    return {
      templates,
      fileTagsByDeck: new Map(decks.map((d) => [d.id, d.fileTags ?? []])),
    };
  } catch (error) {
    console.error("Failed to load template cache:", error);
    return { templates: [], fileTagsByDeck: new Map() };
  }
}

/** Build a per-card resolver bound to a loaded cache. */
export function makeTemplateResolver(
  cache: TemplateCache
): (card: Flashcard) => ResolvedRender | null {
  return (card: Flashcard) => {
    if (cache.templates.length === 0) return null;
    const fileTags = cache.fileTagsByDeck.get(card.deckId) ?? [];
    const result = resolveCardTemplate(
      card.tags,
      fileTags,
      card.templateRow ?? null,
      cache.templates
    );
    if (!result) {
      console.debug(
        `[decks-templates] no match for "${card.front}": cardTags=${JSON.stringify(card.tags)} fileTags=${JSON.stringify(fileTags)} hasRow=${!!card.templateRow} templateTags=${JSON.stringify(cache.templates.map((t) => t.tags))}`
      );
    }
    return result;
  };
}
