# Console Interface for Flashcards Plugin

This console interface provides access to all the core flashcard functionality without UI dependencies. It reuses the existing business logic services with minimal adapters.

## Architecture

### Reused Services
- **DatabaseService**: Database operations and CRUD
- **DeckManager**: Deck discovery and management  
- **DeckSynchronizer**: File parsing and flashcard sync
- **Scheduler**: Review scheduling and FSRS algorithm
- **StatisticsService**: Analytics and statistics
- **BackupService**: Data backup and restore
- **FlashcardParser**: Markdown parsing (header/table formats)

### Console Adapters
- **ConsoleVault**: Replaces Obsidian Vault with Node.js file operations
- **ConsoleMetadataCache**: Replaces Obsidian MetadataCache with custom parsing
- **ConsoleDataAdapter**: Replaces Obsidian DataAdapter with fs operations
- **ConsoleNotice**: Replaces Obsidian Notice with console logging

## Usage

### 1. Programmatic API

```typescript
import { createFlashcardsConsole } from './console/console';

async function example() {
  // Initialize
  const flashcards = await createFlashcardsConsole('./my-vault', './data');

  // Create deck from file
  const deck = await flashcards.createDeckFromFile('notes.md', 'My Deck');

  // Sync flashcards
  await flashcards.syncDeck(deck.id);

  // Review session
  const session = await flashcards.startReviewSession(deck.id);
  const card = await flashcards.getNextCard(deck.id);
  if (card) {
    await flashcards.reviewCard(card.id, 3); // Good rating
  }
  await flashcards.endReviewSession();

  // Clean up
  await flashcards.close();
}
```

### 2. Interactive CLI

```bash
# Run interactive CLI
node src/console/index.js --vault ./my-vault --debug

# Or use the example script
node src/console/example.js cli
```

### 3. Command Line

```bash
# Basic example - scan files and create deck
node src/console/example.js basic

# Programmatic review session
node src/console/example.js auto

# Interactive CLI
node src/console/example.js cli
```

## API Reference

### ConsoleCore

Main class that orchestrates all services:

```typescript
class ConsoleCore {
  // Initialization
  async initialize(options: ConsoleOptions): Promise<void>
  async close(): Promise<void>

  // Deck Management
  async getDecks(): Promise<Deck[]>
  async createDeckFromFile(filePath: string, name?: string, tag?: string): Promise<Deck>
  async syncDeck(deckId: string): Promise<void>
  async syncAllDecks(): Promise<{ totalDecks: number; totalFlashcards: number }>
  async deleteDeck(deckId: string): Promise<void>

  // Review System
  async startReviewSession(deckId: string, durationMinutes?: number): Promise<ReviewSession>
  async getNextCard(deckId: string): Promise<Flashcard | null>
  async reviewCard(flashcardId: string, rating: 1 | 2 | 3 | 4, timeMs?: number): Promise<Flashcard>
  async previewCard(flashcardId: string): Promise<SchedulingPreview>
  async endReviewSession(): Promise<void>

  // Statistics
  async getDeckStats(deckId: string): Promise<DeckStats>
  async getOverallStats(): Promise<OverallStats>
  async getReviewHistory(deckId?: string, limit?: number): Promise<ReviewLog[]>

  // Backup Management
  async createBackup(): Promise<string>
  async listBackups(): Promise<Array<{ filename: string; created: Date; size: number }>>
  async restoreBackup(filename: string): Promise<void>

  // Utilities
  async scanMarkdownFiles(directory?: string): Promise<Array<{ path: string; hasFlashcards: boolean }>>
}
```

### FlashcardsCLI

Interactive command-line interface:

```typescript
class FlashcardsCLI {
  constructor(options?: CLIOptions)
  async start(): Promise<void>
}

// Factory function
async function runCLI(options?: CLIOptions): Promise<void>
```

## Features

### ✅ Complete Business Logic Reuse
- Same FSRS algorithm and scheduling behavior
- Identical file parsing (header-paragraph and table formats)
- Same database operations and migrations
- Identical backup and statistics functionality

### ✅ File System Operations
- Scan vault for markdown files with flashcards
- Parse frontmatter and inline tags
- Handle file creation, modification, and deletion
- Support for folder-based organization

### ✅ Review System
- Full FSRS-4.5 spaced repetition algorithm
- Session management with progress tracking
- Card scheduling previews (Again/Hard/Good/Easy)
- Review history and statistics

### ✅ Data Management
- SQLite database with migrations
- Automatic backup creation and restore
- Progress preservation across operations
- Deck configuration per file

### ✅ Statistics and Analytics
- Deck-specific and overall statistics
- Review history tracking
- Maturity and retention calculations
- Performance metrics

## Examples

### Scan and Create Decks

```typescript
const flashcards = await createFlashcardsConsole();

// Find all markdown files with flashcards
const files = await flashcards.scanMarkdownFiles();
const flashcardFiles = files.filter(f => f.hasFlashcards);

// Create decks from files
for (const file of flashcardFiles) {
  const deck = await flashcards.createDeckFromFile(file.path);
  await flashcards.syncDeck(deck.id);
  console.log(`Created deck: ${deck.name}`);
}
```

### Automated Review Session

```typescript
const decks = await flashcards.getDecks();

for (const deck of decks) {
  await flashcards.startReviewSession(deck.id);
  
  let card;
  while ((card = await flashcards.getNextCard(deck.id))) {
    console.log(`Q: ${card.front}`);
    console.log(`A: ${card.back}`);
    
    // Rate based on some logic
    const rating = calculateRating(card);
    await flashcards.reviewCard(card.id, rating);
  }
  
  await flashcards.endReviewSession();
}
```

### Backup Management

```typescript
// Create backup
const backupFile = await flashcards.createBackup();
console.log(`Backup created: ${backupFile}`);

// List backups
const backups = await flashcards.listBackups();
backups.forEach(backup => {
  console.log(`${backup.filename} - ${backup.created}`);
});

// Restore backup
await flashcards.restoreBackup('backup-2024-01-01.db');
```

## Configuration

### Console Options

```typescript
interface ConsoleOptions {
  dataPath: string;      // Where to store database and backups
  vaultPath: string;     // Root directory to scan for markdown files
  settings?: Partial<DecksSettings>;  // Override default settings
  debug?: boolean;       // Enable debug logging
}
```

### CLI Options

```bash
node console.js [options]

Options:
  --vault, -v <path>   Vault directory (default: current)
  --data, -d <path>    Data directory (default: .flashcards)
  --debug              Enable debug logging
  --help, -h           Show help
```

## Benefits

### ✅ Zero Business Logic Duplication
All core functionality reuses existing services - no copied code to maintain.

### ✅ Same Behavior as UI
Identical FSRS scheduling, parsing, and database operations ensure consistency.

### ✅ Easy Maintenance
Bug fixes and improvements to core services automatically benefit console interface.

### ✅ Lightweight
Only adds minimal adapters - no heavy dependencies or UI frameworks.

### ✅ Scriptable
Enables automation, batch operations, and integration with other tools.

### ✅ Testing
Perfect for automated testing scenarios and CI/CD integration.