// Shared by the database worker, so nothing here may import obsidian.

const SQLITE_HEADER = "SQLite format 3\u0000";

/** `merged` is false when the file could not be read as a database, so it is tried again. */
export interface PeerDirectoryMergeResult {
  merged: boolean;
  changed: boolean;
}

/** A database that can take the directory decks of another database file. */
export interface PeerDirectoryMerger {
  mergePeerDirectory(bytes: Uint8Array): Promise<PeerDirectoryMergeResult>;
}

export function canMergePeerDirectory(db: object): db is PeerDirectoryMerger {
  return "mergePeerDirectory" in db && typeof db.mergePeerDirectory === "function";
}

/** True when the bytes start like a SQLite database; a half-synced or empty file does not. */
export function isSqliteFile(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, SQLITE_HEADER.length)) === SQLITE_HEADER;
}
