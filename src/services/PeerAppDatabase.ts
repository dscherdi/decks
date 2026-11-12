import type { DataAdapter } from "obsidian";
import type { DirectoryDeckRecord } from "@decks/core";
import type { PeerDirectoryMerger, PeerDirectoryMergeResult } from "../database/peer-directory";
import { fileMark, type VaultLocalStorage } from "../utils/device-marks";

const MERGED_KEY = "decks-app-db-merged";
const ATTEMPT_KEY = "decks-app-db-attempt";
// A version whose merge was cut off this often is left alone until the file changes.
const MAX_UNFINISHED_ATTEMPTS = 2;

export interface PeerMergeTarget extends PeerDirectoryMerger {
  listDirectoryDecks(includeRemoved?: boolean): Promise<DirectoryDeckRecord[]>;
}

/**
 * Brings in the directory decks the DecksMD app added to its own database file,
 * which nothing else carries here. A version already taken in is not read again.
 */
export class PeerAppDatabase {
  private lastMark: string | null = null;

  constructor(
    private adapter: Pick<DataAdapter, "stat" | "readBinary">,
    private db: PeerMergeTarget,
    private path: string,
    private storage: VaultLocalStorage,
    private log: (message: string) => void = () => {}
  ) {}

  /** True when the merge changed anything here. */
  async mergeIfChanged(): Promise<boolean> {
    const stat = await this.adapter.stat(this.path);
    if (!stat) return false;
    const mark = fileMark(stat);
    if (mark === this.lastMark) return false;
    if (this.storage.loadLocalStorage(MERGED_KEY) === (await this.mergedMark(mark))) {
      this.lastMark = mark;
      return false;
    }
    if (!this.beginAttempt(mark)) {
      this.lastMark = mark;
      return false;
    }
    let result: PeerDirectoryMergeResult;
    try {
      const bytes = new Uint8Array(await this.adapter.readBinary(this.path));
      result = await this.db.mergePeerDirectory(bytes);
    } finally {
      this.storage.saveLocalStorage(ATTEMPT_KEY, null);
    }
    // A file caught mid-sync is not a database yet; leaving the mark unset retries it.
    if (result.merged) {
      this.lastMark = mark;
      this.storage.saveLocalStorage(MERGED_KEY, await this.mergedMark(mark));
    }
    return result.changed;
  }

  // Names the directory decks held here too: a database that lost some no longer matches.
  private async mergedMark(mark: string): Promise<string> {
    const decks = await this.db.listDirectoryDecks(true);
    const held = decks.map((deck) => `${deck.id}@${deck.modified}`).sort();
    return `${mark}|${held.join(",")}`;
  }

  // The count outlives a session that ends mid-merge, so the same version cannot end every start.
  private beginAttempt(mark: string): boolean {
    const stored = this.storage.loadLocalStorage(ATTEMPT_KEY);
    const sameVersion = typeof stored === "string" && stored.endsWith(`|${mark}`);
    const unfinished = sameVersion ? Number.parseInt(stored, 10) || 0 : 0;
    if (unfinished >= MAX_UNFINISHED_ATTEMPTS) {
      this.log(`App database merge skipped: ${unfinished} earlier attempts on this version did not finish`);
      return false;
    }
    this.storage.saveLocalStorage(ATTEMPT_KEY, `${unfinished + 1}|${mark}`);
    return true;
  }
}
