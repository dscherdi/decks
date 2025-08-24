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


### ✅ TODO 14: FSRS with subday schedules

Do all of the following to support sub‑day intervals in your pure FSRS implementation.
	1.	Interval math

	•	Replace day-based function with minute-based:

private nextIntervalMinutes(stability: number): number {
  const k = Math.log(this.params.requestRetention) / Math.log(0.9); // < 0
  const minutes = stability * k * 1440; // may be < 1d
  const floor = this.params.minMinutes ?? 15;              // configurable, e.g., 10–30
  const cap   = (this.params.maximumInterval ?? 36500) * 1440;
  return Math.max(floor, Math.min(minutes, cap));
}

	•	Remove the ≥1‑day clamp and any Math.round inside scheduling logic. Round only for display.

	2.	Parameters

	•	Extend FSRSParameters:

export interface FSRSParameters {
  w: number[];
  requestRetention: number;   // (0,1)
  maximumInterval: number;    // days
  minMinutes: number;         // e.g., 15
}

	•	Validate on set: 0.5 ≤ requestRetention ≤ 0.99, w.length===17, minMinutes ≥ 1.

	3.	Elapsed time

	•	Keep fractional days; no rounding:

private getElapsedDays(last: Date, now: Date): number {
  return Math.max(0, (now.getTime() - last.getTime()) / 86400000);
}

	4.	Scheduling pipeline

	•	Preview:

private calculateScheduleForRating(card: FSRSCard, rating: number, now: Date): SchedulingCard {
  const updated = this.calculateUpdatedFsrsCard(card, rating, now); // updates S/D, reps, lapses, lastReview=now, state=Review
  const intervalMin = this.nextIntervalMinutes(updated.stability);
  return this.createSchedulingCard(intervalMin, updated, now);
}

	•	Update:
	•	Persist interval in minutes (float or int).
	•	Persist dueDate = now + intervalMinutes.
	•	Never reintroduce Learning/Relearning paths.

	5.	Storage schema

	•	Keep explicit FSRS fields; stop overloading:
	•	stability: number
	•	difficulty: number  // 1–10
	•	repetitions: number
	•	lapses: number
	•	lastReviewed: ISO string
	•	dueDate: ISO string
	•	interval: number    // minutes
	•	state: "new" | "review"
	•	✅ Removed easeFactor completely - now using only difficulty field for FSRS.

	6.	Initialization (first rating)

	•	Unchanged conceptually; output can be sub‑day:
	•	stability = initStability(r)
	•	difficulty = initDifficulty(r)
	•	reps=1
	•	lapses += (r===1)
	•	lastReview=now
	•	intervalMinutes = nextIntervalMinutes(stability)
	•	dueDate = now + intervalMinutes
	•	state="review"

	7.	UI/UX

	•	Deck counts: compute “Due” by dueDate <= now. No “Learn” bucket.
	•	Interval display already ok; ensure it prefers minutes/hours < 1 day.
	•	Show predicted intervals for the four buttons using getSchedulingInfo() with minute precision.

	8.	Queue/scheduler behavior

	•	Allow multiple appearances in the same day. The scheduling loop must check due items continuously or on user action; do not batch strictly by calendar day.
	•	Add per-session anti-thrash guard: never schedule below minMinutes. Optional soft limit on total appearances per day per card (e.g., ≤ 6) to avoid pathological loops.

	9.	Code removals

	•	Remove:
	•	Any >= 1440 graduation checks.
	•	Any minute-step logic (1m/6m/10m/4d).
	•	learningProgressionMultiplier, hardInterval, easyBonus, “graduating/easy interval” comments.
	•	Ensure FSRSState remains only "New" | "Review"; never set "Learning"/"Relearning".

	10.	Preview purity

	•	getSchedulingInfo() must not mutate stored cards. You already return a derived SchedulingCard; keep cloning and avoid side effects.

	11.	Rounding discipline

	•	Store canonical interval in minutes (integer). If you want exactness, store double and round for UI only.
	•	Never round stability/difficulty; store full precision.

	12.	Migration

	•	Existing cards:
	•	✅ Migration completed: easeFactor values copied to difficulty during schema migration.
	•	Keep stability if present. If missing, initialize on the next rating only; do not guess.
	•	Convert any day-based interval to minutes once, if you previously stored days.
	•	Backfill dueDate if null: now to force immediate review visibility.

	13.	Tests

	•	New card + Good:
	•	Produces interval ≥ minMinutes, < 1 day for low initial stability if weights are tuned; state becomes Review.
	•	Review + Again:
	•	Increments lapses, reduces stability via FSRS update, returns interval ≥ minMinutes and typically short (minutes/hours).
	•	Monotonic button order:
	•	For same state: Again < Hard < Good < Easy in minutes.
	•	Continuous-time correctness:
	•	With elapsedDays = 0.5, results differ from elapsedDays = 1.
	•	Cap and floor:
	•	Intervals never fall below minMinutes and never exceed maximumInterval*1440.

	14.	Optional tuning for sub‑day starts

	•	Lower w[0..3] (initial stability after first rating) to target first intervals in minutes/hours:
	•	Again/Hard/Good/Easy stabilities ≈ [20, 40, 120, 480] minutes ÷ 1440, adjusted by requestRetention.
	•	Raise requestRetention to 0.96–0.98 for tighter spacing near exams.

	15.	Defensive coding

	•	Guard invalid params; throw on w.length!==17 or requestRetention∉(0,1).
	•	Clamp difficulty to [1,10] after updates; you already do.

