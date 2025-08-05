# Obsidian Flashcards Plugin - Progress Summary

## ✅ Core Features Implemented
- SQLite database with sql.js for persistence
- FSRS-4.5 spaced repetition algorithm
- Deck management with file-based naming
- Header-paragraph and table flashcard parsing
- Review interface with difficulty ratings
- Real-time statistics and progress tracking
- Settings page with customizable parameters

## ✅ Database Schema
- `decks` table: id, name, tag, timestamps
- `flashcards` table: content, FSRS data, state, contentHash
- `review_logs` table: review history tracking
- Foreign key constraints and performance indexes

## ✅ Smart Sync System
- Content hash-based change detection (back content only)
- ID-based flashcard identification (front content hash)
- Learning progress preservation during file updates
- Unified sync logic for tag-based and name-based operations
- Selective updates: only changed content gets modified
- Automatic cleanup of removed flashcards

## ✅ FSRS Implementation
- Full FSRS-4.5 algorithm with optimized parameters
- Scientific memory modeling with stability/difficulty
- Dynamic interval calculation based on performance
- State transitions: new → learning → review
- Comprehensive review logging for analytics

## ✅ UI Components (Svelte)
- Deck list panel with real-time stats
- Flashcard review modal with smooth animations
- Settings interface with validation
- Progress indicators and completion feedback

## ✅ Key Enhancements
- File-based deck naming instead of tag parsing
- CSS injection system for proper styling
- Memory management and error handling
- Comprehensive test coverage (32 tests)
- TypeScript implementation with strict typing

## ✅ User Experience
- No learning progress lost during file edits
- Seamless content updates with change detection
- Real-time statistics updates during reviews
- Simplified settings with sensible defaults
- Consistent behavior across all sync methods

## ✅ Frontmatter Deck ID Integration
- Deck IDs automatically stored in markdown file frontmatter
- `flashcards-deck-id` field links files to database decks
- Preserves deck relationships when files are moved/renamed
- Existing frontmatter content preserved during updates
- Smart sync prioritizes frontmatter IDs over tag-based lookup

## 🔧 Technical Architecture
- **Database**: SQLite via sql.js with automatic persistence
- **Algorithm**: FSRS-4.5 with scientific parameter optimization
- **Sync**: Smart content-based diffing preserves learning data
- **UI**: Svelte components with reactive state management
- **Testing**: Jest with comprehensive mocking and coverage

## 📦 Files Structure
- `src/main.ts` - Plugin entry point and core logic
- `src/database/` - DatabaseService and type definitions
- `src/services/` - DeckManager with smart sync logic
- `src/algorithm/` - FSRS implementation
- `src/components/` - UI components (Svelte + Obsidian modal wrappers)
  - `DeckListPanel.svelte` - Main deck list with stats and controls
  - `FlashcardReviewModal.svelte` - Review session UI component
  - `FlashcardReviewModalWrapper.ts` - Obsidian modal wrapper for review
  - `DeckConfigUI.svelte` - Deck configuration form component
  - `DeckConfigModal.ts` - Obsidian modal wrapper for deck config
  - `ReviewHeatmap.svelte` - GitHub-style activity heatmap
  - `SettingsTab.ts` - Plugin settings interface
- `src/__tests__/` - Comprehensive test suite

## 🎯 Current Status
- **Fully functional** spaced repetition system
- **Production ready** with comprehensive testing
- **Learning progress preserved** across all operations
- **Optimized performance** with efficient algorithms
- **User-friendly** with intuitive interface and behavior
- **Persistent deck relationships** via frontmatter integration


## TODO

