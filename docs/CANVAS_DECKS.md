# Canvas Decks

CanvasDecks lets you author flashcards on an Obsidian Canvas (`.canvas`) instead of a regular markdown file. Each canvas becomes one deck. Each text node on the canvas is parsed independently with the same four flashcard formats supported on markdown files: header-paragraph, table, cloze, and image-occlusion.

## How it works

### Setup

Open **Settings → Canvas decks** and configure:

- **Canvas decks folder** — every `.canvas` file inside this folder is treated as a deck. Leave the folder empty to disable canvas scanning entirely. Subfolders are included.
- **Canvas deck tag** — applied to every discovered canvas deck. Defaults to `#decks/canvas`. The tag controls which profile the decks use (via the existing **Profiles → Tag mappings** UI) and which group they appear under in the **Tags** view of the deck list. With no mapping, canvas decks fall back to the **DEFAULT** profile.

That's it. Drop a `.canvas` file in the configured folder, restart your sync or trigger a refresh, and the canvas appears as a new deck.

### Getting-started canvas

On first install — and once on the next plugin load for existing installs upgrading to a version that has Canvas Decks — the plugin auto-creates a `Decks — Canvas getting started.canvas` file inside a `Canvas decks/` folder, and points the **Canvas decks folder** setting at that folder if it was empty. The file demonstrates the three text-format card types (header-paragraph, table, cloze) across four text nodes.

You can also recreate it any time via the command palette: **Decks: Create canvas test deck**. Delete the file or fold the folder under another path — the plugin won't recreate or overwrite it (gated on the `hasCreatedCanvasTestDeck` flag and existence-check on the target path).

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

### Spatial cards

Beyond per-node parsing, you can also author **spatial cards** by drawing edges between text nodes:

- **From-node → front, to-node → back, edge label → hint.** The hint is rendered as a small italic chip above the front of the card during review and in the card browser. Front and back are taken as-is (no header parsing); whatever is in the from-node becomes the question text.
- **Tags on the front.** Any `#tag` in the from-node text is stripped from the front and stored on the card.
- **Graph patterns.** All of these work naturally:
  - **One-to-many**: A→B and A→C produce two cards (same front, different backs).
  - **Many-to-one**: A→C and B→C produce two cards (different fronts, same back).
  - **Cascade**: A→B→C produces two cards (A→B and B→C). The middle node B is purely a graph endpoint; it does not also get rule-parsed.
  - **Cycles and self-loops** are allowed; each edge produces a card.
- **Cloze on the back.** If the to-node contains `==highlight==` markup and cloze is enabled on the deck's profile, the spatial edge expands into one cloze card per highlight (each card has the same edge id, hint, and tags; the cloze hides on the back as usual).
- **Connected vs standalone.** Any text node that participates in at least one text-to-text edge is treated as a pure spatial endpoint and is **not** rule-parsed. Nodes with no edges fall through to the four standard formats (header-paragraph, table, cloze, image-occlusion) just like before.
- **Ignored shapes.** Edges that touch a non-text node (file, link, group) are dropped, as are non-text nodes themselves. Only text↔text edges produce spatial cards.
- **Stable identity.** The card id is derived from the canvas edge id, deck-scoped. Moving the nodes around, relabeling the edge, or renaming the from/to text all preserve the card's id (and therefore its review history).
- **No reverse.** Reverse-card expansion (set per profile) does not apply to spatial cards — edges are directional by design.

A small example ships with the getting-started canvas: three text nodes ("Photosynthesis", "Sunlight", "Glucose") wired with two labelled edges ("needs", "produces").

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
- Spatial cards are read-only from the plugin's in-place editor; edit them through Obsidian's canvas UI (drag the node, change its text, relabel the edge) and re-sync.
- Canvas focus on Go-to-source uses Obsidian's internal `CanvasView` API. If a future Obsidian update changes that API shape, focus silently degrades to "open the canvas" — no error, just a slightly less helpful jump.
- Node IDs in canvas files are stable across edits, so card-to-node mapping survives canvas reorganization. Moving a text node spatially doesn't change its ID.
- Deleting a text node deletes the cards it owned. Recreate similar cards in a new node and rename detection will reattach FSRS state where possible.

## Internals (for contributors)

The implementation lives in:

- `src/services/CanvasParser.ts` — JSON shape parser. Returns `{ nodes: { id, text }[], edges: { id, fromNode, toNode, label }[] }`. Edges are pre-filtered to keep only those whose endpoints are both text nodes.
- `src/services/CanvasFlashcardExtractor.ts` — for each edge, emits a spatial card (or a fan of cloze cards if the back contains highlights and cloze is enabled). For each text node that participates in no edges, runs `FlashcardParser.parseFlashcardsFromContent` and stamps `sourceNodeId` on each card.
- `src/services/DeckManager.ts` — `scanVaultForDecks` is extended to emit one entry per `.canvas` file in the configured folder under the configured tag.
- `src/services/FlashcardSynchronizer.ts` — branches on `.canvas` extension to route canvas content through the extractor; threads `sourceNodeId`/`edgeId` into card-ID hashing so cards never collide. Spatial and spatial-cloze cards skip the reverse-expansion path and the fuzzy rename-detection path since their ids are already deterministic.
- `src/services/FlashcardWriter.ts` — branches on canvas to rewrite the JSON node's text via `vault.process`.
- `src/utils/flashcard-navigator.ts` — single source for "go to source" navigation; uses the (undocumented) `CanvasView.canvas.selectOnly` + `zoomToBbox` API with a try/catch fallback.
- `src/utils/hash.ts` — `generateSpatialFlashcardId(deckId, edgeId)` and `generateSpatialClozeFlashcardId(deckId, edgeId, clozeText, clozeOrder)` give spatial cards their stable ids.
- `src/database/schemas.ts` — schema v20 adds `edge_id TEXT` (nullable) and `hint TEXT NOT NULL DEFAULT ''` to the `flashcards` table and adds `'spatial'` to the type CHECK constraint.
