import {
  TFile,
  Vault,
  MetadataCache,
  Notice,
  getAllTags,
  parseFrontMatterTags,
} from "obsidian";
import { type Deck, type Flashcard, type DeckStats, type DeckGroup, DEFAULT_PROFILE_ID } from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { generateDeckGroupId, generateDeckId, yieldToUI } from "@decks/core";
import { Logger, formatTime } from "../utils/logging";
import { FileFilter } from "../utils/fileFilter";
import { FlashcardParser, type ParsedFlashcard } from "@decks/core";
import { ProgressTracker } from "../utils/progress";
import { TagGroupService } from "@decks/core";
import type { DecksSettings } from "../settings";

// Maximum number of flashcards to process per deck for performance
const MAX_FLASHCARDS_PER_DECK = 50000;

type RawCounts = { newCount: number; dueCount: number };
type LimitProfile = {
  hasNewCardsLimitEnabled: boolean;
  newCardsPerDay: number;
  hasReviewCardsLimitEnabled: boolean;
  reviewCardsPerDay: number;
};

// Apply a profile's per-deck daily limits to raw new/due counts, using the
// counts already reviewed today. Pure — shared by the batch + single-deck paths.
function applyPerDeckLimits(
  raw: RawCounts,
  profile: LimitProfile,
  dailyCounts: { newCount: number; reviewCount: number }
): RawCounts {
  let newCount = raw.newCount;
  let dueCount = raw.dueCount;
  if (profile.hasNewCardsLimitEnabled && profile.newCardsPerDay >= 0) {
    newCount =
      profile.newCardsPerDay === 0
        ? 0
        : Math.min(raw.newCount, Math.max(0, profile.newCardsPerDay - dailyCounts.newCount));
  }
  if (profile.hasReviewCardsLimitEnabled && profile.reviewCardsPerDay >= 0) {
    dueCount =
      profile.reviewCardsPerDay === 0
        ? 0
        : Math.min(raw.dueCount, Math.max(0, profile.reviewCardsPerDay - dailyCounts.reviewCount));
  }
  return { newCount, dueCount };
}

// Clamp new/due by the shared global daily cap; reviews take the budget first.
function applyGlobalClamp(counts: RawCounts, globalDailyRemaining: number): RawCounts {
  const dueCount = Math.min(counts.dueCount, globalDailyRemaining);
  const newCount = Math.min(counts.newCount, Math.max(0, globalDailyRemaining - dueCount));
  return { newCount, dueCount };
}

export interface DeckManagerOptions {
  settings?: DecksSettings;
  configDir?: string;
}

export class DeckManager {
  private vault: Vault;
  private metadataCache: MetadataCache;
  private db: IDatabaseService;
  private settings?: DecksSettings;
  private logger?: Logger;
  private fileFilter: FileFilter;

  constructor(
    vault: Vault,
    metadataCache: MetadataCache,
    db: IDatabaseService,
    options?: DeckManagerOptions,
    folderSearchPath?: string
  ) {
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.db = db;
    this.settings = options?.settings;
    this.fileFilter = new FileFilter(folderSearchPath);
    if (options?.settings && options?.configDir) {
      this.logger = new Logger(
        options.settings,
        this.vault.adapter,
        options.configDir
      );
    }
  }

  /**
   * Update the folder search path for filtering files
   */
  updateFolderSearchPath(folderSearchPath?: string): void {
    this.fileFilter.updateFolderSearchPath(folderSearchPath);
  }

  /**
   * Remove decks from the DB whose source file no longer exists in the vault.
   * Cheaper than syncDecks — does not scan or re-parse content.
   * Returns the number of orphan decks deleted.
   */
  async cleanupOrphanedDecks(): Promise<number> {
    const existingDecks = await this.db.getAllDecks();
    let deleted = 0;
    for (const deck of existingDecks) {
      const file = this.vault.getAbstractFileByPath(deck.filepath);
      if (!(file instanceof TFile)) {
        this.debugLog(
          `Cleaning up orphaned deck: "${deck.name}" (${deck.filepath})`
        );
        await this.db.deleteDeckByFilepath(deck.filepath);
        deleted++;
      }
    }
    return deleted;
  }

