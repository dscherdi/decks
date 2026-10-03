import type { AiConceptService, SourceConcept } from "@decks/core";
import { DECKS_CONCEPTS, cleanConcepts } from "@decks/core";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";
import { buildAiConfig } from "./ai-config";

/** Plugin glue around the core extraction pass. One call per source, so the
 *  result is cached by the caller rather than recomputed per round. */
export class AiConceptController {
  constructor(
    private readonly service: AiConceptService,
    private readonly settings: DecksSettings,
    private readonly keyStore: AiKeyStore,
  ) {}

  async extract(
    source: string,
    sourcedPages: Set<number>,
    signal?: AbortSignal,
  ): Promise<SourceConcept[]> {
    const config = await buildAiConfig(this.settings, this.keyStore);
    // The extraction runs on its own slot; other providers use the configured
    // model, as they do for every other pass.
    const model =
      config.provider === "decks-pro" ? DECKS_CONCEPTS : config.model;
    const result = await this.service.extract(
      { ...config, model },
      { source, debug: this.settings.debug.enableLogging },
      signal,
    );
    // A page the source never offered cannot carry a concept, whatever the
    // model claimed.
    return cleanConcepts(result.concepts, sourcedPages);
  }
}
