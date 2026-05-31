import type {
  AiProviderConfig,
  AiRefactoringService,
  RefactorFieldSet,
  RefactorResult,
} from "@decks/core";
import type { Flashcard } from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";
import type { FlashcardEdits } from "./FlashcardWriter";

/** Fallback used when a DeckProfile has no custom refactor prompt. */
export const DEFAULT_REFACTOR_PROMPT =
  "Improve the clarity, correctness, and concision of this flashcard. " +
  "Fix grammar and spelling. Keep the same meaning and the same language. " +
  "Do not add new facts. Preserve any ==cloze== markup and markdown formatting.";

/** Map a stored Flashcard to the editable field set for its type. */
export function cardToRefactorFieldSet(card: Flashcard): RefactorFieldSet {
  switch (card.type) {
    case "header-paragraph":
      return { type: "header-paragraph", front: card.front, back: card.back };
    case "table":
      return {
        type: "table",
        front: card.front,
        back: card.back,
        notes: card.notes ?? "",
      };
    case "cloze":
      return { type: "cloze", front: card.front, sentence: card.back };
    case "spatial":
      return {
        type: "spatial",
        front: card.front,
        back: card.back,
        hint: card.hint ?? "",
      };
    case "image-occlusion":
      return {
        type: "image-occlusion",
        listItem: extractImageOcclusionItem(card),
      };
  }
}

/** Convert a (proposed) field set into a FlashcardWriter edit. Shapes match 1:1. */
export function fieldSetToEdits(fields: RefactorFieldSet): FlashcardEdits {
  switch (fields.type) {
    case "header-paragraph":
      return { type: "header-paragraph", front: fields.front, back: fields.back };
    case "table":
      return {
        type: "table",
        front: fields.front,
        back: fields.back,
        notes: fields.notes,
      };
    case "cloze":
      return { type: "cloze", front: fields.front, sentence: fields.sentence };
    case "spatial":
      return {
        type: "spatial",
        front: fields.front,
        back: fields.back,
        hint: fields.hint,
      };
    case "image-occlusion":
      return { type: "image-occlusion", listItem: fields.listItem };
  }
}

function extractImageOcclusionItem(card: Flashcard): string {
  if (card.type !== "image-occlusion" || card.clozeOrder === null) {
    return card.clozeText ?? "";
  }
  const items: string[] = [];
  for (const line of card.back.split("\n")) {
    const m = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (m) items.push(m[1]);
  }
  return items[card.clozeOrder] ?? card.clozeText ?? "";
}

/**
 * Plugin-side glue around the core AiRefactoringService: resolves the active
 * provider config (settings + non-synced key store) and the per-DeckProfile
 * prompt for a card, then delegates the actual refactor to core.
 */
export class AiRefactorController {
  private promptCache = new Map<string, string>();

  constructor(
    private readonly service: AiRefactoringService,
    private readonly db: IDatabaseService,
    private readonly settings: DecksSettings,
    private readonly keyStore: AiKeyStore,
  ) {}

  isEnabled(): boolean {
    return this.settings.ai.enabled;
  }

  /** Clear the deck→prompt cache (call when profiles/settings change). */
  resetCache(): void {
    this.promptCache.clear();
  }

  async buildConfig(): Promise<AiProviderConfig> {
    const provider = this.settings.ai.provider;
    return {
      provider,
      model: this.settings.ai.models[provider],
      apiKey: await this.keyStore.get(provider),
      baseUrl: this.settings.ai.localBaseUrl,
    };
  }

  async resolvePrompt(card: Flashcard): Promise<string> {
    const cached = this.promptCache.get(card.deckId);
    if (cached !== undefined) return cached;

    const deck = await this.db.getDeckById(card.deckId);
    const profile = deck
      ? await this.db.getProfileById(deck.profileId)
      : await this.db.getDefaultProfile();
    const prompt = profile?.refactorPrompt?.trim();
    const resolved =
      prompt && prompt.length > 0 ? prompt : DEFAULT_REFACTOR_PROMPT;
    this.promptCache.set(card.deckId, resolved);
    return resolved;
  }

  async refactorCard(
    card: Flashcard,
    current: RefactorFieldSet,
    signal?: AbortSignal,
  ): Promise<RefactorResult> {
    const config = await this.buildConfig();
    const prompt = await this.resolvePrompt(card);
    return this.service.refactorCard(config, { prompt, current }, signal);
  }
}