  private debugLog(message: string, ...args: unknown[]): void {
    this.logger?.debug(message, ...args);
  }

  private performanceLog(message: string, ...args: unknown[]): void {
    this.logger?.performance(message, ...args);
  }

  /**
   * Scan vault for all decks (files with the configured deck tag)
   */
  scanVaultForDecks(): Map<string, TFile[]> {
    const decksMap = new Map<string, TFile[]>();
    let files = this.vault.getMarkdownFiles();

    // Filter files by folder search path if specified
    files = this.fileFilter.filterFiles(files);
    this.debugLog(`Filtered to ${files.length} files for scanning`);

    this.debugLog(`Scanning ${files.length} markdown files for flashcard tags`);

    for (const file of files) {
      const metadata = this.metadataCache.getFileCache(file);
      if (!metadata) {
        this.debugLog(`No metadata for file: ${file.path}`);
        continue;
      }
      this.debugLog(`Checking file: ${file.path}`);

      // Get all tags using Obsidian's API (includes inline and frontmatter tags)
      const allTags = getAllTags(metadata) || [];
      this.debugLog(`File ${file.path} has tags:`, allTags);

      if (allTags.length === 0) {
        continue;
      }

      const baseTag = this.settings?.parsing.deckTag || "#decks";
      const flashcardTags = allTags.filter((tag) =>
        tag.startsWith(baseTag)
      );
      this.debugLog(`All tags for ${file.path}:`, allTags);
      this.debugLog(`Flashcard tags for ${file.path}:`, flashcardTags);

      for (const tag of flashcardTags) {
        if (!decksMap.has(tag)) {
          decksMap.set(tag, []);
        }
        const deckFiles = decksMap.get(tag);
        if (deckFiles) {
          deckFiles.push(file);
        }
      }
    }

    // Canvas decks: any .canvas file inside the configured folder is auto-tagged
    // with the configured canvas tag. Empty folderPath disables canvas scanning.
    const canvasFolderPath = this.settings?.canvasDecks?.folderPath?.trim() || "";
    if (canvasFolderPath !== "") {
      const canvasTag = this.settings?.canvasDecks?.tagName?.trim() || "#decks/canvas";
      const canvasFiles = this.vault
        .getFiles()
        .filter((f) => f.extension === "canvas");
      const canvasFilter = new FileFilter(canvasFolderPath);
      const filteredCanvas = canvasFilter.filterFiles(canvasFiles);
      this.debugLog(
        `Found ${filteredCanvas.length} canvas files in folder "${canvasFolderPath}" for tag ${canvasTag}`,
      );
      if (filteredCanvas.length > 0) {
        if (!decksMap.has(canvasTag)) {
          decksMap.set(canvasTag, []);
        }
        const bucket = decksMap.get(canvasTag);
        if (bucket) {
          for (const f of filteredCanvas) bucket.push(f);
        }
      }
    }

    this.debugLog(`Found ${decksMap.size} decks:`, Array.from(decksMap.keys()));
    return decksMap;
  }

