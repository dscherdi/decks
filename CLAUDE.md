# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building

```bash
# Production build (outputs to dist/)
npm run build

# Development build (outputs to demo_vault/.obsidian/plugins/decks)
npm run build:dev

# Clean build artifacts
npm run clean

# Full release build (clean + build)
npm run build:release
```

### Testing

```bash
# Run all unit tests (excludes integration tests)
npm test
# or
npm run test:unit

# Run only integration tests (uses real SQL.js database)
npm run test:integration

# Run all tests (unit + integration)
npm run test:all
```

**Note:** Integration tests run serially (`maxWorkers: 1`) to avoid database conflicts and have longer timeouts (30s).

### Code Quality

```bash
# Lint TypeScript and Svelte files
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Type check Svelte components
npm run check
```

### Code Rules

- Avoid using "any" or "unknown" as types, use available types or create if necessary.
- Avoid casting if possible but when it's needed use proper defined types instead of defining the casting type on the spot.
- Css classes need to have the prefix decks-
- No excessive unnecessary comments. No comments that mention any prompt or plan. Minimal comments explaining functionality allowed.

### Obsidian Plugin Store Linting Rules

- **Logging**:
  - Prefer using the `Logger` class methods (`logger.debug()`, `logger.error()`) for unified logging across the plugin
  - When Logger is not available, only use `console.debug()`, `console.warn()`, and `console.error()`
  - Never use `console.log()` or `console.info()` - they are not allowed by Obsidian plugin store linter
- **Async Modal methods**: Modal and ItemView lifecycle methods (`onOpen()`, `onClose()`) must NOT be async. Wrap async operations in separate methods called from lifecycle methods with `.catch(console.error)`.
- **DOM manipulation**: Never use `innerHTML` or `outerHTML`. Use Obsidian's `createEl()`, `createDiv()`, `appendText()`, etc.
- **Style properties**: Never set `element.style.*` directly. Use CSS classes with `decks-` prefix and `addClass()`/`removeClass()`, or use `element.setCssProps()` for dynamic positioning.
- **UI headings**: Use `new Setting(containerEl).setName("...").setHeading()` instead of `containerEl.createEl("h2"|"h3", ...)`.
- **Deprecated methods**: Use `substring()` or `slice()` instead of deprecated `substr()`.
- **eslint-disable**: Never disable `@typescript-eslint/no-explicit-any` rule. Fix the underlying type issue instead.
- **Sentence case**: All UI text must use sentence case, not title case (e.g., "Review sessions" not "Review Sessions").
- **Node.js imports**: In test files, use `node:` protocol (e.g., `import from "node:fs"` not `import from "fs"`).

### Releasing

```bash
# Create a git tag (triggers automated GitHub Actions release)
git tag v1.2.3 && git push origin v1.2.3
```

GitHub Actions will automatically:

- Run all tests
- Build the plugin
- Generate release notes from `docs/PROGRESS.md`
- Create GitHub release with all dist/ files

## Architecture Overview

### Layered Architecture

The codebase follows a strict layered architecture with clear separation of concerns:

```
UI Layer (Svelte Components)
    ↓
Service Layer (TypeScript Business Logic)
    ↓
Database Layer (SQL.js with Main/Worker Variants)
    ↓
Storage Layer (Obsidian Vault)
```

### Key Architectural Patterns

1. **Factory Pattern**: `DatabaseFactory` creates either `MainDatabaseService` (runs in main thread) or `WorkerDatabaseService` (offloads to Web Worker) based on settings
2. **Abstract Base Class**: `BaseDatabaseService` contains 1,467 lines of shared business logic; concrete implementations only handle SQL execution
3. **Strategy Pattern**: FSRS algorithm encapsulated with profile-based parameters (STANDARD vs INTENSIVE)
4. **Worker Pattern**: Heavy parsing/sync operations can be offloaded to Web Workers for performance
5. **Service Injection**: Services created once in main.ts and injected into components via props (no DI framework)

## Database Architecture

### Dual Execution Modes

The database layer has two implementations that share the same business logic:

- **MainDatabaseService**: Runs SQL.js in main thread, direct database manipulation
- **WorkerDatabaseService**: Communicates with Web Worker via message passing, main thread handles I/O (loading db file, SQL.js assets), worker handles SQL execution

**Key Design Decision**: `BaseDatabaseService` contains ALL business logic (queries, row parsing, batch operations). Concrete implementations only provide:

