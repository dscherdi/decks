import type { DataAdapter } from "obsidian";
import { hashPdf } from "../utils/pdf";

/** The folder syncs with the vault, so a session can arrive after its copy; only old strays go. */
export const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Copies of PDFs attached to AI sessions from outside the vault, by hash, so a
 * resumed session gets its source back. They live in the plugin's folder, not in the vault.
 */
export class AiSourcePdfStore {
  constructor(
    private readonly adapter: Pick<
      DataAdapter,
      "exists" | "stat" | "mkdir" | "writeBinary" | "readBinary" | "list" | "remove"
    >,
    private readonly dir: string,
  ) {}

  /** Hashes kept during this run: their sessions may not be stored yet. */
  private readonly keptThisRun = new Set<string>();

  private pathFor(hash: string): string {
    return `${this.dir}/${hash}.pdf`;
  }

  /** Keep a copy; a complete one already kept under that hash is left as it is. */
  async keep(hash: string, bytes: ArrayBuffer): Promise<void> {
    this.keptThisRun.add(hash);
    const path = this.pathFor(hash);
    const existing = await this.adapter.stat(path);
    if (existing?.size === bytes.byteLength) return;
    if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
    await this.adapter.writeBinary(path, bytes);
  }

  /** The kept copy, or null when there is none or it is no longer that document. */
  async read(hash: string): Promise<ArrayBuffer | null> {
    const path = this.pathFor(hash);
    try {
      if (!(await this.adapter.exists(path))) return null;
      const bytes = await this.adapter.readBinary(path);
      return hashPdf(bytes) === hash ? bytes : null;
    } catch {
      return null;
    }
  }

  /** Delete old copies whose hash is not in `keep`. Returns how many went. */
  async prune(keep: ReadonlySet<string>, now = Date.now()): Promise<number> {
    let files: string[];
    try {
      if (!(await this.adapter.exists(this.dir))) return 0;
      files = (await this.adapter.list(this.dir)).files;
    } catch {
      return 0;
    }
    let removed = 0;
    for (const path of files) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      const hash = name.slice(0, -".pdf".length);
      if (!name.endsWith(".pdf") || keep.has(hash) || this.keptThisRun.has(hash)) continue;
      try {
        const stat = await this.adapter.stat(path);
        if (!stat || now - stat.mtime < PRUNE_AFTER_MS) continue;
        await this.adapter.remove(path);
        removed++;
      } catch {
        // A copy that cannot be removed now is tried again on the next start.
      }
    }
    return removed;
  }
}
