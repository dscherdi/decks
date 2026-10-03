import type {
  AiGenerationService,
  GeneratedCard,
  GeneratedCardType,
  GenerateHandlers,
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
  /** The round a refining instruction replaces; the reply rewrites it. */
  refining?: GeneratedCard[];
  /** Override the model for this run only (per-prompt picker); falls back to settings. */
  modelOverride?: string;
  /** Force attaching the request payload + raw response; falls back to the debug setting. */
  debug?: boolean;
  /** What to generate; the prompt differs for questions. */
  cardType?: GeneratedCardType;
}

/**
 * Plugin-side glue around the core AiGenerationService: resolves the active
 * provider config (settings + non-synced key store); core runs the rounds.
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
    if (options.modelOverride) config.model = options.modelOverride;
    return this.service.generateRounds(
      config,
      {
        prompt: options.prompt,
        sourceContext: options.sourceContext,
        images: options.images,
        existingCards: options.existingCards,
        refining: options.refining,
        cardType: options.cardType,
        maxBatches: options.maxBatches,
        debug: options.debug ?? this.settings.debug.enableLogging,
      },
      handlers,
      signal,
    );
  }
}
