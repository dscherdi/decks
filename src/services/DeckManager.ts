import { TFile, Vault, MetadataCache, CachedMetadata } from "obsidian";
import { Deck, Flashcard } from "../database/types";
import { DatabaseService } from "../database/DatabaseService";

export interface ParsedFlashcard {
  front: string;
  back: string;
  type: "header-paragraph" | "table";
  lineNumber: number;
}

export class DeckManager {
  private vault: Vault;
  private metadataCache: MetadataCache;
  private db: DatabaseService;
  private plugin: any; // FlashcardsPlugin reference for debug logging

  constructor(
    vault: Vault,
    metadataCache: MetadataCache,
    db: DatabaseService,
    plugin?: any,
  ) {
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.db = db;
    this.plugin = plugin;
  }

  private debugLog(message: string, ...args: any[]): void {
    if (this.plugin?.debugLog) {
      this.plugin.debugLog(message, ...args);
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
            const deck: Omit<Deck, "created" | "modified"> = {
              id: this.generateDeckId(filePath),
              name: deckName, // Store clean file name
              filepath: filePath, // Store full file path separately
              tag: tag,
              lastReviewed: null,
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
    } catch (error) {
      console.error("Error during deck sync:", error);
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Parse flashcards from a file
   */
  async parseFlashcardsFromFile(file: TFile): Promise<ParsedFlashcard[]> {
    const content = await this.vault.read(file);
    const lines = content.split("\n");
    const flashcards: ParsedFlashcard[] = [];

    // Check for table flashcards first
    const tableFlashcards = this.parseTableFlashcards(lines);
    flashcards.push(...tableFlashcards);

    // Then parse header+paragraph flashcards
    const headerFlashcards = this.parseHeaderParagraphFlashcards(lines);
    flashcards.push(...headerFlashcards);

    return flashcards;
  }

  /**
   * Parse table-based flashcards
   */
  private parseTableFlashcards(lines: string[]): ParsedFlashcard[] {
    const flashcards: ParsedFlashcard[] = [];
    let inTable = false;
    let tableStartLine = 0;
    let headerSeen = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check if this is a table row
      if (line.startsWith("|") && line.endsWith("|")) {
        if (!inTable) {
          inTable = true;
          tableStartLine = i;
          headerSeen = false;
        }

        // Skip the header row and separator row
        if (!headerSeen) {
          headerSeen = true;
          continue;
        }
        if (line.match(/^\|[\s-]+\|[\s-]+\|$/)) {
          continue;
        }

        // Parse table row
        const cells = line
          .split("|")
          .map((cell) => cell.trim())
          .filter((cell) => cell.length > 0);

        if (cells.length >= 2) {
          flashcards.push({
            front: cells[0],
            back: cells[1],
            type: "table",
            lineNumber: i + 1,
          });
        }
      } else {
        inTable = false;
      }
    }

    return flashcards;
  }

  /**
   * Parse header+paragraph flashcards
   */
  private parseHeaderParagraphFlashcards(lines: string[]): ParsedFlashcard[] {
    const flashcards: ParsedFlashcard[] = [];
    let currentHeader: { text: string; lineNumber: number } | null = null;
    let currentContent: string[] = [];
    let inFrontmatter = false;
    let skipNextParagraph = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip frontmatter
      if (i === 0 && line === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter && line === "---") {
        inFrontmatter = false;
        continue;
      }
      if (inFrontmatter) {
        continue;
      }

      // Check if this is a header
      if (line.match(/^#{1,6}\s+/)) {
        // Check if this is a title header (# at start with "Flashcards" in title)
        if (line.match(/^#\s+/) && line.toLowerCase().includes("flashcard")) {
          skipNextParagraph = true;
          currentHeader = null;
          currentContent = [];
          continue;
        }

        // Save previous flashcard if exists
        if (currentHeader && currentContent.length > 0) {
          const card = {
            front: currentHeader.text.replace(/^#{1,6}\s+/, ""),
            back: currentContent.join("\n").trim(),
            type: "header-paragraph" as const,
            lineNumber: currentHeader.lineNumber,
          };

          flashcards.push(card);
        }

        // Start new flashcard
        currentHeader = {
          text: line,
          lineNumber: i + 1,
        };
        currentContent = [];
        skipNextParagraph = false;
      } else if (skipNextParagraph) {
        // Skip lines after a title header until we hit another header or empty line
        if (line.trim() === "") {
          skipNextParagraph = false;
        }
      } else if (currentHeader) {
        // Skip empty lines at the beginning
        if (line.trim() === "" && currentContent.length === 0) {
          continue;
        }
        currentContent.push(line);
      }
    }

    // Don't forget the last flashcard
    if (currentHeader && currentContent.length > 0) {
      const card = {
        front: currentHeader.text.replace(/^#{1,6}\s+/, ""),
        back: currentContent.join("\n").trim(),
        type: "header-paragraph" as const,
        lineNumber: currentHeader.lineNumber,
      };

      flashcards.push(card);
    }

    return flashcards;
  }

  /**
   * Sync flashcards for a specific deck (file)
   */
  async syncFlashcardsForDeck(filePath: string): Promise<void> {
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

    // Parse flashcards from the file
    const parsedCards = await this.parseFlashcardsFromFile(file);
    this.debugLog(`Parsed ${parsedCards.length} flashcards from ${filePath}`);

    for (const parsed of parsedCards) {
      const flashcardId = this.generateFlashcardId(parsed.front, deck.id);
      const contentHash = this.generateContentHash(parsed.back);
      const existingCard = existingById.get(flashcardId);

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

      if (existingCard) {
        // Update if content has changed
        if (existingCard.contentHash !== contentHash) {
          this.debugLog(
            `Content changed, updating flashcard: ${parsed.front.substring(0, 30)}...`,
          );
          await this.db.updateFlashcard(existingCard.id, {
            front: parsed.front,
            back: parsed.back,
            type: parsed.type,
            contentHash: contentHash,
          });
        } else {
          this.debugLog(
            `No content change, skipping update: ${parsed.front.substring(0, 30)}...`,
          );
        }
      } else {
        // Create new flashcard
        const flashcard: Omit<Flashcard, "created" | "modified"> = {
          id: flashcardId,
          deckId: deck.id,
          front: parsed.front,
          back: parsed.back,
          type: parsed.type,
          sourceFile: file.path,
          lineNumber: parsed.lineNumber,
          contentHash: contentHash,
          state: "new",
          dueDate: new Date().toISOString(),
          interval: 0,
          repetitions: 0,
          easeFactor: 5.0, // FSRS initial difficulty
          stability: 2.5, // FSRS initial stability
          lapses: 0,
          lastReviewed: null,
        };

        this.debugLog(`Creating new flashcard: ${flashcard.front}`);
        await this.db.createFlashcard(flashcard);
      }
    }

    // Delete flashcards that are no longer in the file
    for (const [flashcardId, existingCard] of existingById) {
      if (!processedIds.has(flashcardId)) {
        this.debugLog(`Deleting flashcard: ${existingCard.front}`);
        await this.db.deleteFlashcard(existingCard.id);
      }
    }

    this.debugLog(`Flashcard sync completed for ${filePath}`);
  }

  /**
   * Sync flashcards for a specific deck by name (file path)
   */
  async syncFlashcardsForDeckByName(deckName: string): Promise<void> {
    // In the new system, deckName is actually the file path
    await this.syncFlashcardsForDeck(deckName);
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
  private extractDeckNameFromFiles(files: TFile[]): string {
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
  private generateDeckId(filepath?: string): string {
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
   * Generate unique flashcard ID using hash of front text and deck ID
   */
  private generateFlashcardId(frontText: string, deckId: string): string {
    // Combine front text and deck ID for uniqueness across vault
    const combined = `${deckId}:${frontText}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `card_${Math.abs(hash).toString(36)}`;
  }
}
