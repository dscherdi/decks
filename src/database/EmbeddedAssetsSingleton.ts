export interface EmbeddedAssets {
  workerCode: string;
  sqlWasmBase64: string;
  sqlJsCode: string;
}

// This placeholder gets replaced by the build script with actual asset data
// DO NOT MODIFY THIS LINE - it's replaced during build
const EMBEDDED_ASSETS_DATA: EmbeddedAssets | null = "__DECKS_EMBEDDED_ASSETS_PLACEHOLDER__" as unknown as EmbeddedAssets | null;

class EmbeddedAssetsSingleton {
  private static instance: EmbeddedAssets | null = EMBEDDED_ASSETS_DATA;

  static initialize(assets: EmbeddedAssets): void {
    if (!this.instance) {
      this.instance = assets;
    }
  }

  static getInstance(): EmbeddedAssets | null {
    return this.instance;
  }

  static isAvailable(): boolean {
    return this.instance !== null;
  }
}

export default EmbeddedAssetsSingleton;