1. ✅ Update and Refresh Stats of the deck whenever the user reviews a flashcard
2. Create statistics page for each deck which shows retention percentage as graph,
3. ✅ Add a github style heatmap at the bottom left panel based on the reviews done per day
4. ✅ Filter button on the decks table, to filter decks by name or tag.
5. ✅ Background job that refreshes the side panel stats and data every 5 seconds
6. ✅ Create a configuration page for each deck, which is reached by clicking on a cog icon on the row of the deck list. This configuration page should configure for a particular deck, the number of flashcards to review per session.
7. ✅ Implement Anki-style daily limits for new cards and review cards with proper enforcement
8. ✅ Review order of flashcard should be similar to anki, it should follow this order:
  1. Learning Cards
  	•	Cards currently in a learning or relearning state.
  	•	These always come first to ensure timely repetition within their interval.
  	•	Includes cards you've failed or just learned.
  2. Review Cards (Mature/Due)
  	•	Cards that are due based on spaced repetition.
  	•	Shown after all learning cards.
  	•	Their order is controlled by the deck option "Review order":
  	•	Oldest due first (default)
  	•	Random
  	•	Relative overdueness
  3. New Cards
  	•	Cards never reviewed before.
  	•	Shown after learning and review cards.
  	•	Their order is set by the deck option “New card order”:
  	•	Order added (default, based on note ID)
  	•	Random
  	•	Due position

## ✅ Recent Enhancements

### Deck Configuration System
- Added per-deck configuration with session limits for granular control
- Implemented deck configuration modal accessible via cog icon in dedicated column
- Added database support for deck-specific settings with JSON storage
- Created modular Svelte UI component with reactive controls and validation
- Integrated Obsidian native modal system with Svelte component architecture
- Added automatic schema migration for existing databases
- Preserved backward compatibility with default configuration values
- Separated UI logic (Svelte) from modal management (Obsidian Modal class)
- **Enforced session limits**: Review sessions automatically stop when deck limit is reached
- Added session progress indicators and warnings in review interface
- Enhanced completion messages to show session limit enforcement

### Modal Architecture Refactoring
- Extracted FlashcardReviewModalWrapper to separate file for better organization
- Created DeckConfigModal as dedicated Obsidian modal wrapper for deck configuration
- Established pattern of Obsidian Modal + Svelte UI component architecture
- Improved code maintainability by separating modal lifecycle from UI logic
- Standardized modal wrapper pattern across all plugin modals

### Real-time Stats Updates
- Added efficient deck-specific stats refresh after each flashcard review
- Created `refreshDeckStats(deckId)` method for targeted updates
- Modified review flow to trigger stats refresh automatically
- Optimized performance by updating only the reviewed deck instead of all decks
- Maintained existing general refresh functionality for other operations

### Background Stats Refresh
- Implemented configurable background job to refresh deck stats automatically
- Default 5-second interval with user-configurable setting (1-60 seconds)
- **Invisible updates** - only changes stats numbers, no UI rebuilding
- **Change detection** - only updates stats that actually changed
- Added UI settings section with background refresh interval control
- Automatic restart of background job when settings change
- Proper cleanup on view close to prevent memory leaks
- Optimized performance with stats caching and minimal DOM updates

### Deck Filter Functionality
- Added real-time filter input field in deck list panel
- Case-insensitive search across both deck name and tag fields
- Reactive filtering that updates as user types
- Dual state management: preserves original deck list while showing filtered results
- Smart empty state handling for both no decks and no filtered results
- Integrated with existing deck refresh and stats update systems
- Clean UI following Obsidian design patterns

### GitHub-Style Review Heatmap
- Added interactive heatmap component showing review activity over past year
- GitHub-style design with 5 intensity levels based on daily review counts
- Positioned at bottom of deck list panel for easy visibility
- Real-time updates when reviews are completed
- Tooltips showing exact review counts and dates
- Responsive month and day labels for easy navigation
- Optimized performance with efficient date range queries
- Theme-aware styling for both light and dark modes
- Background refresh integration for automatic data updates
- Responsive design that adjusts weeks shown based on container width

### Unique Flashcard ID Generation
- Enhanced flashcard ID generation to include deck ID for vault-wide uniqueness
- Changed from `generateFlashcardId(frontText)` to `generateFlashcardId(frontText, deckId)`
- IDs now combine deck ID and front content: `${deckId}:${frontText}` for hashing
- Prevents ID collisions when same question appears in different decks
- Maintains backward compatibility with existing learning progress
- Updated comprehensive test coverage for new ID generation logic
- Ensures data integrity across all deck operations and file movements

