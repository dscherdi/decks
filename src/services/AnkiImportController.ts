import { App, TFile, normalizePath } from "obsidian";
import { unzipSync } from "fflate";
import {
  AnkiCollectionParser,
  AnkiDeckRenderer,
  AnkiHistoryImporter,
  generateDeckId,
  isZstd,
  yieldToUI,
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

export type AnkiProgressPhase = "read" | "write" | "sync" | "import";
export type AnkiProgress = (
  done: number,
  total: number,
  phase: AnkiProgressPhase,
  detail?: string
) => void;

export interface AnkiImportOptions {
  targetFolder: string; // vault folder the imported decks are written under
  profileId: string;
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
  mediaCopied: number;
  reviewsImported: number;
  withHistory: number;
  templatesWritten: number;
}

const MEDIA_SUBFOLDER = "media";

interface LoadedCollection {
  db: Database;
  mediaByName: Map<string, string>; // filename → zip entry key
  entries: Record<string, Uint8Array>;
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
      });
      const decks = AnkiDeckRenderer.render(parsed.cards, this.ankiSubtag, headerLevel);
      const total = decks.length + 2; // + sync + import

      await this.db.createTagMapping(opts.profileId, this.ankiSubtag);

      const deckItems: AnkiDeckItem[] = [];
      let decksCreated = 0;
      let cardsImported = 0;
      const base = normalizePath(opts.targetFolder.trim());

      for (let i = 0; i < decks.length; i++) {
        const deck = decks[i];
        onProgress?.(i + 1, total, "write", deck.deckName);
        const outPath = normalizePath(`${base}/${deck.relativePath}.md`);
        try {
          await this.createOrOverwrite(outPath, deck.content);
          decksCreated++;
          cardsImported += deck.cards.length;
          deckItems.push({ deckId: generateDeckId(outPath), profileFsrs, cards: deck.cards });
        } catch (error) {
          this.logger.error(`Anki import failed for deck ${deck.deckName}`, error);
        }
        await yieldToUI();
      }

      const mediaCopied = await this.copyMedia(parsed, loaded, base);
      const templatesWritten = await this.writeTemplates(parsed.templateFiles, base);

      onProgress?.(decks.length + 1, total, "sync");
      await this.deckSynchronizer.sync({ force: true });

      onProgress?.(total, total, "import");
      const { injected, reviews } = await AnkiHistoryImporter.importHistory(this.db, deckItems, {
        collectionCreatedMs: AnkiCollectionParser.readCollectionCreatedMs(rawDb),
        revlogByCard: AnkiCollectionParser.readRevlog(rawDb),
      });

      return {
        decksCreated,
        cardsImported,
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
    for (const file of templateFiles) {
      try {
        await this.createOrOverwrite(normalizePath(`${folder}/${file.relativePath}`), file.content);
        written++;
      } catch (error) {
        this.logger.error(`Anki import: failed to write template ${file.relativePath}`, error);
      }
      await yieldToUI();
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
    base: string
  ): Promise<number> {
    if (parsed.mediaFiles.length === 0) return 0;
    const folder = normalizePath(`${base}/${MEDIA_SUBFOLDER}`);
    let copied = 0;
    for (const name of parsed.mediaFiles) {
      const entryKey = loaded.mediaByName.get(name);
      let data = entryKey ? loaded.entries[entryKey] : undefined;
      if (!data) continue;
      if (isZstd(data)) data = decompressZstd(data);
      const target = normalizePath(`${folder}/${name}`);
      try {
        await this.ensureFolderFor(target);
        if (!this.app.vault.getAbstractFileByPath(target)) {
          await this.app.vault.createBinary(target, AnkiImportController.toArrayBuffer(data));
          copied++;
        }
      } catch (error) {
        this.logger.debug("Could not copy Anki media", name, error);
      }
      await yieldToUI();
    }
    return copied;
  }

  private static toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }

  // --- file helpers (mirror SrMigrationController) ---

  private async createOrOverwrite(path: string, content: string): Promise<void> {
    const norm = normalizePath(path);
    await this.ensureFolderFor(norm);
    const existing = this.app.vault.getAbstractFileByPath(norm);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(norm, content);
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
