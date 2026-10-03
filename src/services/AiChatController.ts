import type { AiChatService, ChatRequest, ChatResult } from "@decks/core";
import { DECKS_CHAT } from "@decks/core";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";
import { buildAiConfig } from "./ai-config";

/** Plugin glue around the core chat service. */
export class AiChatController {
  constructor(
    private readonly service: AiChatService,
    private readonly settings: DecksSettings,
    private readonly keyStore: AiKeyStore,
  ) {}

  async ask(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const config = await buildAiConfig(this.settings, this.keyStore);
    // Answering runs on its own slot; other providers use the configured model.
    const model = config.provider === "decks-pro" ? DECKS_CHAT : config.model;
    return this.service.ask(
      { ...config, model },
      { ...req, debug: this.settings.debug.enableLogging },
      signal,
    );
  }
}
