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
    // The local provider always needs a base URL; decks-pro takes one only as a
    // development override, otherwise it falls back to its baked-in default.
    baseUrl: resolveBaseUrl(settings, provider),
  };
}

function resolveBaseUrl(
  settings: DecksSettings,
  provider: AiProviderConfig["provider"],
): string | undefined {
  if (provider === "openai-compatible") return settings.ai.localBaseUrl;
  // Development-only override; release builds always use the hosted default.
  if (provider === "decks-pro" && __DECKS_DEV__) {
    return settings.ai.proBaseUrl?.trim() || undefined;
  }
  return undefined;
}