Implement items 1–15, then remove any leftover references to day floors or step-based scheduling.

### TODO 15: FSRS config profiles

Implement deck‑configuration profiles in FSRS settings. Produce TypeScript code and minimal schema changes. Enforce all constraints.

Scope
	•	Deck config FSRS section exposes:
	•	requestRetention: number in (0,1), default 0.90.
	•	profile: "INTENSIVE" | "STANDARD".
	•	Deck config FSRS section must NOT store FSRS weights, minMinutes, or maximumIntervalDays. These are hardcoded.
	•	Profiles:
  	•	INTENSIVE: pure FSRS from the first rating with fractional (minute) intervals all the way. Initial target intervals:
     	•	Again=1m, Hard=5m, Good=10m, Easy=40 min.
     	•	There are no steps; all spacing is FSRS‑driven with minute granularity thereafter.
  	•	STANDARD: pure FSRS, day‑based; minimum interval clamp = 1 day; no sub‑day outputs.

FSRS internals (hardcoded, not user‑editable)
	•	FSRS_WEIGHTS_STANDARD = FSRS‑4.5 weights.
	•	FSRS_WEIGHTS_SUBDAY: same as FSRS‑4.5 except w0..w3 set to match the intensive targets in days:
	•	w0 = 1/1440, w1 = 5/1440, w2 = 10/1440, w3 = 40/1440.
	•	Note: first‑interval minutes scale by k = ln(requestRetention)/ln(0.9). With requestRetention=0.90, k=1. If user changes requestRetention, first intervals scale by k.
	•	Global clamps (hardcoded):
	•	maximumIntervalDays = 36500.
	•	minMinutes_INTENSIVE = 1.
	•	minMinutes_STANDARD = 1440 (i.e., 1 day).

Scheduling rules (both profiles)
	•	States: "new" → first rating → "review" permanently. No Learning/Relearning.
	•	At each rating:
	•	Compute elapsedDays = max(0, (now - lastReviewedAt)/86_400_000).
	•	R = (1 + elapsedDays/(9*S))^(-1).
	•	Update difficulty and stability via FSRS‑4.5 equations (weights per profile’s hardcoded set).
	•	Compute next interval:

k = ln(requestRetention)/ln(0.9)
nextMinutes = clamp(minMinutes, maximumIntervalDays*1440, stability * k * 1440)


	•	dueAt = now + nextMinutes * 60_000.

	•	Profile differences:
	•	INTENSIVE: use FSRS_WEIGHTS_SUBDAY; minMinutes = 1.
	•	STANDARD: use FSRS_WEIGHTS_STANDARD; minMinutes = 1440.

