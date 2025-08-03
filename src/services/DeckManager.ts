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
            const deck: Omit<Deck, "created" | "modified"> = {
              id: this.generateDeckId(),
              name: deckName,
              tag: tag,
              lastReviewed: null,
            };
            console.log(`Creating new deck: "${deckName}" with tag: ${tag}`);
            await this.db.createDeck(deck);
            newDecksCreated++;
          } catch (error) {
            console.error(`Failed to create deck for tag ${tag}:`, error);
            // Continue with other decks instead of failing completely
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

    // Delete existing flashcards for files that will be re-parsed
    for (const file of files) {
      await this.db.deleteFlashcardsByFile(file.path);
    }

    // Parse and add flashcards from each file
    for (const file of files) {
      const parsedCards = await this.parseFlashcardsFromFile(file);

      for (const parsed of parsedCards) {
        const flashcard: Omit<Flashcard, "created" | "modified"> = {
          id: this.generateFlashcardId(parsed.front),
          deckId: deck.id,
          front: parsed.front,
          back: parsed.back,
          type: parsed.type,
          sourceFile: file.path,
          lineNumber: parsed.lineNumber,
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
   * Generate unique flashcard ID using hash of front text
   */
  private generateFlashcardId(frontText: string): string {
    // Simple hash function for generating ID from front text
    let hash = 0;
    for (let i = 0; i < frontText.length; i++) {
      const char = frontText.charCodeAt(i);
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

    if (!frontmatter || !frontmatter["flashcards-deck-id"]) {
      // Add deck ID to frontmatter
      const newContent = `---\nflashcards-deck-id: ${deckId}\n---\n\n${content}`;
      await this.vault.modify(file, newContent);
    }
  }

  /**
   * Get deck ID from file
   */
  getDeckIdFromFile(file: TFile): string | null {
    const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter;
    return frontmatter?.["flashcards-deck-id"] || null;
  }
}
