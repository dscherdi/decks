import type { AiProviderConfig } from "@decks/core";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";
import { resolveModelId } from "../utils/ai-model-options";

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
    // Never send a retired model id; a genuine custom value is kept.
    model: resolveModelId(
      provider,
      settings.ai.models[provider],
      settings.ai.customModel?.[provider] ?? false,
    ),
    apiKey: await keyStore.get(provider),
    // Only the local provider takes a base URL; decks-pro uses its baked-in default.
    baseUrl:
      provider === "openai-compatible" ? settings.ai.localBaseUrl : undefined,
  };
}
