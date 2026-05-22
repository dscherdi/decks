# Canvas Decks

CanvasDecks lets you author flashcards on an Obsidian Canvas (`.canvas`) instead of a regular markdown file. Each canvas becomes one deck. Each text node on the canvas is parsed independently with the same four flashcard formats supported on markdown files: header-paragraph, table, cloze, and image-occlusion.

## How it works

### Setup

Open **Settings → Canvas decks** and configure:

- **Canvas decks folder** — every `.canvas` file inside this folder is treated as a deck. Leave the folder empty to disable canvas scanning entirely. Subfolders are included.
- **Canvas deck tag** — applied to every discovered canvas deck. Defaults to `#decks/canvas`. The tag controls which profile the decks use (via the existing **Profiles → Tag mappings** UI) and which group they appear under in the **Tags** view of the deck list. With no mapping, canvas decks fall back to the **DEFAULT** profile.

That's it. Drop a `.canvas` file in the configured folder, restart your sync or trigger a refresh, and the canvas appears as a new deck.

### Per-text-node parsing

A canvas is a JSON document; each `type: "text"` node carries markdown content. The parser visits every text node independently and feeds its content through the same `FlashcardParser.parseFlashcardsFromContent()` pipeline used for markdown decks. The four card formats work inside a node:

- **Header-paragraph** — `## Question` followed by the body paragraph.
- **Table** — a two- or three-column markdown table.
- **Cloze** — `==highlight==` syntax in any header-paragraph body or table row (requires cloze enabled on the deck's profile).
- **Image occlusion** — image embed followed by a numbered list.

Mix freely: one text node can be a header-paragraph card, another a table of rows, another a cloze sentence. Each card "remembers" which node it came from so the plugin can navigate back to it on review.

### Deck identity

- The deck ID is derived from the canvas file path (same hash as markdown decks), so it stays stable across devices.
- Each card ID mixes in the canvas node ID, so two text nodes inside the same canvas with identical front text produce distinct cards — no collisions.
- If you delete a text node and recreate the same card later in a new node, the synchronizer's rename detection (back content match or front-text fuzzy match) restores the card's FSRS state.

## Working with canvas cards

### Reviewing

Canvas cards appear in the deck list (Files view) and grouped under the canvas deck tag in the Tags view. Reviewing is identical to markdown cards — ratings, sessions, daily limits, statistics, all work the same way.

### Go to source

The **Go to source** button in the review modal opens the source canvas and uses Obsidian's canvas API to **select and zoom to the text node** that contains the card. If the canvas API doesn't accept the focus call (different Obsidian build), the canvas still opens at the file root — you can find the node manually.

### Editing

Editing a canvas card from the **Flashcard Manager** writes back to the source canvas: it parses the JSON, locates the right text node by ID, rewrites the markdown segment for your edit (header line, table row, cloze sentence, or image-occlusion list item), and saves the canvas. Other nodes and node positions are preserved.

### Custom decks

Custom decks work without changes:

- **By filter** — build a filter deck with rule `deckTag = #decks/canvas` (or whatever tag you configured) to scope reviews to canvas cards only. Combine with other rules for fine-grained selection.
- **By selection** — pick individual canvas cards from the manager and add them to a manual custom deck like any other card.

## Limitations and notes

- Canvas files don't have markdown frontmatter, so `reverse: true` cannot be set per canvas. If you need reverse cards on canvas decks, file an issue — we'll likely add a setting.
- Canvas focus on Go-to-source uses Obsidian's internal `CanvasView` API. If a future Obsidian update changes that API shape, focus silently degrades to "open the canvas" — no error, just a slightly less helpful jump.
- Node IDs in canvas files are stable across edits, so card-to-node mapping survives canvas reorganization. Moving a text node spatially doesn't change its ID.
- Deleting a text node deletes the cards it owned. Recreate similar cards in a new node and rename detection will reattach FSRS state where possible.

## Internals (for contributors)

The implementation lives in:

- `src/services/CanvasParser.ts` — JSON shape parser. Returns `{ nodes: { id, text }[] }`.
- `src/services/CanvasFlashcardExtractor.ts` — runs `FlashcardParser.parseFlashcardsFromContent` per text node and stamps `sourceNodeId` on each card.
- `src/services/DeckManager.ts` — `scanVaultForDecks` is extended to emit one entry per `.canvas` file in the configured folder under the configured tag.
- `src/services/FlashcardSynchronizer.ts` — branches on `.canvas` extension to route canvas content through the extractor; threads `sourceNodeId` into card-ID hashing so canvas cards never collide.
- `src/services/FlashcardWriter.ts` — branches on canvas to rewrite the JSON node's text via `vault.process`.
- `src/utils/flashcard-navigator.ts` — single source for "go to source" navigation; uses the (undocumented) `CanvasView.canvas.selectOnly` + `zoomToBbox` API with a try/catch fallback.
- `src/database/schemas.ts` — schema v19 adds `source_node_id TEXT` (nullable) to the `flashcards` table.