### Simplified Deck Management
- Removed deck ID frontmatter logic from markdown files
- Eliminated `storeDeckIdInFile()` and `getDeckIdFromFile()` methods
- No longer modifies user's markdown files with plugin-specific metadata
- Cleaner file management without automatic frontmatter injection
- Simplified codebase with fewer file modification operations
- Deck identification now relies purely on tag-based system

### New Deck-File Relationship
- Changed from "1 Tag → 1 Deck" to "1 File → 1 Deck" relationship
- Each markdown file with flashcards tags becomes its own separate deck
- Multiple files can share the same tag but remain distinct decks
- Deck names display as file basenames (without .md extension) in UI
- Full file paths stored internally for unique identification
- Improved organization allowing fine-grained control per file
- Simplified sync logic treating each file independently

### Enhanced Deck Data Model
- Added `filepath` property to Deck interface for explicit file path storage
- Separated `name` (clean filename) from `filepath` (full path) for better organization
- Updated database schema to include `filepath` column with unique constraint
- Modified database methods: `getDeckByName` → `getDeckByFilepath` for accurate lookups
- Cleaner UI display using dedicated `name` field instead of path parsing
- Improved data integrity with explicit separation of concerns
- Updated all tests to reflect new data structure

### Automatic Deck Cleanup on File Deletion
- Added `deleteDeckByFilepath()` method to DatabaseService for removing decks by file path
- Enhanced `handleFileDelete()` to automatically remove both flashcards and deck when file is deleted
- Implemented proper cleanup to maintain database integrity when files are removed
- Added comprehensive tests for file deletion scenarios
- Database migration system ensures schema compatibility across updates
- Real-time deck list updates when files are deleted from vault
- Prevents orphaned decks from remaining after file deletion

### Anki-Style Daily Limits Implementation
- **Separate New & Review Card Limits**: Independent daily limits for new cards (default: 20) and review cards (default: 100)
- **Learning Cards Always Shown**: Learning/relearning cards bypass all limits following proven Anki behavior
- **Daily Progress Tracking**: `getDailyReviewCounts()` method tracks reviews by card type using review log analysis
- **Database-Level Enforcement**: Smart 3-query approach fetches cards respecting remaining daily allowance
- **Real-Time Limit Feedback**: Shows daily progress before review sessions and explains when limits are reached
- **Proper Daily Reset**: Limits reset at midnight for next day's allowance
- **Enhanced Configuration UI**: Clear sections for new vs review limits with helpful descriptions
- **Smart Deck Stats**: New/Due counts show remaining daily allowance when limits enabled
- **Complete Test Coverage**: 43 tests passing including new daily count functionality and NaN prevention
- **Backward Compatibility**: Automatic schema migration preserves existing data and settings

### Anki-Style Review Order Implementation
- **Proper Card Ordering**: Learning cards first, then review cards, then new cards (matches Anki exactly)
- **Review Order Options**: Configurable "Oldest due first" (default) or "Random order" for review cards
- **Learning Cards Priority**: Always shown first regardless of due date to ensure optimal learning progression
- **Within-State Sorting**: Learning and new cards by due date, review cards by user preference
- **Enhanced Configuration**: Added review order dropdown in deck settings with clear options
- **Database Schema Update**: Added `reviewOrder` field to deck config with proper migration
- **Comprehensive Testing**: New test coverage for review order functionality
- **User Experience**: Seamless review flow following proven Anki patterns for maximum learning efficiency

### Smart Deck Stats with Daily Limits Integration
- **Remaining Allowance Display**: New/Due counts show remaining daily cards when limits are enabled
- **Visual Limit Indicators**: Calendar emoji (📅) and border highlight when daily limits are active
- **Contextual Tooltips**: Hover tooltips explain whether counts represent total due cards or remaining daily allowance
- **Real-Time Updates**: Stats automatically reflect daily progress and remaining capacity
- **Enhanced User Awareness**: Clear distinction between unlimited and limited deck modes
- **Intelligent Calculation**: `getDeckStats()` respects daily limits: `min(totalDue, remainingAllowance)`
- **Bug Fix - NaN Prevention**: Added robust validation for zero/undefined limits to prevent NaN display
- **Input Validation**: UI ensures limit values are always valid numbers with proper fallbacks
- **Edge Case Handling**: Zero limits properly show 0 cards available instead of calculation errors
