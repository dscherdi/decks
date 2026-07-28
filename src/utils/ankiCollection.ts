import { isZstd, parseMediaManifest } from "@decks/core";
import { decompressZstd } from "./zstd";

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
