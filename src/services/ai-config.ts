import type { AiProviderConfig } from "@decks/core";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";

/**
 * Resolve the active AI provider config from settings + the non-synced key
 * store. Shared by the refactor and generator controllers.
 */
export async function buildAiConfig(
  settings: DecksSettings,
  keyStore: AiKeyStore,
): Promise<AiProviderConfig> {
  const provider = settings.ai.provider;
  return {
    provider,
    model: settings.ai.models[provider],
    apiKey: await keyStore.get(provider),
    // Only the local provider takes a base URL; decks-pro uses its baked-in default.
    baseUrl:
      provider === "openai-compatible" ? settings.ai.localBaseUrl : undefined,
  };
}
