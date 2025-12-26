/**
 * Console API for Flashcards Plugin
 * Provides clean interface for using flashcards without UI dependencies
 * Reuses existing business logic services with console adapters
 */

export {
  ConsoleCore,
  type ConsoleOptions,
  type ReviewSession,
} from "./core/ConsoleCore";
export { FlashcardsCLI, runCLI, type CLIOptions } from "./index";
export {
  ConsoleDataAdapter,
  ConsoleVault,
  ConsoleMetadataCache,
  ConsoleNotice,
  type MockTFile,
  type MockCachedMetadata,
  type MockVault,
  type MockDataAdapter,
  type MockMetadataCache,
} from "./adapters/ConsoleAdapters";

// Re-export core types for convenience
export type {
  Deck,
  Flashcard,
  ReviewLog,
  DeckStats,
  FlashcardState,
  ReviewOrder,
  DeckConfig,
} from "../database/types";

export type { DecksSettings } from "../settings";

// Console-specific types
export interface ConsoleFlashcardsAPI {
  // Core initialization
  initialize(vaultPath: string, dataPath?: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Quick operations
  createDeckFromFile(filePath: string, name?: string): Promise<string>;
  reviewDeck(deckId: string): Promise<void>;
  syncAllDecks(): Promise<number>;

  // Statistics
  getOverallStats(): Promise<{
    totalDecks: number;
    totalCards: number;
    cardsReviewed: number;
    averageRetention: number;
  }>;
}

/**
 * Factory function for creating console flashcards instance
 * Uses existing services with console adapters
 */
export async function createFlashcardsConsole(
  vaultPath: string = process.cwd(),
  dataPath?: string
): Promise<any> {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const { ConsoleCore } = await import("./core/ConsoleCore");

  const resolvedDataPath = dataPath || `${vaultPath}/.flashcards`;

  const core = new ConsoleCore({
    dataPath: resolvedDataPath,
    vaultPath,
    debug: false,
  });

  await core.initialize({
    dataPath: resolvedDataPath,
    vaultPath,
  });

  return core;
}

/**
 * Usage examples for documentation
 */
export const examples = {
  /**
   * Basic usage example
   */
  basic: `
import { createFlashcardsConsole } from '@/console/console';

async function example() {
  // Initialize with current directory as vault
  const flashcards = await createFlashcardsConsole();

  // Create deck from markdown file (uses existing DeckSynchronizer)
  const deck = await flashcards.createDeckFromFile('notes.md', 'My Deck');

  // Sync flashcards (uses existing parsing and sync logic)
  await flashcards.syncDeck(deck.id);

  // Start review session (uses existing Scheduler)
  const session = await flashcards.startReviewSession(deck.id);

  // Get next card (uses existing FSRS algorithm)
  const card = await flashcards.getNextCard(deck.id);
  if (card) {
    // Review the card (uses existing rating system)
    await flashcards.reviewCard(card.id, 3); // Good rating
  }

  // Clean up
  await flashcards.close();
}
  `,

  /**
   * CLI usage example
   */
  cli: `
import { runCLI } from '@/console/console';

// Run interactive CLI
await runCLI({
  vaultPath: './my-notes',
  dataPath: './flashcards-data',
  debug: true
});

// Or from command line:
// node console.js --vault ./my-notes --data ./data --debug
  `,

  /**
   * Programmatic review session example
   */
  programmatic: `
import { createFlashcardsConsole } from '@/console/console';

async function autoReview() {
  const flashcards = await createFlashcardsConsole();

  // Get all decks
  const decks = await flashcards.getDecks();

  for (const deck of decks) {
    console.log(\`Reviewing deck: \${deck.name}\`);

    // Start review session
    await flashcards.startReviewSession(deck.id);

    // Review cards automatically
    let card;
    while ((card = await flashcards.getNextCard(deck.id))) {
      console.log(\`Q: \${card.front}\`);
      console.log(\`A: \${card.back}\`);

      // Auto-rate based on some logic
      const rating = Math.floor(Math.random() * 4) + 1;
      await flashcards.reviewCard(card.id, rating);
    }

    await flashcards.endReviewSession();
  }
}
  `,

  /**
   * Statistics and backup example
   */
  management: `
import { createFlashcardsConsole } from '@/console/console';

async function management() {
  const flashcards = await createFlashcardsConsole();

  // Get overall statistics
  const stats = await flashcards.getOverallStats();
  console.log(\`Total decks: \${stats.totalDecks}\`);
  console.log(\`Total cards: \${stats.totalCards}\`);

  // Create backup
  const backupFile = await flashcards.createBackup();
  console.log(\`Backup created: \${backupFile}\`);

  // List all backups
  const backups = await flashcards.listBackups();
  backups.forEach(backup => {
    console.log(\`\${backup.filename} - \${backup.created}\`);
  });
}
  `,
};

/**
 * Architecture Notes:
 *
 * This console interface reuses ALL existing business logic:
 * - DatabaseService: Database operations and CRUD
 * - DeckManager: Deck discovery and management
 * - DeckSynchronizer: File parsing and flashcard sync
 * - Scheduler: Review scheduling and FSRS algorithm
 * - StatisticsService: Analytics and statistics
 * - BackupService: Data backup and restore
 * - FlashcardParser: Markdown parsing (header/table formats)
 *
 * Only the UI-dependent parts are replaced:
 * - Obsidian Vault → ConsoleVault (file system operations)
 * - Obsidian MetadataCache → ConsoleMetadataCache (metadata parsing)
 * - Obsidian DataAdapter → ConsoleDataAdapter (file I/O)
 * - Obsidian Notice → ConsoleNotice (console logging)
 *
 * This ensures:
 * 1. No business logic duplication
 * 2. Same FSRS algorithm and scheduling
 * 3. Same file parsing and sync behavior
 * 4. Same database operations and migrations
 * 5. Minimal code changes to existing services
 * 6. Easy maintenance - fixes apply to both UI and console
 */
