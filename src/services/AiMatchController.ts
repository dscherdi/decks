import {
  lexicalCandidates,
  type AiMatchService,
  type ConceptMapCard,
  type OverlapCard,
  type SourceConcept,
} from "@decks/core";
import type { DecksSettings } from "../settings";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { AiKeyStore } from "./AiKeyStore";
import { buildAiConfig } from "./ai-config";
import { isReverseCard } from "../utils/reverse-card";

/** Plugin glue for concept mapping and near-duplicate hints. Never throws: both
 *  are advisory, so a check that cannot run leaves the pile as it was. */
export class AiMatchController {
  constructor(
    private readonly service: Pick<AiMatchService, "mapConcepts" | "findDuplicates">,
    private readonly settings: DecksSettings,
    private readonly keyStore: AiKeyStore,
    private readonly db: Pick<IDatabaseService, "getDeckByFilepath" | "getFlashcardsByDeck">,
  ) {}

  /** Both checks run on the hosted provider only. */
  isAvailable(): boolean {
    return this.settings.ai.enabled && this.settings.ai.provider === "decks-pro";
  }

  async mapConcepts(
    concepts: ReadonlyArray<SourceConcept & { id: string }>,
    cards: readonly ConceptMapCard[],
    signal?: AbortSignal,
  ): Promise<Map<string, string | null>> {
    try {
      const config = await buildAiConfig(this.settings, this.keyStore);
      return await this.service.mapConcepts(config, concepts, cards, signal);
    } catch (e) {
      console.debug("Decks: concept mapping did not run", e);
      return new Map();
    }
  }

  /** For each staged card, the fronts of cards in the file's deck that test the same fact. */
  async similar(
    filePath: string,
    staged: readonly OverlapCard[],
    signal?: AbortSignal,
  ): Promise<Map<string, string[]>> {
    try {
      const deck = await this.db.getDeckByFilepath(filePath);
      if (!deck || staged.length === 0) return new Map();
      // A reverse card is its note's card read backwards: it would take a second
      // candidate slot for the same fact and show the note's answer as a match.
      const existing = (await this.db.getFlashcardsByDeck(deck.id))
        .filter((c) => !isReverseCard(c))
        .map((c) => ({ id: c.id, front: c.front, back: c.back }));
      const candidates = lexicalCandidates(staged, existing);
      if (candidates.length === 0) return new Map();
      const cards = new Map([...staged, ...existing].map((c) => [c.id, c]));
      const config = await buildAiConfig(this.settings, this.keyStore);
      const found = await this.service.findDuplicates(config, candidates, cards, signal);
      return new Map(
        [...found].map(([id, matches]) => [id, matches.map((m) => cards.get(m)?.front ?? "").filter(Boolean)]),
      );
    } catch (e) {
      console.debug("Decks: near-duplicate check did not run", e);
      return new Map();
    }
  }
}
