import initSqlJs from "sql.js/dist/sql-wasm.js";
import type { SqlJsStatic } from "sql.js";
import { getEmbeddedAssets, createBlobUrlFromBase64 } from "./embedded-assets";

let cached: SqlJsStatic | null = null;

/**
 * Loads SQL.js on the main thread from the plugin's embedded assets so external
 * SQLite files (e.g. an Anki collection) can be read without the database
 * worker. The SQL.js runtime is bundled directly; only the wasm binary is
 * loaded at runtime via a blob URL built from the embedded base64.
 */
export async function loadSqlJsMainThread(): Promise<SqlJsStatic> {
  if (cached) return cached;

  const assets = getEmbeddedAssets();
  if (!assets?.sqlWasmBase64) {
    throw new Error("SQL.js assets are not available");
  }

  const wasmUrl = createBlobUrlFromBase64(assets.sqlWasmBase64, "application/wasm");
  cached = await initSqlJs({ locateFile: () => wasmUrl });
  return cached;
}
