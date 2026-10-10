import { requestUrl, type DataAdapter } from "obsidian";
import {
  directoryCardMarkdown,
  directoryDeckInfoUrl,
  directoryDownloadUrl,
  directoryMediaToPrune,
  directoryMediaUrl,
  parseDirectoryDeckInfo,
  parseDirectoryMediaPath,
  sha256Hex,
  unpackDpkg,
  type DirectoryDeckInfo,
  type DirectoryMediaRef,
  type DpkgContents,
  type DpkgImportResult,
} from "@decks/core";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { Logger } from "../utils/logging";

/**
 * Installs and renders decks from .dpkg packages. Media lives in a vault folder shared with
 * the DecksMD app; a missing file is fetched again by hash and shows on the next render.
 */
export class DirectoryService {
  private cached = new Set<string>();
  private fetching = new Set<string>();
  private ready: Promise<void> | null = null;

  constructor(
    private adapter: DataAdapter,
    private mediaDir: string,
    private db: IDatabaseService,
    private logger: Logger
  ) {}

  init(): Promise<void> {
    this.ready ??= this.loadCacheIndex();
    return this.ready;
  }

  private async loadCacheIndex(): Promise<void> {
    try {
      if (!(await this.adapter.exists(this.mediaDir))) return;
      const listing = await this.adapter.list(this.mediaDir);
      for (const file of listing.files) this.cached.add(file.slice(file.lastIndexOf("/") + 1));
    } catch (error) {
      this.logger.debug("Directory media cache could not be listed", error);
    }
  }

  private mediaPath(ref: DirectoryMediaRef): string {
    return `${this.mediaDir}/${ref.sha256}.${ref.ext}`;
  }

  /** A loadable URL for a cached file; a missing one is fetched in the background. */
  mediaUrl(ref: DirectoryMediaRef): string | null {
    const name = `${ref.sha256}.${ref.ext}`;
    if (this.cached.has(name)) return this.adapter.getResourcePath(this.mediaPath(ref));
    void this.fetchMedia(ref);
    return null;
  }

  /** A directory card's markdown with media pointed at the cache and links made plain. */
  prepareMarkdown(text: string): string {
    return directoryCardMarkdown(text, (ref) => this.mediaUrl(ref));
  }

  /** Resolve an embed path written inside a package, such as an occlusion image. */
  resolveEmbed(linkpath: string): string | null {
    const ref = parseDirectoryMediaPath(linkpath);
    return ref ? this.mediaUrl(ref) : null;
  }

  readPackage(bytes: Uint8Array): Promise<DpkgContents> {
    return unpackDpkg(bytes);
  }

  async install(bytes: Uint8Array, contents: DpkgContents): Promise<DpkgImportResult> {
    await this.init();
    await this.ensureMediaDir();
    for (const entry of contents.manifest.media) {
      const data = contents.media.get(entry.sha256);
      if (!data) continue;
      await this.writeMedia({ sha256: entry.sha256, ext: entry.ext }, data);
    }
    return this.db.importDirectoryPackage(bytes);
  }

  /** Drop files only removed packages listed, unless written again since (an install elsewhere). */
  async pruneUnusedMedia(): Promise<void> {
    await this.init();
    const prune = directoryMediaToPrune(await this.db.listDirectoryDecks(true));
    for (const [name, removedAt] of prune) {
      const path = `${this.mediaDir}/${name}`;
      try {
        const stat = await this.adapter.stat(path);
        if (!stat || stat.mtime >= Date.parse(removedAt)) continue;
        await this.adapter.remove(path);
        this.cached.delete(name);
      } catch (error) {
        this.logger.debug(`Could not remove directory media ${name}`, error);
      }
    }
  }

  async fetchDeckInfo(slug: string): Promise<DirectoryDeckInfo | null> {
    const response = await requestUrl({ url: directoryDeckInfoUrl(slug), throw: false });
    return response.status === 200 ? parseDirectoryDeckInfo(response.text) : null;
  }

  async download(ticket: string): Promise<Uint8Array> {
    const response = await requestUrl({ url: directoryDownloadUrl(ticket), throw: false });
    if (response.status !== 200) throw new Error(`Download failed (${response.status})`);
    return new Uint8Array(response.arrayBuffer);
  }

  private async fetchMedia(ref: DirectoryMediaRef): Promise<void> {
    const name = `${ref.sha256}.${ref.ext}`;
    const url = directoryMediaUrl(ref);
    if (this.fetching.has(name)) return;
    this.fetching.add(name);
    try {
      // The folder is shared, so another device may have written the file since it was listed.
      if (await this.adapter.exists(this.mediaPath(ref))) {
        this.cached.add(name);
        return;
      }
      if (!url) return;
      const response = await requestUrl({ url, throw: false });
      if (response.status !== 200) return;
      const data = new Uint8Array(response.arrayBuffer);
      if ((await sha256Hex(data)) !== ref.sha256) return;
      await this.ensureMediaDir();
      await this.writeMedia(ref, data);
    } catch (error) {
      this.logger.debug(`Could not fetch directory media ${name}`, error);
    } finally {
      this.fetching.delete(name);
    }
  }

  private async ensureMediaDir(): Promise<void> {
    if (!(await this.adapter.exists(this.mediaDir))) await this.adapter.mkdir(this.mediaDir);
  }

  private async writeMedia(ref: DirectoryMediaRef, data: Uint8Array): Promise<void> {
    const name = `${ref.sha256}.${ref.ext}`;
    if (this.cached.has(name)) return;
    await this.adapter.writeBinary(this.mediaPath(ref), data.slice().buffer);
    this.cached.add(name);
  }
}
