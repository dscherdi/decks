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

  constructor(vault: Vault, metadataCache: MetadataCache, db: DatabaseService) {
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.db = db;
  }

  /**
   * Scan vault for all decks (files with #flashcards tags)
   */
  async scanVaultForDecks(): Promise<Map<string, TFile[]>> {
    const decksMap = new Map<string, TFile[]>();
    const files = this.vault.getMarkdownFiles();

    for (const file of files) {
      const metadata = this.metadataCache.getFileCache(file);
      if (!metadata) {
        continue;
      }

      const allTags: string[] = [];

      // Check inline tags
      if (metadata.tags) {
        const inlineTags = metadata.tags.map((t) => t.tag);
        allTags.push(...inlineTags);
        console.log(`File ${file.path} has inline tags:`, inlineTags);
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
        console.log(`File ${file.path} has frontmatter tags:`, normalizedTags);
      }

      if (allTags.length === 0) {
        continue;
      }

      // Look for #flashcards tags
      const flashcardTags = allTags.filter((tag) =>
        tag.startsWith("#flashcards"),
      );

      for (const tag of flashcardTags) {
        if (!decksMap.has(tag)) {
          decksMap.set(tag, []);
        }
        decksMap.get(tag)!.push(file);
      }
    }

    console.log(`Found ${decksMap.size} decks:`, Array.from(decksMap.keys()));
    return decksMap;
  }

  /**
   * Sync decks with database
   */
  async syncDecks(): Promise<void> {
    try {
      console.log("Starting deck sync...");
      const decksMap = await this.scanVaultForDecks();
      const existingDecks = await this.db.getAllDecks();
      const existingTags = new Set(existingDecks.map((d) => d.tag));

      console.log(
        `Found ${decksMap.size} deck tags in vault, ${existingDecks.length} existing decks in database`,
      );

      // Add new decks
      let newDecksCreated = 0;
      for (const [tag, files] of decksMap) {
        if (!existingTags.has(tag)) {
          try {
            const deckName = this.extractDeckNameFromFiles(files);

            // Check if any file already has a deck ID in frontmatter
            let existingDeck = null;
            for (const file of files) {
              const deckId = this.getDeckIdFromFile(file);
              if (deckId) {
                existingDeck = await this.db.getDeckById(deckId);
                if (existingDeck) {
                  console.log(
                    `Found existing deck "${existingDeck.name}" with ID ${deckId} for tag ${tag}`,
                  );
                  break;
                }
              }
            }

            if (existingDeck) {
              // Update existing deck with new tag if needed
              if (existingDeck.tag !== tag) {
                console.log(
                  `Updating deck "${existingDeck.name}" tag from ${existingDeck.tag} to ${tag}`,
                );
                await this.db.updateDeck(existingDeck.id, {
                  tag: tag,
                  name: deckName,
                });
              }

              // Ensure all files have the deck ID in frontmatter
              for (const file of files) {
                await this.storeDeckIdInFile(file, existingDeck.id);
              }
            } else {
              // Create new deck
              const deck: Omit<Deck, "created" | "modified"> = {
                id: this.generateDeckId(),
                name: deckName,
                tag: tag,
                lastReviewed: null,
              };
              console.log(`Creating new deck: "${deckName}" with tag: ${tag}`);
              await this.db.createDeck(deck);

              // Add deck ID to frontmatter of all files
              for (const file of files) {
                await this.storeDeckIdInFile(file, deck.id);
              }

              newDecksCreated++;
            }
          } catch (error) {
            console.error(`Failed to create deck for tag ${tag}:`, error);
            // Continue with other decks instead of failing completely
          }
        } else {
          // Existing deck - ensure frontmatter is up to date
          const existingDeck = existingDecks.find((d) => d.tag === tag);
          if (existingDeck) {
            for (const file of files) {
              await this.storeDeckIdInFile(file, existingDeck.id);
            }
          }
        }
      }

      console.log(`Deck sync completed. Created ${newDecksCreated} new decks.`);
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
   * Sync flashcards for a specific deck
   */
  async syncFlashcardsForDeck(deckTag: string): Promise<void> {
    const deck = await this.db.getDeckByTag(deckTag);
    if (!deck) return;

    const decksMap = await this.scanVaultForDecks();
    const files = decksMap.get(deckTag) || [];

    // Get existing flashcards for this deck
    const existingFlashcards = await this.db.getFlashcardsByDeck(deck.id);
    const existingById = new Map<string, Flashcard>();
    existingFlashcards.forEach((card) => {
      existingById.set(card.id, card);
    });

    const processedIds = new Set<string>();

    // Parse and sync flashcards from each file
    for (const file of files) {
      const parsedCards = await this.parseFlashcardsFromFile(file);

      for (const parsed of parsedCards) {
        const flashcardId = this.generateFlashcardId(parsed.front, deck.id);
        const contentHash = this.generateContentHash(parsed.back);
        const existingCard = existingById.get(flashcardId);

        processedIds.add(flashcardId);

        if (existingCard) {
          // Update if content has changed
          if (existingCard.contentHash !== contentHash) {
            await this.db.updateFlashcard(existingCard.id, {
              front: parsed.front,
              back: parsed.back,
              type: parsed.type,
              contentHash: contentHash,
            });
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

          await this.db.createFlashcard(flashcard);
        }
      }
    }

    // Delete flashcards that are no longer in any file
    for (const [flashcardId, existingCard] of existingById) {
      if (!processedIds.has(flashcardId)) {
        await this.db.deleteFlashcard(existingCard.id);
      }
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
   * Sync flashcards for a specific deck by name
   */
  async syncFlashcardsForDeckByName(deckName: string): Promise<void> {
    const deck = await this.db.getDeckByName(deckName);
    if (!deck) return;

    // Find the file with matching basename
    const files = this.vault.getMarkdownFiles();
    const targetFile = files.find((file) => file.basename === deckName);
    if (!targetFile) return;

    // Get existing flashcards for this deck
    const existingFlashcards = await this.db.getFlashcardsByDeck(deck.id);
    const existingById = new Map<string, Flashcard>();
    existingFlashcards
      .filter((card) => card.sourceFile === targetFile.path)
      .forEach((card) => {
        existingById.set(card.id, card);
      });

    // Parse flashcards from the file
    const parsedCards = await this.parseFlashcardsFromFile(targetFile);
    const processedIds = new Set<string>();

    for (const parsed of parsedCards) {
      const flashcardId = this.generateFlashcardId(parsed.front, deck.id);
      const contentHash = this.generateContentHash(parsed.back);
      const existingCard = existingById.get(flashcardId);

      processedIds.add(flashcardId);

      if (existingCard) {
        // Update if content has changed
        if (existingCard.contentHash !== contentHash) {
          await this.db.updateFlashcard(existingCard.id, {
            front: parsed.front,
            back: parsed.back,
            type: parsed.type,
            contentHash: contentHash,
          });
        }
      } else {
        // Create new flashcard
        const flashcard: Omit<Flashcard, "created" | "modified"> = {
          id: flashcardId,
          deckId: deck.id,
          front: parsed.front,
          back: parsed.back,
          type: parsed.type,
          sourceFile: targetFile.path,
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

        await this.db.createFlashcard(flashcard);
      }
    }

    // Delete flashcards that are no longer in the file
    for (const [flashcardId, existingCard] of existingById) {
      if (!processedIds.has(flashcardId)) {
        await this.db.deleteFlashcard(existingCard.id);
      }
    }
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
   * Generate unique deck ID
   */
  private generateDeckId(): string {
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

  /**
   * Store deck ID in markdown file
   */
  async storeDeckIdInFile(file: TFile, deckId: string): Promise<void> {
    const content = await this.vault.read(file);
    const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter;

    // Skip if deck ID already exists and matches
    if (frontmatter?.["flashcards-deck-id"] === deckId) {
      return;
    }

    let newContent: string;

    if (content.startsWith("---\n")) {
      // File already has frontmatter, update it
      const endOfFrontmatter = content.indexOf("\n---\n", 4);
      if (endOfFrontmatter !== -1) {
        const frontmatterContent = content.slice(4, endOfFrontmatter);
        const bodyContent = content.slice(endOfFrontmatter + 5);

        // Add or update deck ID in existing frontmatter
        const lines = frontmatterContent.split("\n");
        let deckIdExists = false;

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("flashcards-deck-id:")) {
            lines[i] = `flashcards-deck-id: ${deckId}`;
            deckIdExists = true;
            break;
          }
        }

        if (!deckIdExists) {
          lines.push(`flashcards-deck-id: ${deckId}`);
        }

        newContent = `---\n${lines.join("\n")}\n---\n${bodyContent}`;
      } else {
        // Malformed frontmatter, add new frontmatter
        newContent = `---\nflashcards-deck-id: ${deckId}\n---\n\n${content}`;
      }
    } else {
      // No frontmatter exists, add new frontmatter
      newContent = `---\nflashcards-deck-id: ${deckId}\n---\n\n${content}`;
    }

    await this.vault.modify(file, newContent);
  }

  /**
   * Get deck ID from file
   */
  getDeckIdFromFile(file: TFile): string | null {
    const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter;
    return frontmatter?.["flashcards-deck-id"] || null;
  }
}
