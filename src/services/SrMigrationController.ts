import { App, TFile, normalizePath, getAllTags } from "obsidian";
import {
  LegacySrMigrator,
  SrHistoryImporter,
  generateDeckId,
  DEFAULT_DECK_PROFILE,
  HEADER_LEVEL_TITLE,
  REVIEW_PROFILE_ID,
  REVIEW_PROFILE_NAME,
} from "@decks/core";
import type {
  MigratedCard,
  MigrationDeckItem,
  MigrationFormat,
  MigrationProfileFsrs,
} from "@decks/core";
import type { DecksSettings } from "@/settings";
import type { DeckSynchronizer } from "@/services/DeckSynchronizer";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import type { Logger } from "@/utils/logging";

export interface SrMigrateOptions {
  sourceFolder: string; // "" = whole vault
  targetFolder: string;
  srBaseTag: string; // default "#flashcards"
  srReviewTag: string; // default "#review"
  inlineSep: string; // single-line separator (default "::")
  multiSep: string; // multi-line separator (default "?")
  profileId: string;
  format: MigrationFormat;
  deleteMode: boolean; // irreversible: rewrite originals with block-ref links
}

export interface SrSeparators {
  inlineSep: string;
  multiSep: string;
}

const SR_PLUGIN_ID = "obsidian-spaced-repetition";

interface ScanEntry {
  file: TFile;
  kind: "inline" | "whole";
  cards: MigratedCard[]; // inline: many; whole: a single title-mode card
}

export interface SrScanResult {
  entries: ScanEntry[];
  fileCount: number;
  cardCount: number;
  withHistory: number;
}

export interface SrMigrateSummary {
  filesMigrated: number;
  filesCreated: number;
  cardsMigrated: number;
  withHistory: number;
  suspended: number;
  deleted: boolean;
}

export class SrMigrationController {
  constructor(
    private readonly app: App,
    private readonly db: IDatabaseService,
    private readonly deckSynchronizer: DeckSynchronizer,
    private readonly settings: DecksSettings,
    private readonly logger: Logger
  ) {}

  private get decksBaseTag(): string {
    return this.settings.parsing.deckTag;
  }

  private get reviewSubtag(): string {
    return `${this.decksBaseTag}/review`;
  }

  /**
   * Best-effort read of the legacy plugin's configured separators from its
   * data.json so the modal can prefill them. Falls back to the defaults
   * (`::` / `?`) on any error.
   */
  async readSrSeparators(): Promise<SrSeparators> {
    const fallback: SrSeparators = { inlineSep: "::", multiSep: "?" };
    try {
      const path = normalizePath(
        `${this.app.vault.configDir}/plugins/${SR_PLUGIN_ID}/data.json`
      );
      if (!(await this.app.vault.adapter.exists(path))) return fallback;
      const raw = await this.app.vault.adapter.read(path);
      const data: unknown = JSON.parse(raw);
      const inlineSep = this.readStringField(data, "singlelineCardSeparator");
      const multiSep = this.readStringField(data, "multilineCardSeparator");
      return {
        inlineSep: inlineSep || fallback.inlineSep,
        multiSep: multiSep || fallback.multiSep,
      };
    } catch (error) {
      this.logger.debug("Could not read Spaced Repetition settings", error);
      return fallback;
    }
  }

