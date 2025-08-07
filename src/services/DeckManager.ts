import { TFile, Vault, MetadataCache, CachedMetadata, Notice } from "obsidian";
import { Deck, Flashcard, DEFAULT_DECK_CONFIG } from "../database/types";
import { DatabaseService } from "../database/DatabaseService";
import DecksPlugin from "@/main";

export interface ParsedFlashcard {
  front: string;
  back: string;
  type: "header-paragraph" | "table";
  headerLevel?: number; // Header level (1-6) for header-paragraph cards, null for table cards
}

export class DeckManager {
  private vault: Vault;
  private metadataCache: MetadataCache;
  private db: DatabaseService;
  private plugin: DecksPlugin | undefined; // Plugin reference for debug logging

  // Pre-compiled regex patterns for better performance
  private static readonly HEADER_REGEX = /^(#{1,6})\s+/;
  private static readonly TABLE_ROW_REGEX = /^\|.*\|$/;
  private static readonly TABLE_SEPARATOR_REGEX = /^\|[\s-]+\|[\s-]+\|$/;

  constructor(
    vault: Vault,
    metadataCache: MetadataCache,
    db: DatabaseService,
    plugin?: DecksPlugin,
  ) {
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.db = db;
    this.plugin = plugin;
  }

  /**
   * Helper method for timing operations
   */
  private formatTime(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(2)}ms`;
    } else {
      return `${(ms / 1000).toFixed(2)}s`;
    }
  }

  private debugLog(message: string, ...args: any[]): void {
    if (this.plugin?.debugLog) {
      this.plugin.debugLog(message, ...args);
    }
  }

  private performanceLog(message: string, ...args: any[]): void {
    if (this.plugin?.performanceLog) {
      this.plugin.performanceLog(message, ...args);
    }
  }

  /**
   * Scan vault for all decks (files with #flashcards tags)
   */
  async scanVaultForDecks(): Promise<Map<string, TFile[]>> {
    const decksMap = new Map<string, TFile[]>();
    const files = this.vault.getMarkdownFiles();
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
        `Deck sync completed successfully in ${this.formatTime(syncDecksTime)} (${newDecksCreated} created, ${deletedDecks} deleted)`,
      );
    } catch (error) {
      console.error("Error during deck sync:", error);
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Parse flashcards from a file
   */
  async parseFlashcardsFromFile(file: TFile): Promise<ParsedFlashcard[]> {
    const parseStartTime = performance.now();

    // Read and parse content
    const content = await this.vault.read(file);
    const readTime = performance.now() - parseStartTime;

    const parseContentStartTime = performance.now();
    const flashcards = this.parseFlashcardsFromContent(content);
    const parseTime = performance.now() - parseContentStartTime;

    const totalTime = performance.now() - parseStartTime;

    this.performanceLog(
      `Parsed ${flashcards.length} flashcards from ${file.path} in ${this.formatTime(totalTime)} (read: ${this.formatTime(readTime)}, parse: ${this.formatTime(parseTime)})`,
    );

    return flashcards;
  }

  /**
   * Parse flashcards from content string (optimized single-pass parsing)
   */
  private parseFlashcardsFromContent(content: string): ParsedFlashcard[] {
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
            front: cells[0],
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
            );
            currentHeader = null;
            currentContent = [];
            continue;
          }

          // Finalize previous header
          this.finalizeCurrentHeader(currentHeader, currentContent, flashcards);

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
    this.finalizeCurrentHeader(currentHeader, currentContent, flashcards);

    return flashcards;
  }

  /**
   * Helper to finalize current header flashcard
   */
  private finalizeCurrentHeader(
    currentHeader: { text: string; level: number } | null,
    currentContent: string[],
    flashcards: ParsedFlashcard[],
  ): void {
    if (currentHeader && currentContent.length > 0) {
      flashcards.push({
        front: currentHeader.text.replace(/^#{1,6}\s+/, ""),
        back: currentContent.join("\n").trim(),
        type: "header-paragraph",
        headerLevel: currentHeader.level,
      });
    }
  }

  /**
   * Execute batch database operations for better performance
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
    const BATCH_SIZE = 50;
    let createCount = 0;
    let updateCount = 0;
    let deleteCount = 0;

    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      const chunk = operations.slice(i, i + BATCH_SIZE);
      const chunkStartTime = performance.now();

      // Execute chunk operations
      for (const op of chunk) {
        try {
          switch (op.type) {
            case "create":
              if (op.flashcard) {
                await this.db.createFlashcard(op.flashcard);
                createCount++;
              }
              break;
            case "update":
              if (op.flashcardId && op.updates) {
                await this.db.updateFlashcard(op.flashcardId, op.updates);
                updateCount++;
              }
              break;
            case "delete":
              if (op.flashcardId) {
                await this.db.deleteFlashcard(op.flashcardId);
                deleteCount++;
              }
              break;
          }
        } catch (error) {
          console.error(`Failed to execute ${op.type} operation:`, error);
          // Continue with other operations
        }
      }

      const chunkTime = performance.now() - chunkStartTime;
      this.performanceLog(
        `Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} operations in ${this.formatTime(chunkTime)}`,
      );

      // Yield control between chunks
      if (i + BATCH_SIZE < operations.length) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    const totalBatchTime = performance.now() - batchStartTime;
    this.performanceLog(
      `Batch operations completed in ${this.formatTime(totalBatchTime)} (${createCount} created, ${updateCount} updated, ${deleteCount} deleted)`,
    );
  }

  /**
   * Sync flashcards for a specific deck (file)
   */
  async syncFlashcardsForDeck(
    filePath: string,
    force: boolean = false,
  ): Promise<void> {
    const deckSyncStartTime = performance.now();
    this.debugLog(`Syncing flashcards for deck: ${filePath}`);

    const deck = await this.db.getDeckByFilepath(filePath);
    if (!deck) {
      this.debugLog(`No deck found for filepath: ${filePath}`);
      return;
    }
    this.debugLog(
      `Found deck ID: ${deck.id}, name: ${deck.name}, filepath: ${deck.filepath}`,
    );

    const file = this.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    // Get file modification time
    const fileModifiedTime = new Date(file.stat.mtime);

    // Check if file has been modified since last deck update (unless forced)
    if (!force) {
      const deckModifiedTime = new Date(deck.modified);
      if (fileModifiedTime <= deckModifiedTime) {
        this.debugLog(
          `File ${filePath} not modified since last sync, skipping`,
        );
        return;
      }
    }
    this.debugLog(
      `File modified: ${fileModifiedTime.toISOString()}, last sync: ${deck.modified}`,
    );

    // Get existing flashcards for this deck
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

    // Parse flashcards from the file
    const parsedCards = await this.parseFlashcardsFromFile(file);
    this.debugLog(`Parsed ${parsedCards.length} flashcards from ${filePath}`);

    // Batch operations for better performance
    const batchOperations: Array<{
      type: "create" | "update" | "delete";
      flashcardId?: string;
      flashcard?: Omit<Flashcard, "created" | "modified">;
      updates?: any;
    }> = [];

    // Process flashcards in chunks to avoid blocking UI with large datasets
    for (let i = 0; i < parsedCards.length; i++) {
      const parsed = parsedCards[i];
      const flashcardId = this.generateFlashcardId(parsed.front);
      const contentHash = this.generateContentHash(parsed.back);
      const existingCard = existingById.get(flashcardId);

      // Check for duplicate front text within the same parsing session
      if (processedIds.has(flashcardId)) {
        const duplicateKey = `${deck.name}:${parsed.front}`;
        if (!duplicateWarnings.has(duplicateKey)) {
          new Notice(
            `⚠️ Duplicate flashcard detected in "${deck.name}": "${parsed.front.substring(0, 50)}${parsed.front.length > 50 ? "..." : ""}". Only the first occurrence will be used.`,
            8000,
          );
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
      this.debugLog(`Content hash: ${contentHash}`);
      this.debugLog(`Existing card found:`, existingCard ? "YES" : "NO");

      if (existingCard) {
        this.debugLog(
          `Existing card - ID: ${existingCard.id}, Front: "${existingCard.front.substring(0, 30)}...", Hash: ${existingCard.contentHash}`,
        );
      }

      processedIds.add(flashcardId);

      // Yield control every 50 flashcards to keep UI responsive
      if (i % 50 === 49) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

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
          headerLevel: parsed.headerLevel,
          // Restore progress from review logs or use defaults
          state: previousProgress?.state || "new",
          dueDate: previousProgress?.dueDate || new Date().toISOString(),
          interval: previousProgress?.interval || 0,
          repetitions: previousProgress?.repetitions || 0,
          easeFactor: previousProgress?.easeFactor || 5.0, // FSRS initial difficulty
          stability: previousProgress?.stability || 2.5, // FSRS initial stability
          lapses: previousProgress?.lapses || 0,
          lastReviewed: previousProgress?.lastReviewed || null,
        };

        if (previousProgress) {
          this.debugLog(
            `Restoring flashcard progress from review logs: ${flashcard.front} (state: ${previousProgress.state}, interval: ${previousProgress.interval})`,
          );

          // Notify user that progress was restored
          new Notice(
            `✅ Progress restored for flashcard: "${parsed.front.substring(0, 40)}${parsed.front.length > 40 ? "..." : ""}" (${previousProgress.state}, ${previousProgress.repetitions} reviews)`,
            5000,
          );
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
    }

    // Update deck's modified timestamp to match file modification time
    const timestampStartTime = performance.now();
    await this.db.updateDeckTimestamp(deck.id, fileModifiedTime.toISOString());
    await this.checkForDuplicatesInDeck(deck.id);
    const timestampTime = performance.now() - timestampStartTime;

    const totalDeckSyncTime = performance.now() - deckSyncStartTime;
    this.performanceLog(
      `Sync completed for deck: ${deck.name} in ${this.formatTime(totalDeckSyncTime)} (${parsedCards.length} flashcards, ${batchOperations.length} operations, cleanup: ${this.formatTime(timestampTime)})`,
    );
  }

  /**
   * Sync flashcards for a specific deck by name (file path)
   */
  async syncFlashcardsForDeckByName(deckName: string): Promise<void> {
    // In the new system, deckName is actually the file path
    await this.syncFlashcardsForDeck(deckName);
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
        new Notice(
          `⚠️ Found ${cards.length} duplicate flashcards in "${deckName}": "${cards[0].front.substring(0, 50)}${cards[0].front.length > 50 ? "..." : ""}". Consider removing duplicates to avoid confusion.`,
          10000,
        );
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
