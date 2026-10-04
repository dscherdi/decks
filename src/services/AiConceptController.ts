import type { AiConceptService, ConceptChunkHandlers, SourceConcept, SourceUnit } from "@decks/core";
import { DECKS_CONCEPTS } from "@decks/core";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";
import { buildAiConfig } from "./ai-config";

/** Plugin glue around the core extraction pass. Each chunk is stored by the
 *  caller as it lands, so the pass runs once per source rather than per round. */
export class AiConceptController {
  constructor(
    private readonly service: AiConceptService,
    private readonly settings: DecksSettings,
    private readonly keyStore: AiKeyStore,
  ) {}

  async extract(
    units: SourceUnit[],
    handlers: ConceptChunkHandlers,
    signal?: AbortSignal,
  ): Promise<{ concepts: SourceConcept[]; read: number[] }> {
    const config = await buildAiConfig(this.settings, this.keyStore);
    // The extraction runs on its own slot; other providers use the configured
    // model, as they do for every other pass.
    const model =
      config.provider === "decks-pro" ? DECKS_CONCEPTS : config.model;
    return this.service.extractChunked({ ...config, model }, units, handlers, signal);
  }
}