  private readStringField(data: unknown, key: string): string | undefined {
    if (data && typeof data === "object") {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return undefined;
  }

  private candidateFiles(sourceFolder: string): TFile[] {
    const folder = normalizePath(sourceFolder.trim());
    const all = this.app.vault.getMarkdownFiles();
    if (!folder || folder === "/") return all;
    const prefix = folder.endsWith("/") ? folder : folder + "/";
    return all.filter((f) => f.path === folder || f.path.startsWith(prefix));
  }

  private hasReviewTag(file: TFile, srReviewTag: string): boolean {
    const tag = srReviewTag.startsWith("#") ? srReviewTag : `#${srReviewTag}`;
    const tags = getAllTags(this.app.metadataCache.getFileCache(file) ?? {}) ?? [];
    return tags.some((t) => t === tag || t.startsWith(tag + "/"));
  }

  /** Read and classify every candidate file as inline cards or a whole-note review. */
  async scan(
    opts: Pick<
      SrMigrateOptions,
      "sourceFolder" | "srBaseTag" | "srReviewTag" | "inlineSep" | "multiSep"
    >
  ): Promise<SrScanResult> {
    const entries: ScanEntry[] = [];

    for (const file of this.candidateFiles(opts.sourceFolder)) {
      const content = await this.app.vault.cachedRead(file);

      if (this.hasReviewTag(file, opts.srReviewTag)) {
        entries.push({
          file,
          kind: "whole",
          cards: [LegacySrMigrator.processWholeNote(content, file.basename)],
        });
        continue;
      }

      const { dbRecords } = LegacySrMigrator.processFile(content, {
        srBaseTag: opts.srBaseTag,
        decksBaseTag: this.decksBaseTag,
        inlineSep: opts.inlineSep,
        multiSep: opts.multiSep,
      });
      if (dbRecords.length > 0) {
        entries.push({ file, kind: "inline", cards: dbRecords });
        continue;
      }

      // No inline cards and no review tag — only a whole-note review if it
      // carries file-level scheduling state (sr-* YAML or an EOF comment).
      if (LegacySrMigrator.parseFileLevelState(content)) {
        entries.push({
          file,
          kind: "whole",
          cards: [LegacySrMigrator.processWholeNote(content, file.basename)],
        });
      }
    }

    const cardCount = entries.reduce((sum, e) => sum + e.cards.length, 0);
    const withHistory = entries.reduce(
      (sum, e) => sum + e.cards.filter((c) => c.fsrsData || c.fsrsDataReverse).length,
      0
    );
    return { entries, fileCount: entries.length, cardCount, withHistory };
  }

  async migrate(opts: SrMigrateOptions): Promise<SrMigrateSummary> {
    const profile = await this.db.getProfileById(opts.profileId);
    const headerLevel = profile?.headerLevel ?? 2;
    const profileFsrs: MigrationProfileFsrs = {
      requestRetention: profile?.fsrs.requestRetention ?? 0.9,
      profile: profile?.fsrs.profile ?? "STANDARD",
    };
    const format: MigrationFormat = opts.format;

    const scan = await this.scan(opts);
    const hasWhole = scan.entries.some((e) => e.kind === "whole");

    await this.db.applyProfileToTag(opts.profileId, this.decksBaseTag);
    if (hasWhole) {
      const reviewProfileId = await this.ensureReviewProfile();
      await this.db.applyProfileToTag(reviewProfileId, this.reviewSubtag);
    }

    const deckItems: MigrationDeckItem[] = [];
    let filesCreated = 0;

    for (const entry of scan.entries) {
      const basePath = this.targetBasePath(entry.file, opts);
      await this.ensureFolderFor(basePath);

      if (entry.kind === "whole") {
        filesCreated += await this.migrateWholeNote(entry, basePath, opts, profileFsrs, deckItems);
      } else {
        filesCreated += await this.migrateInline(
          entry,
          basePath,
          opts,
          headerLevel,
          format,
          profileFsrs,
          deckItems
        );
      }
    }

    // The new files are brand new, so the mtime gate never skips them.
    await this.deckSynchronizer.sync({ force: true });

    const { injected, suspended } = await SrHistoryImporter.importHistory(this.db, deckItems);

    return {
      filesMigrated: scan.fileCount,
      filesCreated,
      cardsMigrated: scan.cardCount,
      withHistory: injected,
      suspended,
      deleted: opts.deleteMode,
    };
  }

  private async migrateInline(
    entry: ScanEntry,
    basePath: string,
    opts: SrMigrateOptions,
    headerLevel: number,
    format: MigrationFormat,
    profileFsrs: MigrationProfileFsrs,
    deckItems: MigrationDeckItem[]
  ): Promise<number> {
    const rendered = LegacySrMigrator.renderDecksFiles(entry.cards, this.decksBaseTag, headerLevel, {
      withBlockRefs: opts.deleteMode,
      format,
      noteTitle: this.basename(basePath),
    });

    const written = new Map<boolean, string>(); // reverse -> basename
    let created = 0;
    for (const file of rendered) {
      const outPath = await this.writeUnique(basePath + file.suffix, file.content);
      created++;
      written.set(file.reverse, this.basename(outPath));
      deckItems.push({ deckId: generateDeckId(outPath), profileFsrs, cards: file.cards });
    }

    if (opts.deleteMode) {
      const original = await this.app.vault.read(entry.file);
      await this.backup(entry.file, original);
      const mainBasename = written.get(false) ?? entry.file.basename;
      const reversedBasename = written.get(true) ?? mainBasename;
      const replaced = LegacySrMigrator.buildLinkReplacedOriginal(
        original,
        entry.cards,
        mainBasename,
        reversedBasename
      );
      await this.app.vault.process(entry.file, () => replaced);
    }
    return created;
  }

  private async migrateWholeNote(
    entry: ScanEntry,
    basePath: string,
    opts: SrMigrateOptions,
    profileFsrs: MigrationProfileFsrs,
    deckItems: MigrationDeckItem[]
  ): Promise<number> {
    const card = entry.cards[0];
    const content = LegacySrMigrator.renderTitleModeFile(card, this.reviewSubtag, {
      withBlockRefs: opts.deleteMode,
    });
    const outPath = await this.writeUnique(basePath, content);
    // In title mode the filename is the card front — keep them in sync so the
    // injected id matches what the parser computes after sync.
    card.front = this.basename(outPath);
    deckItems.push({ deckId: generateDeckId(outPath), profileFsrs, cards: [card] });

    if (opts.deleteMode && card.blockId) {
      const original = await this.app.vault.read(entry.file);
      await this.backup(entry.file, original);
      const link = `[[${this.basename(outPath)}#^${card.blockId}]]`;
      await this.app.vault.process(entry.file, () => link);
    }
    return 1;
  }

  // The title-mode review profile ships preinstalled in the DB; resolve it by
  // id (then name), creating it only as a safety net for older databases.
  private async ensureReviewProfile(): Promise<string> {
    const byId = await this.db.getProfileById(REVIEW_PROFILE_ID);
    if (byId) return byId.id;
    const byName = await this.db.getProfileByName(REVIEW_PROFILE_NAME);
    if (byName) return byName.id;
    return this.db.createProfile({
      ...DEFAULT_DECK_PROFILE,
      id: REVIEW_PROFILE_ID,
      name: REVIEW_PROFILE_NAME,
      headerLevel: HEADER_LEVEL_TITLE,
      // One card per note — never split a review note by cloze highlights.
      clozeEnabled: false,
      isDefault: false,
    });
  }

  private async backup(file: TFile, content: string): Promise<void> {
    const backupPath = await this.uniquePath(file.path + ".bak");
    await this.app.vault.create(backupPath, content);
  }

  private targetBasePath(file: TFile, opts: SrMigrateOptions): string {
    const folder = normalizePath(opts.sourceFolder.trim());
    let relative = file.path;
    if (folder && folder !== "/") {
      const prefix = folder.endsWith("/") ? folder : folder + "/";
      if (file.path.startsWith(prefix)) relative = file.path.slice(prefix.length);
    }
    const relativeNoExt = relative.replace(/\.md$/i, "");
    const target = normalizePath(opts.targetFolder.trim());
    return normalizePath(target ? `${target}/${relativeNoExt}` : relativeNoExt);
  }

  private basename(path: string): string {
    const file = path.replace(/\.md$/i, "");
    const slash = file.lastIndexOf("/");
    return slash >= 0 ? file.slice(slash + 1) : file;
  }

  private async writeUnique(basePathNoExt: string, content: string): Promise<string> {
    const path = await this.uniquePath(basePathNoExt + ".md");
    await this.app.vault.create(path, content);
    return path;
  }

  private async uniquePath(path: string): Promise<string> {
    const normalized = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalized))) return normalized;
    const dotIndex = normalized.lastIndexOf(".");
    const stem = dotIndex >= 0 ? normalized.slice(0, dotIndex) : normalized;
    const ext = dotIndex >= 0 ? normalized.slice(dotIndex) : "";
    for (let i = 1; i < 1000; i++) {
      const candidate = `${stem} ${i}${ext}`;
      if (!(await this.app.vault.adapter.exists(candidate))) return candidate;
    }
    throw new Error(`Could not find a free path for ${normalized}`);
  }

  private async ensureFolderFor(basePathNoExt: string): Promise<void> {
    const slash = basePathNoExt.lastIndexOf("/");
    if (slash < 0) return;
    const folder = basePathNoExt.slice(0, slash);
    const segments = folder.split("/").filter((s) => s.length > 0);
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