Data model
	•	 DeckConfig.fsrs: { requestRetention: number, profile: "INTENSIVE"|"STANDARD" }.
	-    Reviewlog - store profile


API
	•	getDeckConfig(deckId) → DeckConfig.
	•	updateDeckConfig(deckId, { requestRetention?, profile? }) with validation; changing profile does not retro‑mutate existing card states.
	•	schedulePreview(cardId, now) returns four outcomes using the current deck’s profile rules, minute‑granularity.

Validation
	•	requestRetention ∈ (0.5, 0.995); clamp or reject outside.
	•	profile ∈ {"INTENSIVE","STANDARD"}.
	•	Ensure weights arrays have length 17; throw on misconfig.
	•	Clamp difficulty to [1,10], stability to ≥ 1e‑12.
	•	Store intervalMinutes as number; compute due by timestamp math (UTC). No calendar‑day buckets.

Precision policy
	•	All FSRS math uses IEEE‑754 doubles. No rounding inside logic. Round only in UI formatting.
	•	Keep stability, difficulty unrounded in storage.
	•	Intervals stored as minutes (float or int). Display rounding only.

Migration
	•	Drop any deck‑level storage for weights/min/max intervals.
	•	Existing "new" cards follow the profile’s initialization on next review.
	•	Existing "review" cards keep their FSRS state; switching profile only changes which hardcoded weights and minMinutes are used on subsequent reviews.
	•	Backfill profileSnapshot on next review.

Tests
	•	INTENSIVE:
    	•	New+Again ⇒ ~1m (≥1m floor).
    	•	New+Good ⇒ ~10m.
    	•	Subsequent reviews produce continuous minute/hour growth; no step logic is ever invoked.
	•	STANDARD:
    	•	New+Good ⇒ ≥1 day; sub‑day never produced.
    	•	Monotonicity per review: Again < Hard < Good < Easy for same card/time.
    	•	Changing requestRetention scales intervals by factor ln(rr)/ln(0.9); verify first‑interval scaling and subsequent growth.
    	•	Precision: after 100 updates, stability finite and positive; no unintended quantization.

#### Behaviour when the user changes profiles

Do this when a user switches profiles:
	1.	Persist the change

	•	Update deck config: profile, requestRetention, bump configVersion. No other fields.

	2.	Do not touch existing cards

	•	Do not reinitialize stability/difficulty.
	•	Do not rewrite dueAt or intervalMinutes.
	•	Do not rescale anything.

	3.	Apply new rules on the next review

	•	On each card’s next rating, use the new profile’s:
	•	weights (INTENSIVE=sub‑day w0..w3; STANDARD=FSRS‑4.5),
	•	minMinutes (INTENSIVE=1, STANDARD=1440),
	•	current requestRetention.
	•	Write profileSnapshot on the card to the new profile at that moment.
	•	Log the profile used in the review log row.

	4.	New cards after the switch

	•	Initialize with the new profile immediately.
	•	INTENSIVE: first intervals ~1m/5m/10m/40m (scaled by ln(rr)/ln(0.9)), minute granularity thereafter.
	•	STANDARD: first interval ≥1 day, day floor thereafter.

	5.	In‑flight edge cases

	•	If switching to STANDARD while some cards are due in <1 day, keep their current dueAt; the day floor applies only after you answer them.
	•	If switching to INTENSIVE while some cards are due in many days, keep dueAt; minute granularity applies only after the next answer.

	6.	Preview/UI

	•	Recompute button previews immediately using the new profile for all cards (without mutating storage).
	•	Deck “Due” counts remain based on stored dueAt; they won’t jump on profile change.

	7.	Auditing

	•	Insert a profile_changed system log with deckId, oldProfile, newProfile, oldRR, newRR, configVersion, timestamp.
	•	Include profile, requestRetention, and weightsVersion in each subsequent ReviewLog.

	8.	Safety/validation

	•	Validate profile ∈ {"INTENSIVE","STANDARD"} and 0.5 < requestRetention < 0.995.
	•	Scheduler must read profile and rr at rating time; never cache per‑session beyond a single compute call.

This preserves card history, avoids retroactive rewrites, and cleanly switches behavior at the next interaction.

