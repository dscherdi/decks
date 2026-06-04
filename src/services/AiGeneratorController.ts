import type {
  AiGenerationService,
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
}

/**
 * Plugin-side glue around the core AiGenerationService: resolves the active
 * provider config (settings + non-synced key store) and streams generated cards.
 * The core service handles incremental parsing and the non-streaming fallback.
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
    const req: GenerateRequest = {
      prompt: options.prompt,
      sourceContext: options.sourceContext,
      images: options.images,
      debug: this.settings.debug.enableLogging,
    };
    return this.service.generateStream(config, req, handlers, signal);
  }
}
