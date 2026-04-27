import type {
  CustomDeck,
  CustomDeckGroup,
  DeckStats,
  FilterDefinition,
} from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { compileFilter } from "./FilterEngine";

export class CustomDeckService {
  constructor(private db: IDatabaseService) {}

  async createCustomDeck(name: string): Promise<CustomDeck> {
    const existing = await this.db.getCustomDeckByName(name);
    if (existing) {
      throw new Error(`A custom deck named "${name}" already exists`);
    }
    const id = await this.db.createCustomDeck(name);
    const deck = await this.db.getCustomDeckById(id);
    if (!deck) {
      throw new Error("Failed to create custom deck");
    }
    return deck;
  }

  async createFilterDeck(name: string, filterDefinition: FilterDefinition): Promise<CustomDeck> {
    const existing = await this.db.getCustomDeckByName(name);
    if (existing) {
      throw new Error(`A custom deck named "${name}" already exists`);
    }
    const filterJson = JSON.stringify(filterDefinition);
    const id = await this.db.createCustomDeck(name, 'filter', filterJson);
    const deck = await this.db.getCustomDeckById(id);
    if (!deck) {
      throw new Error("Failed to create filter deck");
    }
    return deck;
  }

  async updateFilter(id: string, filterDefinition: FilterDefinition): Promise<void> {
    const deck = await this.db.getCustomDeckById(id);
    if (!deck) {
      throw new Error("Custom deck not found");
    }
    if (deck.deckType !== 'filter') {
      throw new Error("Cannot set filter on a manual deck");
    }
    await this.db.updateCustomDeck(id, { filterDefinition: JSON.stringify(filterDefinition) });
  }

  async previewFilter(filterDefinition: FilterDefinition): Promise<number> {
    const compiled = compileFilter(filterDefinition);
    const from = compiled.requiresDeckJoin
      ? "flashcards f JOIN decks d ON f.deck_id = d.id"
      : "flashcards f";
    const sql = `SELECT COUNT(*) FROM ${from} WHERE ${compiled.whereClause}`;
    const results = await this.db.querySql(sql, compiled.params);
    const row = results[0] as (string | number | null)[];
    return (row?.[0] as number) ?? 0;
  }

  async deleteCustomDeck(id: string): Promise<void> {
    await this.db.deleteCustomDeck(id);
  }

  async renameCustomDeck(id: string, newName: string): Promise<void> {
    const existing = await this.db.getCustomDeckByName(newName);
    if (existing && existing.id !== id) {
      throw new Error(`A custom deck named "${newName}" already exists`);
    }
    await this.db.updateCustomDeck(id, { name: newName });
  }

  async addFlashcards(customDeckId: string, flashcardIds: string[]): Promise<void> {
    const deck = await this.db.getCustomDeckById(customDeckId);
    if (deck?.deckType === 'filter') {
      throw new Error("Cannot manually add cards to a filter deck");
    }
    await this.db.addCardsToCustomDeck(customDeckId, flashcardIds);
  }

  async removeFlashcards(customDeckId: string, flashcardIds: string[]): Promise<void> {
    const deck = await this.db.getCustomDeckById(customDeckId);
    if (deck?.deckType === 'filter') {
      throw new Error("Cannot manually remove cards from a filter deck");
    }
    await this.db.removeCardsFromCustomDeck(customDeckId, flashcardIds);
  }

  async getAllCustomDecks(): Promise<CustomDeck[]> {
    return this.db.getAllCustomDecks();
  }

  async getAllCustomDeckGroups(): Promise<CustomDeckGroup[]> {
    const customDecks = await this.db.getAllCustomDecks();
    const groups: CustomDeckGroup[] = [];

    for (const deck of customDecks) {
      const flashcardIds = await this.db.getFlashcardIdsForCustomDeck(deck.id);
      groups.push({
        type: 'custom',
        id: deck.id,
        name: deck.name,
        deckType: deck.deckType,
        filterDefinition: deck.filterDefinition,
        flashcardIds,
        lastReviewed: deck.lastReviewed,
        created: deck.created,
        modified: deck.modified,
      });
    }

    return groups;
  }

  async getCustomDeckStats(customDeckId: string): Promise<DeckStats> {
    const [newCount, dueCount, totalCount] = await Promise.all([
      this.db.countNewCardsCustomDeck(customDeckId),
      this.db.countDueCardsCustomDeck(customDeckId),
      this.db.countTotalCardsCustomDeck(customDeckId),
    ]);

    return {
      deckId: customDeckId,
      newCount,
      dueCount,
      totalCount,
      matureCount: 0,
    };
  }

  async getAllCustomDeckStats(): Promise<Map<string, DeckStats>> {
    const customDecks = await this.db.getAllCustomDecks();
    const statsMap = new Map<string, DeckStats>();

    for (const deck of customDecks) {
      const stats = await this.getCustomDeckStats(deck.id);
      statsMap.set(deck.id, stats);
    }

    return statsMap;
  }
}