### TODO 16: Proper Migration

Use schema versioning, run ordered migrations inside a transaction, and rebuild tables when removing fields.

Procedure:
	1.	Versioning

	•	Store current schema version with PRAGMA user_version.
	•	Bump it after each successful migration.

	2.	Apply-once migration runner

	•	Keep an ordered list {from,to,up}.
	•	Read PRAGMA user_version; run all up where from === currentVersion.
	•	Wrap the entire step in a single transaction; rollback on error; only then PRAGMA user_version = to.

	3.	Adding a column (cheap)

	•	ALTER TABLE table ADD COLUMN new_col TYPE DEFAULT <value>;
	•	Backfill if needed with UPDATE.

	4.	Dropping or changing a column (rebuild)

	•	Create a new table with the desired shape.
	•	Copy only the columns you keep/transform.
	•	Swap names; recreate indexes/constraints; drop the old table.
	•	Pattern:

BEGIN;
CREATE TABLE new_table( ...desired columns... );
INSERT INTO new_table (c1, c2, c3)
  SELECT c1, c2, transform(c_old) AS c2, c3 FROM old_table;
DROP TABLE old_table;
ALTER TABLE new_table RENAME TO old_table;
CREATE INDEX ...; -- recreate
COMMIT;



	5.	Foreign keys and integrity

	•	PRAGMA foreign_keys = OFF; before rebuild; ON; after.
	•	If you use them, also PRAGMA defer_foreign_keys = ON; inside the transaction.

	6.	Indices and triggers

	•	You must recreate them after rebuild; ALTER TABLE ... RENAME does not move them.

	7.	Vacuum (optional)

	•	After large rebuilds: VACUUM; to reclaim space.

	8.	Persistence

	•	In sql.js you must re-export the DB buffer after migration and persist it (IndexedDB or file).

Notes:
	•	sql.js has no WAL; transactions are still atomic within the in‑memory VM. Always export the DB bytes only after migrate() succeeds.
	•	For renames, SQLite supports ALTER TABLE t RENAME COLUMN old TO new in newer engines, but for maximum compatibility in sql.js, prefer rebuilds.
	•	Always recreate indexes and triggers after rebuilds.

### TODO 17: Database migration should be run one table at a time in a series of transactions

### ✅ TODO 18: During a review session, all cards reviewed that are due will not be shown in this session until the next session.

**COMPLETED** - Implemented dynamic card reloading during review sessions without session-based locking.

**Implementation Summary:**
- **Dynamic Card List Refresh**: After each card review, the system refreshes the available card list to check for newly due cards
- **No Session Locking**: Reviewed cards are removed from the current list but can reappear when they become due again
- **Real-Time Due Checking**: Cards that reach their due time during the session are automatically added back
- **Profile Support**: Works for both INTENSIVE (sub-day intervals) and STANDARD (1+ day intervals) profiles
- **Seamless Experience**: Session continues as long as cards are available, respecting daily limits

**Technical Changes:**
- Modified `FlashcardReviewModal.svelte` to refresh card list after each review
- Added `refreshCardList` prop to dynamically load newly due cards
- Updated `FlashcardReviewModalWrapper.ts` to pass card refresh function
- Enhanced session management to support continuous card flow without artificial session locks

**Behavior:**
- INTENSIVE: Cards with 1-10 minute intervals resurface in same session when due
- STANDARD: Cards with 1+ day intervals won't reappear same day (not due until next day)
- No "seen-this-session" filtering - purely time-based due checking


### ✅ TODO 19: Mature cards are flashcards that have an interval over 21 days.

**COMPLETED** - Implemented proper mature card classification based on interval length.

**Implementation Summary:**
- **Definition**: Mature cards are review cards with intervals > 21 days (30,240 minutes)
- **Database Query Update**: Modified `GET_CARD_STATS` to classify cards as new/review/mature based on interval
- **Type System**: Added `isCardMature()` and `getCardMaturityType()` utility functions
- **Statistics Enhancement**: Updated CardStats interface to distinguish between review and mature cards
- **UI Updates**: Enhanced StatisticsUI to show separate counts for New, Review, and Mature cards
- **Comprehensive Testing**: Added test suite with 12 test cases covering edge cases and real-world intervals

