## Image occlusion

There are two image-occlusion methods, and they run side by side:

- **Legacy (numbered list)** — an image embed plus a numbered list (documented below). Simple, no coordinates.
- **V2 (interactive)** — a self-contained `decks-occlusion` code block with precise, coordinate-based masks drawn in a studio. See [Image occlusion V2 (interactive)](#image-occlusion-v2-interactive).

Image occlusion flashcards combine an image with a numbered list to create cards where you identify labeled regions on an image.

### Format

Place an image embed followed by a numbered list under a header. The image should contain numbered indexes (labels) that correspond to the numbered list entries. Each `==highlighted==` term in the list is the answer for that label.

```markdown
## Bones of the arm

![[arm_bones.png]]
1. ==Humerus==
2. ==Radius==
3. ==Ulna==
```

### How it works

- The parser detects the image-embed + numbered-list pattern under a header when cloze is enabled on the profile
- Each numbered list item produces exactly one flashcard with type `image-occlusion`
- The image embed becomes the **front** of every card
- The numbered list (without the image) becomes the **back** of every card
- The active list item's cloze markers are blanked during review; other items follow the profile's cloze context mode (hidden or open)

### Card generation rules

- One card per non-empty list item, regardless of how many `==highlights==` it contains
- All highlights in the active item are blanked and revealed together as a group
- Items without `==highlights==` still generate cards — the full item text is treated as the answer
- Empty list items are skipped
- Reverse cards are not generated for image occlusion cards

### Parsing detection

The parser checks the content lines under a header:
1. First non-empty line must match the image embed regex: `![[filename.(png|jpg|jpeg|gif|svg|bmp|webp)]]`
2. All remaining non-empty lines must be numbered list items: `1. text`, `2. text`, etc.
3. If either condition fails, the block falls through to regular cloze or header-paragraph parsing

### Breadcrumb and navigation

Image occlusion cards include the card's own header in the breadcrumb (unlike other card types that exclude it). This allows the go-to-source button to navigate directly to the parent header in the source file by extracting the last breadcrumb part.

### ID generation

Image occlusion cards use the same ID scheme as cloze cards: `generateClozeFlashcardId(front, clozeText, clozeOrder, deckId)` where `front` is the image embed.

### Schema

The `flashcards` table type column accepts `'image-occlusion'` as a valid type (added in schema v12). The card stores:
- `front`: the image embed (e.g., `![[arm_bones.png]]`)
- `back`: the numbered list content (without the image embed)
- `cloze_text`: the answer text for this card's list item (with `==` markers stripped)
- `cloze_order`: the 0-based index of the list item

### Review rendering

1. **Front**: The image embed is rendered via Obsidian's markdown renderer
2. **Back**: `prepareImageOcclusionBack()` processes the numbered list — wraps non-cloze items in `==` markers so the post-processor can apply hidden/open mode to all items. Returns a mark index range (`markStart`, `markEnd`) identifying which `<mark>` elements belong to the active list item.
3. The markdown post-processor uses `data-decks-cloze-index` and `data-decks-cloze-index-end` attributes for range-based active mark identification, replacing active marks with clickable `[...]` blanks.
4. Clicking any active blank reveals all active blanks for that list item using the `data-decks-cloze-text` attribute.

---

## Image occlusion V2 (interactive)

V2 stores the whole occlusion — image reference, box geometry, and answers — in a single `decks-occlusion` code block, drawn and edited visually. It runs alongside the legacy path; the legacy numbered-list parser is untouched.

### Authoring

- Command **"Create image occlusion at cursor"**: pick a vault image, a block is inserted at the cursor, and the **studio** opens to draw boxes.
- In the studio: drag on the image to draw a box, drag/resize existing boxes, type a Markdown/LaTeX answer per box (or leave it empty for a deletion-only box), delete with the box's red ×.
- Re-edit any time from the block's **Edit** button (reading view) or from the flashcard manager (a V2 card opens the studio instead of the inline editor).

### Format

````markdown
```decks-occlusion
image: "[[anatomy/heart.png]]"
version: 2
masks:
  - id: m1
    x: 12.5
    y: 30
    w: 18
    h: 9.5
    answer: "Left **ventricle**"
  - id: m2
    x: 55
    y: 22
    w: 14
    h: 8
    answer: ""
```
````

- `image` accepts `[[wikilink]]`, `![[embed]]`, `![alt](path)`, or a bare path.
- `x, y, w, h` are **percentages (0–100)** of the rendered image, so masks scale on any device.
- `answer` is Markdown/LaTeX; an empty answer is a deletion-only box (reveals the region with no text).
- `id` is a stable token assigned per box.

### Card generation

- Parsed by a pre-pass in `FlashcardParser` that extracts `decks-occlusion` blocks before the line loop and blanks them out (so YAML never reaches the header/table parser). Gated on cloze being enabled, and the block must sit under a header at the deck's configured `headerLevel` (same rule as other cards).
- One card per mask, type **`image-occlusion-v2`** (schema v32). `front` = the image embed, `back` = the serialized doc (all masks), `cloze_text` = the active answer, `cloze_order` = the active index.
- **ID** = `generateOcclusionV2FlashcardId(deckId, imagePath, maskId)` — keyed only on the mask id, so moving/resizing a box or editing its answer preserves the card's FSRS history. Per-card content hash covers only the active mask, so editing one box never churns its siblings.
- V2 cards skip reverse-card generation and the fuzzy rename-match (deterministic ids).

### Rendering

- **Reading view** (code-block post-processor): the fully answered diagram — boxes with answers show their text as labels; deletion-only boxes go transparent to reveal the image. Includes an **Edit** button.
- **Review**: the active box is hidden (opaque, accent outline) on the front; **Show answer** reveals it in place and renders its answer below (deletion-only boxes show no panel). Front behavior follows the profile's `clozeShowContext` ("hidden" hides all boxes; "open" shows the others). Siblings group like cloze cards (by `deck_id` + `front`).

### Write-back

The studio serializes masks to YAML (`OcclusionV2Parser.toYaml`, JSON schema so the `y` key isn't quoted) and splices the block back into the note via `Vault.process`, locating the block by line hints with an image-reference fallback (`locateOcclusionBlock`).
