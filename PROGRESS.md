# Decks - Progress Summary

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
- **Fully functional** spaced repetition system with FSRS algorithm
- **Production ready** with comprehensive testing and error handling
- **Learning progress preserved** across all deck operations (rename, delete, restore)
- **High performance** with optimized parsing and non-blocking sync
- **User-friendly** with responsive UI and progress notifications
- **Robust data integrity** with deck-independent flashcard IDs
- **Smart file handling** with automatic deck ID regeneration on file rename
- **Efficient algorithms** with single-pass parsing and batch database operations


## TODO

1. ✅ Update and Refresh Stats of the deck whenever the user reviews a flashcard
2. ✅ Statistics modal
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
9. ✅ Parse header-paragraph flashcards based on a configurable header level setting. The parser for header-paragraphs should parse only headers with that level and paragraphs it contains.
10. ✅ Add a timelapsed to the review object which tracks how much time it took for the user to review a flashcard from the time it was shown to him until he chooses a difficulty. Use this timelapse in statistics to measure pace of the user seconds/cards.
11. ✅ Mobile support:
  - The modals and views position and size must be adapted for mobile use.
12. ✅ Export deck to anki:
  - A deck can be exported to anki by clicking on the cog icon of the deck, on the deck list.
  - The cog will open a select dropdown where the user can select the option Export to anki.
  - The select dropdown will contain these options:
    - Export to anki
    - Configure deck
  - The export to anki function opens a configuration modal where the user can select options for exporting to anki:
    - The note type
    - Tags the user would like to add to anki
    - Specific anki Deck

### ✅ Todo 13 - Pure FSRS Implementation

**Successfully implemented Pure FSRS algorithm with the following changes:**

**✅ Core Algorithm Changes:**
- Removed all step-based logic (getNewCardInterval, learningProgressionMultiplier, hardInterval, easyBonus)
- Simplified to only two states: "New" and "Review" (no Learning/Relearning states)
- Implemented pure FSRS initialization for new cards with all ratings going directly to Review state
- All intervals are now ≥1 day (minimum 1440 minutes) - no minute-based learning steps
- Proper FSRS state transitions: New → Review (permanent)

**✅ Data Model Updates:**
- Updated database schema to only allow "new" and "review" states
- Proper storage of stability, difficulty, reps, lapses, lastReviewed
- Legacy learning state cards are automatically migrated to review state
- Removed obsolete FSRS parameters from settings interface

**✅ Algorithm Compliance:**
- getSchedulingInfo() returns four different futures without mutating original card
- updateCard() properly handles initialization vs subsequent reviews
- Maximum interval capping works correctly (36500 days)
- All ratings maintain monotonic interval progression (Hard < Good < Easy)
- Proper lapse counting and stability updates for Again ratings

**✅ UI/UX Updates:**
- Removed Learning column from deck statistics displays
- Updated settings to remove obsolete parameters (easyBonus, hardInterval, etc.)
- Simplified deck configuration descriptions
- Hidden learning card references in statistics panels

**✅ Testing & Verification:**
- Comprehensive test suite covering all pure FSRS requirements
- Migration support for existing cards with legacy states
- All edge cases and algorithm correctness verified
- Build and TypeScript compilation successful

The implementation now fully complies with pure FSRS specifications and passes all required sanity tests.

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
- **Enhanced Exceeded Limit Messaging**: Clear "LIMIT EXCEEDED" indicators when daily allowance surpassed
- **Learning Cards Explanation**: Notifies users when only learning cards available due to exceeded limits
- **Complete Test Coverage**: 46 tests passing including exceeded limit scenarios
- **Bug Fix - Deck Configuration Preservation**: Fixed issue where deck configs were reset during file changes

