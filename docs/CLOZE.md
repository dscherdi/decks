# Cloze Deletions

## Overview

Cloze deletions use Obsidian's native `==highlight==` syntax. Each highlighted phrase in a paragraph becomes a separate flashcard where that text is blanked out during review. Cloze is enabled by default on new profiles.

## How It Works

### Parsing

- The parser scans for `==text==` patterns in card content (header-paragraph and table formats)
- Each match generates a separate flashcard with `type: "cloze"`
- Cards share the same `front` (the header) and `back` (the full paragraph with all `==` markers intact)
- Each card has a unique `clozeText` (the hidden word/phrase) and `clozeOrder` (0-based position)
- Card IDs use a `ccard_` prefix, hashed from front + clozeText + clozeOrder + deckId
- When no `==` markers exist in a paragraph, a normal card is created even with cloze enabled
- Reverse cards are not generated for cloze type cards

### Review Flow

1. When a cloze card is due, the scheduler fetches its siblings (other cloze cards with the same front that are also due or new)
2. All siblings are grouped and reviewed sequentially as a "cloze group"
3. A "Cloze 1/N" indicator shows progress through the group
4. For each card in the group:
   - **Show Answer** reveals the back with the active cloze shown as `[...]` (accent-colored, clickable)
   - The user **taps the blank** to reveal the answer text
   - The user rates the card (Again/Hard/Good/Easy)
   - Each cloze card is rated independently with its own FSRS scheduling state

### Context Modes

Controlled per-profile via "Cloze context" setting:

- **Hidden** (default): All non-active clozes also show as `[...]` (neutral gray). The active blank is visually distinct with an accent-colored background.
- **Open**: Non-active clozes show their text in muted italic. Only the active cloze is blanked.

### Rendering

Cloze rendering uses Obsidian's `registerMarkdownPostProcessor` API. The flow:

1. Before rendering, data attributes are set on the back container: `data-decks-cloze-index` (which cloze to blank), `data-decks-cloze-mode` (open/hidden), `data-decks-cloze-revealed` (false until tapped)
2. Obsidian's markdown renderer converts `==text==` to `<mark>` tags
3. The post-processor counts `<mark>` elements and transforms them based on position:
   - Active cloze (matching index) -> `decks-cloze-active` (clickable blank) or `decks-cloze-revealed`
   - Non-active in hidden mode -> `decks-cloze-blank` (neutral blank)
   - Non-active in open mode -> `decks-cloze-context` (muted text)

### Database

- Flashcard table columns: `cloze_text TEXT`, `cloze_order INTEGER`
- Profile table columns: `cloze_enabled INTEGER DEFAULT 1`, `cloze_show_context TEXT DEFAULT 'hidden'`
- The sync update and migrate operations preserve `type`, `cloze_text`, and `cloze_order` so toggling cloze on a profile correctly updates existing cards

### Table Format

Cloze also works in table-based cards. Highlights in the Back column generate cloze cards with the Front column value as the front. Rows without highlights produce normal table cards.

### Duplicate Detection

Cloze cards are excluded from the duplicate detection check (`checkForDuplicatesInDeck`) since sharing the same front text is by design.
