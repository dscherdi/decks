declare global {
  interface Window {
    __DECKS_EMBEDDED_ASSETS__?: {
      workerCode: string;
      sqlWasmBase64: string;
      sqlJsCode: string;
    };
  }
}

export function getEmbeddedAssets():
  | { workerCode: string; sqlWasmBase64: string; sqlJsCode: string }
  | null {
  if (
    typeof window !== "undefined" &&
    window.__DECKS_EMBEDDED_ASSETS__ &&
    window.__DECKS_EMBEDDED_ASSETS__.workerCode &&
    window.__DECKS_EMBEDDED_ASSETS__.sqlWasmBase64 &&
    window.__DECKS_EMBEDDED_ASSETS__.sqlJsCode
  ) {
    return window.__DECKS_EMBEDDED_ASSETS__;
  }
  return null;
}

export function hasEmbeddedAssets(): boolean {
  return getEmbeddedAssets() !== null;
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