**Technical Changes:**
- Updated `schemas.ts`: Modified `GET_CARD_STATS` query to use `CASE WHEN f.interval > 30240` logic
- Updated `types.ts`: Added `review` field to `CardStats` interface and utility functions
- Updated `DatabaseService.ts`: Enhanced `getOverallStatistics()` to handle three card types
- Updated `StatisticsUI.svelte`: Added Review card display and fixed total/maturity calculations
- Added `mature-cards.test.ts`: Comprehensive test coverage for mature card classification

**Behavior:**
- **New Cards**: state = 'new' (regardless of interval)
- **Review Cards**: state = 'review' AND interval ≤ 21 days (30,240 minutes)
- **Mature Cards**: state = 'review' AND interval > 21 days (30,240 minutes)
- **Statistics**: Proper counts and maturity ratio calculation including all three categories

### ✅ TODO 20: Scheduler implementation

Unify the logic of a scheduler split in multiple components (FlashcardsReviewModal, Main.ts, DatabaseService.ts, fsrs.ts, etc) into a new component Scheduler.ts


Definition: a scheduler is the deterministic component that, given the current time and each card’s memory state, decides which card to show next and when each card will be shown again.

The pseudocode in this description are meant as a guide (it may be missing things), make sure to check with current implementation and adapt accordingly.


Core responsibilities
	•	Select next due card.
	•	Update card state from a rating (Again/Hard/Good/Easy).
	•	Compute the next review time (dueAt) and interval.
	•	Maintain invariants across profiles and options.
	•	Persist changes atomically and idempotently.

The current implementation implements these responsibilities in different components, we need to find them and unify them in a Scheduler component

Inputs
	•	Now (UTC timestamp).
	•	Card state: {state, stability, difficulty, repetitions, lapses, lastReviewedAt, dueAt, intervalMinutes, deckId, profileSnapshot}.
	•	Deck config: {requestRetention, profile}.
	•	FSRS parameters: weights for the chosen profile, maximumIntervalDays, minMinutes (hardcoded, not user-editable).
	•	User action: rating ∈ {1,2,3,4}.

Outputs
	•	Next card to present (or none).
	•	Updated card record after a rating.
	•	Review log entry.

Invariants
	•	Only two states: "new" and "review". First rating moves "new"→"review". Never demote.
	•	Intervals are minute-based; dueAt = lastReviewedAt + intervalMinutes.
	•	INTENSIVE profile allows sub-day intervals (minMinutes ≥ 1). STANDARD clamps to ≥ 1 day.
	•	Button order monotonic: Again < Hard < Good < Easy.
	•	No “session lockout”: a card can reappear in the same session when its dueAt arrives.

Queues
	•	Due queue: cards with dueAt <= now, ordered by dueAt ASC, then tie-breaker (e.g., oldest lastReviewedAt).
	•	Pending queue: empty by default; optionally for UI prefetch or filtered study modes.
	•	New queue: selection policy for unseen cards (respect daily new limits if you implement them).

Selection policy
	•	If any due cards exist: show the earliest dueAt.
	•	Else, if allowNew and new quota remains: pick next new card (deterministic ordering).
	•	Else: idle until next dueAt or end session.

Rating update
	•	Compute elapsedDays = max(0, (now - lastReviewedAt) / 86_400_000).
	•	Compute retrievability R = (1 + elapsedDays / (9 * stability))^(-1) (clamp stability > 0).
	•	Update difficulty:
d' = w7*w4 + (1-w7)*(d - w6*(rating-3)), clamp to [1,10].
	•	Update stability:
s' = s * (1 + exp(w8) * (11 - d') * s^(-w9) * (exp((1 - R) * w10) - 1) * hardPenalty(r) * easyBonus(r)), clamp > 0.
	•	Next interval (minutes):
