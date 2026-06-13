import { PROVIDER_MODELS, type AiModelOption, type AiProviderId } from "@decks/core";

/**
 * Options for the per-prompt model picker: the curated models for the provider
 * plus the currently-configured model when it isn't already in that list (e.g.
 * a custom model set in settings). Providers with no curated list (the local
 * openai-compatible one) yield a single entry, which the composer hides.
 */
export function buildModelOptions(
  provider: AiProviderId,
  defaultModel: string,
): AiModelOption[] {
  const list = [...(PROVIDER_MODELS[provider] ?? [])];
  if (defaultModel && !list.some((m) => m.id === defaultModel)) {
    list.push({ id: defaultModel, name: defaultModel });
  }
  return list;
}

/**
 * Resolve the model id to actually use for a provider. A genuine custom value is
 * kept; a curated provider whose stored id is no longer offered (a model we
 * retired) falls back to the first preset. The local provider is free-text, so
 * its stored value is always returned as-is.
 */
export function resolveModelId(
  provider: AiProviderId,
  stored: string,
  isCustom: boolean,
): string {
  const presets = PROVIDER_MODELS[provider];
  if (presets.length === 0) return stored;
  if (isCustom) return stored;
  return presets.some((m) => m.id === stored) ? stored : presets[0].id;
}
