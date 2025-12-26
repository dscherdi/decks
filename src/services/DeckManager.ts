import { TFile, Vault, MetadataCache, Notice } from "obsidian";
import {
    type Deck,
    type Flashcard,
    DEFAULT_DECK_CONFIG,
} from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { yieldToUI } from "../utils/ui";
import { Logger, formatTime } from "../utils/logging";
import { FileFilter } from "../utils/fileFilter";
import { FlashcardParser, type ParsedFlashcard } from "./FlashcardParser";
import { ProgressTracker } from "../utils/progress";
import { generateDeckId } from "../utils/hash";
import DecksPlugin from "@/main";

// Maximum number of flashcards to process per deck for performance
const MAX_FLASHCARDS_PER_DECK = 50000;

export class DeckManager {
    private vault: Vault;
    private metadataCache: MetadataCache;
    private db: IDatabaseService;
    private plugin?: DecksPlugin;
    private logger?: Logger;
    private fileFilter: FileFilter;

    constructor(
        vault: Vault,
        metadataCache: MetadataCache,
        db: IDatabaseService,
        plugin?: DecksPlugin,
        folderSearchPath?: string
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
                plugin.app.vault.configDir
            );
        }
    }

    /**
     * Update the folder search path for filtering files
     */
    updateFolderSearchPath(folderSearchPath?: string): void {
        this.fileFilter.updateFolderSearchPath(folderSearchPath);
    }

    private debugLog(message: string, ...args: unknown[]): void {
        this.logger?.debug(message, ...args);
    }

    private performanceLog(message: string, ...args: unknown[]): void {
        this.logger?.performance(message, ...args);
    }

    /**
     * Scan vault for all decks (files with #flashcards tags)
     */
    scanVaultForDecks(): Map<string, TFile[]> {
        const decksMap = new Map<string, TFile[]>();
        let files = this.vault.getMarkdownFiles();

        // Filter files by folder search path if specified
        files = this.fileFilter.filterFiles(files);
        this.debugLog(`Filtered to ${files.length} files for scanning`);

        this.debugLog(
            `Scanning ${files.length} markdown files for flashcard tags`
        );

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
                    tag.startsWith("#") ? tag : `#${tag}`
                );
                allTags.push(...normalizedTags);
                this.debugLog(
                    `File ${file.path} has frontmatter tags:`,
                    normalizedTags
                );
            }

            if (allTags.length === 0) {
                continue;
            }

            // Look for #flashcards tags
            const flashcardTags = allTags.filter((tag) =>
                tag.startsWith("#flashcards")
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

        this.debugLog(
            `Found ${decksMap.size} decks:`,
            Array.from(decksMap.keys())
        );
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
                        existingDeck ? `YES (ID: ${existingDeck.id})` : "NO"
                    );

                    if (existingDeck) {
                        // Update existing deck if tag changed
                        if (existingDeck.tag !== tag) {
                            this.debugLog(
                                `Updating deck "${deckName}" tag from ${existingDeck.tag} to ${tag}`
                            );
                            await this.db.updateDeck(existingDeck.id, {
                                tag: tag,
                            });
                        } else {
                            this.debugLog(
                                `Deck "${deckName}" already exists with correct tag, no update needed`
                            );
                        }
                    } else {
                        // Create new deck for this file
                        const deck = {
                            id: generateDeckId(filePath),
                            name: deckName, // Store clean file name
                            filepath: filePath, // Store full file path separately
                            tag: tag,
                            lastReviewed: null,
                            config: DEFAULT_DECK_CONFIG,
                            created: new Date().toISOString(),
                            modified: new Date().toISOString(),
                        };
                        this.debugLog(
                            `Creating new deck: "${deckName}" with ID: ${generateDeckId(
                                filePath
                            )}, tag: ${tag}, filepath: ${filePath}`
                        );
                        this.db.createDeck(deck);
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
        headerLevel = 2
    ): Promise<ParsedFlashcard[]> {
        const parseStartTime = performance.now();

        // Read and parse content
        const content = await this.vault.read(file);
        const readTime = performance.now() - parseStartTime;

        const parseContentStartTime = performance.now();
        const flashcards = this.parseFlashcardsFromContent(
            content,
            headerLevel
        );
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
        headerLevel = 2
    ): ParsedFlashcard[] {
        return FlashcardParser.parseFlashcardsFromContent(content, headerLevel);
    }

    /**
     * Sync flashcards for a specific deck - now delegates to worker
     */
    async syncFlashcardsForDeck(
        deckId: string,
        force = false,
        progressTracker?: ProgressTracker
    ): Promise<void> {
        const deckSyncStartTime = performance.now();
        this.debugLog(`Syncing flashcards for deck ID: ${deckId}`);

        const deck = await this.db.getDeckById(deckId);
        if (!deck) {
            this.debugLog(`No deck found for ID: ${deckId}`);
            return;
        }
        this.debugLog(
            `Found deck ID: ${deck.id}, name: ${deck.name}, filepath: ${deck.filepath}`
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
                    `File ${deck.filepath} not modified since last sync, skipping`
                );
                return;
            }
        }
        this.debugLog(
            `File modified: ${fileModifiedTime.toISOString()}, last sync: ${
                deck.modified
            }`
        );

        // Read file content - this stays in DeckManager
        const fileContent = await this.vault.read(file);

        // Create progress callback from ProgressTracker
        const progressCallback = progressTracker
            ? (progress: number, message?: string) =>
                  progressTracker.update(message || "Processing...", progress)
            : undefined;

        // Use unified sync method - implementation handles worker vs main thread
        try {
            const result = await this.db.syncFlashcardsForDeck(
                {
                    deckId: deck.id,
                    deckName: deck.name,
                    deckFilepath: deck.filepath,
                    deckConfig: deck.config,
                    fileContent: fileContent,
                    force: force,
                },
                progressCallback
            );

            if (result.parsedCount > MAX_FLASHCARDS_PER_DECK) {
                this.debugLog(
                    `⚠️ Deck "${deck.name}" exceeds flashcard limit. ${
                        result.parsedCount - MAX_FLASHCARDS_PER_DECK
                    } flashcards will be skipped.`
                );
                if (this.plugin?.settings?.ui?.enableNotices) {
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

            // Check for duplicates after sync
            try {
                this.debugLog(`Checking for duplicates in deck: ${deck.name}`);
                await this.checkForDuplicatesInDeck(deck.id);
                this.debugLog(
                    `Duplicate check completed for deck: ${deck.name}`
                );
            } catch (error) {
                console.error(
                    `Failed to check duplicates for ${deck.name}:`,
                    error
                );
            }
        } catch (error) {
            console.error(`Sync failed for ${deck.name}:`, error);
            throw error;
        }

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
            const deck = {
                id: generateDeckId(filePath),
                name: deckName,
                filepath: filePath,
                tag: tag,
                lastReviewed: null,
                config: DEFAULT_DECK_CONFIG,
                created: new Date().toISOString(),
                modified: new Date().toISOString(),
            };

            this.debugLog(
                `Creating new deck: "${deckName}" with ID: ${generateDeckId(
                    filePath
                )}, tag: ${tag}, filepath: ${filePath}`
            );
            this.db.createDeck(deck);
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

        // Group flashcards by front text
        for (const card of existingFlashcards) {
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
                if (this.plugin?.settings?.ui?.enableNotices) {
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
}