k = ln(requestRetention)/ln(0.9),
minutes = clamp(minMinutes, maxDays*1440, s' * k * 1440).
	•	Persist:
	•	state="review"
	•	repetitions += 1
	•	lapses += (rating===1 ? 1 : 0)
	•	lastReviewedAt = now
	•	intervalMinutes = minutes
	•	dueAt = now + minutes*60_000
	•	profileSnapshot = deck.profile

Review logging (immutable)
	•	Store: cardId, reviewedAt, rating, elapsedDays, retrievability, old/new stability, old/new difficulty, old/new intervalMinutes, old/new dueAt, old/new repetitions, old/new lapses, old/new state, requestRetention, profile, weightsVersion, schedulerVersion.

Profile behavior
	•	INTENSIVE: use sub-day weights (w0..w3 encode first-interval targets like 1m/5m/10m/40m), minMinutes=1.
	•	STANDARD: use FSRS-4.5 weights, minMinutes=1440.
	•	Switching profiles affects only subsequent computations; do not mutate existing card fields immediately.

APIs
	•	getNext(now, deckId, options) → Card | null
	•	preview(cardId, now) → {again, hard, good, easy}: SchedulingCard (no mutations)
	•	rate(cardId, rating, now) → UpdatedCard (mutates, logs review)
	•	peekDue(now, deckId, limit) → Card[]
	•	timeToNext(now, deckId) → milliseconds | null

Pseudocode

function getNext(now: Date, deckId: string): Card | null {
  const due = db.select(`
    SELECT * FROM cards
    WHERE deckId=? AND dueAt <= ?
    ORDER BY dueAt ASC, lastReviewedAt ASC
    LIMIT 1
  `, [deckId, now.toISOString()]);
  if (due) return due;

  if (allowNew(deckId)) {
    return pickNextNew(deckId);
  }
  return null;
}

function rate(card: Card, rating: 1|2|3|4, now: Date): Card {
  const cfg = getDeckConfig(card.deckId);
  const prof = cfg.profile;
  const weights = (prof === "INTENSIVE") ? FSRS_WEIGHTS_SUBDAY : FSRS_WEIGHTS_STANDARD;
  const minMinutes = (prof === "INTENSIVE") ? 1 : 1440;
  const k = Math.log(cfg.requestRetention) / Math.log(0.9);

  const isNew = card.state === "new" || !isFinite(card.stability) || !isFinite(card.difficulty);
  const old = snapshot(card);

  let d = isNew ? initDifficulty(rating, weights) : card.difficulty;
  let s = isNew ? initStability(rating, weights)  : card.stability;

  const elapsedDays = isNew ? 0 : Math.max(0, (now.getTime() - new Date(card.lastReviewedAt).getTime()) / 86400000);
  const R = isNew ? 1 : retrievability(elapsedDays, s);

  d = clamp1to10(nextDifficulty(d, rating, weights));
  s = clampPos(nextStability(d, s, R, rating, weights));

  const minutes = Math.max(minMinutes, Math.min(s * k * 1440, 36500*1440));
  const dueAt = new Date(now.getTime() + minutes * 60000).toISOString();

  const updated = {
    ...card,
    state: "review",
    difficulty: d,
    stability: s,
    repetitions: (card.repetitions ?? 0) + 1,
    lapses: (card.lapses ?? 0) + (rating === 1 ? 1 : 0),
    lastReviewedAt: now.toISOString(),
    intervalMinutes: minutes,
    dueAt,
    profileSnapshot: prof
  };

  db.updateCard(updated);
  logReview(old, updated, { rating, elapsedDays, R, cfg, weightsVersion: version(weights) });

  return updated;
}

Concurrency and atomicity
	•	Wrap rate() mutations and review-log insert in a single transaction.
	•	On resume/focus, rebuild the due queue from timestamps; never rely on in-memory session flags.

Performance
	•	Index on (deckId, dueAt) for fast due selection.
	•	Keep a small in-memory buffer of the next N due cards; refresh after every rating.

Testing
	•	Determinism: given fixed time, config, and card state, outputs are stable.
	•	Monotonicity across ratings.
	•	Sub-day resurfacing works in INTENSIVE; not in STANDARD.
	•	No clock-dependent bugs across DST changes (UTC arithmetic only).

This is the scheduler contract and behavior your plugin should implement.

**✅ Implementation Complete:**
- Created unified `Scheduler.ts` component consolidating scattered scheduling logic
- Implemented core APIs: `getNext()`, `rate()`, `preview()`, `peekDue()`, `timeToNext()`
- Unified card selection logic from FlashcardReviewModal, Main.ts, and DatabaseService
- Added atomic transaction support for rating operations with review logging
- Maintains proper FSRS invariants and state transitions (new→review)
- Supports both INTENSIVE (sub-day) and STANDARD (daily+) profiles
- Deterministic card selection with proper due date ordering
- Database transaction wrapping ensures data consistency
- Comprehensive test suite validates all scheduler operations
- Updated main.ts to use scheduler for `reviewFlashcard()` and `schedulePreview()`
- Added `getFlashcardById()` method to DatabaseService for efficient card lookup
- Maintains backward compatibility with existing review and scheduling workflows


### ✅ TODO 21: Header level should be a deck-specific configuration

- Remove header level from general settings
- Add header level setting in deck specific configuration
- Ensure header level is read from deck configuration (default h2) persistent in database
- Header level should be removed from Flashcard interface and added to Deck interface and


### ✅ TODO 22: Progress bar fix

**IMPLEMENTED**: Unique-first progress tracking with session-based architecture.

**Key Features Implemented:**
- `ReviewSession` interface and database table with fields:
  - `id`, `deckId`, `startedAt`, `endedAt`, `goalTotal`, `doneUnique`
- Session-based progress calculation: `progress = doneUnique / goalTotal`
- Updated `ReviewLog` schema with optional `sessionId` field (no cascade delete)
- Scheduler manages active sessions internally for seamless integration
- Progress only increments on first review of a card per session
- Cards can reappear when due but don't affect progress after first answer

**Implementation Details:**
- **Database Schema v3**: Added `review_sessions` table and `session_id` to `review_logs`
- **Scheduler Enhanced**: 
  - `startReviewSession()`, `getSessionProgress()`, `endReviewSession()`
  - `getOrCreateActiveSession()` for automatic session management
  - Internal session tracking with `setCurrentSession()`
- **FlashcardReviewModal**: Session initialization on mount, real-time progress updates
- **Migration**: Automatic schema migration from v2 to v3 with backward compatibility

**Progress Behavior:**
- Goal calculated at session start: due cards + available new cards (respecting daily limits)
- First review of any card increments `doneUnique`
- Subsequent reviews of same card don't affect progress
- Progress bar shows: `(doneUnique / goalTotal) * 100`
- Display format: "Reviewed: X (Y remaining)"


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
  - Extended with essential FSRS fields: `newState`, `newInterval`, `newRepetitions`, `newLapses`, `newStability`
  - Stores core progression data (intervals, difficulty) and incremental counters (repetitions, lapses)
  - Preserves old/new interval and difficulty for statistics and performance tracking
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

### ✅ Dynamic Database Migration System
- **Column-Aware Migrations**: Migration system now checks existing table structure before copying data
- **Missing Column Handling**: Automatically provides sensible defaults for columns that don't exist in old schema
- **Dynamic SQL Generation**: Builds migration SQL based on actual table structure, not assumptions
- **Robust Error Prevention**: Eliminates "no such column" errors during schema upgrades
- **Smart Defaults**: FSRS-compliant fallback values for algorithm parameters
- **Universal Compatibility**: Works with any previous database version regardless of schema differences
- **Safe Data Transfer**: Preserves all existing data while adding new required columns
- **Future-Proof Design**: Handles schema evolution automatically without manual column mapping

### ✅ Database Schema Extraction and Migration System
- **SQL Query Centralization**: Extracted all 25+ SQL queries from DatabaseService into `schemas.ts` as named constants
- **Schema Separation**: Split into `CREATE_TABLES_SQL` (fresh databases) and `MIGRATE_TABLES_SQL` (existing databases)
- **File-Based Detection**: Database initialization now checks file existence instead of schema version
- **Clean Fresh Installs**: New databases use direct table creation without migration overhead
- **Recreate Migration Pattern**: Existing databases use CREATE → INSERT → DROP → RENAME for schema updates
- **Query Organization**: Categorized SQL constants by operation type (deck, flashcard, review log, statistics)
- **Type Safety**: All SQL queries properly typed and validated through constants
- **Maintainability**: Single source of truth for all database schema definitions
- **Performance**: Faster initialization for fresh databases with direct table creation
- **Reliability**: Simplified logic reduces edge cases and improves error handling

### ✅ Header Level as Deck-Specific Configuration & Schema Cleanup [L1361-1362]

### ✅ Complete CSS Refactoring with Decks Prefix [L1363-1364]
**Status:** ✅ Complete
**Branch:** main
**Files Modified:** 6 Svelte components + styles.css
**Description:**
Refactored all CSS classes throughout the project to use a `decks-` prefix for better isolation and to prevent conflicts with other plugins. This ensures that the plugin's styles won't interfere with other Obsidian plugins or themes.

**Key Changes:**
- **All CSS classes prefixed**: Added `decks-` prefix to every CSS class across all components
- **Component isolation**: Each component's styles are properly scoped with prefixed classes
- **Mobile compatibility**: All responsive styles updated with new prefixed classes
- **Global styles**: Main `styles.css` updated with new class names
- **Build verification**: Project builds successfully with no errors after refactoring

**Files Updated:**
- `styles.css` - Main stylesheet with prefixed classes
- `DeckListPanel.svelte` - All CSS classes prefixed (deck-list-panel → decks-deck-list-panel)
- `FlashcardReviewModal.svelte` - All CSS classes prefixed (review-modal → decks-review-modal)
- `ReviewHeatmap.svelte` - All CSS classes prefixed (heatmap-container → decks-heatmap-container)
- `StatisticsUI.svelte` - All CSS classes prefixed (statistics-container → decks-statistics-container)
- `DeckConfigUI.svelte` - All CSS classes prefixed (deck-config-ui → decks-deck-config-ui)
- `AnkiExportUI.svelte` - All CSS classes prefixed (anki-export-ui → decks-anki-export-ui)

**Examples of transformations:**
- `.stats-button` → `.decks-stats-button`
- `.difficulty-button` → `.decks-difficulty-button`
- `.forecast-chart` → `.decks-forecast-chart`
- `.heatmap-header` → `.decks-heatmap-header`
- `.modal-actions` → `.decks-modal-actions`

**Technical Benefits:**
- Complete CSS isolation from other plugins
- Maintains all existing functionality and responsive design
- No performance impact - purely structural change
- Future-proof against CSS conflicts
- Better maintainability with consistent naming convention

This refactoring ensures the plugin can coexist cleanly with any other Obsidian plugins without CSS interference while maintaining all desktop and mobile functionality.
- **Removed Header Level from Global Settings**: Moved parsing header level from plugin settings to individual deck configurations
- **Deck-Specific Header Level**: Each deck can now have its own header level (H1-H6) independent of other decks
- **Removed Header Level Column from Flashcards**: Eliminated `header_level` column from flashcards table - no longer needed in database schema
- **Parse-Time Filtering**: Changed from parse-all-then-filter to parse-only-required-level approach for better performance
- **Automatic Flashcard Cleanup**: When header level changes in deck config, automatically deletes old flashcards and creates new ones
- **Consistent Flashcard IDs**: Header symbols (`#`) are stripped during ID generation to ensure same content gets same ID across header levels
- **Force Resync on Config Change**: Deck configuration changes trigger immediate resync to clean up incompatible flashcards
- **Cleaner DeckConfig Interface**: Simplified config structure with `newCardsPerDay`/`reviewCardsPerDay` (0 = unlimited) instead of boolean + limit pairs
- **Utility Functions**: Added `hasNewCardsLimit()` and `hasReviewCardsLimit()` helper functions for cleaner code
- **Backward Compatibility**: Migration logic handles old config formats automatically during database upgrades
- **Updated All Components**: Fixed all TypeScript files, Svelte components, and test files to use new config structure
- **Preserved User Progress**: Flashcard progress is maintained when changing header levels if content matches

Showing symbols 1-67 (total symbols: 67)
