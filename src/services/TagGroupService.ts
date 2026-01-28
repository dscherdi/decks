import type {
  DeckWithProfile,
  DeckGroup,
  DeckProfile,
} from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";

export class TagGroupService {
  constructor(private db: IDatabaseService) {}

  async aggregateByTag(decks: DeckWithProfile[]): Promise<DeckGroup[]> {
    const tagMap = new Map<string, DeckWithProfile[]>();

    for (const deck of decks) {
      if (!tagMap.has(deck.tag)) {
        tagMap.set(deck.tag, []);
      }
      tagMap.get(deck.tag)!.push(deck);
    }

    const deckGroups: DeckGroup[] = [];
    for (const [tag, groupDecks] of tagMap) {
      const profile = await this.resolveProfileForTag(tag);
      deckGroups.push({
        type: 'group',
        tag,
        name: this.getDisplayName(tag),
        deckIds: groupDecks.map(d => d.id),
        profile,
        lastReviewed: this.getMostRecentReview(groupDecks),
        created: this.getEarliestCreation(groupDecks),
        modified: this.getMostRecentModification(groupDecks),
      });
    }

    return deckGroups.sort((a, b) => a.tag.localeCompare(b.tag));
  }

  private getDisplayName(tag: string): string {
    const parts = tag.replace(/^#/, '').split('/');
    const lastPart = parts[parts.length - 1];
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
  }

  private async resolveProfileForTag(tag: string): Promise<DeckProfile> {
    const profileId = await this.db.getProfileIdForTag(tag);
    if (profileId) {
      const profile = await this.db.getProfileById(profileId);
      if (profile) return profile;
    }

    const defaultProfile = await this.db.getProfileById('profile_default');
    if (!defaultProfile) throw new Error('Default profile not found');
    return defaultProfile;
  }

  private getMostRecentReview(decks: DeckWithProfile[]): string | null {
    return decks.reduce((latest, deck) =>
      deck.lastReviewed && (!latest || deck.lastReviewed > latest)
        ? deck.lastReviewed
        : latest,
      null as string | null
    );
  }

  private getEarliestCreation(decks: DeckWithProfile[]): string {
    return decks.reduce((earliest, deck) =>
      deck.created < earliest ? deck.created : earliest,
      decks[0].created
    );
  }

  private getMostRecentModification(decks: DeckWithProfile[]): string {
    return decks.reduce((latest, deck) =>
      deck.modified > latest ? deck.modified : latest,
      decks[0].modified
    );
  }
}
