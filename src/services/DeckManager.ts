import { TFile, Vault, MetadataCache, CachedMetadata, Notice } from "obsidian";
import {
  Deck,
  Flashcard,
  ReviewLog,
  DEFAULT_DECK_CONFIG,
} from "../database/types";
import { DatabaseServiceInterface } from "../database/DatabaseFactory";
import { yieldToUI, yieldEvery } from "../utils/ui";
import { Logger, formatTime } from "../utils/logging";
import { FileFilter } from "../utils/fileFilter";
import DecksPlugin from "@/main";

// Maximum number of flashcards to process per deck for performance
const MAX_FLASHCARDS_PER_DECK = 50000;

export interface ParsedFlashcard {
  front: string;
  back: string;
  type: "header-paragraph" | "table";
}

export class DeckManager {
  private vault: Vault;
  private metadataCache: MetadataCache;
  private db: DatabaseServiceInterface;
  private plugin?: DecksPlugin;
  private logger?: Logger;
  private fileFilter: FileFilter;

  // Pre-compiled regex patterns for better performance
  private static readonly HEADER_REGEX = /^(#{1,6})\s+/;
  private static readonly TABLE_ROW_REGEX = /^\|.*\|$/;
  private static readonly TABLE_SEPARATOR_REGEX = /^\|[\s-]+\|[\s-]+\|$/;

  constructor(
    vault: Vault,
    metadataCache: MetadataCache,
    db: DatabaseServiceInterface,
    plugin?: DecksPlugin,
    folderSearchPath?: string,
  ) {
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.db = db;
    this.plugin = plugin;
    this.fileFilter = new FileFilter(folderSearchPath);
    if (plugin?.settings && plugin?.app) {
      this.logger = new Logger(
        plugin.settings,
        this.vault.adapter,
        plugin.app.vault.configDir,
      );
    }
  }

  /**
   * Update the folder search path for filtering files
   */
  updateFolderSearchPath(folderSearchPath?: string): void {
    this.fileFilter.updateFolderSearchPath(folderSearchPath);
  }

  private debugLog(message: string, ...args: any[]): void {
    this.logger?.debug(message, ...args);
  }

  private performanceLog(message: string, ...args: any[]): void {
    this.logger?.performance(message, ...args);
  }

  /**
   * Scan vault for all decks (files with #flashcards tags)
   */
  async scanVaultForDecks(): Promise<Map<string, TFile[]>> {
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

      const allTags: string[] = [];

      // Check inline tags
      if (metadata.tags) {
        const inlineTags = metadata.tags.map((t) => t.tag);
        allTags.push(...inlineTags);
        this.debugLog(`File ${file.path} has inline tags:`, inlineTags);
      }

      // Check frontmatter tags
      if (metadata.frontmatter && metadata.frontmatter.tags) {
        const frontmatterTags = Array.isArray(metadata.frontmatter.tags)
          ? metadata.frontmatter.tags
          : [metadata.frontmatter.tags];

        // Add # prefix if not present
        const normalizedTags = frontmatterTags.map((tag: string) =>
          tag.startsWith("#") ? tag : `#${tag}`,
        );
        allTags.push(...normalizedTags);
        this.debugLog(
          `File ${file.path} has frontmatter tags:`,
          normalizedTags,
        );
      }

      if (allTags.length === 0) {
        continue;
      }

      // Look for #flashcards tags
      const flashcardTags = allTags.filter((tag) =>
        tag.startsWith("#flashcards"),
      );
      this.debugLog(`All tags for ${file.path}:`, allTags);
      this.debugLog(`Flashcard tags for ${file.path}:`, flashcardTags);

      for (const tag of flashcardTags) {
        if (!decksMap.has(tag)) {
          decksMap.set(tag, []);
        }
        decksMap.get(tag)!.push(file);
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
      const decksMap = await this.scanVaultForDecks();
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
            existingDeck ? `YES (ID: ${existingDeck.id})` : "NO",
          );

          if (existingDeck) {
            // Update existing deck if tag changed
            if (existingDeck.tag !== tag) {
              this.debugLog(
                `Updating deck "${deckName}" tag from ${existingDeck.tag} to ${tag}`,
              );
              await this.db.updateDeck(existingDeck.id, {
                tag: tag,
              });
            } else {
              this.debugLog(
                `Deck "${deckName}" already exists with correct tag, no update needed`,
              );
            }
          } else {
            // Create new deck for this file
            const file = this.vault.getAbstractFileByPath(filePath);
            let deckModTime = new Date();

            if (file instanceof TFile) {
              const fileModTime = new Date(file.stat.mtime);
              const fileCreateTime = new Date(file.stat.ctime);
              // Use the earlier of file modification time or file creation time
              deckModTime =
                fileModTime < fileCreateTime ? fileModTime : fileCreateTime;
            }

            const deck: Omit<Deck, "created"> = {
              id: this.generateDeckId(filePath),
              name: deckName, // Store clean file name
              filepath: filePath, // Store full file path separately
              tag: tag,
              lastReviewed: null,
              config: DEFAULT_DECK_CONFIG,
              modified: deckModTime.toISOString(),
            };
            this.debugLog(
              `Creating new deck: "${deckName}" with ID: ${deck.id}, tag: ${tag}, filepath: ${filePath}`,
            );
            await this.db.createDeck(deck);
            newDecksCreated++;
          }
        }
      }

