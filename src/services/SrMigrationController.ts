import {
  App,
  TFile,
  normalizePath,
  getAllTags,
  parseFrontMatterTags,
  stringifyYaml,
} from "obsidian";
import {
  LegacySrMigrator,
  SrHistoryImporter,
  generateDeckId,
  yieldToUI,
  DEFAULT_DECK_PROFILE,
  HEADER_LEVEL_TITLE,
  REVIEW_PROFILE_ID,
  REVIEW_PROFILE_NAME,
  I18n,
} from "@decks/core";
import type {
  MigratedCard,
  MigrationDeckItem,
  MigrationFormat,
  MigrationProfileFsrs,
  WholeNoteOptions,
} from "@decks/core";
import type { DecksSettings } from "@/settings";
import type { DeckSynchronizer } from "@/services/DeckSynchronizer";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import type { Logger } from "@/utils/logging";

export type SrProgressPhase = "write" | "sync" | "import";
export type SrProgress = (
  done: number,
  total: number,
  phase: SrProgressPhase,
  detail?: string
) => void;

export interface SrMigrateOptions {
  sourceFolder: string; // "" = whole vault
  targetFolder: string;
  srBaseTag: string; // default "#flashcards"
  srReviewTag: string; // default "#review"
  inlineSep: string; // single-line separator (default "::")
  multiSep: string; // multi-line separator (default "?")
  clozeSep: string; // cloze separator (default ";;")
  profileId: string;
  format: MigrationFormat;
  sameFolder: boolean; // true = outputs beside the source note; false = under targetFolder
  archiveOriginals: boolean; // backup location: true → _Legacy_SR_Archive, false → <path>.md.bak
}

const ARCHIVE_FOLDER = "_Legacy_SR_Archive";

export interface SrSeparators {
  inlineSep: string;
  multiSep: string;
  clozeSep: string;
}

const SR_PLUGIN_ID = "obsidian-spaced-repetition";

interface ScanEntry {
  file: TFile;
  kind: "inline" | "whole";
  cards: MigratedCard[]; // inline: many; whole: a single title-mode card
  deckTag?: string; // inline only: the single derived deck tag (e.g. decks/cleancode/comments)
  reviewTag?: string; // whole only: the derived review tag (e.g. decks/review/spanish)
  properties?: string; // whole only: serialized non-SR frontmatter to carry over
  userTags?: string[]; // whole only: non-SR frontmatter tags to carry over
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

  // Migrated decks are namespaced under a `migration` subtag so the chosen profile
  // is mapped only to them — never the user's own `#decks` decks/mapping.
  private get migrationSubtag(): string {
    return `${this.decksBaseTag}/migration`;
  }

  private get migrationReviewSubtag(): string {
    return `${this.decksBaseTag}/review/migration`;
  }