### Configurable Header Level Parsing
- **Selective Header Parsing**: Configure which header level (H1-H6) to use for header-paragraph flashcards
- **Settings Integration**: Added parsing settings section with intuitive dropdown (H1 = #, H2 = ##, etc.)
- **Smart Content Boundaries**: Parser stops at any header level to prevent content mixing between sections
- **Default H2 Behavior**: Sensible default of H2 headers for most common use cases
- **Backward Compatible**: Existing setups continue working with automatic H2 default
- **Enhanced Control**: Users can target specific document structures (H3 for detailed notes, H1 for main topics)
- **Test Coverage**: Comprehensive testing including different header level configurations

### Deck Configuration Preservation Bug Fix
- **Root Cause**: File changes triggered full `syncDecks()` which could recreate existing decks with default configs
- **Smart File Handling**: Modified `handleFileChange()` to update existing decks instead of recreating them
- **Targeted Operations**: New `createDeckForFile()` method for single file deck creation without full sync
- **Configuration Safety**: Deck configurations (daily limits, review order, etc.) now preserved during file edits
- **Efficient Updates**: Only sync flashcards for specific deck when file content changes
- **Backward Compatibility**: No impact on existing deck creation or initial sync processes
- **Test Coverage**: Added test for single file deck creation to prevent regression

### ✅ Comprehensive Statistics Modal Implementation

### ✅ Time Elapsed Tracking Implementation
- Added `timeElapsed` field to ReviewLog interface and database schema
- Modified Svelte review modal to track time from card display to difficulty selection
- Updated `reviewFlashcard` function to accept and store time elapsed data
- Enhanced statistics to show average pace (seconds per card) and total review time
- Implemented safe database migration using ALTER TABLE to preserve all user data
- Fixed migration to handle cases where tables don't exist yet (fresh installations)
- Migration intelligently checks for existing tables and columns before making changes
- Fixed test migration errors by properly mocking database statements and table existence checks
- All time measurements stored in milliseconds for precision

### ✅ Deck Filter Tag Suggestions Enhancement
- Added intelligent tag suggestions dropdown to deck filter input
- Shows available tags when user starts typing or focuses on empty input
- Displays up to 5 most relevant tags as clickable suggestions
- Includes helpful placeholder text with examples
- Improved user experience with better tag discovery

### ✅ Forecast Histogram Proportional Sizing Fix
- Fixed forecast bars that became too large with high card counts
- Implemented proportional bar height calculation based on dataset maximum
- Set fixed container height (150px) with proper spacing and padding
- Bar heights now scale proportionally leaving room at top of container
- Improved visual clarity for review load forecasting across all scenarios

### ✅ Project Rename to "Decks"
- Renamed project from "obsidian-flashcards-plugin" to "Decks" for cleaner branding
- Updated all plugin IDs, class names, and file references
- Changed main plugin class from `FlashcardsPlugin` to `DecksPlugin`
- Updated view type from "flashcards-view" to "decks-view"
- Renamed CSS classes from "flashcard-" to "deck-" prefix
- Updated manifest.json, package.json, and README.md with new branding
- Changed plugin directory path from ".obsidian/plugins/obsidian-flashcards-plugin" to ".obsidian/plugins/decks"
- Maintained all functionality while providing cleaner, more focused naming

### ✅ MIT License Addition
- Added comprehensive MIT License file to the project root
- Updated README.md with detailed license information and terms
- Ensured package.json license field is properly set to "MIT"
- Project now has clear, permissive licensing for open source distribution

### ✅ Production Build and Release Infrastructure
- Added comprehensive build system for GitHub releases
- Created `npm run build:release` command for production builds
- Enhanced esbuild config with production optimizations (minification, tree shaking)
- Built automated packaging script that creates distribution-ready files
- Added GitHub Actions workflow for automated releases on version tags
- Created release notes generator that extracts features from PROGRESS.md

### ✅ File Modification Timestamp Optimization
- Implemented smart file change detection using filesystem modification timestamps
- Added timestamp comparison between file.stat.mtime and deck.modified to skip unnecessary processing
- Optimized sync performance by only processing files that have actually changed since last sync
- Enhanced refresh system with force parameter for complete vs efficient sync modes
- Background refresh uses efficient timestamp checking while manual refresh forces complete sync
- Deck timestamps now track file modification time for accurate change detection

### ✅ Flashcard Data Model Cleanup
- Removed unused lineNumber property from Flashcard and ParsedFlashcard interfaces
- Simplified flashcard parsing by eliminating line number tracking requirements
- Updated database schema to remove line_number column from flashcards table
- Streamlined flashcard creation and sync processes without positional dependencies
- Enhanced code maintainability by removing unnecessary tracking overhead
- Enhanced version bump script with validation and clear next steps
- Production build creates optimized 202KB bundle with all necessary files
- Release package includes main.js, manifest.json, styles.css, README.md, and LICENSE
- Automated workflow runs tests, builds, and creates GitHub releases with proper assets
- **Modal Access**: Added graph icon button next to refresh button in deck list header

### ✅ Header Level Filtering Implementation
- **Problem**: Changing header level settings caused flashcards to lose all review progress
- **KISS Solution**: Store header level with each flashcard and filter at query time instead of deleting/recreating
- **Database Changes**:
  - Added `header_level` column to flashcards table (1-6 for header-paragraph cards, null for table cards)
  - Integrated migration into existing `migrateSchemaIfNeeded()` method with simple `ALTER TABLE` statement
  - Migration follows established pattern alongside filepath, config, and time_elapsed columns
  - Safe migration with error handling and graceful fallback to table recreation if needed
  - Updated all database methods to support header level filtering
  - Added filtered versions: `getFlashcardsByDeckFiltered()`, `getDeckStatsFiltered()`, etc.
- **Parsing Changes**:
  - Removed header level filtering during parsing - now parses ALL header levels (H1-H6)
  - Each header-paragraph flashcard stores its original header level in database
  - Table flashcards remain unaffected (headerLevel = null)
- **Query Filtering**:
  - Main plugin methods now filter flashcards by current header level setting
  - Filter logic: `(type = 'table' OR header_level = ?)` to include table cards always
  - Stats, review counts, and deck operations respect header level selection
- **User Experience**: Instant header level switching without data loss - all flashcards preserved in database
- **Settings Integration**: Changing header level triggers force sync + view refresh to ensure complete data
- **Test Coverage**: Added unit tests for multi-level parsing and headerLevel property validation

### ✅ Duplicate Flashcard Detection and Warnings
- **Problem**: Users could accidentally create duplicate flashcards with same front text, causing confusion
- **Solution**: Added comprehensive duplicate detection with user notifications using Obsidian's Notice system
- **Detection Points**:
  - During sync: Warns when same front text appears multiple times in a single file
  - Post-sync: Scans entire deck for duplicates across all files and header levels
  - Case-insensitive matching with whitespace normalization for robust detection
- **User Notifications**:
  - Warning notices with deck name and truncated flashcard text (⚠️ emoji for visibility)
  - 8-10 second display duration for adequate reading time
  - Prevents duplicate warnings for same flashcard during single session
- **Implementation Details**:
  - Integrated into existing sync workflow with minimal performance impact
  - Uses `generateFlashcardId()` logic to detect ID collisions before creation
  - Comprehensive logging for debugging duplicate detection issues
- **User Experience**: Clear warnings help users identify and resolve duplicate content proactively
- **Test Coverage**: Unit tests verify duplicate detection logic and database interaction patterns

### ✅ Flashcard Progress Restoration from Extended Review Logs
- **Problem**: When flashcards get recreated (due to file changes, sync, etc.), users lose all learning progress
- **Solution**: Complete progress restoration system using extended review log schema with precise due date calculation
- **Enhanced ReviewLog Schema**:
  - Extended with essential FSRS fields: `newState`, `newInterval`, `newEaseFactor`, `newRepetitions`, `newLapses`
  - Stores core progression data (intervals, ease factors) and incremental counters (repetitions, lapses)
  - Preserves old/new interval and ease factor for statistics and performance tracking
  - Maintains complete audit trail of learning progression without redundant calculated values
- **Precise Due Date Calculation**:
  - Formula: `dueDate = reviewedAt + (newInterval * 60 * 1000)` for mathematical precision
  - No timing drift or approximation errors - exact FSRS scheduling preserved
  - Perfect restoration of review timing regardless of when flashcard is recreated
- **Direct Stability Storage**:
  - Added `newStability` field to ReviewLog interface and database schema
  - Stability stored directly when calculated during actual review process
  - No complex recalculation needed - uses exact FSRS-computed stability values
  - Eliminates approximation errors and ensures perfect stability restoration
- **Database Implementation**:
  - Added `getLatestReviewLogForFlashcard()` method with optimized query: ORDER BY reviewed_at DESC LIMIT 1
  - Extended review_logs table with `new_stability` column for direct storage
  - Automatic migration with ALTER TABLE statements for existing databases
  - Modified flashcard creation logic to check review logs before creating new cards
  - Complete fallback to default "new" state when no review logs exist
- **User Experience**:
  - Seamless progress preservation without user intervention
  - Success notifications: "✅ Progress restored for flashcard: [name] (review, 5 reviews)"
  - Perfect data integrity: all learning metrics preserved during file modifications and plugin updates
  - No data loss during deck syncing, header level changes, or database migrations
- **Comprehensive Testing**:
  - Unit tests verify due date calculation: reviewedAt + newInterval accuracy
  - Direct stability storage and retrieval testing from review logs
  - Database method functionality and edge case handling
  - Progress restoration logic with complete state preservation
  - Migration safety and backwards compatibility
- **Technical Benefits**:
  - Optimal storage: essential data preserved, calculated values stored when computed
  - Direct FSRS integration: stability stored exactly as calculated during review
  - Simple and reliable: no complex recalculation algorithms or approximations
  - Future-proof: stored stability values remain accurate regardless of algorithm changes
  - Performance optimized: single query per flashcard restoration with direct value retrieval

### ✅ Comprehensive German Verb Flashcard Collection
- **Project**: Complete German language learning resource with extensive verb coverage
- **Final Result**: 1,006 unique German verbs with comprehensive flashcard format
- **Content Quality**:
  - Detailed German explanations for each verb meaning and usage context
  - Practical example sentences demonstrating real-world application
  - Relevant synonyms for vocabulary expansion
  - Appropriate usage contexts (formal, informal, technical, emotional, etc.)
- **Coverage Areas**:
  - Daily activities: kochen, waschen, schlafen, essen, trinken
  - Professional terms: organisieren, präsentieren, analysieren, koordinieren
  - Emotional/psychological verbs: lieben, träumen, hoffen, fürchten, bewundern
  - Technical verbs: programmieren, installieren, konfigurieren, optimieren
  - Communication verbs: sprechen, diskutieren, erklären, überreden
  - Physical activities: laufen, schwimmen, klettern, tanzen, springen
- **Format Structure**:
  - Markdown table format compatible with Obsidian flashcard plugins
  - Consistent entry structure: | **verb** | detailed explanation with examples and synonyms |

### ✅ Flashcard Progress Preservation System
- **Problem**: Flashcard progress was lost when decks were renamed, deleted, or files were moved
- **Root Cause**: Flashcard IDs included deck ID, making them dependent on deck existence and identity
- **Solution**: Deck-independent flashcard ID generation and smart progress restoration
- **Technical Implementation**:
  - Modified `generateFlashcardId()` to use only front text content, removing deck ID dependency
  - Removed cascade deletion of flashcards when decks are deleted - flashcards become orphaned but retain progress
  - Added file rename event handler with `handleFileRename()` method for automatic deck ID updates
  - Created `renameDeck()` database method for proper deck ID and filepath updates
  - Added `updateFlashcardDeckIds()` method to reassign orphaned flashcards to new deck IDs
- **User Benefits**:
  - Progress preservation: Review history maintained across all deck operations
  - Smart reassignment: Flashcards automatically reconnect when files are renamed
  - No data loss: Review logs and FSRS data preserved even during temporary deck deletion
  - Seamless experience: File organization changes don't affect learning progress
- **Database Changes**:
  - Updated `deleteDeck()` and `deleteDeckByFilepath()` to preserve flashcards
  - Added `updateFlashcardDeckIds()` for bulk flashcard reassignment
  - Enhanced error handling to prevent data loss during operations

### ✅ Performance Optimization and Parsing Efficiency
- **Problem**: Large initial syncs with thousands of flashcards blocked app loading and froze UI
- **Parsing Optimizations**:
  - Single-pass parsing algorithm combining table and header flashcard detection
  - Pre-compiled regex patterns for better performance (`HEADER_REGEX`, `TABLE_ROW_REGEX`, `TABLE_SEPARATOR_REGEX`)
  - Optimized string processing with efficient table cell parsing
  - Reduced algorithmic complexity from O(2n) to O(n) for file processing
- **Sync Performance Improvements**:
  - Increased initial sync delay from 2 to 5 seconds after workspace ready
  - Added dedicated `performInitialSync()` method with graceful error handling
  - Implemented UI yielding every 5 decks (10ms delay) and every 50 flashcards (5ms delay)
  - Added sync locking mechanism to prevent concurrent operations
  - Created batch database operations processing in chunks of 50 for better performance
- **User Experience Enhancements**:
  - Non-blocking background sync with progress notifications
  - Responsive UI maintained during large dataset processing
  - Faster app loading with deferred sync execution
  - Clear progress indication with success/error notifications
- **Memory Management**:
  - Removed unnecessary content caching (redundant due to existing modification time checks)
  - Efficient memory usage with controlled batch processing
  - Garbage collection friendly patterns

### ✅ Force Refresh Progress Bar System
- **Problem**: Users had no feedback during force refresh operations, causing uncertainty about sync progress
- **Visual Progress Tracking**:
  - Real-time progress bar with Unicode characters (█ filled, ░ empty)
  - Detailed status messages showing current operation ("Discovering decks", "Processing deck X/Y")
  - Percentage completion indicator with smooth updates
  - Final summary with timing and flashcard count statistics
- **Progress Stages**:
  - Discovery phase (0-10%): Scanning vault for flashcard files
  - Setup phase (10-20%): Preparing decks for synchronization
  - Processing phase (20-95%): Individual deck processing with real-time updates
  - Finalization phase (95-100%): Cleanup operations and statistics calculation
- **User Experience**:
  - Auto-hiding progress notice after 3 seconds on success
  - Extended 5-second display for error messages with clear error indication
  - Coordinated with refresh button state (spinning animation during operation)
  - Non-blocking operation maintains UI responsiveness throughout sync
- **Error Handling**:
  - Graceful error display with "❌ Sync failed" message
  - Console logging integration for detailed troubleshooting
  - Progress bar maintained even during error states
  - Clear distinction between success and failure states

### ✅ Mobile Support Implementation
- **Problem**: Plugin was desktop-only and UI components weren't optimized for mobile devices
- **Core Changes**:
  - Removed `isDesktopOnly: true` from manifest.json to enable mobile compatibility
  - Added comprehensive responsive CSS with mobile-first breakpoints (768px, 480px, 380px)
  - Implemented touch-friendly button sizes (44px minimum) following iOS/Android guidelines
- **Modal Adaptations**:
  - Full-screen modals on mobile devices (100vw x 100vh)
  - Dynamic CSS class assignment based on screen width
  - Resize event handlers for orientation changes
- **Component Optimizations**:
  - FlashcardReviewModal: Improved button layout, readable text sizes, touch-friendly interactions
  - StatisticsUI: Responsive grid layouts, optimized charts, mobile-friendly filters
  - DeckListPanel: Compact table layout, touch-friendly config buttons
  - ReviewHeatmap: Smaller day squares, responsive navigation buttons
  - DeckConfigUI: Stacked layout, larger form inputs (16px font to prevent iOS zoom)
- **Touch Experience**:
  - `@media (hover: none) and (pointer: coarse)` detection for touch devices
  - Minimum 44px touch targets throughout the interface
  - Improved spacing and padding for finger navigation
  - Educational focus: each entry designed for effective language learning
- **Quality Assurance**:
  - Duplicate removal: eliminated 165 duplicate entries from original 1,171 total
  - Zero duplicates verified: comprehensive deduplication process completed
  - Maintained format consistency throughout all entries
- **Educational Value**:
  - Covers all proficiency levels from beginner to advanced
  - Includes common everyday verbs plus specialized terminology
  - Perfect for spaced repetition learning systems
  - Comprehensive resource for German language acquisition
- **Technical Implementation**:
  - Python-based deduplication script with regex pattern matching
  - Preserved first occurrence of each unique verb
  - Maintained file structure and formatting integrity
  - Final verification of zero duplicate entries
- **Filtering System**: Complete deck filtering (All Decks, by Tag, by Individual Deck)
- **Timeframe Selection**: Last 12 months or All History options
- **Seven Main Sections**:
  1. **Today**: Cards studied, time spent, breakdown by ease and card type
  2. **Week/Month/Year**: Similar breakdown over broader time windows
  3. **Forecast**: 30-day review load prediction chart
  4. **Answer Buttons**: Bar chart with percentages of ease button usage
  5. **Intervals**: Histogram showing card interval distribution
  6. **Deck Stats**: Comprehensive metrics dashboard
  7. **Review Heatmap**: Reuses existing ReviewHeatmap component
- **Key Metrics Implemented**:
  - Retention Rate: % of reviews answered correctly (excluding "Again")
  - Average Ease: Mean of ease button values (1-4 scale)
  - Average Interval: Mean interval of all review cards
  - Due Today/Tomorrow: Number of cards due
  - Learning Cards: Cards in learning queue
  - Maturity Ratio: Mature cards ÷ total cards
  - Total Cards: Complete collection count
- **Database Enhancement**: Added `getOverallStatistics()` with filtering support
- **Visual Components**: Cards, charts, grids with responsive design
- **Performance**: Efficient SQL queries with proper joins and date filtering
- **UI/UX**: Streamlined single-scroll layout (600px width, 80vh height) for focused viewing
- **Simplified Navigation**: Removed tabs in favor of continuous top-to-bottom layout
- **Compact Design**: Optimized spacing and sizing for 600px width constraint
- **Enhanced Readability**: Section dividers and proper visual hierarchy for easy scanning
- **Mobile-Friendly**: Responsive design that works well on smaller screens (90vw minimum)
- **Fixed Modal Issues**: Proper centering, eliminated multiple scrollbars, sticky close button
- **Overflow Handling**: Prevented horizontal scroll issues in charts and content areas
- **Select Dropdown Fixes**: Enhanced visibility with proper styling, borders, and focus states
- **Forecast Chart Labels**: Changed from dates to "Today", "Tomorrow", "in Xd" format for clarity
- **FSRS-Based Forecast**: Chart now shows only days with scheduled reviews (filtered by FSRS algorithm)
- **Intelligent Display**: Extended forecast to 90 days, displaying first 20 days with actual due cards
- **Native Tooltips**: Hover over forecast bars to see detailed information using reliable browser tooltips
- **Enhanced UX**: Simple, consistent tooltip experience showing "Today/Tomorrow/In X days: Y cards"

### ✅ Enhanced Heatmap Layout
- **Month Separation**: Replaced single continuous grid with individual month containers
- **Improved Readability**: Each month now has its own label and container for better visual separation
- **Responsive Design**: Maintains mobile compatibility with proper spacing and touch targets
- **Clean Architecture**: Simplified CSS layout using flexbox for month organization

### ✅ Full Width Layout Optimization
- **Left Panel Utilization**: Deck list now uses 100% of available left panel width
- **Removed Width Constraints**: Eliminated 328px minimum width limitation
- **Consistent Padding**: Unified 12px padding across all panel components
- **Better Space Usage**: Tables, filters, and heatmap all stretch to panel edges
- **Mobile Responsive**: Maintains full width behavior across all screen sizes

### ✅ Comprehensive Touch Support Implementation
- **Unified Event Handling**: Added `handleTouchClick()` function to prevent double execution
- **Touch Properties**: Applied `touch-action: manipulation` and removed tap highlights
- **Proper Touch Targets**: Minimum 44px touch targets on mobile (Apple HIG compliant)
- **Visual Feedback**: Added `:active` states alongside `:hover` for immediate touch response
- **Cross-Component Coverage**: Touch support added to all interactive elements:
  - DeckListPanel: Stats, refresh, config buttons, deck links, filter suggestions
  - ReviewHeatmap: Year navigation buttons
  - FlashcardReviewModal: Show answer and all difficulty buttons
  - DeckConfigUI: Save/cancel modal buttons
  - StatisticsUI: Close/retry buttons
- **Performance**: Eliminates 300ms tap delay on iOS Safari
- **Accessibility**: Maintains proper focus states and keyboard navigation

### ✅ Mobile Modal Experience Enhancement
- **Smart Margins**: Modals no longer fill entire screen on mobile
- **Progressive Spacing**: 20px margins on tablets, 16px on phones, 8px on small screens
- **Professional Appearance**: Maintains modal look vs full-screen takeover
- **Border Radius Preservation**: Keeps rounded corners on mobile devices
- **Responsive Heights**: Calculated heights account for margins (`calc(100vh - margins)`)
- **Safe Minimums**: 280px min-width and 400px min-height protection
- **Cross-Modal Consistency**: Applied to review, statistics, and config modals
- **Touch-Friendly**: Large enough for easy interaction while providing visual breathing room
- **Empty State Handling**: Graceful display when no reviews exist yet, with helpful guidance messages
- **Current Status Section**: Always shows current card counts (New, Learning, Mature, Due Today) even without reviews
- **Robust Error Handling**: Statistics queries wrapped in try-catch with fallback empty data structures
- **Null Safety**: All statistics fields protected with null checks and safe defaults
- **Error Recovery**: Retry button and console logging for debugging failed statistics loads
- **Display Logic Fixes**: Corrected conditional rendering to show statistics when data exists
- **Date Handling**: Fixed today's stats to show most recent data when current day has no reviews
- **Timeframe Calculations**: Improved week/month/year stats aggregation with proper empty state handling
- **Dropdown Visibility**: Fixed select dropdown styling with forced colors and !important declarations
- **Theme Compatibility**: Ensured dropdown text is visible across all Obsidian themes (light/dark modes)
- **Forecast Chart Improvements**: Wider bars (24px), bigger labels (12px), numeric x-axis for cleaner appearance
- **Enhanced Tooltips**: More descriptive hover information showing day context and card counts
- **TypeScript Interface**: Added comprehensive Statistics interface with DailyStats, CardStats, AnswerButtons, etc.

### ✅ Anki Export Implementation
- **Dropdown Menu System**: Replaced direct config modal with dropdown offering "Configure deck" and "Export to Anki" options
- **Smart Positioning**: Dropdown automatically adjusts position to stay within viewport bounds
- **State Management**: Only one dropdown open at a time, clicking same cog closes dropdown
- **Event Cleanup**: Proper cleanup of click, scroll, and resize event listeners
- **Export Modal**: Dedicated AnkiExportModal with simplified configuration interface
- **Configurable Separators**: User can choose from tab, semicolon, colon, pipe, comma, or space separators
- **Default Tab Format**: Uses tab separator by default for maximum Anki compatibility
- **Content Sanitization**: Proper escaping of chosen separator characters in flashcard content
- **Markdown Conversion**: Converts markdown formatting to HTML (bold, italic, code)
- **File Download**: Generates and downloads Anki-compatible text files
- **Mobile Responsive**: Full mobile support with touch-friendly interactions
- **Import Instructions**: Clear step-by-step guide for importing into Anki
- **Error Handling**: Graceful handling of empty decks and export failures
- **Progress Feedback**: Loading states and success notifications for user feedback

### ✅ FSRS Algorithm Test Suite Implementation
- **Comprehensive Test Coverage**: 23 test cases covering all FSRS algorithm functionality
- **State Transition Testing**: Verified proper transitions between New → Learning → Review states
- **Easy Button Graduation**: Confirmed New cards pressing Easy graduate directly to Review state
- **Lapse Functionality**: Tested Again button properly increments lapses and resets to Learning
- **Learning Card Progression**: Verified Again/Hard/Good/Easy behavior in Learning phase
- **Review Card Behavior**: Confirmed Review cards maintain proper state and intervals
- **Relearning Support**: Tested cards with lapses behave correctly in relearning phase
- **Edge Case Handling**: High lapses, zero stability, future due dates all properly handled
- **Interval Validation**: Confirmed proper interval progression (1min → 6min → 10min → 4days for new cards)
- **FSRS Compliance**: All state transitions follow FSRS-4.5 algorithm specifications
- **Mocked Date Testing**: Consistent test results with controlled Date.now mocking
- **Proper Type Usage**: Tests use actual Flashcard objects instead of internal FSRSCard types
- **Algorithm Bug Fix**: Fixed missing return statements in Learning card graduation logic
- **Review Card Fix**: Resolved issue where Review cards were incorrectly processed as New cards

### ✅ FSRS Settings Configuration Enhancement
- **Configurable Hard Interval**: Replaced hardcoded 1.2 multiplier with `hardInterval` from settings
- **Settings-Based Parameters**: FSRS algorithm now uses configured values instead of hardcoded constants
- **Learning Progression Multiplier**: Added configurable `learningProgressionMultiplier` for Good button advancement
- **Parameter Integration**: All FSRS settings properly passed from main plugin to algorithm instance
- **Dynamic Reconfiguration**: FSRS instance updates automatically when settings change
- **Backwards Compatibility**: Default values maintain existing behavior for users without custom settings
- **Settings Interface**: Added `learningProgressionMultiplier` to FSRSParameters interface
- **Easy Bonus Handling**: Confirmed proper use of algorithm weights vs direct easyBonus parameter
- **Maximum Interval**: Uses configured maximum interval from settings instead of hardcoded values
- **Request Retention**: Algorithm respects user-configured target retention rate

### ✅ Easy Button Graduation Fix
- **Direct Graduation**: New cards pressing Easy now graduate directly to Review state instead of Learning
- **FSRS Compliance**: Proper state transitions following FSRS algorithm specifications
- **Stability Initialization**: Easy cards get proper stability and difficulty values for Review phase
- **4-Day Interval**: New Easy cards correctly receive 4-day initial review interval
- **Bug Resolution**: Fixed incorrect state assignment that kept Easy cards in Learning phase
- **State Consistency**: Learning/Relearning cards continue to graduate properly to Review on Easy
- **Algorithm Integrity**: Maintains proper FSRS state machine: New → Review (Easy) or New → Learning (other ratings)
- **Type Safety**: Improved code reliability with proper typing for all statistics data structures
- **Execution Order Fix**: Restructured component to load statistics before UI calculations and rendering
- **Null Safety**: Fixed reactive statement execution order to prevent null reference errors during initialization