- `executeSql()` / `querySql()` - execute SQL statements
- `initialize()` / `close()` / `save()` - lifecycle management
- `exportDatabaseToBuffer()` / `syncWithDisk()` - persistence

### Merge-Before-Save Synchronization

**Critical for multi-device sync**: Before saving the database to disk, the code checks if the disk file has been modified by another device. If so, it performs a SQL-based merge:

1. `ATTACH DATABASE` to mount the remote (disk) database
2. Review data: `INSERT OR IGNORE` (preserve all review history from both devices)
3. Cards/Decks: Conditional replace based on `modified` timestamp (keep newer version)
4. Export merged result back to disk

This enables users to sync via Dropbox/iCloud without losing data from either device.

**Implementation**: See `MainDatabaseService.syncWithDisk()` around line 200.

### Schema Management

- Current schema version: **v5** (tracked in `PRAGMA user_version`)
- Migration strategy: `CREATE TABLE *_new` → `INSERT SELECT` → `DROP/RENAME`
- Dynamic column detection via `PRAGMA table_info()` to handle missing columns
- Schema definitions in `src/database/schemas.ts`

### Database Tables

```sql
decks          -- Deck metadata, config (FSRS profile, daily limits), timestamps
flashcards     -- Card content, FSRS state (stability, difficulty), due dates
review_logs    -- Comprehensive review history (pre/post state, retrievability)
review_sessions -- Session tracking with goal/progress
```

## Service Layer

### DeckManager (`src/services/DeckManager.ts`)

**Responsibilities**: Vault scanning, deck discovery, flashcard parsing coordination, file→database synchronization

**Key Methods**:

- `scanVaultForDecks()`: Traverses vault to find files with `#flashcards` tags
- `syncFlashcardsForDeck()`: **Routing logic** - delegates to worker or main thread based on database type
- `generateDeckId()`: Deterministic ID generation based on filepath hash (ensures same deck = same ID across devices)

**Performance**: Checks file `mtime` vs `deck.modified` to skip unchanged files. Calls `yieldToUI()` to prevent blocking the main thread.

### Scheduler (`src/services/Scheduler.ts`)

**Responsibilities**: Card selection (due/new), FSRS algorithm application, session management, review logging

**Card Selection Logic**:

1. Check review quota → get due card (respects daily limits if enabled)
2. If no due cards, check new quota → get new card
3. Apply deck's `reviewOrder` (due-date or random)
4. Return null if quota exhausted

**Rating Flow** (`rate(cardId, rating)`):

1. Load card + deck config
2. Configure FSRS with deck's profile and retention target
3. Calculate new FSRS state (stability, difficulty, interval)
4. Create detailed `ReviewLog` with pre/post state, retrievability, elapsed days
5. Update session progress
6. Atomically update card state + create log

**Session Tracking**: `startReviewSession()` calculates `goalTotal` based on due cards (within session window) + new cards available + daily limits.

### FlashcardParser (`src/services/FlashcardParser.ts`)

**Static class** with single-pass parsing algorithm supporting two formats:

1. **Table-based**: Markdown tables with Front/Back columns
2. **Header-paragraph**: Headers (configurable level via deck config) with paragraph content as back

**Performance**: Pre-compiled regex patterns, single pass through content, skips frontmatter/title headers.

### FlashcardSynchronizer (`src/services/FlashcardSynchronizer.ts`)

**Centralized sync logic** usable in both main thread and worker.

**Sync Algorithm**:

1. Parse flashcards from file content
2. Load existing flashcards from database
3. Build operations list (CREATE/UPDATE/DELETE)
4. Execute batch operations for performance
5. Update deck timestamp

**Smart Restoration**: When recreating a deleted card (same ID), queries `review_logs` to restore previous FSRS state. This preserves learning progress when users delete/recreate cards.

## FSRS Algorithm

**Location**: `src/algorithm/fsrs.ts`

**Profile System**: Two hardcoded profiles (NOT user-editable):

- **STANDARD**: Default weights, max 36500 days interval
- **INTENSIVE**: Aggressive weights, shorter max intervals for intensive learning

Weights loaded from `src/algorithm/fsrs-weights.ts` (19 weights per profile).

**Core Flow**:

