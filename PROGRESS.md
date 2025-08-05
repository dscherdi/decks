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
- Implemented automatic database migration for existing installations
- All time measurements stored in milliseconds for precision
- **Modal Access**: Added graph icon button next to refresh button in deck list header
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
- **Type Safety**: Improved code reliability with proper typing for all statistics data structures
- **Execution Order Fix**: Restructured component to load statistics before UI calculations and rendering
- **Null Safety**: Fixed reactive statement execution order to prevent null reference errors during initialization
