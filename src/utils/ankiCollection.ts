import { isZstd, parseMediaManifest } from "@decks/core";
import type { Database, SqlJsStatic } from "sql.js";
import { decompressZstd } from "./zstd";

const UNICASE_COLLATION = /COLLATE\s+"?unicase"?/gi;

// Anki's schema-18 tables declare its own `unicase` collation, which newer SQLite
// won't scan without, so the in-memory copy is switched to the built-in NOCASE.
export function openAnkiCollection(SQL: SqlJsStatic, bytes: Uint8Array): Database {
  const db = new SQL.Database(bytes);
  if (!replaceUnicaseCollation(db)) return db;
  // A rewritten schema is only read back on a fresh open.
  const patched = db.export();
  db.close();
  return new SQL.Database(patched);
}

function replaceUnicaseCollation(db: Database): boolean {
  const rewrites: Array<{ name: string; sql: string }> = [];
  const stmt = db.prepare("SELECT name, sql FROM sqlite_master WHERE sql LIKE '%unicase%'");
  try {
    while (stmt.step()) {
      const [name, sql] = stmt.get();
      if (typeof name !== "string" || typeof sql !== "string") continue;
      const rewritten = sql.replace(UNICASE_COLLATION, "COLLATE NOCASE");
      if (rewritten !== sql) rewrites.push({ name, sql: rewritten });
    }
  } finally {
    stmt.free();
  }
  if (rewrites.length === 0) return false;
  db.run("PRAGMA writable_schema = ON");
  for (const { name, sql } of rewrites) {
    db.run("UPDATE sqlite_master SET sql = ? WHERE name = ?", [sql, name]);
  }
  db.run("PRAGMA writable_schema = OFF");
  return true;
}

/**
 * Pick the authoritative SQLite collection from an unzipped `.apkg`.
 *
 * Modern Anki exports ("Support older Anki versions" unchecked) ship the real
 * data in zstd-compressed `collection.anki21b` AND a legacy `collection.anki2`
 * (and sometimes `collection.anki21`) stub containing a single "please update"
 * notice for old clients. So `anki21b`, when present, is authoritative and must
 * win over the legacy siblings. Legacy-only exports fall through to `anki21`/`anki2`.
 */
export function pickAnkiCollection(entries: Record<string, Uint8Array>): Uint8Array {
  if (entries["collection.anki21b"]) return decompressZstd(entries["collection.anki21b"]);
  if (entries["collection.anki21"]) return entries["collection.anki21"];
  if (entries["collection.anki2"]) return entries["collection.anki2"];
  throw new Error("No Anki collection found in the .apkg file.");
}

/**
 * Parse the `media` manifest (filename → entry key). Modern exports zstd-compress
 * the manifest itself (like the collection), so decompress before parsing.
 */
export function readAnkiMediaMap(entries: Record<string, Uint8Array>): Map<string, string> {
  let raw = entries["media"] ?? new Uint8Array();
  if (isZstd(raw)) raw = decompressZstd(raw);
  return parseMediaManifest(raw);
}
