import type {
  AiGenerationService,
  GeneratedCard,
  GenerateHandlers,
  GenerateRequest,
  GenerateResult,
  RefactorImage,
} from "@decks/core";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";
import { buildAiConfig } from "./ai-config";

/** Inputs the generator modal supplies for a generation run. */
export interface GenerateOptions {
  prompt: string;
  sourceContext?: string;
  images?: RefactorImage[];
  /**
   * Upper bound on generation rounds. Each round feeds the cards produced so far
   * back as an assistant turn (so the model continues without repeating) until
   * a round adds nothing new, the cap is reached, or the run is aborted.
   * Defaults to 1 (single-shot, the original behaviour).
   */
  maxBatches?: number;
  /**
   * Cards already shown to the user (e.g. from a previous run) used to seed
   * deduplication and the model's context, without re-emitting them via onCard.
   */
  existingCards?: GeneratedCard[];
}

/** Normalized key for in-session dedup (no deck exists yet to hash against). */
function cardKey(card: GeneratedCard): string {
  return card.front.trim().toLowerCase();
}

/**
 * Plugin-side glue around the core AiGenerationService: resolves the active
 * provider config (settings + non-synced key store) and streams generated cards.
 * Drives the iterative batch loop — the core service handles incremental parsing
 * and the non-streaming fallback for a single round.
 */
export class AiGeneratorController {
  constructor(
    private readonly service: AiGenerationService,
    private readonly settings: DecksSettings,
    private readonly keyStore: AiKeyStore,
  ) {}

  isEnabled(): boolean {
    return this.settings.ai.enabled;
  }

  async generateStream(
    options: GenerateOptions,
    handlers: GenerateHandlers,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    const config = await buildAiConfig(this.settings, this.keyStore);
    const maxBatches = Math.max(1, options.maxBatches ?? 1);

    // Cards we feed back to the model each round (prior run + this run's output).
    const priorContext: GeneratedCard[] = [...(options.existingCards ?? [])];
    // Cards newly produced in this run — what we return and surface via onCard.
    const newCards: GeneratedCard[] = [];
    const seen = new Set<string>(priorContext.map(cardKey).filter(Boolean));

    // Dedup wrapper: only surface genuinely new cards; accumulate the rest.
    const dedupHandlers: GenerateHandlers = {
      onCard: (card) => {
        const key = cardKey(card);
        if (!key || seen.has(key)) return;
        seen.add(key);
        newCards.push(card);
        priorContext.push(card);
        handlers.onCard(card);
      },
      onPartial: handlers.onPartial,
    };

    let debug: GenerateResult["debug"];

    for (let batch = 0; batch < maxBatches; batch++) {
      if (signal?.aborted) break;
      const countBefore = newCards.length;
      const req: GenerateRequest = {
        prompt: options.prompt,
        sourceContext: options.sourceContext,
        images: options.images,
        generatedSoFar: priorContext.length ? [...priorContext] : undefined,
        debug: this.settings.debug.enableLogging,
      };

      try {
        const result = await this.service.generateStream(
          config,
          req,
          dedupHandlers,
          signal,
        );
        debug = result.debug ?? debug;
      } catch (e) {
        // User cancelled: stop quietly and keep whatever we have.
        if (signal?.aborted) break;
        // First round failed (e.g. missing key): surface the real error.
        if (batch === 0) throw e;
        // A later round failed transiently: keep the cards already produced.
        break;
      }

      // The model stopped producing anything new — further rounds won't help.
      if (newCards.length === countBefore) break;
    }

    return { cards: newCards, debug };
  }
}
