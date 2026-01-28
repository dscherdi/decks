import EmbeddedAssetsSingleton from "./EmbeddedAssetsSingleton";

export function getEmbeddedAssets():
  | { workerCode: string; sqlWasmBase64: string; sqlJsCode: string }
  | null {
  return EmbeddedAssetsSingleton.getInstance();
}

export function hasEmbeddedAssets(): boolean {
  return EmbeddedAssetsSingleton.isAvailable();
}

export function createBlobUrlFromBase64(
  base64: string,
  mimeType: string
): string {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}