1. Convert rating label ("Again", "Hard", "Good", "Easy") → number (1-4)
2. If card is "New": use `initStability(rating)` and `initDifficulty(rating)`
3. Otherwise: calculate retrievability `R = (1 + elapsedDays / (9 * stability))^(-1)`
4. Update difficulty: `nextDifficulty(D, rating)`
5. Update stability: `forgettingStability(D, S, R)` if rating = 1, else `nextStability(D, S, R, rating)`
6. Calculate interval: `S * (R / requestRetention)^(1/DECAY)`, clamped to [minMinutes, maxIntervalDays * 1440]
7. Calculate due date: now + interval

**Validation**: Extensive checks for `isFinite()` and `> 0` to prevent NaN/Infinity propagation. Clamps difficulty to [1, 10].

## Flashcard Parsing & Synchronization Flow

```
1. User edits file with #flashcards tag
   ↓
2. DeckManager.syncFlashcardsForDeck(deckId, force)
   ↓
3. Check file.stat.mtime vs deck.modified (skip if unchanged)
   ↓
4. Read file content from vault
   ↓
5. ROUTING DECISION:
   if (WorkerDatabaseService):
     → db.syncFlashcardsForDeckWorker({deckId, fileContent, ...})
        → Worker: FlashcardParser.parseFlashcardsFromContent()
        → Worker: FlashcardSynchronizer.syncFlashcardsForDeck()
        → Worker: Execute batch SQL operations
   else (MainDatabaseService):
     → FlashcardParser.parseFlashcardsFromContent() (main thread)
     → FlashcardSynchronizer.syncFlashcardsForDeck() (main thread)
   ↓
6. Update deck.modified timestamp
   ↓
7. Check for duplicates (warning if found)
```

**Performance**: Worker offloading prevents main thread blocking on large decks (max 50,000 cards per deck).

## Svelte Components

### Component Hierarchy

```
DecksView (TypeScript wrapper, Obsidian ItemView)
    ↓ creates
DeckListPanel (Svelte)
    ↓ dispatches onDeckClick
FlashcardReviewModalWrapper (TypeScript, Obsidian Modal)
    ↓ creates
FlashcardReviewModal (Svelte)
```

### Service Injection Pattern

Services are created once in `main.ts` and injected into components via props:

```typescript
new DeckListPanel({
  target: container,
  props: {
    statisticsService,
    deckSynchronizer,
    db,
    app,
    onDeckClick: (deck) => this.openReviewModal(deck),
    ...
  }
})
```

No dependency injection framework - simple constructor/prop passing.

### Reactivity

Svelte's reactive declarations update UI automatically:

```typescript
$: progress = sessionProgress ? sessionProgress.progress : 0;
$: filteredDecks = filterDecks(allDecks, filterText);
```

Components load data in `onMount()` and use reactive assignments to trigger re-renders.

## Testing Architecture

### Test Organization

- **Unit tests**: `src/__tests__/**/*.test.ts` (excludes `integration/`)
- **Integration tests**: `src/__tests__/integration/**/*.test.ts`

### Mocking Strategy

**Unit Tests** (`jest.config.js`):

- Mock Obsidian API: `src/__mocks__/obsidian.ts`
- Mock SQL.js: `src/__mocks__/sql.js.ts` (in-memory fake implementation)
- Timeout: 10s

**Integration Tests** (`jest.integration.config.js`):

- Mock Obsidian API (still needed for vault operations)
- Use **real SQL.js** (no mock) for database operations
- Timeout: 30s
- Run serially (`maxWorkers: 1`) to avoid database conflicts
- Disabled cache for fresh state

### Running Individual Tests

```bash
# Run a specific test file
npm test -- src/__tests__/fsrs.test.ts

# Run tests matching a pattern
npm test -- --testNamePattern="FSRS algorithm"

# Run with coverage
npm test -- --coverage
```

## Important Patterns & Conventions

### ID Generation

**Deterministic hashing** enables consistent IDs across devices:

```typescript
// Deck IDs: hash of filepath
generateDeckId(filepath) → `deck_${hash.toString(36)}`

// Flashcard IDs: hash of front text
generateFlashcardId(frontText) → `card_${hash.toString(36)}`
```

### Timestamp Management

**ISO 8601 strings everywhere**: All timestamps (`created`, `modified`, `lastReviewed`, `dueDate`) use ISO strings for:

- Consistent SQL sorting: `ORDER BY due_date ASC`
- Easy parsing: `new Date(isoString)`
- No timezone confusion

