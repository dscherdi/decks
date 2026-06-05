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
    baseUrl:
      provider === "decks-cloud"
        ? settings.ai.decksCloudBaseUrl
        : settings.ai.localBaseUrl,
  };
}
