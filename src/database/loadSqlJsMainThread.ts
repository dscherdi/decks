import type { InitSqlJsStatic, SqlJsStatic } from "sql.js";
import { getEmbeddedAssets, createBlobUrlFromBase64 } from "./embedded-assets";

let cached: SqlJsStatic | null = null;

/**
 * Loads SQL.js on the main thread from the plugin's embedded assets so external
 * SQLite files (e.g. an Anki collection) can be read without the database
 * worker. Mirrors the worker's init: inject the SQL.js code, then point its
 * wasm loader at a blob URL built from the embedded base64.
 */
export async function loadSqlJsMainThread(): Promise<SqlJsStatic> {
  if (cached) return cached;

  const assets = getEmbeddedAssets();
  if (!assets?.sqlJsCode || !assets?.sqlWasmBase64) {
    throw new Error("SQL.js assets are not available");
  }

  const win = window as Window & { initSqlJs?: InitSqlJsStatic };
  if (!win.initSqlJs) {
    await injectScript(assets.sqlJsCode);
  }
  if (!win.initSqlJs) {
    throw new Error("Failed to load SQL.js");
  }

  const wasmUrl = createBlobUrlFromBase64(assets.sqlWasmBase64, "application/wasm");
  cached = await win.initSqlJs({ locateFile: () => wasmUrl });
  return cached;
}

function injectScript(code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    const script = document.createElement("script");
    script.src = url;
    script.addEventListener("load", () => {
      URL.revokeObjectURL(url);
      resolve();
    });
    script.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SQL.js script"));
    });
    document.head.appendChild(script);
  });
}