      // Clean up orphaned decks (decks whose files no longer exist)
      const allFiles = new Set<string>();
      for (const [tag, files] of decksMap) {
        for (const file of files) {
          allFiles.add(file.path);
        }
      }

      let deletedDecks = 0;
      for (const deck of existingDecks) {
        if (!allFiles.has(deck.filepath)) {
          this.debugLog(
            `Deleting orphaned deck: "${deck.name}" (${deck.filepath})`,
          );
          await this.db.deleteDeckByFilepath(deck.filepath);
          deletedDecks++;
        }
      }

      this.debugLog(
        `Deck sync completed. Processed ${totalFiles} files, created ${newDecksCreated} new decks, deleted ${deletedDecks} orphaned decks.`,
      );
      const syncDecksTime = performance.now() - syncDecksStartTime;
      this.performanceLog(
        `Deck sync completed successfully in ${formatTime(syncDecksTime)} (${newDecksCreated} created, ${deletedDecks} deleted)`,
      );
    } catch (error) {
      console.error("Error during deck sync:", error);
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Parse flashcards from a file
   */
  async parseFlashcardsFromFile(
    file: TFile,
    headerLevel: number = 2,
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
      `Parsed ${flashcards.length} flashcards from ${file.path} in ${formatTime(totalTime)} (read: ${formatTime(readTime)}, parse: ${formatTime(parseTime)})`,
    );

    return flashcards;
  }

  /**
   * Parse flashcards from content string (optimized single-pass parsing)
   */
  private parseFlashcardsFromContent(
    content: string,
    headerLevel: number = 2,
  ): ParsedFlashcard[] {
    const lines = content.split("\n");
    const flashcards: ParsedFlashcard[] = [];

    // Single pass through lines for both table and header parsing
    let inTable = false;
    let headerSeen = false;
    let currentHeader: { text: string; level: number } | null = null;
    let currentContent: string[] = [];
    let inFrontmatter = false;
    let skipNextParagraph = false;

    // Use pre-compiled regex patterns for better performance

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Handle frontmatter
      if (i === 0 && trimmedLine === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (trimmedLine === "---") {
          inFrontmatter = false;
        }
        continue;
      }

      // Check for table rows
      if (DeckManager.TABLE_ROW_REGEX.test(trimmedLine)) {
        if (!inTable) {
          inTable = true;
          headerSeen = false;
        }

        // Skip header and separator rows
        if (!headerSeen) {
          headerSeen = true;
          continue;
        }
        if (DeckManager.TABLE_SEPARATOR_REGEX.test(trimmedLine)) {
          continue;
        }

        // Parse table row
        const cells = trimmedLine
          .slice(1, -1) // Remove leading/trailing pipes
          .split("|")
          .map((cell) => cell.trim());

        if (cells.length >= 2 && cells[0] && cells[1]) {
          flashcards.push({
            front: cells[0], // TODO strip of unnecessary characters
            back: cells[1],
            type: "table",
          });
        }
      } else {
        // Not a table row, end table processing
        if (inTable) {
          inTable = false;
        }

        // Check for headers
        const headerMatch = DeckManager.HEADER_REGEX.exec(line);
        if (headerMatch) {
          const currentHeaderLevel = headerMatch[1].length;

          // Check for title headers to skip
          if (line.match(/^#\s+/) && line.toLowerCase().includes("flashcard")) {
            skipNextParagraph = true;
            this.finalizeCurrentHeader(
              currentHeader,
              currentContent,
              flashcards,
              headerLevel,
            );
            currentHeader = null;
            currentContent = [];
            continue;
          }

          // Finalize previous header
          this.finalizeCurrentHeader(
            currentHeader,
            currentContent,
            flashcards,
            headerLevel,
          );

          // Start new header
          currentHeader = {
            text: line,
            level: currentHeaderLevel,
          };
          currentContent = [];
          skipNextParagraph = false;
        } else if (skipNextParagraph) {
          if (trimmedLine === "") {
            skipNextParagraph = false;
          }
        } else if (currentHeader) {
          // Skip empty lines at the beginning of content
          if (trimmedLine === "" && currentContent.length === 0) {
            continue;
          }
          currentContent.push(line);
        }
      }
    }

    // Finalize last header
    this.finalizeCurrentHeader(
      currentHeader,
      currentContent,
      flashcards,
      headerLevel,
    );

    return flashcards;
  }

  /**
   * Helper to finalize current header flashcard
   */
  private finalizeCurrentHeader(
    currentHeader: { text: string; level: number } | null,
    currentContent: string[],
    flashcards: ParsedFlashcard[],
    targetHeaderLevel: number,
  ): void {
    if (
      currentHeader &&
      currentContent.length > 0 &&
      currentHeader.level === targetHeaderLevel
    ) {
      flashcards.push({
        front: currentHeader.text.replace(/^#{1,6}\s+/, ""),
        back: currentContent.join("\n").trim(),
        type: "header-paragraph",
      });
    }
  }

  /**
   * Execute batch database operations using transactions with prepared statements for optimal performance
   */
  private async executeBatchOperations(
    operations: Array<{
      type: "create" | "update" | "delete";
      flashcardId?: string;
      flashcard?: Omit<Flashcard, "created" | "modified">;
      updates?: any;
    }>,
  ): Promise<void> {
    const batchStartTime = performance.now();
    let createCount = 0;
    let updateCount = 0;
    let deleteCount = 0;

    this.debugLog(`Starting transaction for ${operations.length} operations`);

    try {
      // Begin transaction
      this.db.beginTransaction();
      this.debugLog(`Transaction started successfully`);

      // Group operations by type for batch processing
      const deleteOps = operations.filter(
        (op) => op.type === "delete" && op.flashcardId,
      );
      const createOps = operations.filter(
        (op) => op.type === "create" && op.flashcard,
      );
      const updateOps = operations.filter(
        (op) => op.type === "update" && op.flashcardId && op.updates,
      );

      // Execute all DELETE operations with single prepared statement
      if (deleteOps.length > 0) {
        this.db.batchDeleteFlashcards(deleteOps.map((op) => op.flashcardId!));
        deleteCount = deleteOps.length;
        this.debugLog(`Batch deleted ${deleteCount} flashcards`);
      }
      // Execute all CREATE operations with single prepared statement
      if (createOps.length > 0) {
        this.db.batchCreateFlashcards(createOps.map((op) => op.flashcard!));
        createCount = createOps.length;
        this.debugLog(`Batch created ${createCount} flashcards`);
      }
      // Execute all UPDATE operations with single prepared statement
      if (updateOps.length > 0) {
        this.db.batchUpdateFlashcards(
          updateOps.map((op) => ({
            id: op.flashcardId!,
            updates: op.updates!,
          })),
        );
        updateCount = updateOps.length;
        this.debugLog(`Batch updated ${updateCount} flashcards`);
      }
      await yieldToUI();

      // Commit transaction
      this.db.commitTransaction();
      this.debugLog(`Transaction committed successfully`);

      const totalBatchTime = performance.now() - batchStartTime;
      this.performanceLog(
        `Transaction completed in ${formatTime(totalBatchTime)} (${createCount} created, ${updateCount} updated, ${deleteCount} deleted)`,
      );
    } catch (error) {
      console.error(`Critical error in transaction:`, error);
      try {
        this.db.rollbackTransaction();
        this.debugLog(`Transaction rolled back due to error`);
      } catch (rollbackError) {
        console.error(`Failed to rollback transaction:`, rollbackError);
      }
      throw error;
    }
  }

  /**
   * Sync flashcards for a specific deck
   */
  async syncFlashcardsForDeck(
    deckId: string,
    force: boolean = false,
  ): Promise<void> {
    const deckSyncStartTime = performance.now();
    this.debugLog(`Syncing flashcards for deck ID: ${deckId}`);

    const deck = await this.db.getDeckById(deckId);
    if (!deck) {
      this.debugLog(`No deck found for ID: ${deckId}`);
      return;
    }
    this.debugLog(
      `Found deck ID: ${deck.id}, name: ${deck.name}, filepath: ${deck.filepath}`,
    );

    const file = this.vault.getAbstractFileByPath(deck.filepath);
    if (!file || !(file instanceof TFile)) return;

    // Get file modification time
    const fileModifiedTime = new Date(file.stat.mtime);

    // Check if file has been modified since last deck update (unless forced)
    if (!force) {
      const deckModifiedTime = new Date(deck.modified);
      if (fileModifiedTime <= deckModifiedTime) {
        this.debugLog(
          `File ${deck.filepath} not modified since last sync, skipping`,
        );
        return;
      }
    }
    this.debugLog(
      `File modified: ${fileModifiedTime.toISOString()}, last sync: ${deck.modified}`,
    );

    // Get existing flashcards for this deck to determine what changed
    const existingFlashcards = await this.db.getFlashcardsByDeck(deck.id);
    this.debugLog(
      `Found ${existingFlashcards.length} existing flashcards for deck ${deck.name}`,
    );

    const existingById = new Map<string, Flashcard>();
    existingFlashcards.forEach((card) => {
      existingById.set(card.id, card);
      this.debugLog(`Existing card ID: ${card.id}, Front: "${card.front}"`);
    });

    const processedIds = new Set<string>();
    const duplicateWarnings = new Set<string>(); // Track duplicates to warn only once per file

    // Batch operations for better performance
    const batchOperations: Array<{
      type: "create" | "update" | "delete";
      flashcardId?: string;
      flashcard?: Omit<Flashcard, "created" | "modified">;
      updates?: any;
    }> = [];

    // Parse flashcards from the file using deck's header level configuration
    const allParsedCards = await this.parseFlashcardsFromFile(
      file,
      deck.config.headerLevel,
    );

    // Limit to first 4000 flashcards per deck
    const parsedCards = allParsedCards.slice(0, MAX_FLASHCARDS_PER_DECK);

    this.debugLog(
      `Parsed ${allParsedCards.length} flashcards from ${deck.filepath}, processing first ${parsedCards.length} (limit: ${MAX_FLASHCARDS_PER_DECK})`,
    );

    if (allParsedCards.length > MAX_FLASHCARDS_PER_DECK) {
      this.debugLog(
        `⚠️ Deck "${deck.name}" exceeds flashcard limit. ${allParsedCards.length - MAX_FLASHCARDS_PER_DECK} flashcards will be skipped.`,
      );
      if (this.plugin?.settings?.ui?.enableNotices) {
        new Notice(
          `⚠️ Deck "${deck.name}" has ${allParsedCards.length} flashcards. Only processing first ${MAX_FLASHCARDS_PER_DECK} for performance.`,
          8000,
        );
      }
    }

    // Process flashcards in chunks to avoid blocking UI with large datasets
    for (let i = 0; i < parsedCards.length; i++) {
      // Yield control to UI every 50 flashcards to prevent blocking
      const parsed = parsedCards[i];
      const flashcardId = this.generateFlashcardId(parsed.front);
      const contentHash = this.generateContentHash(parsed.back);
      const existingCard = existingById.get(flashcardId);

      // Check for duplicate front text within the same parsing session
      if (processedIds.has(flashcardId)) {
        const duplicateKey = `${deck.name}:${parsed.front}`;
        if (!duplicateWarnings.has(duplicateKey)) {
          if (this.plugin?.settings?.ui?.enableNotices) {
            new Notice(
              `⚠️ Duplicate flashcard detected in "${deck.name}": "${parsed.front.substring(0, 50)}${parsed.front.length > 50 ? "..." : ""}". Only the first occurrence will be used.`,
              8000,
            );
          }
          duplicateWarnings.add(duplicateKey);
          this.debugLog(
            `Duplicate flashcard detected: "${parsed.front}" in deck "${deck.name}"`,
          );
        }
        continue; // Skip this duplicate
      }

      this.debugLog(
        `Processing flashcard: "${parsed.front.substring(0, 50)}..."`,
      );
      this.debugLog(
        `Generated ID: ${flashcardId} (from front: "${parsed.front.substring(0, 30)}..." + deck: ${deck.id})`,
      );
      this.debugLog(`Existing card found:`, existingCard ? "YES" : "NO");

      if (existingCard) {
        this.debugLog(
          `Existing card - ID: ${existingCard.id}, Front: "${existingCard.front.substring(0, 30)}...", Hash: ${existingCard.contentHash}`,
        );
      }

      processedIds.add(flashcardId);
      await yieldEvery(i);
      if (existingCard) {
        // Update if content has changed
        if (existingCard.contentHash !== contentHash) {
          this.debugLog(
            `Content changed, updating flashcard: ${parsed.front.substring(0, 30)}...`,
          );
          batchOperations.push({
            type: "update",
            flashcardId: existingCard.id,
            updates: {
              front: parsed.front,
              back: parsed.back,
              type: parsed.type,
              contentHash: contentHash,
            },
          });
        } else {
          this.debugLog(
            `No content change, skipping update: ${parsed.front.substring(0, 30)}...`,
          );
        }
      } else {
        // Check for existing review logs to restore progress
        const previousProgress =
          await this.db.getLatestReviewLogForFlashcard(flashcardId);

        // Create new flashcard with restored progress if available
        const flashcard: Omit<Flashcard, "created" | "modified"> = {
          id: flashcardId,
          deckId: deck.id,
          front: parsed.front,
          back: parsed.back,
          type: parsed.type,
          sourceFile: file.path,
          contentHash: contentHash,

          // Restore progress from review logs or use defaults
          state: previousProgress?.newState || "new",
          dueDate: previousProgress
            ? new Date(
                new Date(previousProgress.reviewedAt).getTime() +
                  previousProgress.newIntervalMinutes * 60 * 1000,
              ).toISOString()
            : new Date().toISOString(),
          interval: previousProgress?.newIntervalMinutes || 0,
          repetitions: previousProgress?.newRepetitions || 0,
          difficulty: previousProgress?.newDifficulty || 5.0, // FSRS initial difficulty
          stability: previousProgress?.newStability || 2.5, // FSRS initial stability
          lapses: previousProgress?.newLapses || 0,
          lastReviewed: previousProgress?.reviewedAt || null,
        };

        if (previousProgress) {
          this.debugLog(
            `Restoring flashcard progress from review logs: ${flashcard.front} (state: ${previousProgress.newState}, interval: ${previousProgress.newIntervalMinutes})`,
          );

          // Notify user that progress was restored
          if (this.plugin?.settings?.ui?.enableNotices) {
            new Notice(
              `✅ Progress restored for flashcard: "${parsed.front.substring(0, 40)}${parsed.front.length > 40 ? "..." : ""}" (${previousProgress.newState}, ${previousProgress.newRepetitions} reviews)`,
              5000,
            );
          }
        } else {
          this.debugLog(`Creating new flashcard: ${flashcard.front}`);
        }

        batchOperations.push({
          type: "create",
          flashcard: flashcard,
        });
      }
    }

    // Delete flashcards that are no longer in the file
    for (const [flashcardId, existingCard] of existingById) {
      if (!processedIds.has(flashcardId)) {
        this.debugLog(`Deleting flashcard: ${existingCard.front}`);
        batchOperations.push({
          type: "delete",
          flashcardId: existingCard.id,
        });
      }
    }

    // Execute all batch operations
    if (batchOperations.length > 0) {
      this.debugLog(
        `Executing ${batchOperations.length} batch database operations`,
      );
      await this.executeBatchOperations(batchOperations);
      this.debugLog(`Batch operations completed successfully`);
    }

    // Update deck's modified timestamp to match file modification time (without save)
    const timestampStartTime = performance.now();
    try {
      this.debugLog(`Updating deck timestamp for: ${deck.name}`);
      await this.db.updateDeckTimestamp(deck.id);
      this.debugLog(`Deck timestamp updated successfully`);
    } catch (error) {
      console.error(`Failed to update deck timestamp for ${deck.name}:`, error);
      throw error;
    }

    try {
      this.debugLog(`Checking for duplicates in deck: ${deck.name}`);
      await this.checkForDuplicatesInDeck(deck.id);
      this.debugLog(`Duplicate check completed for deck: ${deck.name}`);
    } catch (error) {
      console.error(`Failed to check duplicates for ${deck.name}:`, error);
      throw error;
    }

    const timestampTime = performance.now() - timestampStartTime;

    const totalDeckSyncTime = performance.now() - deckSyncStartTime;
    this.performanceLog(
      `Sync completed for deck: ${deck.name} in ${formatTime(totalDeckSyncTime)} (${parsedCards.length} flashcards, ${batchOperations.length} operations, cleanup: ${formatTime(timestampTime)}) - DB save deferred`,
    );
    yieldToUI();
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
      const fileModTime = new Date(file.stat.mtime);
      const fileCreateTime = new Date(file.stat.ctime);

      // Use the earlier of file modification time or file creation time
      const deckModTime =
        fileModTime < fileCreateTime ? fileModTime : fileCreateTime;

      const deck: Omit<Deck, "created"> = {
        id: this.generateDeckId(filePath),
        name: deckName,
        filepath: filePath,
        tag: tag,
        lastReviewed: null,
        config: DEFAULT_DECK_CONFIG,
        modified: deckModTime.toISOString(),
      };

      this.debugLog(
        `Creating new deck: "${deckName}" with ID: ${deck.id}, tag: ${tag}, filepath: ${filePath}`,
      );
      await this.db.createDeck(deck);
    }
  }

  /**
   * Generate content hash for flashcard back content (front is used for ID)
   */
  private generateContentHash(back: string): string {
    let hash = 0;
    for (let i = 0; i < back.length; i++) {
      const char = back.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
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
   * Extract deck name from tag (legacy method for compatibility)
   */
  private extractDeckName(tag: string): string {
    // Remove #flashcards prefix
    let name = tag.replace("#flashcards", "");

    // If there's a remaining slash, remove it
    if (name.startsWith("/")) {
      name = name.substring(1);
    }

    // If empty (just #flashcards), return "General"
    if (!name) {
      return "General";
    }

    // Split by slashes and convert to title case
    const parts = name.split("/");
    return parts
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" - ");
  }

  /**
   * Generate deterministic deck ID based on filepath
   */
  public generateDeckId(filepath?: string): string {
    if (filepath) {
      // Generate deterministic ID based on filepath
      let hash = 0;
      for (let i = 0; i < filepath.length; i++) {
        const char = filepath.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return `deck_${Math.abs(hash).toString(36)}`;
    }
    // Fallback to timestamp-based ID for backward compatibility
    return `deck_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique flashcard ID using hash of front text only
   */
  public generateFlashcardId(frontText: string, deckId?: string): string {
    // Use only front text for ID generation to preserve progress across deck changes
    let hash = 0;
    for (let i = 0; i < frontText.length; i++) {
      const char = frontText.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `card_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Check for duplicate flashcards in a deck and warn the user
   */
  async checkForDuplicatesInDeck(deckId: string): Promise<void> {
    const existingFlashcards = await this.db.getFlashcardsByDeck(deckId);
    const frontTextMap = new Map<string, Flashcard[]>();

    // Group flashcards by front text
    for (const card of existingFlashcards) {
      const normalizedFront = card.front.trim().toLowerCase();
      if (!frontTextMap.has(normalizedFront)) {
        frontTextMap.set(normalizedFront, []);
      }
      frontTextMap.get(normalizedFront)!.push(card);
    }

    // Find and warn about duplicates
    const deck = await this.db.getDeckById(deckId);
    const deckName = deck?.name || "Unknown Deck";

    for (const [frontText, cards] of frontTextMap) {
      if (cards.length > 1) {
        if (this.plugin?.settings?.ui?.enableNotices) {
          new Notice(
            `⚠️ Found ${cards.length} duplicate flashcards in "${deckName}": "${cards[0].front.substring(0, 50)}${cards[0].front.length > 50 ? "..." : ""}". Consider removing duplicates to avoid confusion.`,
            10000,
          );
        }
        this.debugLog(
          `Duplicate flashcards found in deck "${deckName}": "${cards[0].front}" (${cards.length} copies)`,
        );
      }
    }
  }

  /**
   * Update deck IDs for all flashcards when a deck ID changes (e.g., file rename)
   */
  async updateFlashcardDeckIds(
    oldDeckId: string,
    newDeckId: string,
  ): Promise<void> {
    this.debugLog(
      `Updating flashcard deck IDs from ${oldDeckId} to ${newDeckId}`,
    );
    await this.db.updateFlashcardDeckIds(oldDeckId, newDeckId);
  }
}
