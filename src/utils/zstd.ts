import { decompress } from "fzstd";

/**
 * Decompress a zstd frame to its original bytes. Modern Anki `.apkg` exports
 * store `collection.anki21b` (and sometimes media blobs) zstd-compressed; this
 * is a thin, pure-JS wrapper used by the importer. Decompress-only.
 */
export function decompressZstd(bytes: Uint8Array): Uint8Array {
  return decompress(bytes);
}
