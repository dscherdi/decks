import { App, FileSystemAdapter, Platform, TFile, normalizePath } from "obsidian";
import { unzipSync } from "fflate";
import {
  AnkiCollectionParser,
  AnkiDeckRenderer,
  AnkiHistoryImporter,
  generateDeckId,
  isZstd,
  mapWithConcurrency,
  yieldEvery,
} from "@decks/core";
import type {
  AnkiParseResult,
  AnkiDeckItem,
  AnkiTemplateFile,
  MigrationProfileFsrs,
  RawDatabase,
} from "@decks/core";
import type { Database } from "sql.js";
import type { DecksSettings } from "@/settings";
import type { DeckSynchronizer } from "@/services/DeckSynchronizer";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import type { Logger } from "@/utils/logging";
import { loadSqlJsMainThread } from "@/database/loadSqlJsMainThread";
import { htmlToMarkdown } from "@/utils/htmlToMarkdown";
import { decompressZstd } from "@/utils/zstd";
import { pickAnkiCollection, readAnkiMediaMap } from "@/utils/ankiCollection";
import { imageDimensions } from "@/utils/imageDimensions";

export type AnkiProgressPhase = "read" | "write" | "media" | "sync" | "import";
export type AnkiProgress = (
  done: number,
  total: number,
  phase: AnkiProgressPhase,
  detail?: string
) => void;

export interface AnkiImportOptions {
  targetFolder: string; // vault folder the imported decks are written under
  profileId: string;
  split: boolean; // break large decks into numbered part-files (subdecks always split)
  cardsPerFile: number; // max cards per part-file when split is on
}

export interface AnkiScanResult {
  deckCount: number;
  cardCount: number;
  noteCount: number;
  withHistory: number;
  mediaCount: number;
}

export interface AnkiImportSummary {
  decksCreated: number;
  cardsImported: number;
  // Source cards whose front collided with another and merged into one card.
  duplicateFronts: number;
  mediaCopied: number;
  reviewsImported: number;
  withHistory: number;
  templatesWritten: number;
}

const MEDIA_SUBFOLDER = "media";
// Media files written concurrently. Bounded so bulk imports pipeline disk I/O
// without exhausting file descriptors or the mobile filesystem bridge.
const MEDIA_WRITE_CONCURRENCY = 8;

interface LoadedCollection {
  db: Database;
  mediaByName: Map<string, string>; // filename → zip entry key
  entries: Record<string, Uint8Array>;
}

// Minimal shapes for the Node modules reached only on Electron desktop.
interface NodeFsPromises {
  writeFile(path: string, data: Uint8Array): Promise<void>;
}
interface NodePathModule {
  join(...parts: string[]): string;
}
interface WindowWithRequire {
  require?: (module: string) => unknown;
}

/**
 * Orchestrates importing an Anki `.apkg` export into Decks: unzip, read the
 * embedded SQLite collection, translate notes/cards to Decks markdown + media,
 * sync the new decks, then import scheduling/review history.
 */
export class AnkiImportController {
  constructor(
    private readonly app: App,
    private readonly db: IDatabaseService,
    private readonly deckSynchronizer: DeckSynchronizer,
    private readonly settings: DecksSettings,
    private readonly logger: Logger,
    // Optional: rebuild the template cache + persist the template folder after
    // generated templates are written (so multi-field cards render immediately).
    private readonly templateSyncService?: { syncAll(): Promise<void> },
    private readonly saveSettings?: () => Promise<void>
  ) {}

  // Cached desktop fs writer: undefined = not resolved yet, null = unavailable.
  private fastWriter?: ((normPath: string, buffer: ArrayBuffer) => Promise<void>) | null;

  // Migrated Anki decks nest under a `/anki` subtag so the chosen profile maps
  // only to them — never the user's own decks.
  private get ankiSubtag(): string {
    return `${this.settings.parsing.deckTag.replace(/^#/, "")}/anki`;
  }

