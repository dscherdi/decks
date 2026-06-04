import type { DataAdapter } from "obsidian";
import type { AiProviderId } from "@decks/core";

type KeyMap = Partial<Record<AiProviderId, string>>;

function isKeyMap(value: unknown): value is KeyMap {
  return typeof value === "object" && value !== null;
}

/**
 * Stores provider API keys in a local, non-synced file under the plugin
 * directory — deliberately NOT via the plugin's saveData/data.json, which
 * Obsidian sync replicates across devices. Keys are read/written directly
 * through the vault adapter.
 */
export class AiKeyStore {
  private cache: KeyMap | null = null;

  constructor(
    private readonly adapter: DataAdapter,
    private readonly pluginDir: string,
  ) {}

  private get path(): string {
    return `${this.pluginDir}/ai-keys.json`;
  }

  async load(): Promise<KeyMap> {
    if (this.cache) return this.cache;
    try {
      if (await this.adapter.exists(this.path)) {
        const raw = await this.adapter.read(this.path);
        const parsed: unknown = JSON.parse(raw);
        this.cache = isKeyMap(parsed) ? parsed : {};
      } else {
        this.cache = {};
      }
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  async get(provider: AiProviderId): Promise<string> {
    const map = await this.load();
    return map[provider] ?? "";
  }

  async set(provider: AiProviderId, key: string): Promise<void> {
    const map = await this.load();
    const trimmed = key.trim();
    if (trimmed) {
      map[provider] = trimmed;
    } else {
      delete map[provider];
    }
    this.cache = map;
    await this.adapter.write(this.path, JSON.stringify(map, null, 2));
  }
}
