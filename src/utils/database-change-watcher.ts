export interface DatabaseChangeWatcherDeps {
  /** The database file's mtime, or null when there is no file. */
  mtime(): Promise<number | null>;
  /** Merges the file on disk into the open database. */
  merge(): Promise<void>;
  onMerged(): Promise<void>;
  log(message: string, error?: unknown): void;
}

/** Merges the database file when another device rewrote it: one check at a time, and a version that failed is tried again only once it changes. */
export class DatabaseChangeWatcher {
  private known = 0;
  private failed: number | null = null;
  private running = false;

  constructor(private deps: DatabaseChangeWatcherDeps) {}

  /** Takes the file as it is now as already merged. */
  async remember(): Promise<void> {
    try {
      this.known = (await this.deps.mtime()) ?? this.known;
    } catch (error) {
      this.deps.log("Failed to read the database file's mtime", error);
    }
  }

  async check(): Promise<void> {
    // A merge outlasting the polling interval must not start a second one beside it.
    if (this.running) return;
    this.running = true;
    let mtime: number | null = null;
    try {
      mtime = await this.deps.mtime();
      if (mtime === null || mtime <= this.known || mtime === this.failed) return;
      this.deps.log(`Database file changed (${mtime} > ${this.known}), merging it`);
      await this.deps.merge();
      this.known = mtime;
      this.failed = null;
      await this.deps.onMerged().catch((error) => this.deps.log("Refreshing after a database merge failed", error));
    } catch (error) {
      if (mtime !== null) this.failed = mtime;
      this.deps.log("Merging the changed database file failed; it is tried again once the file changes", error);
    } finally {
      this.running = false;
    }
  }
}