  /** Parse the apkg in memory and report counts for the modal preview. */
  async scan(bytes: Uint8Array): Promise<AnkiScanResult> {
    const loaded = await this.loadCollection(bytes);
    try {
      const parsed = AnkiCollectionParser.parse(loaded.db, {
        hintLabel: "hint",
        htmlToMarkdown,
        getMediaText: (name) => AnkiImportController.mediaText(loaded, name),
        getMediaSize: (name) => AnkiImportController.mediaSize(loaded, name),
      });
      return {
        deckCount: parsed.deckNames.length,
        cardCount: parsed.cardCount,
        noteCount: parsed.noteCount,
        withHistory: parsed.withHistory,
        mediaCount: parsed.mediaFiles.length,
      };
    } finally {
      loaded.db.close();
    }
  }

  async import(
    bytes: Uint8Array,
    opts: AnkiImportOptions,
    onProgress?: AnkiProgress
  ): Promise<AnkiImportSummary> {
    onProgress?.(0, 1, "read");
    const loaded = await this.loadCollection(bytes);
    const rawDb: RawDatabase = loaded.db;

    const profile = await this.db.getProfileById(opts.profileId);
    const headerLevel = profile?.headerLevel ?? 2;
    const profileFsrs: MigrationProfileFsrs = {
      requestRetention: profile?.fsrs.requestRetention ?? 0.9,
      profile: profile?.fsrs.profile ?? "STANDARD",
    };

    this.deckSynchronizer.isMigrating = true;
    try {
      const parsed = AnkiCollectionParser.parse(rawDb, {
        hintLabel: "hint",
        htmlToMarkdown,
        getMediaText: (name) => AnkiImportController.mediaText(loaded, name),
        getMediaSize: (name) => AnkiImportController.mediaSize(loaded, name),
      });
      const decks = AnkiDeckRenderer.render(
        parsed.cards,
        this.ankiSubtag,
        headerLevel,
        opts.split,
        opts.cardsPerFile
      );

      await this.db.createTagMapping(opts.profileId, this.ankiSubtag);

      const deckItems: AnkiDeckItem[] = [];
      let decksCreated = 0;
      const base = normalizePath(opts.targetFolder.trim());

      // Progress is reported per-phase (done/total within the current phase) so the
      // bar visibly advances during every long phase, not just the deck write.
      for (let i = 0; i < decks.length; i++) {
        const deck = decks[i];
        onProgress?.(i + 1, decks.length, "write", deck.relativePath);
        const outPath = normalizePath(`${base}/${deck.relativePath}.md`);
        try {
          await this.createOrOverwrite(outPath, deck.content);
          decksCreated++;
          deckItems.push({ deckId: generateDeckId(outPath), profileFsrs, cards: deck.cards });
        } catch (error) {
          this.logger.error(`Anki import failed for deck ${deck.deckName}`, error);
        }
        await yieldEvery(i, 100);
      }

      const mediaCopied = await this.copyMedia(parsed, loaded, base, (done, mediaTotal) =>
        onProgress?.(done, mediaTotal, "media")
      );
      const templatesWritten = await this.writeTemplates(parsed.templateFiles, base);

      // Non-force: only the newly written/overwritten decks are stale (new decks
      // register with lastSyncedMtime 0, overwrites bump mtime), so unchanged
      // decks elsewhere in the vault aren't needlessly re-parsed.
      await this.deckSynchronizer.sync({
        showProgress: true,
        onProgress: (p) => onProgress?.(Math.round(p.percentage), 100, "sync"),
      });

      const { injected, reviews } = await AnkiHistoryImporter.importHistory(this.db, deckItems, {
        collectionCreatedMs: AnkiCollectionParser.readCollectionCreatedMs(rawDb),
        revlogByCard: AnkiCollectionParser.readRevlog(rawDb),
        onProgress: (done, historyTotal) => onProgress?.(done, historyTotal, "import"),
      });

      // Count what actually landed in the imported decks (not the pre-sync render
      // count). duplicateFronts is any shortfall — cards whose front collided with
      // another and merged into a single card.
      let cardsImported = 0;
      for (const item of deckItems) {
        cardsImported += await this.db.countTotalCards(item.deckId);
      }
      const duplicateFronts = Math.max(0, parsed.cardCount - cardsImported);

      return {
        decksCreated,
        cardsImported,
        duplicateFronts,
        mediaCopied,
        reviewsImported: reviews,
        withHistory: injected,
        templatesWritten,
      };
    } finally {
      loaded.db.close();
      this.deckSynchronizer.isMigrating = false;
    }
  }

