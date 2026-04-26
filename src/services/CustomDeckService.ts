import type {
  CustomDeck,
  CustomDeckGroup,
  DeckStats,
} from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";

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
    await this.db.addCardsToCustomDeck(customDeckId, flashcardIds);
  }

  async removeFlashcards(customDeckId: string, flashcardIds: string[]): Promise<void> {
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
