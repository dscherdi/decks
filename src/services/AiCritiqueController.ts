import type {
  AiCritiqueService,
  CritiqueCard,
  CritiqueResult,
  GeneratedCardType,
} from "@decks/core";
import { critiqueSentinelForTier } from "@decks/core";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";
import { buildAiConfig } from "./ai-config";

/** Plugin glue around the core critique service. Never throws: a verdict is an
 *  annotation, so a pass that cannot run leaves the cards unjudged. */
export class AiCritiqueController {
  constructor(
    private readonly service: AiCritiqueService,
    private readonly settings: DecksSettings,
    private readonly keyStore: AiKeyStore,
  ) {}

  isEnabled(): boolean {
    return this.settings.ai.enabled;
  }

  async critique(
    cards: CritiqueCard[],
    options?: { model?: string; cardType?: GeneratedCardType },
    signal?: AbortSignal,
  ): Promise<CritiqueResult | null> {
    if (cards.length === 0) return { verdicts: [] };
    try {
      const config = await buildAiConfig(this.settings, this.keyStore);
      // The tier the user picked for generation selects the critique slot; the
      // backend resolves the sentinel. Other providers judge on their own model.
      const model =
        config.provider === "decks-pro"
          ? critiqueSentinelForTier(options?.model ?? config.model)
          : config.model;
      return await this.service.critique(
        { ...config, model },
        { cards, cardType: options?.cardType, debug: this.settings.debug.enableLogging },
        signal,
      );
    } catch (e) {
      // Quiet by design: see the class comment.
      console.debug("Decks: card critique did not run", e);
      return null;
    }
  }
}