  // Insert `/migration` after the base in a no-# deck tag (e.g. deriveDeckTag's
  // `decks` / `decks/x` → `decks/migration` / `decks/migration/x`).
  private toMigrationTag(deckTag: string): string {
    const base = this.decksBaseTag.replace(/^#/, "");
    return `${base}/migration${deckTag.slice(base.length)}`;
  }

  // Insert `/migration` after `decks/review` (deriveReviewTag's `decks/review` /
  // `decks/review/x` → `decks/review/migration` / `decks/review/migration/x`).
  private toMigrationReviewTag(reviewTag: string): string {
    const reviewBase = `${this.decksBaseTag.replace(/^#/, "")}/review`;
    return `${reviewBase}/migration${reviewTag.slice(reviewBase.length)}`;
  }

  /**
   * Best-effort read of the legacy plugin's configured separators from its
   * data.json so the modal can prefill them. Falls back to the defaults
   * (`::` / `?` / `;;`) on any error.
   */
  async readSrSeparators(): Promise<SrSeparators> {
    const fallback: SrSeparators = { inlineSep: "::", multiSep: "?", clozeSep: ";;" };
    try {
      const path = normalizePath(
        `${this.app.vault.configDir}/plugins/${SR_PLUGIN_ID}/data.json`
      );
      if (!(await this.app.vault.adapter.exists(path))) return fallback;
      const raw = await this.app.vault.adapter.read(path);
      const data: unknown = JSON.parse(raw);
      return {
        inlineSep: this.readStringField(data, "singlelineCardSeparator") || fallback.inlineSep,
        multiSep: this.readStringField(data, "multilineCardSeparator") || fallback.multiSep,
        clozeSep: this.readClozeSeparator(data) || fallback.clozeSep,
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

  // SR stores its cloze syntax in `clozePatterns` (e.g. "==[123;;]answer[;;hint]==").
  // Detect the in-cloze separator from the patterns; default ";;".
  private readClozeSeparator(data: unknown): string | undefined {
    if (data && typeof data === "object") {
      const patterns = (data as Record<string, unknown>)["clozePatterns"];
      if (Array.isArray(patterns)) {
        const joined = patterns.filter((p) => typeof p === "string").join(" ");
        if (joined.includes(";;")) return ";;";
        if (joined.includes("::")) return "::";
      }
    }
    return undefined;
  }

  // SR's note due-date format (best-effort; absent in most versions → auto-detect).
  private async readSrDateFormat(): Promise<string | undefined> {
    try {
      const path = normalizePath(
        `${this.app.vault.configDir}/plugins/${SR_PLUGIN_ID}/data.json`
      );
      if (!(await this.app.vault.adapter.exists(path))) return undefined;
      const data: unknown = JSON.parse(await this.app.vault.adapter.read(path));
      return (
        this.readStringField(data, "dueDateFormat") ??
        this.readStringField(data, "dateFormat")
      );
    } catch (error) {
      this.logger.debug("Could not read Spaced Repetition date format", error);
      return undefined;
    }
  }

  // Non-SR frontmatter (properties + tags) to carry onto a migrated review file.
  private extractReviewFrontmatter(
    file: TFile,
    srBaseTag: string,
    srReviewTag: string
  ): { properties: string; userTags: string[] } {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return { properties: "", userTags: [] };
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fm)) {
      const lower = key.toLowerCase();
      if (lower === "tags" || lower === "tag" || lower === "position") continue;
      if (/^sr-/i.test(key)) continue;
      rest[key] = value;
    }
    const properties = Object.keys(rest).length > 0 ? stringifyYaml(rest).trim() : "";
    const fmTags = (parseFrontMatterTags(fm) ?? []).map((t) => t.replace(/^#/, ""));
    const userTags = LegacySrMigrator.reviewUserTags(fmTags, {
      srBaseTag,
      srReviewTag,
      decksBaseTag: this.decksBaseTag,
    });
    return { properties, userTags };
  }

  private candidateFiles(sourceFolder: string): TFile[] {
    const folder = normalizePath(sourceFolder.trim());
    // Never re-scan our own archive of previously-migrated originals.
    const all = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !f.path.startsWith(`${ARCHIVE_FOLDER}/`));
    if (!folder || folder === "/") return all;
    const prefix = folder.endsWith("/") ? folder : folder + "/";
    return all.filter((f) => f.path === folder || f.path.startsWith(prefix));
  }

  private hasReviewTag(file: TFile, srReviewTag: string): boolean {
    const tag = srReviewTag.startsWith("#") ? srReviewTag : `#${srReviewTag}`;
    const tags = getAllTags(this.app.metadataCache.getFileCache(file) ?? {}) ?? [];
    return tags.some((t) => t === tag || t.startsWith(tag + "/"));
  }

  private hasSrTag(file: TFile, srBaseTag: string): boolean {
    const tag = srBaseTag.startsWith("#") ? srBaseTag : `#${srBaseTag}`;
    const tags = getAllTags(this.app.metadataCache.getFileCache(file) ?? {}) ?? [];
    return tags.some((t) => t === tag || t.startsWith(tag + "/"));
  }

  // All of a file's tags (frontmatter + inline), without the leading `#`.
  private fileTags(file: TFile): string[] {
    const tags = getAllTags(this.app.metadataCache.getFileCache(file) ?? {}) ?? [];
    return tags.map((t) => t.replace(/^#/, ""));
  }

  /** Read and classify every candidate file as inline cards or a whole-note review. */
  async scan(
    opts: Pick<
      SrMigrateOptions,
      "sourceFolder" | "srBaseTag" | "srReviewTag" | "inlineSep" | "multiSep" | "clozeSep"
    >
  ): Promise<SrScanResult> {
    const entries: ScanEntry[] = [];
    const sourceFiles = new Set<string>();
    const dateFormat = await this.readSrDateFormat();

    for (const file of this.candidateFiles(opts.sourceFolder)) {
      // Only parse files that the SR plugin would treat as flashcards/review —
      // i.e. carrying the SR base tag (incl. subtags) or the SR review tag.
      const isReview = this.hasReviewTag(file, opts.srReviewTag);
      if (!this.hasSrTag(file, opts.srBaseTag) && !isReview) continue;

      const content = await this.app.vault.cachedRead(file);
      const fileTags = this.fileTags(file);

      // Inline cards (if any) → a separate Decks file, tagged with the single
      // deepest SR base subtag.
      const { dbRecords } = LegacySrMigrator.processFile(content, {
        srBaseTag: opts.srBaseTag,
        decksBaseTag: this.decksBaseTag,
        inlineSep: opts.inlineSep,
        multiSep: opts.multiSep,
        clozeSep: opts.clozeSep,
        noteTitle: file.basename,
        hintLabel: I18n.t.srMigration.hintLabel,
        dateFormat,
      });
      if (dbRecords.length > 0) {
        entries.push({
          file,
          kind: "inline",
          cards: dbRecords,
          deckTag: this.toMigrationTag(
            LegacySrMigrator.deriveDeckTag(fileTags, {
              srBaseTag: opts.srBaseTag,
              decksBaseTag: this.decksBaseTag,
            })
          ),
        });
        sourceFiles.add(file.path);
      }

      // Whole-note review → reviewed IN PLACE. Triggered by the SR review tag,
      // or (when there are no inline cards) by file-level scheduling state. A
      // file can be BOTH inline AND a review — it then yields two entries.
      const isWholeReview =
        isReview || (dbRecords.length === 0 && !!LegacySrMigrator.parseFileLevelState(content));
      if (isWholeReview) {
        const { properties, userTags } = this.extractReviewFrontmatter(
          file,
          opts.srBaseTag,
          opts.srReviewTag
        );
        entries.push({
          file,
          kind: "whole",
          cards: [
            LegacySrMigrator.processWholeNote(content, file.basename, {
              srBaseTag: opts.srBaseTag,
              srReviewTag: opts.srReviewTag,
              dateFormat,
            }),
          ],
          reviewTag: this.toMigrationReviewTag(
            LegacySrMigrator.deriveReviewTag(fileTags, opts.srReviewTag, this.decksBaseTag)
          ),
          properties,
          userTags,
        });
        sourceFiles.add(file.path);
      }
    }

    const cardCount = entries.reduce((sum, e) => sum + e.cards.length, 0);
    const withHistory = entries.reduce(
      (sum, e) => sum + e.cards.filter((c) => c.fsrsData || c.fsrsDataReverse).length,
      0
    );
    return { entries, fileCount: sourceFiles.size, cardCount, withHistory };
  }

  async migrate(opts: SrMigrateOptions, onProgress?: SrProgress): Promise<SrMigrateSummary> {
    const profile = await this.db.getProfileById(opts.profileId);
    const headerLevel = profile?.headerLevel ?? 2;
    const profileFsrs: MigrationProfileFsrs = {
      requestRetention: profile?.fsrs.requestRetention ?? 0.9,
      profile: profile?.fsrs.profile ?? "STANDARD",
    };
    const dateFormat = await this.readSrDateFormat();

    this.deckSynchronizer.isMigrating = true;
    try {
      const files = this.candidateFiles(opts.sourceFolder).filter(
        (f) => this.hasSrTag(f, opts.srBaseTag) || this.hasReviewTag(f, opts.srReviewTag)
      );
      const total = files.length + 2; // + sync + import phases

      // Map the chosen/review profiles to the migration subtags only — never the
      // user's own `#decks` tag/decks. The forced sync resolves the new decks.
      await this.db.createTagMapping(opts.profileId, this.migrationSubtag);
      const reviewProfileId = await this.ensureReviewProfile();
      await this.db.createTagMapping(reviewProfileId, this.migrationReviewSubtag);

      const deckItems: MigrationDeckItem[] = [];
      let filesMigrated = 0;
      let filesCreated = 0;
      let cardsMigrated = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        onProgress?.(i + 1, total, "write", file.basename);
        try {
          const r = await this.migrateSingleFile(file, opts, headerLevel, profileFsrs, dateFormat, deckItems);
          if (r.migrated) {
            filesMigrated++;
            filesCreated += r.created;
            cardsMigrated += r.cards;
          }
        } catch (error) {
          // Atomic order: the original is copied before any write, so a failure
          // here leaves it untouched. Log and continue with the next file.
          this.logger.error(`SR migration failed for ${file.path}`, error);
        }
        await yieldToUI();
      }

      onProgress?.(files.length + 1, total, "sync");
      await this.deckSynchronizer.sync({ force: true });

      onProgress?.(total, total, "import");
      const { injected, suspended } = await SrHistoryImporter.importHistory(this.db, deckItems);

      return {
        filesMigrated,
        filesCreated,
        cardsMigrated,
        withHistory: injected,
        suspended,
        deleted: opts.archiveOriginals,
      };
    } finally {
      this.deckSynchronizer.isMigrating = false;
    }
  }

  // Migrate one legacy note: split into a readable review note and/or an
  // extracted cards file by what's actually inside, then dispose of the original
  // safely (copy-backup first, then modify-in-place or create+trash).
  private async migrateSingleFile(
    file: TFile,
    opts: SrMigrateOptions,
    headerLevel: number,
    profileFsrs: MigrationProfileFsrs,
    dateFormat: string | undefined,
    deckItems: MigrationDeckItem[]
  ): Promise<{ migrated: boolean; created: number; cards: number }> {
    const content = await this.app.vault.cachedRead(file);
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const isReviewNote =
      this.hasReviewTag(file, opts.srReviewTag) ||
      !!(fm && ("sr-due" in fm || "review" in fm));
    const fileTags = this.fileTags(file);
    const t = I18n.t.srMigration;

    const { dbRecords, hasProse } = LegacySrMigrator.processFile(content, {
      srBaseTag: opts.srBaseTag,
      decksBaseTag: this.decksBaseTag,
      inlineSep: opts.inlineSep,
      multiSep: opts.multiSep,
      clozeSep: opts.clozeSep,
      noteTitle: file.basename,
      hintLabel: t.hintLabel,
      dateFormat,
    });
    const cards = LegacySrMigrator.expandReverseCards(dbRecords);
    const hasCards = cards.length > 0;
    if (!hasCards && !isReviewNote) return { migrated: false, created: 0, cards: 0 };

    // Output base path (no extension). Same-folder reuses the source path; custom
    // folder mirrors the relative path under the target.
    const reviewBaseNoExt = opts.sameFolder
      ? file.path.replace(/\.md$/i, "")
      : this.targetBasePath(file, opts);
    const reviewPath = `${reviewBaseNoExt}.md`;
    const safeSuffix = this.sanitizePathString(t.flashcardsSuffix);
    const cardsBasename = this.basename(reviewBaseNoExt) + safeSuffix;

    const wantReview = !hasCards || isReviewNote || hasProse; // CASE A or C
    // Pure cards (CASE B) take the base name; mixed/review (C) suffix the cards file.
    const cardsOutPath = wantReview ? `${reviewBaseNoExt}${safeSuffix}.md` : reviewPath;

    const wholeOpts: WholeNoteOptions = {
      srBaseTag: opts.srBaseTag,
      srReviewTag: opts.srReviewTag,
      dateFormat,
      inlineSep: opts.inlineSep,
      multiSep: opts.multiSep,
      clozeSep: opts.clozeSep,
      hintLabel: t.hintLabel,
    };

    // A back-link to the original is only safe when the original survives in
    // place (additive). Use its full relative path — the target deck shares the
    // basename, so a bare `[[name]]` would be ambiguous.
    const keepsOriginal = !opts.sameFolder && !opts.archiveOriginals;
    const sourceLine = keepsOriginal
      ? `${t.sourceProperty}: "[[${file.path.replace(/\.md$/i, "")}]]"`
      : "";

    let cardsText: string | null = null;
    let cardsCards: MigratedCard[] = [];
    if (hasCards) {
      const rendered = LegacySrMigrator.renderDecksFiles(cards, this.decksBaseTag, headerLevel, {
        format: opts.format,
        noteTitle: this.basename(reviewBaseNoExt),
        deckTag: this.toMigrationTag(
          LegacySrMigrator.deriveDeckTag(fileTags, {
            srBaseTag: opts.srBaseTag,
            decksBaseTag: this.decksBaseTag,
          })
        ),
        properties: sourceLine || undefined,
      })[0];
      cardsText = rendered?.content ?? null;
      cardsCards = rendered?.cards ?? [];
    }

    let reviewText: string | null = null;
    let reviewCard: MigratedCard | null = null;
    if (wantReview) {
      reviewCard = LegacySrMigrator.processWholeNote(content, file.basename, wholeOpts);
      const { properties, userTags } = this.extractReviewFrontmatter(
        file,
        opts.srBaseTag,
        opts.srReviewTag
      );
      // Frontmatter links: review → its extracted cards, and → the original.
      const links = [
        hasCards ? `${t.flashcardsProperty}: "[[${cardsBasename}]]"` : "",
        sourceLine,
      ].filter((s) => s.length > 0);
      const mergedProps = [properties, ...links].filter((s) => s.length > 0).join("\n");
      const reviewTag = this.toMigrationReviewTag(
        LegacySrMigrator.deriveReviewTag(fileTags, opts.srReviewTag, this.decksBaseTag)
      );
      reviewText = LegacySrMigrator.renderTitleModeFile(reviewCard, reviewTag, {
        extraTags: userTags,
        properties: mergedProps,
      });
    }

    // --- Atomic file ops ---
    let created = 0;
    if (opts.sameFolder) {
      // The original's slot is reused, so back it up first (copy keeps links
      // frozen): archive → _Legacy_SR_Archive, else a sibling .md.bak. Then
      // overwrite the source in place and create the sibling cards file.
      if (opts.archiveOriginals) {
        await this.copyToArchive(file);
      } else {
        await this.app.vault.copy(file, await this.uniquePath(`${file.path}.bak`));
      }
      if (cardsText && reviewText) {
        await this.createOrOverwrite(cardsOutPath, cardsText);
        await this.app.vault.modify(file, reviewText);
        created = 2;
      } else if (reviewText) {
        await this.app.vault.modify(file, reviewText);
        created = 1;
      } else if (cardsText) {
        await this.app.vault.modify(file, cardsText);
        created = 1;
      }
    } else {
      // Separate folder: write the new files there. The original stays put
      // (additive) unless archiving, which copies it out then trashes it.
      // No .bak — the original isn't overwritten here.
      if (cardsText) {
        await this.createOrOverwrite(cardsOutPath, cardsText);
        created++;
      }
      if (reviewText) {
        await this.createOrOverwrite(reviewPath, reviewText);
        created++;
      }
      if (opts.archiveOriginals) {
        await this.copyToArchive(file);
        await this.app.fileManager.trashFile(file);
      }
    }

    // History: review deck (title-mode) + cards deck. Ids derive from the paths.
    if (reviewText && reviewCard) {
      reviewCard.front = this.basename(reviewPath);
      deckItems.push({ deckId: generateDeckId(reviewPath), profileFsrs, cards: [reviewCard] });
    }
    if (cardsText) {
      deckItems.push({ deckId: generateDeckId(cardsOutPath), profileFsrs, cards: cardsCards });
    }

    return { migrated: true, created, cards: cards.length };
  }

  // Copy (never move) the original into the archive folder, preserving relative
  // path — copy leaves the vault's link graph untouched.
  private async copyToArchive(file: TFile): Promise<void> {
    const archivePath = await this.uniquePath(`${ARCHIVE_FOLDER}/${file.path}`);
    await this.ensureFolderFor(archivePath.replace(/\.md$/i, ""));
    await this.app.vault.copy(file, archivePath);
  }

  // Remove characters illegal in a vault path (a translated suffix may contain them).
  private sanitizePathString(value: string): string {
    return value.replace(/[\\/:*?"<>|]/g, "");
  }

  // Write content, overwriting an existing file in place (so re-migration is
  // idempotent and links to an existing path are preserved).
  private async createOrOverwrite(path: string, content: string): Promise<string> {
    const norm = normalizePath(path);
    await this.ensureFolderFor(norm.replace(/\.md$/i, ""));
    const existing = this.app.vault.getAbstractFileByPath(norm);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(norm, content);
    return norm;
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