  // Write the generated per-model HTML templates into the template folder (auto-
  // configuring it on first use), then rebuild the template cache so multi-field
  // cards render via their template right away.
  private async writeTemplates(templateFiles: AnkiTemplateFile[], base: string): Promise<number> {
    if (templateFiles.length === 0) return 0;
    const folder = await this.ensureTemplateFolder(base);
    let written = 0;
    for (let i = 0; i < templateFiles.length; i++) {
      const file = templateFiles[i];
      try {
        await this.createOrOverwrite(normalizePath(`${folder}/${file.relativePath}`), file.content);
        written++;
      } catch (error) {
        this.logger.error(`Anki import: failed to write template ${file.relativePath}`, error);
      }
      await yieldEvery(i, 100);
    }
    await this.templateSyncService?.syncAll();
    return written;
  }

  private async ensureTemplateFolder(base: string): Promise<string> {
    const configured = this.settings.templates?.templateFolder?.trim();
    if (configured) return configured;
    const folder = normalizePath(`${base}/_anki-templates`);
    this.settings.templates.templateFolder = folder;
    await this.saveSettings?.();
    return folder;
  }

  private static mediaText(loaded: LoadedCollection, filename: string): string | undefined {
    const key = loaded.mediaByName.get(filename);
    let bytes = key ? loaded.entries[key] : undefined;
    if (bytes && isZstd(bytes)) bytes = decompressZstd(bytes);
    return bytes ? new TextDecoder().decode(bytes) : undefined;
  }

  private static mediaSize(
    loaded: LoadedCollection,
    filename: string
  ): { width: number; height: number } | undefined {
    const key = loaded.mediaByName.get(filename);
    let bytes = key ? loaded.entries[key] : undefined;
    if (bytes && isZstd(bytes)) bytes = decompressZstd(bytes);
    return bytes ? imageDimensions(bytes) : undefined;
  }

  // --- collection loading ---

  private async loadCollection(bytes: Uint8Array): Promise<LoadedCollection> {
    const entries = unzipSync(bytes);
    const collectionBytes = pickAnkiCollection(entries);
    const SQL = await loadSqlJsMainThread();
    const db = new SQL.Database(collectionBytes);
    return { db, mediaByName: AnkiImportController.readMediaMap(entries), entries };
  }

  // The `media` entry maps zip entry keys (numbers) to filenames — legacy JSON or
  // the newer (possibly zstd-compressed) protobuf manifest, handled in the util.
  private static readMediaMap(entries: Record<string, Uint8Array>): Map<string, string> {
    return readAnkiMediaMap(entries);
  }

