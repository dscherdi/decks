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

    // Include child tag decks in parent groups
    const allTags = Array.from(tagMap.keys());
    for (const parentTag of allTags) {
      for (const childTag of allTags) {
        if (childTag !== parentTag && childTag.startsWith(parentTag + '/')) {
          const childDecks = tagMap.get(childTag)!;
          tagMap.get(parentTag)!.push(...childDecks);
        }
      }
    }

    const deckGroups: DeckGroup[] = [];
    for (const [tag, groupDecks] of tagMap) {
      const uniqueDecks = this.deduplicateDecks(groupDecks);
      const profile = await this.resolveProfileForTag(tag, uniqueDecks);
      deckGroups.push({
        type: 'group',
        tag,
        name: this.getDisplayName(tag),
        deckIds: uniqueDecks.map(d => d.id),
        profile,
        lastReviewed: this.getMostRecentReview(uniqueDecks),
        created: this.getEarliestCreation(uniqueDecks),
        modified: this.getMostRecentModification(uniqueDecks),
      });
    }

    return deckGroups.sort((a, b) => a.tag.localeCompare(b.tag));
  }

  private deduplicateDecks(decks: DeckWithProfile[]): DeckWithProfile[] {
    const seen = new Set<string>();
    return decks.filter(d => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
  }

  private getDisplayName(tag: string): string {
    const parts = tag.replace(/^#/, '').split('/');
    const lastPart = parts[parts.length - 1];
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
  }

  private async resolveProfileForTag(tag: string, groupDecks: DeckWithProfile[]): Promise<DeckProfile> {
    const profileId = await this.db.getProfileIdForTag(tag);
    if (profileId) {
      const profile = await this.db.getProfileById(profileId);
      if (profile) return profile;
    }

    if (groupDecks.length > 0) {
      return groupDecks[0].profile;
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
