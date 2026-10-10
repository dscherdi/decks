import type { DataAdapter } from "obsidian";
import type { PeerDirectoryMerger } from "../database/peer-directory";

/**
 * Brings in the directory decks the DecksMD app added to its own database file,
 * which nothing else carries here. A file that has not changed is not read again.
 */
export class PeerAppDatabase {
  private lastMark: string | null = null;

  constructor(
    private adapter: Pick<DataAdapter, "stat" | "readBinary">,
    private db: PeerDirectoryMerger,
    private path: string
  ) {}

  /** True when the merge changed anything here. */
  async mergeIfChanged(): Promise<boolean> {
    const stat = await this.adapter.stat(this.path);
    if (!stat) return false;
    const mark = `${stat.mtime}:${stat.size}`;
    if (mark === this.lastMark) return false;
    const bytes = new Uint8Array(await this.adapter.readBinary(this.path));
    const result = await this.db.mergePeerDirectory(bytes);
    // A file caught mid-sync is not a database yet; leaving the mark unset retries it.
    if (result.merged) this.lastMark = mark;
    return result.changed;
  }
}