  /**
   * Sync decks with database
   */
  async syncDecks(): Promise<void> {
    const syncDecksStartTime = performance.now();
    try {
      this.debugLog("Starting deck sync...");
      const decksMap = this.scanVaultForDecks();
      this.debugLog("Decks found in vault:", decksMap);
      const existingDecks = await this.db.getAllDecks();
      this.debugLog("Existing decks in database:", existingDecks);

      // Create a map of existing decks by file path for quick lookup
      const existingDecksByFile = new Map<string, Deck>();
      for (const deck of existingDecks) {
        existingDecksByFile.set(deck.filepath, deck);
      }

      let newDecksCreated = 0;
      let totalFiles = 0;

      // Process each file as its own deck
      for (const [tag, files] of decksMap) {
        for (const file of files) {
          totalFiles++;
          const filePath = file.path;
          const deckName = file.basename; // Use file basename as deck name

          const existingDeck = existingDecksByFile.get(filePath);

          this.debugLog(`Checking file: ${filePath}`);
          this.debugLog(
            `Existing deck found:`,
            existingDeck ? `YES (ID: ${existingDeck.id})` : "NO"
          );

          if (existingDeck) {
            // Re-resolve profileId from tag mapping to ensure it's current
            const resolvedProfileId = await this.db.getProfileIdForTag(tag) || DEFAULT_PROFILE_ID;
            const needsTagUpdate = existingDeck.tag !== tag;
            const needsProfileUpdate = existingDeck.profileId !== resolvedProfileId;

            if (needsTagUpdate || needsProfileUpdate) {
              this.debugLog(
                `Updating deck "${deckName}"${needsTagUpdate ? ` tag: ${existingDeck.tag} → ${tag}` : ""}${needsProfileUpdate ? ` profileId: ${existingDeck.profileId} → ${resolvedProfileId}` : ""}`
              );
              await this.db.updateDeck(existingDeck.id, {
                ...(needsTagUpdate && { tag }),
                ...(needsProfileUpdate && { profileId: resolvedProfileId }),
              });
            } else {
              this.debugLog(
                `Deck "${deckName}" already exists with correct tag and profile, no update needed`
              );
            }
          } else {
            // Create new deck for this file
            // Note: profileId will be auto-assigned by createDeck based on tag mapping
            const deck = {
              id: generateDeckId(filePath),
              name: deckName, // Store clean file name
              filepath: filePath, // Store full file path separately
              tag: tag,
              lastReviewed: null,
            };
            this.debugLog(
              `Creating new deck: "${deckName}" with ID: ${generateDeckId(
                filePath
              )}, tag: ${tag}, filepath: ${filePath}`
            );
            await this.db.createDeck(deck);
            newDecksCreated++;
          }
        }
      }

      // Clean up orphaned decks (decks whose files no longer exist)
      const allFiles = new Set<string>();
      for (const [, files] of decksMap) {
        for (const file of files) {
          allFiles.add(file.path);
        }
      }

      let deletedDecks = 0;
      for (const deck of existingDecks) {
        if (!allFiles.has(deck.filepath)) {
          this.debugLog(
            `Deleting orphaned deck: "${deck.name}" (${deck.filepath})`
          );
          await this.db.deleteDeckByFilepath(deck.filepath);
          deletedDecks++;
        }
      }

      this.debugLog(
        `Deck sync completed. Processed ${totalFiles} files, created ${newDecksCreated} new decks, deleted ${deletedDecks} orphaned decks.`
      );
      const syncDecksTime = performance.now() - syncDecksStartTime;
      this.performanceLog(
        `Deck sync completed successfully in ${formatTime(
          syncDecksTime
        )} (${newDecksCreated} created, ${deletedDecks} deleted)`
      );
    } catch (error) {
      this.debugLog("Error during deck sync:", error);
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Parse flashcards from a file
   */
  async parseFlashcardsFromFile(
    file: TFile,
    headerLevel: number | number[] = 2
  ): Promise<ParsedFlashcard[]> {
    const parseStartTime = performance.now();

    // Read and parse content
    const content = await this.vault.read(file);
    const readTime = performance.now() - parseStartTime;

    const parseContentStartTime = performance.now();
    const flashcards = this.parseFlashcardsFromContent(content, headerLevel);
    const parseTime = performance.now() - parseContentStartTime;

    const totalTime = performance.now() - parseStartTime;

    this.performanceLog(
      `Parsed ${flashcards.length} flashcards from ${
        file.path
      } in ${formatTime(totalTime)} (read: ${formatTime(
        readTime
      )}, parse: ${formatTime(parseTime)})`
    );

    return flashcards;
  }

  /**
   * Parse flashcards from content string (delegates to FlashcardParser)
   */
  parseFlashcardsFromContent(
    content: string,
    headerLevel: number | number[] = 2,
    clozeEnabled = false
  ): ParsedFlashcard[] {
    return FlashcardParser.parseFlashcardsFromContent(content, headerLevel, undefined, clozeEnabled);
  }

  /**
   * Sync flashcards for a specific deck - now delegates to worker.
   *
   * Mtime gate: skips the parse + DB write entirely when the source file's
   * stat.mtime is at or below the value we recorded on the last successful
   * sync. Pass `{ force: true }` to bypass (used by profile-driven reparses
   * and the manual force-full-resync command). Without the gate, every focus
   * event and every unrelated UI refresh would re-read + re-parse every
   * tagged file in the vault.
   */
  // Deck ids whose file changed since last sync (mtime gate, one bulk read). Stale = newer mtime, never-synced, or missing file.
  async getStaleDeckIds(): Promise<Set<string>> {
    const meta = await this.db.getAllDeckSyncMeta();
    const stale = new Set<string>();
    for (const { id, filepath, lastSyncedMtime } of meta) {
      const file = this.vault.getAbstractFileByPath(filepath);
      if (!(file instanceof TFile)) {
        stale.add(id);
        continue;
      }
      if (lastSyncedMtime <= 0 || file.stat.mtime > lastSyncedMtime) {
        stale.add(id);
      }
    }
    return stale;
  }

  async syncFlashcardsForDeck(
    deckId: string,
    progressTracker?: ProgressTracker,
    options: { force?: boolean } = {}
  ): Promise<void> {
    const deckSyncStartTime = performance.now();
    this.debugLog(`Syncing flashcards for deck ID: ${deckId}`);

    const deck = await this.db.getDeckWithProfile(deckId);
    if (!deck) {
      this.debugLog(`No deck found for ID: ${deckId}`);
      return;
    }
    this.debugLog(
      `Found deck ID: ${deck.id}, name: ${deck.name}, filepath: ${deck.filepath}`
    );

    const file = this.vault.getAbstractFileByPath(deck.filepath);
    if (!file || !(file instanceof TFile)) return;

    // mtime gate
    const fileMtime = file.stat.mtime;
    if (!options.force) {
      const lastSyncedMtime = await this.db.getDeckLastSyncedMtime(deckId);
      if (lastSyncedMtime > 0 && fileMtime <= lastSyncedMtime) {
        this.debugLog(
          `Skipping sync for ${deck.name}: file mtime ${fileMtime} <= last_synced_mtime ${lastSyncedMtime}`
        );
        return;
      }
    }

    // Read file content - this stays in DeckManager
    const fileContent = await this.vault.read(file);
    const fileTitle = file.basename.replace(/\.md$/i, "");

    // Create progress callback from ProgressTracker
    const progressCallback = progressTracker
      ? (progress: number, message?: string) =>
          progressTracker.update(message || "Processing...", progress)
      : undefined;

    // Use unified sync method - implementation handles worker vs main thread
    try {
      const fileMeta = this.metadataCache.getFileCache(file);
      const reverseCards = fileMeta?.frontmatter?.reverse === true;

      // Persist the deck file's tags for file-level (Tier 2) template binding.
      // Only frontmatter tags are deck-wide; inline #tags on a section stay
      // scoped to that section's cards (Tier 1), so a tag on one header doesn't
      // bind its template to the whole file's tables.
      const fileTags = parseFrontMatterTags(fileMeta?.frontmatter ?? null) ?? [];
      await this.db.setDeckFileTags(deck.id, fileTags);

      const result = await this.db.syncFlashcardsForDeck(
        {
          deckId: deck.id,
          deckName: deck.name,
          deckFilepath: deck.filepath,
          deckConfig: deck.profile,
          fileContent: fileContent,
          fileTitle: fileTitle,
          reverseCards,
          clozeEnabled: deck.profile.clozeEnabled,
        },
        progressCallback
      );

      if (result.duplicatesSkipped > 0) {
        this.debugLog(
          `⚠️ Deck "${deck.name}" has ${result.duplicatesSkipped} duplicate flashcard(s) with the same front text. Only the first occurrence was kept.`
        );
        if (this.settings?.ui?.enableNotices) {
          new Notice(
            `⚠️ Deck "${deck.name}" has ${result.duplicatesSkipped} duplicate flashcard(s) with the same front text. Only the first occurrence was kept.`,
            8000
          );
        }
      }

      if (result.parsedCount > MAX_FLASHCARDS_PER_DECK) {
        this.debugLog(
          `⚠️ Deck "${deck.name}" exceeds flashcard limit. ${
            result.parsedCount - MAX_FLASHCARDS_PER_DECK
          } flashcards will be skipped.`
        );
        if (this.settings?.ui?.enableNotices) {
          new Notice(
            `⚠️ Deck "${deck.name}" has ${result.parsedCount} flashcards. Only processing first ${MAX_FLASHCARDS_PER_DECK} for performance.`,
            8000
          );
        }
      }

      const totalDeckSyncTime = performance.now() - deckSyncStartTime;
      this.performanceLog(
        `Sync completed for deck: ${deck.name} in ${formatTime(
          totalDeckSyncTime
        )} (${result.parsedCount} flashcards, ${
          result.operationsCount
        } operations)`
      );

      // Stamp the mtime gate. Only after the sync succeeded — if anything
      // above threw, we want the next sync to retry (mtime stays unchanged
      // so the gate condition `fileMtime > lastSyncedMtime` is satisfied
      // and parse happens again next time).
      await this.db.setDeckLastSyncedMtime(deck.id, fileMtime);

      // Check for duplicates after sync
      try {
        this.debugLog(`Checking for duplicates in deck: ${deck.name}`);
        await this.checkForDuplicatesInDeck(deck.id);
        this.debugLog(`Duplicate check completed for deck: ${deck.name}`);
      } catch (error) {
        console.error(`Failed to check duplicates for ${deck.name}:`, error);
      }
    } catch (error) {
      console.error(`Sync failed for ${deck.name}:`, error);
      throw error;
    }

    await yieldToUI();
  }

  /**
   * Create deck for a single file without running full sync
   */
  async createDeckForFile(filePath: string, tag: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    const deckName = file.basename;
    const existingDeck = await this.db.getDeckByFilepath(filePath);

    if (!existingDeck) {
      // Create new deck for this file
      // Note: profileId will be auto-assigned by createDeck based on tag mapping
      const deck = {
        id: generateDeckId(filePath),
        name: deckName,
        filepath: filePath,
        tag: tag,
        lastReviewed: null,
      };

      this.debugLog(
        `Creating new deck: "${deckName}" with ID: ${generateDeckId(
          filePath
        )}, tag: ${tag}, filepath: ${filePath}`
      );
      await this.db.createDeck(deck);
    }
  }

  /**
   * Extract deck name from files (use the first file's name)
   */
  public extractDeckNameFromFiles(files: TFile[]): string {
    if (files.length === 0) {
      return "General";
    }

    // Use the first file's basename (without extension) as deck name
    const firstFile = files[0];
    return firstFile.basename;
  }

  /**
   * Check for duplicate flashcards in a deck and warn the user
   */
  async checkForDuplicatesInDeck(deckId: string): Promise<void> {
    const existingFlashcards = await this.db.getFlashcardsByDeck(deckId);
    const frontTextMap = new Map<string, Flashcard[]>();

    // Group flashcards by front text (skip cloze cards — they share front text by design)
    for (const card of existingFlashcards) {
      if (card.type === "cloze" || card.type === "image-occlusion") continue;
      const normalizedFront = card.front.trim().toLowerCase();
      if (!frontTextMap.has(normalizedFront)) {
        frontTextMap.set(normalizedFront, []);
      }
      frontTextMap.get(normalizedFront)?.push(card);
    }

    // Find and warn about duplicates
    const deck = await this.db.getDeckById(deckId);
    const deckName = deck?.name || "Unknown Deck";

    for (const [, cards] of frontTextMap) {
      if (cards.length > 1) {
        if (this.settings?.ui?.enableNotices) {
          new Notice(
            `⚠️ Found ${
              cards.length
            } duplicate flashcards in "${deckName}": "${cards[0].front.substring(
              0,
              50
            )}${
              cards[0].front.length > 50 ? "..." : ""
            }". Consider removing duplicates to avoid confusion.`,
            10000
          );
        }
        this.debugLog(
          `Duplicate flashcards found in deck "${deckName}": "${cards[0].front}" (${cards.length} copies)`
        );
      }
    }
  }

  /**
   * Update deck IDs for all flashcards when a deck ID changes (e.g., file rename)
   */
  async updateFlashcardDeckIds(
    oldDeckId: string,
    newDeckId: string
  ): Promise<void> {
    this.debugLog(
      `Updating flashcard deck IDs from ${oldDeckId} to ${newDeckId}`
    );
    await this.db.updateFlashcardDeckIds(oldDeckId, newDeckId);
  }

  /**
   * Get statistics for a single deck
   */
  /**
   * Cards (new + review) still allowed today under the global daily cap across
   * ALL decks. `Infinity` when the cap is disabled or set to 0. Also exposed for
   * the deck list header via getGlobalDailyCapStatus().
   */
  private async globalDailyRemaining(): Promise<number> {
    const r = this.settings?.review;
    if (!r?.hasGlobalReviewCap || !(r.globalReviewCapAmount > 0)) return Infinity;
    const done = await this.db.countCardsStudiedTodayAllDecks(r.nextDayStartsAt);
    return Math.max(0, r.globalReviewCapAmount - done);
  }

  /** Global daily-cap status for the deck list header; null when disabled. */
  async getGlobalDailyCapStatus(): Promise<{ done: number; cap: number } | null> {
    const r = this.settings?.review;
    if (!r?.hasGlobalReviewCap || !(r.globalReviewCapAmount > 0)) return null;
    const done = await this.db.countCardsStudiedTodayAllDecks(r.nextDayStartsAt);
    return { done, cap: r.globalReviewCapAmount };
  }

  async getDeckStats(
    deckId: string,
    respectDailyLimits = true,
    globalDailyRemaining = Infinity
  ): Promise<DeckStats> {
    // Get basic deck stats
    const totalCards = await this.db.countTotalCards(deckId);
    const newCards = await this.db.countNewCards(deckId);
    const dueCards = await this.db.countDueCards(deckId);
    // Count mature cards via SQL — avoids serializing every card across the
    // worker boundary just to filter by state/interval.
    const matureCount = await this.db.countMatureCards(deckId);

    let counts: RawCounts = { newCount: newCards, dueCount: dueCards };

    // Apply per-deck daily limits if requested.
    if (respectDailyLimits) {
      const deck = await this.db.getDeckWithProfile(deckId);
      if (deck) {
        const dailyCounts = await this.db.getDailyReviewCounts(deckId);
        counts = applyPerDeckLimits(counts, deck.profile, dailyCounts);
      }
    }

    // Clamp by the shared global daily cap (no-op when Infinity).
    counts = applyGlobalClamp(counts, globalDailyRemaining);

    return {
      deckId,
      newCount: counts.newCount,
      dueCount: counts.dueCount,
      totalCount: totalCards,
      matureCount,
    };
  }

  /**
   * Get statistics for a deck group (aggregates stats from all decks in the group)
   */
  async getDeckGroupStats(
    deckGroup: DeckGroup,
    globalDailyRemaining = Infinity
  ): Promise<DeckStats> {
    let totalNew = 0;
    let totalDue = 0;
    let totalCount = 0;
    let totalMature = 0;

    for (const deckId of deckGroup.deckIds) {
      // Members counted uncapped; the group total is clamped once below.
      const stats = await this.getDeckStats(deckId);
      totalNew += stats.newCount;
      totalDue += stats.dueCount;
      totalCount += stats.totalCount;
      totalMature += stats.matureCount;
    }

    // Clamp the group's combined total (new + review) by the shared global cap.
    const clampedDue = Math.min(totalDue, globalDailyRemaining);
    const clampedNew = Math.min(
      totalNew,
      Math.max(0, globalDailyRemaining - clampedDue)
    );

    return {
      deckId: generateDeckGroupId(deckGroup.tag),
      newCount: clampedNew,
      dueCount: clampedDue,
      totalCount: totalCount,
      matureCount: totalMature,
    };
  }

  /**
   * Get all deck stats (file decks + tag groups) as a Map. Uses batched
   * aggregate queries (GROUP BY deck_id) instead of ~7 queries per deck: the
   * whole refresh is ~4 worker round-trips regardless of deck/group count.
   * Per-deck limit + global-cap math runs in JS; group stats are summed in
   * memory from the per-deck results (no re-query of member decks).
   */
  async getAllDeckStatsMap(): Promise<Map<string, DeckStats>> {
    const tagGroupService = new TagGroupService(this.db);
    const statsMap = new Map<string, DeckStats>();
    const nextDayStartsAt = this.settings?.review.nextDayStartsAt ?? 4;

    // Four aggregate queries for the whole vault (was 3 + ~7 per deck).
    const [decksWithProfiles, cardStatsRows, dailyRows, globalDailyRemaining] =
      await Promise.all([
        this.db.getAllDecksWithProfiles(),
        this.db.getDeckCardStatsBatch(),
        this.db.getDailyReviewCountsBatch(nextDayStartsAt),
        this.globalDailyRemaining(),
      ]);

    const cardStatsById = new Map(cardStatsRows.map((r) => [r.deckId, r]));
    const dailyById = new Map(dailyRows.map((r) => [r.deckId, r]));

    // Per-deck stats BEFORE the global clamp — reused for group summation.
    const perDeck = new Map<
      string,
      { newCount: number; dueCount: number; totalCount: number; matureCount: number }
    >();

    for (const deck of decksWithProfiles) {
      const cs = cardStatsById.get(deck.id);
      const raw: RawCounts = {
        newCount: cs?.newCount ?? 0,
        dueCount: cs?.dueCount ?? 0,
      };
      const daily = dailyById.get(deck.id) ?? { newCount: 0, reviewCount: 0 };
      const limited = applyPerDeckLimits(raw, deck.profile, daily);
      const totalCount = cs?.total ?? 0;
      const matureCount = cs?.matureCount ?? 0;
      perDeck.set(deck.id, { ...limited, totalCount, matureCount });

      const clamped = applyGlobalClamp(limited, globalDailyRemaining);
      statsMap.set(deck.id, {
        deckId: deck.id,
        newCount: clamped.newCount,
        dueCount: clamped.dueCount,
        totalCount,
        matureCount,
      });
    }

    // Tag groups: sum member per-deck (pre-global) stats, then clamp once.
    const tagGroups = await tagGroupService.aggregateByTag(decksWithProfiles);
    for (const g of tagGroups) {
      let totalNew = 0;
      let totalDue = 0;
      let totalCount = 0;
      let totalMature = 0;
      for (const deckId of g.deckIds) {
        const pd = perDeck.get(deckId);
        if (!pd) continue;
        totalNew += pd.newCount;
        totalDue += pd.dueCount;
        totalCount += pd.totalCount;
        totalMature += pd.matureCount;
      }
      const clamped = applyGlobalClamp(
        { newCount: totalNew, dueCount: totalDue },
        globalDailyRemaining
      );
      const groupId = generateDeckGroupId(g.tag);
      statsMap.set(groupId, {
        deckId: groupId,
        newCount: clamped.newCount,
        dueCount: clamped.dueCount,
        totalCount,
        matureCount: totalMature,
      });
    }

    return statsMap;
  }
}