```typescript
getCurrentTimestamp(): string {
  return new Date().toISOString();
}
```

### Configuration Hierarchy

```
Plugin Settings (from data.json)
  ↓
Deck Config (stored in database)
  ↓
FSRS Parameters (profile + requestRetention)
```

Deck config includes daily limits, review order, header level, and FSRS settings.

### Performance Optimizations

1. **UI Yielding**: `await yieldToUI()` in heavy loops to prevent main thread blocking
2. **Batch Operations**: `batchCreateFlashcards()`, `batchUpdateFlashcards()`, etc. for database efficiency
3. **Database Indexes**: On `deck_id`, `due_date`, `reviewed_at` for query optimization
4. **Worker Offloading**: Heavy parsing/sync operations can run in Web Worker
5. **File Modification Checks**: Skip unchanged files via `mtime` comparison

### Error Handling

**Graceful degradation**: Operations catch errors, log them, and either return defaults or fall back to alternative implementations.

**Worker fallback**: If worker operation fails, automatically fall back to main thread execution.

### Type Safety

- Strict TypeScript with `strictNullChecks` enabled
- Interfaces for all data structures (`Deck`, `Flashcard`, `ReviewLog`, `ReviewSession`)
- Type guards for union types
- Generic database query functions: `querySql<T>(sql, params, {asObject: true}): Promise<T[]>`

## Build System

### esbuild Configuration

**Two-stage build** (`esbuild.config.mjs`):

1. Build Web Worker bundle (`worker-entry.ts`) as IIFE, write to `database-worker.js`
2. Build main plugin bundle (`main.ts`) with Svelte plugin

**Development vs Production**:

- **Development**: Output to `demo_vault/.obsidian/plugins/decks` with inline sourcemaps
- **Production**: Output to `dist/` with minification, no sourcemaps

**Assets Copied**:

- `manifest.json`
- `sql-wasm.wasm` and `sql-wasm.js` (to `assets/`)
- `README.md` and `LICENSE`

**Svelte Integration**:

- Uses `esbuild-svelte` with `svelte-preprocess` for TypeScript support
- CSS extracted to `main.css`, then merged with `styles.css`
- Development mode enables Svelte dev mode features

### Release Contents

Each GitHub release includes:

- `main.js` (~238 KB) - bundled plugin code
- `styles.css` (~63 KB) - merged styles
- `manifest.json` - plugin manifest
- `database-worker.js` (~4 KB) - worker thread bundle
- `assets/sql-wasm.js` (~48 KB) - SQL.js JavaScript
- `assets/sql-wasm.wasm` (~644 KB) - WebAssembly binary
- `README.md` & `LICENSE`

**Total release size: ~1 MB**

## TypeScript Configuration

**Path Alias**: `@/*` maps to `src/*` (configured in `tsconfig.json`, `jest.config.js`, and `esbuild.config.mjs`)

**Target**: ES6 with ESNext modules, transpiles to ES2018 for plugin bundle

**Strict Mode**: `noImplicitAny` and `strictNullChecks` enabled

## Common Development Workflows

### Adding a New Service

1. Create service class in `src/services/`
2. Add constructor parameters for database and settings dependencies
3. Inject in `main.ts` during plugin initialization
4. Pass to components via props if needed
5. Write unit tests in `src/__tests__/`

### Modifying Database Schema

1. Update schema in `src/database/schemas.ts`
2. Increment schema version number
3. Add migration logic to handle existing databases
4. Test migration with integration tests
5. Verify backward compatibility

### Adding a New Svelte Component

1. Create `.svelte` file in `src/components/`
2. Define props with `export let` declarations
3. Import and use in parent component or TypeScript wrapper
4. Styles can be scoped in `<style>` block or use global classes
5. esbuild will automatically compile and bundle

### Debugging Worker Issues

1. Check `WorkerDatabaseService` message passing logic
2. Verify `worker-entry.ts` message handlers
3. Use `console.log` in worker (visible in DevTools console)
4. Test with `MainDatabaseService` to isolate worker-specific issues
5. Check `pendingRequests` Map for stuck operations

### Adding FSRS Tests

1. Use `src/__tests__/fsrs-*.test.ts` files for algorithm tests
2. Create test cards with known states
3. Simulate reviews with specific ratings
4. Assert expected stability, difficulty, intervals
5. Test edge cases (NaN, Infinity, negative values)