  private async copyMedia(
    parsed: AnkiParseResult,
    loaded: LoadedCollection,
    base: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<number> {
    const total = parsed.mediaFiles.length;
    if (total === 0) return 0;
    const folder = normalizePath(`${base}/${MEDIA_SUBFOLDER}`);

    // Phase A — build the write list (CPU only): resolve each entry, decompress
    // if needed, convert to a buffer. Also collect the distinct parent folders.
    const writes: Array<{ target: string; buffer: ArrayBuffer }> = [];
    const parents = new Set<string>();
    for (let i = 0; i < total; i++) {
      const name = parsed.mediaFiles[i];
      const entryKey = loaded.mediaByName.get(name);
      let data = entryKey ? loaded.entries[entryKey] : undefined;
      if (!data) continue;
      if (isZstd(data)) data = decompressZstd(data);
      const target = normalizePath(`${folder}/${name}`);
      const parent = target.slice(0, Math.max(0, target.lastIndexOf("/")));
      if (parent) parents.add(parent);
      writes.push({ target, buffer: AnkiImportController.toArrayBuffer(data) });
      await yieldEvery(i, 100);
    }

    // Phase B — create each distinct parent folder once (all media share
    // base/media, bar the rare nested name), before any parallel write.
    for (const parent of parents) {
      await this.ensureFolderFor(`${parent}/.`);
    }

    // Phase C — write files concurrently. Distinct paths, folders already
    // created, so bounded-parallel writes are safe; the shared counter keeps
    // progress monotonic. Overwrite on re-import to refresh changed media.
    let completed = 0;
    const results = await mapWithConcurrency(
      writes,
      MEDIA_WRITE_CONCURRENCY,
      async ({ target, buffer }) => {
        let ok = false;
        try {
          await this.writeBinary(target, buffer);
          ok = true;
        } catch (error) {
          this.logger.debug("Could not copy Anki media", target, error);
        }
        completed++;
        if (completed % 50 === 0) onProgress?.(completed, total);
        await yieldEvery(completed, 100);
        return ok;
      }
    );

    onProgress?.(total, total);
    return results.filter(Boolean).length;
  }

  private static toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const { buffer, byteOffset, byteLength } = bytes;
    // Reuse the backing buffer when the view spans it exactly (unzipSync/fzstd
    // outputs own their buffer) to avoid copying large media.
    if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
      return buffer;
    }
    const copy = new ArrayBuffer(byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
  }

  // --- file helpers (mirror SrMigrationController) ---

  private async createOrOverwrite(path: string, content: string): Promise<void> {
    const norm = normalizePath(path);
    await this.ensureFolderFor(norm);
    const existing = this.app.vault.getAbstractFileByPath(norm);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(norm, content);
  }

  // On desktop, resolve a direct Node fs writer once: writing straight to the
  // vault path lets libuv's threadpool run writes in parallel and skips the
  // adapter's per-file bookkeeping/fsync that serialises bulk media imports.
  // Null on mobile or if Node isn't reachable — callers fall back to the adapter.
  private resolveFastWriter(): ((normPath: string, buffer: ArrayBuffer) => Promise<void>) | null {
    if (this.fastWriter !== undefined) return this.fastWriter;
    this.fastWriter = null;
    const adapter = this.app.vault.adapter;
    const req =
      typeof window !== "undefined" ? (window as unknown as WindowWithRequire).require : undefined;
    if (Platform.isDesktopApp && adapter instanceof FileSystemAdapter && req) {
      const fs = (req("fs") as { promises: NodeFsPromises }).promises;
      const path = req("path") as NodePathModule;
      const base = adapter.getBasePath();
      this.fastWriter = (normPath, buffer) =>
        fs.writeFile(path.join(base, normPath), new Uint8Array(buffer));
    }
    return this.fastWriter;
  }

  // Caller ensures the parent folder exists (copyMedia does so once per folder).
  // Desktop uses the direct fs writer; everything else (mobile, or a failed fast
  // write) falls back to the adapter. Obsidian's file watcher registers the files
  // either way, so embeds resolve at review time.
  private async writeBinary(path: string, buffer: ArrayBuffer): Promise<void> {
    const norm = normalizePath(path);
    const fast = this.resolveFastWriter();
    if (fast) {
      try {
        await fast(norm, buffer);
        return;
      } catch (error) {
        this.logger.debug("fs fast-write failed, using adapter", norm, error);
      }
    }
    await this.app.vault.adapter.writeBinary(norm, buffer);
  }

  private async ensureFolderFor(filePath: string): Promise<void> {
    const slash = filePath.lastIndexOf("/");
    if (slash < 0) return;
    const segments = filePath
      .slice(0, slash)
      .split("/")
      .filter((s) => s.length > 0);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const norm = normalizePath(current);
      if (!(await this.app.vault.adapter.exists(norm))) {
        try {
          await this.app.vault.adapter.mkdir(norm);
        } catch (error) {
          this.logger.debug("Folder already exists or could not be created", norm, error);
        }
      }
    }
  }
}
